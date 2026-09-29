import { newId, newTraceId, type ThreadId } from "@harness/contracts";
import { InMemoryEventLog } from "@harness/events";
import type { ThreadBinding, ThreadRegistry, WorkflowIdentity } from "@harness/kernel";
import { describe, expect, it } from "vitest";
import {
  classifyExecutionError,
  LangGraphSmokeWorkflow,
  memoryCheckpointPersistence,
  type StreamObservation,
} from "../src/index.ts";

/*
 * Unit tests of graph logic with the in-memory saver. These are NOT evidence of
 * durable persistence; the real-PostgreSQL proofs live in tests/integration and
 * tests/e2e.
 */
class MemoryThreads implements ThreadRegistry {
  readonly #m = new Map<ThreadId, ThreadBinding>();
  async bind(b: ThreadBinding) {
    if (this.#m.has(b.thread_id)) throw new Error("dup");
    this.#m.set(b.thread_id, b);
  }
  async get(id: ThreadId) {
    return this.#m.get(id);
  }
}

function setup() {
  const events = new InMemoryEventLog();
  const observations: StreamObservation[] = [];
  const wf = new LangGraphSmokeWorkflow({
    persistence: memoryCheckpointPersistence(),
    events,
    threads: new MemoryThreads(),
    maxSteps: 25,
    onStream: (o) => observations.push(o),
  });
  const identity = (): WorkflowIdentity => ({
    run_id: newId("RunId"),
    thread_id: newId("ThreadId"),
    trace_id: newTraceId(),
  });
  return { events, observations, wf, identity };
}

describe("classifyExecutionError", () => {
  it("maps raw connection-loss driver errors to DB_DISCONNECTED and other errors to NODE_FAILED", () => {
    expect(classifyExecutionError(Object.assign(new Error("x"), { code: "57P01" }))).toBe("DB_DISCONNECTED");
    expect(classifyExecutionError(Object.assign(new Error("x"), { code: "ECONNRESET" }))).toBe(
      "DB_DISCONNECTED",
    );
    expect(classifyExecutionError(new Error("Connection terminated unexpectedly"))).toBe("DB_DISCONNECTED");
    expect(classifyExecutionError(new Error("some bug"))).toBe("NODE_FAILED");
    expect(classifyExecutionError(Object.assign(new Error("x"), { code: "23505" }))).toBe("NODE_FAILED");
  });
});

describe("smoke graph (unit, in-memory saver)", () => {
  it("runs deterministic nodes to completion without approval", async () => {
    const { wf, identity, events, observations } = setup();
    const id = identity();
    const out = await wf.start(id, { goal: "  Prove   P00 ", approval_required: false });
    expect(out.kind).toBe("completed");
    expect(out.state["intent"]).toBe("intent:prove p00");
    expect(out.state["outcome"]).toBe("completed");
    expect(out.state["steps"]).toEqual(["initialize_run", "record_intent", "approval_gate", "finalize"]);
    expect(observations.flatMap((o) => o.nodes)).toEqual([
      "initialize_run",
      "record_intent",
      "approval_gate",
      "finalize",
    ]);
    const types = (await events.listByRun(id.run_id)).map((e) => e.event_type);
    expect(types[0]).toBe("graph.started");
    expect(types.at(-1)).toBe("graph.completed");
    expect(types).toContain("policy.decision_recorded");
  });

  it("is deterministic: same input gives the same final state", async () => {
    const { wf, identity } = setup();
    const a = await wf.start(identity(), { goal: "same", approval_required: false });
    const b = await wf.start(identity(), { goal: "same", approval_required: false });
    const strip = (s: Record<string, unknown>) => ({ ...s, run_id: 0, thread_id: 0, trace_id: 0 });
    expect(strip(a.state)).toEqual(strip(b.state));
  });

  it("pauses at the human interrupt and resumes with an explicit response", async () => {
    const { wf, identity } = setup();
    const id = identity();
    const first = await wf.start(id, { goal: "needs approval", approval_required: true });
    expect(first.kind).toBe("interrupted");
    if (first.kind !== "interrupted") return;
    expect(first.interrupt).toMatchObject({ node: "interrupt_for_human", kind: "approval" });
    const second = await wf.resume(id, { decision: "approve", responder: "unit-test" });
    expect(second.kind).toBe("completed");
    expect(second.state["approval"]).toEqual({ decision: "approve", responder: "unit-test" });
  });

  it("human denial overrides intent (INV-015)", async () => {
    const { wf, identity } = setup();
    const id = identity();
    await wf.start(id, { goal: "g", approval_required: true });
    const out = await wf.resume(id, { decision: "deny", responder: "unit-test" });
    expect(out.state["outcome"]).toBe("denied_by_human");
  });

  it("classifies a forced node failure and records the failing node", async () => {
    const { wf, identity, events } = setup();
    const id = identity();
    await expect(
      wf.start(id, { goal: "g", approval_required: false, fail_at_node: "record_intent" }),
    ).rejects.toMatchObject({ code: "NODE_FAILED", details: { node: "record_intent" } });
    const last = (await events.listByRun(id.run_id)).at(-1);
    expect(last).toMatchObject({ event_type: "graph.failed", payload: { node: "record_intent" } });
  });

  it("rejects invalid input and invalid human responses", async () => {
    const { wf, identity } = setup();
    await expect(wf.start(identity(), { goal: "", approval_required: false })).rejects.toMatchObject({
      code: "PAYLOAD_INVALID",
    });
    const id = identity();
    await wf.start(id, { goal: "g", approval_required: true });
    await expect(wf.resume(id, { decision: "maybe" } as never)).rejects.toMatchObject({
      code: "PAYLOAD_INVALID",
    });
  });

  it("refuses to start the same thread twice", async () => {
    const { wf, identity } = setup();
    const id = identity();
    await wf.start(id, { goal: "g", approval_required: false });
    await expect(wf.start(id, { goal: "g", approval_required: false })).rejects.toMatchObject({
      code: "DUPLICATE_ID",
    });
  });
});
