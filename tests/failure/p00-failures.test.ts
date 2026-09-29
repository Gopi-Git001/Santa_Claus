import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FilesystemArtifactStore } from "@harness/artifacts";
import { CapabilityRegistry } from "@harness/capabilities";
import { loadConfig } from "@harness/config";
import { HarnessError, newId, newTraceId, parseContract, RunContract } from "@harness/contracts";
import { createEvent, parseEvent } from "@harness/events";
import { createMemoryLogger } from "@harness/observability";
import {
  createTestDatabase,
  Database,
  pgRepositories,
  requireDatabaseUrl,
  type TestDatabase,
} from "@harness/persistence";
import { createSmokeHarness, echoCapability, type SmokeHarness } from "@harness/testing";
import { type CapabilityRecord, validateLedger, validatePhases } from "@harness/traceability";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runSmokeChild } from "../e2e/child.ts";
import { testConfig } from "../support/env.ts";
import { FAILURE_SCENARIOS, observe } from "./scenarios.ts";

// Real PostgreSQL throughout; failures here must never be skipped.
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

async function codeOf(p: Promise<unknown> | (() => unknown)): Promise<string> {
  try {
    await (typeof p === "function" ? p() : p);
  } catch (e) {
    return e instanceof HarnessError ? e.code : `UNCLASSIFIED:${String(e)}`;
  }
  return "NO_ERROR";
}

// Fixture-only ledger (IDs outside the reserved C001–C168 range; see P00-BLK-001).
const fixtureOpts = {
  capabilityRange: { first: 901, last: 902 },
  expectedDomainCount: 1,
  phaseRange: { first: 0, last: 1 },
  invariantRange: { first: 1, last: 1 },
  refExists: () => true,
};
const fixtureDomains = {
  schema_version: 1 as const,
  source: "fixture",
  domains: [{ id: "S01", name: "n", responsibility: "r" }],
};
const fixturePhase = (id: string, prerequisites: string[]) => ({
  id,
  purpose: "fixture",
  prerequisites,
  owned_capability_ids: [],
  entry_criteria: [],
  exit_criteria: [],
  evidence_requirements: [],
  status: "NOT_STARTED" as const,
  sources: ["fixture"],
});
const fixturePhases = {
  schema_version: 1 as const,
  source: "fixture",
  phases: [fixturePhase("P00", []), fixturePhase("P01", ["P00"])],
};
const fixtureCap = (id: string, o: Partial<CapabilityRecord> = {}): CapabilityRecord => ({
  id,
  title: `FIXTURE ${id}`,
  description: "fixture",
  domain: "S01",
  owning_phase: "P01",
  dependencies: [],
  status: "SPECIFIED",
  mandatory: false,
  implementation_refs: [],
  test_refs: [],
  security_refs: [],
  evidence_refs: [],
  notes: "",
  ...o,
});

