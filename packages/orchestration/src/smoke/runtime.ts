import { HarnessError, isHarnessError, type JsonObject, type ThreadId } from "@harness/contracts";
import type { EventLog } from "@harness/events";
import type {
  PendingInterrupt,
  ThreadRegistry,
  ThreadSnapshot,
  WorkflowIdentity,
  WorkflowOutcome,
  WorkflowRuntime,
} from "@harness/kernel";
import { Command } from "@langchain/langgraph";
import { type CheckpointPersistence, saverOf } from "../checkpoint-persistence.ts";
import { RunEventEmitter } from "../event-emitter.ts";
import { buildSmokeGraph, type NodeHooks, type SmokeStateValues } from "./graph.ts";
import {
  type HumanResponse,
  HumanResponseSchema,
  SMOKE_GRAPH_NAME,
  SMOKE_GRAPH_VERSION,
  type SmokeInput,
  SmokeInputSchema,
  type SmokeNode,
} from "./schemas.ts";

/** One observed streaming chunk; recorded as evidence of streaming observation. */
export interface StreamObservation {
  mode: "updates";
  nodes: string[];
}

export interface SmokeWorkflowDeps {
  persistence: CheckpointPersistence;
  events: EventLog;
  threads: ThreadRegistry;
  maxSteps: number;
  onStream?: (observation: StreamObservation) => void;
}

const graphRef = { graph: SMOKE_GRAPH_NAME, graph_version: SMOKE_GRAPH_VERSION };

/**
 * LangGraph implementation of the harness WorkflowRuntime port for the P00
 * smoke graph. All LangGraph types stay inside this package.
 */
export class LangGraphSmokeWorkflow implements WorkflowRuntime<SmokeInput, HumanResponse> {
  readonly name = SMOKE_GRAPH_NAME;
  readonly version = SMOKE_GRAPH_VERSION;
  readonly #deps: SmokeWorkflowDeps;

  constructor(deps: SmokeWorkflowDeps) {
    this.#deps = deps;
  }

  #config(threadId: ThreadId) {
    return { configurable: { thread_id: threadId }, recursionLimit: this.#deps.maxSteps };
  }

