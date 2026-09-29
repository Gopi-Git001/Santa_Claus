import { newId, newTraceId } from "@harness/contracts";
import {
  createTestDatabase,
  pgRepositories,
  requireDatabaseUrl,
  type TestDatabase,
} from "@harness/persistence";
import { createSmokeHarness, type SmokeHarness } from "@harness/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testConfig } from "../support/env.ts";

// Real PostgreSQL checkpointer + system of record. Never skipped.
let t: TestDatabase;
let h: SmokeHarness;
beforeAll(async () => {
  t = await createTestDatabase(requireDatabaseUrl());
  h = await createSmokeHarness({ config: testConfig(t.url), databaseUrl: t.url });
});
afterAll(async () => {
  await h?.close();
  await t?.drop();
});

describe("LangGraph.js smoke graph on PostgreSQL", () => {
  it("executes, streams, and records the run lifecycle and causal event chain", async () => {
    const before = h.observations.length;
    const { identity, outcome } = await h.startRun({ goal: "integration smoke", approval_required: false });
    expect(outcome.kind).toBe("completed");
    expect(h.observations.length - before).toBe(4);

    const repos = pgRepositories(t.db);
    expect((await repos.runs.get(identity.run_id))?.status).toBe("COMPLETED");
    const events = await repos.events.listByRun(identity.run_id);
    expect(events.map((e) => e.event_type)).toEqual([
      "run.created",
      "run.status_changed",
      "graph.started",
      ...["initialize_run", "record_intent"].flatMap(() => ["graph.node_started", "graph.node_completed"]),
      "graph.node_started",
      "graph.node_completed",
      "policy.decision_recorded",
      "graph.node_started",
      "graph.node_completed",
      "graph.completed",
      "artifact.created",
      "run.status_changed",
    ]);
    // Every event after the first is caused by its predecessor; all share the run correlation.
    events.slice(1).forEach((e, i) => {
      expect(e.causation_id).toBe(events[i]?.event_id);
    });
    expect(new Set(events.map((e) => e.correlation_id))).toEqual(new Set([identity.run_id]));
    expect(new Set(events.map((e) => e.trace_id))).toEqual(new Set([identity.trace_id]));
  });

  it("writes durable checkpoints to the dedicated checkpoint schema, separate from harness tables", async () => {
    const { identity } = await h.startRun({ goal: "checkpoint rows", approval_required: true });
    const r = await t.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM harness_checkpoints.checkpoints WHERE thread_id = $1",
      [identity.thread_id],
    );
    expect(Number(r.rows[0]?.n)).toBeGreaterThan(0);
    const leaked = await t.db.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'checkpoint%'",
    );
    expect(leaked.rows).toEqual([]);
    const snap = await h.workflow.inspect(identity.thread_id);
    expect(snap?.pending_interrupt?.node).toBe("interrupt_for_human");
    expect((await pgRepositories(t.db).runs.get(identity.run_id))?.status).toBe("INTERRUPTED");
  });

  it("isolates threads: another run cannot resume this thread, unknown threads are rejected", async () => {
    const a = await h.startRun({ goal: "thread A", approval_required: true });
    const b = await h.startRun({ goal: "thread B", approval_required: true });

    // Run B's identity pointed at thread A → mismatch, and A is untouched.
    await expect(
      h.resumeRun(
        { ...b.identity, thread_id: a.identity.thread_id },
        { decision: "approve", responder: "x" },
      ),
    ).rejects.toMatchObject({ code: "THREAD_MISMATCH" });
    // A thread that was never started.
    await expect(
      h.resumeRun(
        { run_id: a.identity.run_id, thread_id: newId("ThreadId"), trace_id: newTraceId() },
        { decision: "approve", responder: "x" },
      ),
    ).rejects.toMatchObject({ code: "THREAD_NOT_FOUND" });

    const snapA = await h.workflow.inspect(a.identity.thread_id);
    expect(snapA?.pending_interrupt).not.toBeNull();
    expect(snapA?.state["goal"]).toBe("thread A");
    expect((await pgRepositories(t.db).runs.get(a.identity.run_id))?.status).toBe("INTERRUPTED");

    // Each thread resumes independently with its own state.
    const doneB = await h.resumeRun(b.identity, { decision: "deny", responder: "x" });
    const doneA = await h.resumeRun(a.identity, { decision: "approve", responder: "x" });
    expect(doneA.state["goal"]).toBe("thread A");
    expect(doneA.state["outcome"]).toBe("completed");
    expect(doneB.state["goal"]).toBe("thread B");
    expect(doneB.state["outcome"]).toBe("denied_by_human");
  });

  it("rejects resuming a thread that has no pending interrupt", async () => {
    const { identity } = await h.startRun({ goal: "no interrupt", approval_required: false });
    await expect(h.resumeRun(identity, { decision: "approve", responder: "x" })).rejects.toMatchObject({
      code: "GRAPH_NOT_INTERRUPTED",
    });
  });

  it("marks the run FAILED with a classified error when a node fails", async () => {
    await expect(
      h.startRun({ goal: "fail", approval_required: false, fail_at_node: "finalize" }),
    ).rejects.toMatchObject({ code: "NODE_FAILED", details: { node: "finalize" } });
    const r = await t.db.query<{ id: string; status: string }>(
      "SELECT id, status FROM harness_runs WHERE root_goal = 'fail'",
    );
    const runId = r.rows[0]?.id;
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.status).toBe("FAILED");
    const events = await pgRepositories(t.db).events.listByRun(runId as never);
    expect(events.find((e) => e.event_type === "graph.failed")).toMatchObject({
      payload: { node: "finalize", error_code: "NODE_FAILED" },
    });
  });
});
