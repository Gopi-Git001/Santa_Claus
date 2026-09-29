/*
 * The P00 smoke graph. Nodes are pure and deterministic: they only read graph
 * state and return state updates. This module must not import anything that
 * grants shell, filesystem, network, process or environment access — enforced
 * by tests/contract/no-authority.test.ts.
 */
import type { PolicyDecision } from "@harness/contracts";
import { HarnessError } from "@harness/contracts";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { Annotation, END, interrupt, isGraphInterrupt, START, StateGraph } from "@langchain/langgraph";
import { type HumanResponse, HumanResponseSchema, type SmokeNode } from "./schemas.ts";

export const SmokeState = Annotation.Root({
  run_id: Annotation<string>(),
  thread_id: Annotation<string>(),
  trace_id: Annotation<string>(),
  goal: Annotation<string>(),
  approval_required: Annotation<boolean>(),
  fail_at_node: Annotation<SmokeNode | null>(),
  intent: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
  policy_decision: Annotation<PolicyDecision | null>({ reducer: (_, v) => v, default: () => null }),
  approval: Annotation<HumanResponse | null>({ reducer: (_, v) => v, default: () => null }),
  outcome: Annotation<string | null>({ reducer: (_, v) => v, default: () => null }),
  steps: Annotation<string[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
});

export type SmokeStateValues = typeof SmokeState.State;
type Update = Partial<typeof SmokeState.Update>;

/** Observation hooks the runtime adapter uses to emit harness events. */
export interface NodeHooks {
  started(node: SmokeNode): Promise<void>;
  completed(node: SmokeNode, durationMs: number): Promise<void>;
  policyDecision(decision: PolicyDecision): Promise<void>;
  failed(node: SmokeNode): void;
}

function instrument(node: SmokeNode, hooks: NodeHooks, fn: (s: SmokeStateValues) => Update) {
  return async (state: SmokeStateValues): Promise<Update> => {
    await hooks.started(node);
    const started = performance.now();
    try {
      if (state.fail_at_node === node) {
        throw new HarnessError("NODE_FAILED", `forced failure in node ${node}`, { details: { node } });
      }
      const update = fn(state);
      await hooks.completed(node, performance.now() - started);
      return { ...update, steps: [node] };
    } catch (error) {
      // An interrupt is a controlled pause, not a failure.
      if (!isGraphInterrupt(error)) hooks.failed(node);
      throw error;
    }
  };
}

export function buildSmokeGraph(hooks: NodeHooks, checkpointer: BaseCheckpointSaver) {
  const decisionFor = (state: SmokeStateValues): PolicyDecision => ({
    schema_version: 1,
    decision: state.approval_required ? "ASK_HUMAN" : "AUTO_ALLOW",
    reason_code: state.approval_required ? "P00_DEMO_APPROVAL_REQUIRED" : "P00_DEMO_NO_SIDE_EFFECT",
    policy_version: "p00-demo-1",
    constraints: {},
  });

  return new StateGraph(SmokeState)
    .addNode(
      "initialize_run",
      instrument("initialize_run", hooks, (s) => {
        if (s.run_id === "" || s.thread_id === "") {
          throw new HarnessError("PAYLOAD_INVALID", "smoke graph started without identity");
        }
        return {};
      }),
    )
    .addNode(
      "record_intent",
      instrument("record_intent", hooks, (s) => ({
        intent: `intent:${s.goal.trim().toLowerCase().replace(/\s+/g, " ")}`,
      })),
    )
    .addNode("approval_gate", async (state: SmokeStateValues): Promise<Update> => {
      // Records the (static, demo) policy decision; a real policy engine is P06.
      const decision = decisionFor(state);
      const update = await instrument("approval_gate", hooks, () => ({ policy_decision: decision }))(state);
      await hooks.policyDecision(decision);
      return update;
    })
    .addNode(
      "interrupt_for_human",
      instrument("interrupt_for_human", hooks, (s) => {
        const raw = interrupt({
          kind: "approval",
          question: "Approve the P00 smoke intent?",
          intent: s.intent,
        });
        const parsed = HumanResponseSchema.safeParse(raw);
        if (!parsed.success) {
          throw new HarnessError("PAYLOAD_INVALID", "invalid human response", {
            details: { issues: parsed.error.issues.map((i) => i.message) },
          });
        }
        return { approval: parsed.data };
      }),
    )
    .addNode(
      "finalize",
      instrument("finalize", hooks, (s) => ({
        // Human denial overrides agent intent (INV-015).
        outcome: s.approval?.decision === "deny" ? "denied_by_human" : "completed",
      })),
    )
    .addEdge(START, "initialize_run")
    .addEdge("initialize_run", "record_intent")
    .addEdge("record_intent", "approval_gate")
    .addConditionalEdges(
      "approval_gate",
      (s: SmokeStateValues) => (s.approval_required ? "interrupt_for_human" : "finalize"),
      ["interrupt_for_human", "finalize"],
    )
    .addEdge("interrupt_for_human", "finalize")
    .addEdge("finalize", END)
    .compile({ checkpointer, name: "p00.smoke" });
}
