import { HarnessError, newId, newTraceId, type Run } from "@harness/contracts";
import { createEvent } from "@harness/events";
import {
  createTestDatabase,
  loadMigrations,
  migrate,
  pgRepositories,
  requireDatabaseUrl,
  schemaVersion,
  type TestDatabase,
} from "@harness/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Real PostgreSQL: these tests fail (never skip) if the database is unavailable.
let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase(requireDatabaseUrl());
});
afterAll(async () => {
  await t?.drop();
});

function newRun(): Run {
  const now = new Date().toISOString();
  return {
    schema_version: 1,
    id: newId("RunId"),
    root_goal: "integration",
    status: "CREATED",
    created_at: now,
    updated_at: now,
    policy_profile: "p00-default",
    budget_profile: "p00-default",
    root_thread_id: newId("ThreadId"),
    metadata: { suite: "integration" },
  };
}

describe("database foundation", () => {
  it("passes the connection health check against a real server", async () => {
    const h = await t.db.healthCheck();
    expect(h.ok).toBe(true);
    expect(Number.parseInt(h.server_version, 10)).toBeGreaterThanOrEqual(18);
  });

  it("migrations are reproducible and idempotent", async () => {
    const expected = loadMigrations().length;
    expect(await schemaVersion(t.db)).toBe(expected);
    const again = await migrate(t.db);
    expect(again.applied).toEqual([]);
    expect(again.already_applied).toHaveLength(expected);
  });

  it("produces an identical schema on a fresh database", async () => {
    const other = await createTestDatabase(requireDatabaseUrl());
    try {
      const shape = async (db: TestDatabase["db"]) =>
        (
          await db.query<{ d: string }>(
            `SELECT string_agg(table_name || '.' || column_name || ':' || data_type || ':' || is_nullable, ',' ORDER BY table_name, column_name) AS d
             FROM information_schema.columns WHERE table_schema = 'public'`,
          )
        ).rows[0]?.d;
      expect(await shape(other.db)).toBe(await shape(t.db));
    } finally {
      await other.drop();
    }
  });

  it("refuses to run when an applied migration was modified", async () => {
    const tampered = loadMigrations().map((m, i) => (i === 0 ? { ...m, checksum: "0".repeat(64) } : m));
    await expect(migrate(t.db, tampered)).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  });

  it("rolls back a failed transaction completely and propagates caller errors unchanged", async () => {
    // Corrected in review: this test previously asserted that a caller's own Error was re-labelled
    // as a HarnessError (UNKNOWN_OUTCOME), which mislabelled logic bugs as database outcomes.
    const repos = pgRepositories(t.db);
    const run = newRun();
    const boom = new Error("boom");
    await expect(
      t.db.withTransaction(async (tx) => {
        await pgRepositories(tx).runs.create(run);
        throw boom;
      }),
    ).rejects.toBe(boom);
    expect(await repos.runs.get(run.id)).toBeUndefined();
  });

  it("classifies driver errors inside a transaction and keeps query-phase SQL errors out of DB_UNAVAILABLE", async () => {
    const run = newRun();
    await pgRepositories(t.db).runs.create(run);
    await expect(
      t.db.withTransaction(async (tx) => {
        await pgRepositories(tx).runs.create(run);
      }),
    ).rejects.toMatchObject({ code: "DUPLICATE_ID" });
    const missingTable = await t.db.query("SELECT * FROM no_such_table").catch((e: unknown) => e);
    expect(missingTable).toBeInstanceOf(HarnessError);
    expect((missingTable as HarnessError).code).not.toBe("DB_UNAVAILABLE");
    expect((missingTable as HarnessError).details["driver_code"]).toBe("42P01");
  });
});

