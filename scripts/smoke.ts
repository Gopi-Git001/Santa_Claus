/**
 * LangGraph.js smoke execution with full diagnostic record (P00 spec §14, §26).
 *
 *   node --env-file-if-exists=.env scripts/smoke.ts [--json <out>]
 *
 * Runs in a freshly created, migrated database (dropped afterwards) so the
 * evidence is reproducible and never touches development data. Records run and
 * thread IDs, node sequence, timestamps, the causal event chain, persistence
 * operations, interrupt/resume, final state and error classification.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { loadConfig } from "@harness/config";
import { isHarnessError, newId } from "@harness/contracts";
import { createEvent } from "@harness/events";
import { createTestDatabase, pgRepositories, requireDatabaseUrl } from "@harness/persistence";
import { createSmokeHarness } from "@harness/testing";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;

const t = await createTestDatabase(requireDatabaseUrl());
const { config, source } = loadConfig({
  ...process.env,
  DATABASE_URL: t.url,
  HARNESS_ARTIFACT_ROOT: join(tmpdir(), `harness-smoke-${Date.now()}`),
  HARNESS_LOG_LEVEL: "warn",
});
const harness = await createSmokeHarness({ config });
const repos = pgRepositories(t.db);
const checkpoints = async (thread: string) =>
  Number(
    (
      await t.db.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${config.langgraph.checkpoint_schema}.checkpoints WHERE thread_id = $1`,
        [thread],
      )
    ).rows[0]?.n,
  );

async function describeRun(runId: string) {
  const events = await repos.events.listByRun(runId as never);
  return {
    run: await repos.runs.get(runId as never),
    events: events.map((e) => ({
      event_id: e.event_id,
      type: e.event_type,
      at: e.timestamp,
      node: (e.payload as { node?: string }).node ?? null,
      causation_id: e.causation_id ?? null,
      correlation_id: e.correlation_id ?? null,
    })),
    causal_chain_intact: events.slice(1).every((e, i) => e.causation_id === events[i]?.event_id),
  };
}

const scenarios: Record<string, unknown>[] = [];
let failure: { code: string; message: string } | null = null;
try {
  // 1. Straight-through run (no approval).
  const obs0 = harness.observations.length;
  const t0 = performance.now();
  const direct = await harness.startRun({ goal: "P00 smoke: straight through", approval_required: false });
  scenarios.push({
    name: "straight_through",
    identity: direct.identity,
    outcome: direct.outcome.kind,
    duration_ms: Math.round(performance.now() - t0),
    stream_observations: harness.observations.slice(obs0),
    checkpoint_rows: await checkpoints(direct.identity.thread_id),
    final_state: direct.outcome.state,
    ...(await describeRun(direct.identity.run_id)),
  });

  // 2. Human interrupt → persisted → explicit resume (same process; restart proof is persistence-resume.json).
  const obs1 = harness.observations.length;
  const gated = await harness.startRun({ goal: "P00 smoke: human approval", approval_required: true });
  const pending = await harness.workflow.inspect(gated.identity.thread_id);
  const rowsAtInterrupt = await checkpoints(gated.identity.thread_id);
  const resumed = await harness.resumeRun(gated.identity, { decision: "approve", responder: "p00-smoke" });
  scenarios.push({
    name: "interrupt_resume",
    identity: gated.identity,
    outcome_before_resume: gated.outcome.kind,
    pending_interrupt: pending?.pending_interrupt ?? null,
    checkpoint_rows_at_interrupt: rowsAtInterrupt,
    outcome_after_resume: resumed.kind,
    checkpoint_rows_after_resume: await checkpoints(gated.identity.thread_id),
    stream_observations: harness.observations.slice(obs1),
    final_state: resumed.state,
    ...(await describeRun(gated.identity.run_id)),
  });

  // 3. Controlled failure: classified error, node recorded, run FAILED.
  let classified: unknown = null;
  try {
    await harness.startRun({
      goal: "P00 smoke: forced failure",
      approval_required: false,
      fail_at_node: "record_intent",
    });
  } catch (e) {
    classified = isHarnessError(e) ? { code: e.code, details: e.details } : { code: "UNCLASSIFIED" };
  }
  const failedRun = await t.db.query<{ id: string }>("SELECT id FROM harness_runs WHERE root_goal = $1", [
    "P00 smoke: forced failure",
  ]);
  scenarios.push({
    name: "forced_node_failure",
    error: classified,
    ...(await describeRun(String(failedRun.rows[0]?.id))),
  });
} catch (e) {
  failure = {
    code: isHarnessError(e) ? e.code : "UNCLASSIFIED",
    message: e instanceof Error ? e.message : String(e),
  };
}

const evidence = {
  kind: "p00-langgraph-smoke",
  generated_at: new Date().toISOString(),
  graph: { name: harness.workflow.name, version: harness.workflow.version },
  config_source: source, // variable names only, never values
  checkpoint_store: `postgresql schema ${config.langgraph.checkpoint_schema}`,
  isolated_database: true,
  scenarios,
  failure,
  ok: failure === null,
};

if (jsonOut) {
  mkdirSync(dirname(resolve(jsonOut)), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`);
  // Record that evidence was produced, in the same durable event log (test.evidence_recorded).
  const first = scenarios[0] as { identity?: { run_id: string; trace_id: string } } | undefined;
  if (first?.identity) {
    await repos.events.append(
      createEvent(
        "test.evidence_recorded",
        {
          evidence_id: newId("EvidenceId"),
          name: "langgraph-smoke",
          path: relative(process.cwd(), resolve(jsonOut)),
        },
        {
          run_id: first.identity.run_id as never,
          trace_id: first.identity.trace_id as never,
          correlation_id: first.identity.run_id,
        },
        { causation_id: (await repos.events.lastEventId(first.identity.run_id as never)) as never },
      ),
    );
  }
}
console.log(
  JSON.stringify({
    smoke: evidence.ok ? "OK" : "FAILED",
    scenarios: scenarios.map((s) => s["name"]),
    failure,
  }),
);
await harness.close();
await t.drop();
process.exit(evidence.ok ? 0 : 1);
