import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createTestDatabase,
  pgRepositories,
  requireDatabaseUrl,
  type TestDatabase,
} from "@harness/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * P00 restart/resume proof (P00 spec §15 scenarios 1–6, §33 #9 and #15).
 * Every step runs in a separate OS process against real PostgreSQL; nothing is
 * shared in memory between the process that checkpoints and the one that resumes.
 */
let t: TestDatabase;
let env: NodeJS.ProcessEnv;
const script = join(import.meta.dirname, "smoke-process.ts");

function child(...args: string[]): { pid: number } & Record<string, unknown> {
  const r = spawnSync(process.execPath, [script, ...args], { env, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`child ${args[0]} exited ${r.status}: ${r.stderr}`);
  const line = r.stdout.trim().split("\n").at(-1) ?? "";
  return JSON.parse(line) as { pid: number } & Record<string, unknown>;
}

beforeAll(async () => {
  t = await createTestDatabase(requireDatabaseUrl());
  env = {
    PATH: process.env["PATH"],
    SystemRoot: process.env["SystemRoot"],
    HARNESS_ENV: "test",
    DATABASE_URL: t.url,
    HARNESS_ARTIFACT_ROOT: mkdtempSync(join(tmpdir(), "harness-e2e-")),
    HARNESS_LOG_LEVEL: "error",
  };
});
afterAll(async () => {
  await t?.drop();
});

describe("process restart → resume on the same thread", () => {
  it("persists across process death, stays interrupted until resumed, then completes", async () => {
    const started = child("start");
    expect(started["kind"]).toBe("interrupted");
    const identity = started["identity"] as { run_id: string; thread_id: string; trace_id: string };

    // A different process sees the persisted, still-pending interrupt (graph not resumed ≠ completed).
    const inspected = child("inspect", JSON.stringify(identity));
    expect(inspected.pid).not.toBe(started.pid);
    const snapshot = inspected["snapshot"] as {
      pending_interrupt: { node: string } | null;
      state: Record<string, unknown>;
    };
    expect(snapshot.pending_interrupt?.node).toBe("interrupt_for_human");
    expect(snapshot.state["intent"]).toBe("intent:restart proof");
    expect(snapshot.state["outcome"]).toBeNull();
    const repos = pgRepositories(t.db);
    expect((await repos.runs.get(identity.run_id as never))?.status).toBe("INTERRUPTED");

    // A third process resumes with an explicit human response.
    const resumed = child("resume", JSON.stringify(identity));
    expect(resumed.pid).not.toBe(started.pid);
    expect(resumed["kind"]).toBe("completed");
    const state = resumed["state"] as Record<string, unknown>;
    expect(state["approval"]).toEqual({ decision: "approve", responder: "e2e-operator" });
    expect(state["outcome"]).toBe("completed");
    expect(state["steps"]).toEqual([
      "initialize_run",
      "record_intent",
      "approval_gate",
      "interrupt_for_human",
      "finalize",
    ]);

    // Durable record: status, and one unbroken causal chain across both processes.
    expect((await repos.runs.get(identity.run_id as never))?.status).toBe("COMPLETED");
    const events = await repos.events.listByRun(identity.run_id as never);
    const types = events.map((e) => e.event_type);
    expect(types.filter((x) => x === "graph.interrupted")).toHaveLength(1);
    expect(types.filter((x) => x === "graph.resumed")).toHaveLength(1);
    expect(types.indexOf("graph.interrupted")).toBeLessThan(types.indexOf("graph.resumed"));
    expect(types.at(-1)).toBe("run.status_changed");
    for (const [i, e] of events.slice(1).entries()) expect(e.causation_id).toBe(events[i]?.event_id);
    // Pre-restart nodes were not re-executed after resume.
    const nodeStarts = events.filter((e) => e.event_type === "graph.node_started").map((e) => e.payload);
    expect(nodeStarts.filter((p) => (p as { node: string }).node === "record_intent")).toHaveLength(1);
  });

  it("an interrupted graph that is never resumed remains INTERRUPTED (no silent completion)", async () => {
    const started = child("start");
    const identity = started["identity"] as { run_id: string; thread_id: string };
    const again = child("inspect", JSON.stringify(identity));
    expect((again["snapshot"] as { pending_interrupt: unknown }).pending_interrupt).not.toBeNull();
    expect((await pgRepositories(t.db).runs.get(identity.run_id as never))?.status).toBe("INTERRUPTED");
    const types = (await pgRepositories(t.db).events.listByRun(identity.run_id as never)).map(
      (e) => e.event_type,
    );
    expect(types).not.toContain("graph.completed");
  });
});