describe("system-of-record repositories", () => {
  it("round-trips a run and performs compare-and-set transitions", async () => {
    const { runs } = pgRepositories(t.db);
    const run = newRun();
    await runs.create(run);
    expect(await runs.get(run.id)).toEqual(run);
    expect(await runs.transition(run.id, "CREATED", "RUNNING", new Date())).toBe(true);
    expect(await runs.transition(run.id, "CREATED", "COMPLETED", new Date())).toBe(false);
    expect((await runs.get(run.id))?.status).toBe("RUNNING");
  });

  it("rejects duplicate run IDs with DUPLICATE_ID", async () => {
    const { runs } = pgRepositories(t.db);
    const run = newRun();
    await runs.create(run);
    await expect(runs.create({ ...run, root_thread_id: newId("ThreadId") })).rejects.toMatchObject({
      code: "DUPLICATE_ID",
    });
  });

  it("records events durably in order with causation links (INV-007)", async () => {
    const { runs, events } = pgRepositories(t.db);
    const run = newRun();
    await runs.create(run);
    const ctx = { run_id: run.id, trace_id: newTraceId(), correlation_id: run.id };
    const a = createEvent("run.created", { root_goal: "g", policy_profile: "p", budget_profile: "b" }, ctx);
    const b = createEvent("run.status_changed", { from: "CREATED", to: "RUNNING" }, ctx, {
      causation_id: a.event_id,
    });
    await events.append(a);
    await events.append(b);
    const listed = await events.listByRun(run.id);
    expect(listed.map((e) => e.event_id)).toEqual([a.event_id, b.event_id]);
    expect(listed[1]?.causation_id).toBe(a.event_id);
    expect(await events.lastEventId(run.id)).toBe(b.event_id);
    await expect(events.append(a)).rejects.toMatchObject({ code: "DUPLICATE_ID" });
  });

  it("rejects events for a run that does not exist", async () => {
    const { events } = pgRepositories(t.db);
    const e = createEvent(
      "graph.started",
      { graph: "g", graph_version: "1" },
      {
        run_id: newId("RunId"),
        trace_id: newTraceId(),
      },
    );
    await expect(events.append(e)).rejects.toMatchObject({ code: "INVALID_REFERENCE" });
  });

  it("enforces an append-only event log and detects a privileged tamper on read", async () => {
    const { runs, events } = pgRepositories(t.db);
    const run = newRun();
    await runs.create(run);
    const e = createEvent(
      "graph.started",
      { graph: "g", graph_version: "1" },
      {
        run_id: run.id,
        trace_id: newTraceId(),
      },
    );
    await events.append(e);
    const tamper = `UPDATE harness_events SET envelope = jsonb_set(envelope, '{payload,graph}', '42'::jsonb) WHERE event_id = $1`;
    // Normal operation cannot modify recorded events (append-only, migration 0002)...
    const refused = await t.db.query(tamper, [e.event_id]).catch((err: unknown) => err);
    expect((refused as HarnessError).details["driver_code"]).toBe("23001");
    await expect(
      t.db.query("DELETE FROM harness_events WHERE event_id = $1", [e.event_id]),
    ).rejects.toBeInstanceOf(HarnessError);
    // ...so simulate a privileged tamper that bypasses the trigger; the read path must still catch it.
    await t.db.withTransaction(async (tx) => {
      await tx.query("ALTER TABLE harness_events DISABLE TRIGGER harness_events_no_update_delete");
      await tx.query(tamper, [e.event_id]);
      await tx.query("ALTER TABLE harness_events ENABLE TRIGGER harness_events_no_update_delete");
    });
    await expect(events.listByRun(run.id)).rejects.toMatchObject({ code: "PAYLOAD_INVALID" });
  });

  it("binds a thread to exactly one run", async () => {
    const { runs, threads } = pgRepositories(t.db);
    const run = newRun();
    await runs.create(run);
    const binding = { thread_id: run.root_thread_id, run_id: run.id, graph_name: "g", graph_version: "1" };
    await threads.bind(binding);
    expect(await threads.get(run.root_thread_id)).toEqual(binding);
    const otherRun = newRun();
    await runs.create(otherRun);
    await expect(threads.bind({ ...binding, run_id: otherRun.id })).rejects.toMatchObject({
      code: "DUPLICATE_ID",
    });
  });
});