describe("P00 failure scenarios (§33)", () => {
  it("covers all 15 scenarios", () => {
    expect(FAILURE_SCENARIOS.map((s) => s.id)).toEqual(
      Array.from({ length: 15 }, (_, i) => `F${String(i + 1).padStart(2, "0")}`),
    );
  });

  it("F01 invalid configuration fails clearly with CONFIG_INVALID", async () => {
    expect(
      observe("F01", await codeOf(() => loadConfig({ HARNESS_ENV: "prod", DATABASE_URL: "nope" }))),
    ).toBe("CONFIG_INVALID");
  });

  it("F02 PostgreSQL unavailable at startup gives DB_UNAVAILABLE without leaking credentials", async () => {
    const secret = ["f02", "pw"].join("-");
    const url = `postgres://harness:${secret}@127.0.0.1:1/none`;
    let err: unknown;
    try {
      await Database.connect({ connectionString: url, connectTimeoutMs: 2_000 });
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: "DB_UNAVAILABLE" });
    expect(JSON.stringify({ m: (err as Error).message, d: (err as HarnessError).details })).not.toContain(
      secret,
    );
    const cfg = testConfig(url, { HARNESS_DB_CONNECT_TIMEOUT_MS: "2000" });
    expect(observe("F02", await codeOf(createSmokeHarness({ config: cfg })))).toBe("DB_UNAVAILABLE");
  });

  /*
   * F03: a one-shot trigger kills the *inserting backend itself* at an exact point
   * inside a running workflow (deterministic, no timing races). A sequence gates
   * it because sequences are non-transactional, so the rollback caused by the
   * kill cannot re-arm the trigger.
   */
  async function armKillSwitch(table: string, condition: string): Promise<string> {
    const tag = `f03_${Math.random().toString(36).slice(2, 8)}`;
    await t.db.query(`CREATE SEQUENCE ${tag}_seq`);
    await t.db.query(`CREATE FUNCTION ${tag}_fn() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF ${condition} THEN
          IF nextval('${tag}_seq') = 1 THEN PERFORM pg_terminate_backend(pg_backend_pid()); END IF;
        END IF;
        RETURN NEW;
      END $$`);
    await t.db.query(
      `CREATE TRIGGER ${tag}_trg BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION ${tag}_fn()`,
    );
    return tag;
  }

  it("F03 database disconnect during the test workflow is DB_DISCONNECTED; run outcome UNKNOWN (INV-012); system recovers", async () => {
    // (a) connection lost while a graph node writes its event (system-of-record connection).
    await armKillSwitch(
      "harness_events",
      "NEW.event_type = 'graph.node_started' AND NEW.envelope->'payload'->>'node' = 'record_intent'",
    );
    const eventWrite = await h.startRun({ goal: "F03-a", approval_required: false }).catch((e: unknown) => e);
    expect(eventWrite).toMatchObject({
      code: "NODE_FAILED",
      details: { node: "record_intent", cause_code: "DB_DISCONNECTED" },
    });
    observe("F03", String((eventWrite as HarnessError).details["cause_code"]));

    // (b) connection lost while LangGraph writes a checkpoint (checkpoint-store connection).
    await armKillSwitch("harness_checkpoints.checkpoints", "TRUE");
    const checkpointWrite = await h
      .startRun({ goal: "F03-b", approval_required: false })
      .catch((e: unknown) => e);
    expect(checkpointWrite).toMatchObject({
      code: "NODE_FAILED",
      details: { cause_code: "DB_DISCONNECTED" },
    });

    // Both runs are UNKNOWN, never silently FAILED, and the loss is recorded.
    const runs = await t.db.query<{ root_goal: string; status: string }>(
      "SELECT root_goal, status FROM harness_runs WHERE root_goal IN ('F03-a', 'F03-b') ORDER BY root_goal",
    );
    expect(runs.rows).toEqual([
      { root_goal: "F03-a", status: "UNKNOWN" },
      { root_goal: "F03-b", status: "UNKNOWN" },
    ]);

    // Recovery: the kill switches are spent; new work and a pending interrupt proceed normally.
    const fresh = await h.startRun({ goal: "F03-after", approval_required: true });
    const done = await h.resumeRun(fresh.identity, { decision: "approve", responder: "f03" });
    expect(done.kind).toBe("completed");
  });

  it("F04 invalid or corrupted event payloads are rejected as PAYLOAD_INVALID", async () => {
    const e = createEvent(
      "graph.started",
      { graph: "g", graph_version: "1" },
      { run_id: newId("RunId"), trace_id: newTraceId() },
    );
    expect(observe("F04", await codeOf(() => parseEvent({ ...e, payload: { graph: 1 } })))).toBe(
      "PAYLOAD_INVALID",
    );
    expect(await codeOf(() => parseEvent({ ...e, trace_id: "not-a-trace" }))).toBe("PAYLOAD_INVALID");
    expect(await codeOf(() => parseEvent(null))).toBe("PAYLOAD_INVALID");
  });

  it("F05 duplicate capability ID is rejected as DUPLICATE_ID (registry and ledger)", async () => {
    const reg = new CapabilityRegistry();
    reg.register(echoCapability);
    expect(observe("F05", await codeOf(() => reg.register(echoCapability)))).toBe("DUPLICATE_ID");
    const issues = validateLedger(
      {
        schema_version: 1,
        source: "fixture",
        catalog: { path: "fixture-catalog.md", sha256: "a".repeat(64) },
        capabilities: [fixtureCap("C901"), fixtureCap("C901"), fixtureCap("C902")],
      },
      { domains: fixtureDomains, phases: fixturePhases },
      fixtureOpts,
    );
    expect(issues.map((i) => i.code)).toContain("DUPLICATE_ID");
  });

  it("F06 invalid capability dependency is reported as INVALID_DEPENDENCY", () => {
    const issues = validateLedger(
      {
        schema_version: 1,
        source: "fixture",
        catalog: { path: "fixture-catalog.md", sha256: "a".repeat(64) },
        capabilities: [fixtureCap("C901", { dependencies: ["C999"] }), fixtureCap("C902")],
      },
      { domains: fixtureDomains, phases: fixturePhases },
      fixtureOpts,
    );
    expect(issues.map((i) => i.code)).toContain(
      observe("F06", issues.find((i) => i.code === "INVALID_DEPENDENCY")?.code ?? "none"),
    );
  });

  it("F07 invalid phase reference is reported as INVALID_PHASE_REF", () => {
    const issues = validateLedger(
      {
        schema_version: 1,
        source: "fixture",
        catalog: { path: "fixture-catalog.md", sha256: "a".repeat(64) },
        capabilities: [fixtureCap("C901", { owning_phase: "P42" }), fixtureCap("C902")],
      },
      { domains: fixtureDomains, phases: fixturePhases },
      fixtureOpts,
    );
    expect(issues.map((i) => i.code)).toContain(
      observe("F07", issues.find((i) => i.code === "INVALID_PHASE_REF")?.code ?? "none"),
    );
    const badPhases = { ...fixturePhases, phases: [fixturePhase("P00", []), fixturePhase("P01", ["P07"])] };
    expect(validatePhases(badPhases, fixtureOpts).map((i) => i.code)).toContain("INVALID_PHASE_REF");
  });

  it("F08 wrong thread ID on resume is THREAD_MISMATCH and leaves both threads untouched", async () => {
    const a = await h.startRun({ goal: "F08-A", approval_required: true });
    const b = await h.startRun({ goal: "F08-B", approval_required: true });
    expect(
      await codeOf(
        h.resumeRun(
          { ...a.identity, thread_id: b.identity.thread_id },
          { decision: "approve", responder: "x" },
        ),
      ),
    ).toBe(observe("F08", "THREAD_MISMATCH"));
    expect(
      await codeOf(
        h.resumeRun({ ...a.identity, thread_id: newId("ThreadId") }, { decision: "approve", responder: "x" }),
      ),
    ).toBe("THREAD_NOT_FOUND");
    for (const r of [a, b]) {
      expect((await h.workflow.inspect(r.identity.thread_id))?.pending_interrupt).not.toBeNull();
      expect((await pgRepositories(t.db).runs.get(r.identity.run_id))?.status).toBe("INTERRUPTED");
    }
  });

  it("F09 an interrupted graph that is not resumed retains its interrupted state; resuming a finished one is rejected", async () => {
    const { identity } = await h.startRun({ goal: "F09", approval_required: true });
    const snap = await h.workflow.inspect(identity.thread_id);
    expect(snap?.pending_interrupt?.node).toBe("interrupt_for_human");
    expect(snap?.state["outcome"]).toBeNull();
    expect((await pgRepositories(t.db).runs.get(identity.run_id))?.status).toBe(
      observe("F09", "INTERRUPTED"),
    );
    const done = await h.startRun({ goal: "F09-done", approval_required: false });
    expect(await codeOf(h.resumeRun(done.identity, { decision: "approve", responder: "x" }))).toBe(
      "GRAPH_NOT_INTERRUPTED",
    );
  });

  it("F10 artifact hash mismatch is detected as ARTIFACT_HASH_MISMATCH", async () => {
    const root = mkdtempSync(join(tmpdir(), "f10-"));
    const store = await FilesystemArtifactStore.open(root, { create: true });
    const rec = await store.put({
      run_id: newId("RunId"),
      bytes: new TextEncoder().encode("original"),
      media_type: "text/plain",
      producer: { kind: "test", id: "f10" },
      provenance: { trace_id: newTraceId(), source: "f10" },
    });
    const blob = join(root, "blobs", "sha256", rec.content_hash.digest.slice(0, 2), rec.content_hash.digest);
    await writeFile(blob, "tampered");
    expect((await store.verifyHash(rec.artifact_id)).ok).toBe(false);
    expect(observe("F10", await codeOf(store.get(rec.artifact_id)))).toBe("ARTIFACT_HASH_MISMATCH");
    rmSync(blob);
    expect(await codeOf(store.get(rec.artifact_id))).toBe("ARTIFACT_HASH_MISMATCH");
  });

  it("F11 artifact storage unavailable is STORAGE_UNAVAILABLE", async () => {
    const dir = mkdtempSync(join(tmpdir(), "f11-"));
    const notADir = join(dir, "file");
    writeFileSync(notADir, "x");
    expect(observe("F11", await codeOf(FilesystemArtifactStore.open(notADir)))).toBe("STORAGE_UNAVAILABLE");
    expect(await codeOf(FilesystemArtifactStore.open(join(dir, "missing")))).toBe("STORAGE_UNAVAILABLE");
    const root = join(dir, "store");
    const store = await FilesystemArtifactStore.open(root, { create: true });
    rmSync(root, { recursive: true, force: true });
    writeFileSync(root, "now a file");
    expect(
      await codeOf(
        store.put({
          run_id: newId("RunId"),
          bytes: new Uint8Array([1]),
          media_type: "application/octet-stream",
          producer: { kind: "test", id: "f11" },
          provenance: { trace_id: newTraceId(), source: "f11" },
        }),
      ),
    ).toBe("STORAGE_UNAVAILABLE");
  });

  it("F12 a secret-like value passed to the logger is REDACTED", () => {
    const { logger, lines } = createMemoryLogger();
    const token = ["gh", "p_", "Z".repeat(36)].join("");
    const pw = ["f12", "secret"].join("-");
    logger.error("oops", { note: `token ${token}`, url: `postgres://u:${pw}@h/db`, password: pw });
    const raw = JSON.stringify(lines());
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(pw);
    expect(raw).toContain("[REDACTED]");
    observe("F12", "REDACTED");
  });

  it("F13 unsupported schema versions are UNSUPPORTED_SCHEMA_VERSION", async () => {
    expect(await codeOf(() => parseContract(RunContract, { schema_version: 99 }))).toBe(
      "UNSUPPORTED_SCHEMA_VERSION",
    );
    const e = createEvent(
      "graph.started",
      { graph: "g", graph_version: "1" },
      { run_id: newId("RunId"), trace_id: newTraceId() },
    );
    expect(observe("F13", await codeOf(() => parseEvent({ ...e, schema_version: 2 })))).toBe(
      "UNSUPPORTED_SCHEMA_VERSION",
    );
  });

  it("F14 a forced node failure becomes a controlled NODE_FAILED graph error with diagnostics", async () => {
    const before = await t.db.query<{ id: string }>("SELECT id FROM harness_runs");
    expect(
      observe(
        "F14",
        await codeOf(h.startRun({ goal: "F14", approval_required: false, fail_at_node: "approval_gate" })),
      ),
    ).toBe("NODE_FAILED");
    const r = await t.db.query<{ id: string; status: string }>(
      "SELECT id, status FROM harness_runs WHERE root_goal = 'F14'",
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]?.status).toBe("FAILED");
    expect(before.rows.map((x) => x.id)).not.toContain(r.rows[0]?.id);
    const events = await pgRepositories(t.db).events.listByRun(r.rows[0]?.id as never);
    const failed = events.find((e) => e.event_type === "graph.failed");
    expect(failed).toMatchObject({ payload: { node: "approval_gate", error_code: "NODE_FAILED" } });
    // Diagnosable: which node failed, with which run/thread, after which event, and was state persisted?
    const failedIdx = events.findIndex((e) => e.event_type === "graph.failed");
    expect(events[failedIdx - 1]?.event_type).toBe("graph.node_started");
    expect(failed?.causation_id).toBe(events[failedIdx - 1]?.event_id);
    expect(failed?.thread_id).toBeDefined();
    const snap = await h.workflow.inspect(failed?.thread_id as never);
    expect(snap?.state["intent"]).toBe("intent:f14");
  });

  it("F15 process restart followed by persisted-state verification", async () => {
    const env = {
      PATH: process.env["PATH"],
      SystemRoot: process.env["SystemRoot"],
      HARNESS_ENV: "test",
      DATABASE_URL: t.url,
      HARNESS_ARTIFACT_ROOT: mkdtempSync(join(tmpdir(), "f15-")),
      HARNESS_LOG_LEVEL: "error",
    };
    const started = runSmokeChild(env, "start");
    expect(started.killed, "process must be killed after checkpointing").toBe(true);
    expect(started.pid).not.toBe(process.pid);
    const identity = started["identity"] as { run_id: string; thread_id: string };
    // Verified from this (different) process purely from durable state.
    const snap = await h.workflow.inspect(identity.thread_id as never);
    expect(snap?.pending_interrupt?.node).toBe("interrupt_for_human");
    expect(snap?.state["intent"]).toBe("intent:restart proof");
    expect((await pgRepositories(t.db).runs.get(identity.run_id as never))?.status).toBe(
      observe("F15", "INTERRUPTED"),
    );
    const cp = await t.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM harness_checkpoints.checkpoints WHERE thread_id = $1",
      [identity.thread_id],
    );
    expect(Number(cp.rows[0]?.n)).toBeGreaterThan(0);
  });
});