  #graph(emitter: RunEventEmitter | null, failed: { node: SmokeNode | undefined }) {
    const hooks: NodeHooks = {
      started: async (node) => {
        await emitter?.emit("graph.node_started", { ...graphRef, node });
      },
      completed: async (node, duration_ms) => {
        await emitter?.emit("graph.node_completed", { ...graphRef, node, duration_ms });
      },
      policyDecision: async (decision) => {
        await emitter?.emit("policy.decision_recorded", { subject: "p00.smoke.intent", decision });
      },
      failed: (node) => {
        failed.node = node;
      },
    };
    return buildSmokeGraph(hooks, saverOf(this.#deps.persistence));
  }

  async start(identity: WorkflowIdentity, input: SmokeInput): Promise<WorkflowOutcome> {
    const parsed = SmokeInputSchema.safeParse(input);
    if (!parsed.success) throw new HarnessError("PAYLOAD_INVALID", "invalid smoke input");
    if ((await this.#deps.threads.get(identity.thread_id)) !== undefined) {
      throw new HarnessError("DUPLICATE_ID", "thread already started", {
        details: { thread_id: identity.thread_id },
      });
    }
    await this.#deps.threads.bind({
      thread_id: identity.thread_id,
      run_id: identity.run_id,
      graph_name: SMOKE_GRAPH_NAME,
      graph_version: SMOKE_GRAPH_VERSION,
    });
    const emitter = await RunEventEmitter.open(this.#deps.events, identity);
    await emitter.emit("graph.started", graphRef);
    const initial = {
      run_id: identity.run_id,
      thread_id: identity.thread_id,
      trace_id: identity.trace_id,
      goal: parsed.data.goal,
      approval_required: parsed.data.approval_required,
      fail_at_node: parsed.data.fail_at_node,
    };
    return this.#execute(identity, emitter, initial);
  }

  async resume(identity: WorkflowIdentity, response: HumanResponse): Promise<WorkflowOutcome> {
    const binding = await this.#deps.threads.get(identity.thread_id);
    if (binding === undefined) {
      throw new HarnessError("THREAD_NOT_FOUND", "no such workflow thread", {
        details: { thread_id: identity.thread_id },
      });
    }
    if (binding.run_id !== identity.run_id || binding.graph_name !== SMOKE_GRAPH_NAME) {
      throw new HarnessError("THREAD_MISMATCH", "thread belongs to a different run or graph", {
        details: { thread_id: identity.thread_id, requested_run_id: identity.run_id },
      });
    }
    const snapshot = await this.inspect(identity.thread_id);
    if (snapshot?.pending_interrupt == null) {
      throw new HarnessError("GRAPH_NOT_INTERRUPTED", "thread has no pending interrupt to resume", {
        details: { thread_id: identity.thread_id },
      });
    }
    const parsed = HumanResponseSchema.safeParse(response);
    if (!parsed.success) throw new HarnessError("PAYLOAD_INVALID", "invalid human response");
    const emitter = await RunEventEmitter.open(this.#deps.events, identity);
    await emitter.emit("graph.resumed", { ...graphRef, resume_kind: `human_${parsed.data.decision}` });
    return this.#execute(identity, emitter, new Command({ resume: parsed.data }));
  }

  async #execute(
    identity: WorkflowIdentity,
    emitter: RunEventEmitter,
    input: Record<string, unknown> | Command,
  ): Promise<WorkflowOutcome> {
    const failed: { node: SmokeNode | undefined } = { node: undefined };
    const graph = this.#graph(emitter, failed);
    try {
      const stream = await graph.stream(input as never, {
        ...this.#config(identity.thread_id),
        streamMode: "updates",
      });
      for await (const chunk of stream) {
        this.#deps.onStream?.({ mode: "updates", nodes: Object.keys(chunk as object) });
      }
    } catch (error) {
      const code = isHarnessError(error) ? error.code : "NODE_FAILED";
      const message = error instanceof Error ? error.message : String(error);
      await emitter.emit("graph.failed", {
        ...graphRef,
        ...(failed.node === undefined ? {} : { node: failed.node }),
        error_code: code,
        message,
      });
      throw new HarnessError(
        "NODE_FAILED",
        `smoke graph failed${failed.node ? ` in node ${failed.node}` : ""}`,
        {
          details: { node: failed.node ?? null, cause_code: code, thread_id: identity.thread_id },
          cause: error,
        },
      );
    }
    const snapshot = await this.inspect(identity.thread_id);
    if (snapshot === undefined) throw new HarnessError("UNKNOWN_OUTCOME", "no checkpoint after execution");
    if (snapshot.pending_interrupt !== null) {
      await emitter.emit("graph.interrupted", {
        ...graphRef,
        node: snapshot.pending_interrupt.node,
        interrupt_kind: snapshot.pending_interrupt.kind,
      });
      return { kind: "interrupted", identity, interrupt: snapshot.pending_interrupt, state: snapshot.state };
    }
    await emitter.emit("graph.completed", { ...graphRef, outcome: String(snapshot.state["outcome"]) });
    return { kind: "completed", identity, state: snapshot.state };
  }

  async inspect(threadId: ThreadId): Promise<ThreadSnapshot | undefined> {
    const graph = this.#graph(null, { node: undefined });
    const snap = await graph.getState(this.#config(threadId));
    // LangGraph returns an empty snapshot (no checkpoint) for unknown threads.
    if (snap.config?.configurable?.["checkpoint_id"] === undefined) return undefined;
    const values = snap.values as SmokeStateValues;
    let pending: PendingInterrupt | null = null;
    for (const task of snap.tasks) {
      const first = task.interrupts[0];
      if (first !== undefined) {
        const value = first.value as { kind?: unknown } | undefined;
        pending = {
          node: task.name,
          kind: typeof value?.kind === "string" ? value.kind : "unknown",
          prompt: JSON.parse(JSON.stringify(first.value ?? null)),
        };
        break;
      }
    }
    return {
      identity: {
        run_id: values.run_id as WorkflowIdentity["run_id"],
        thread_id: threadId,
        trace_id: values.trace_id as WorkflowIdentity["trace_id"],
      },
      state: JSON.parse(JSON.stringify(values)) as JsonObject,
      next: [...snap.next],
      pending_interrupt: pending,
    };
  }
}
