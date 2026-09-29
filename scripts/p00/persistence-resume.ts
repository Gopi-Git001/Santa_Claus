/**
 * P00 persistence/resume proof with evidence (P00 spec §15 scenarios 1–6).
 *
 *   node --env-file-if-exists=.env scripts/p00/persistence-resume.ts [--json <out>]
 *
 * 1 start graph, 2 checkpoint, 3 terminate the process, 4 resume the same thread
 * from a NEW process, 5 verify expected state, 6 prove other threads/runs cannot
 * resume it. Uses a fresh isolated database against real PostgreSQL.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "@harness/config";
import { isHarnessError, newId, newTraceId } from "@harness/contracts";
import { createTestDatabase, pgRepositories, requireDatabaseUrl } from "@harness/persistence";
import { createSmokeHarness } from "@harness/testing";
import { runSmokeChild } from "../../tests/e2e/child.ts";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;

const t = await createTestDatabase(requireDatabaseUrl());
const artifactRoot = mkdtempSync(join(tmpdir(), "harness-pr-"));
const childEnv = {
  PATH: process.env["PATH"],
  SystemRoot: process.env["SystemRoot"],
  HARNESS_ENV: "test",
  DATABASE_URL: t.url,
  HARNESS_ARTIFACT_ROOT: artifactRoot,
  HARNESS_LOG_LEVEL: "error",
};
const steps: Record<string, unknown>[] = [];
const checks: Record<string, boolean> = {};

const child = (...a: string[]): Record<string, unknown> => runSmokeChild(childEnv, ...a);
const checkpointRows = async (thread: string) =>
  Number(
    (
      await t.db.query<{ n: string }>(
        "SELECT count(*)::text AS n FROM harness_checkpoints.checkpoints WHERE thread_id = $1",
        [thread],
      )
    ).rows[0]?.n,
  );

let ok = false;
try {
  const started = child("start");
  const identity = started["identity"] as { run_id: string; thread_id: string; trace_id: string };
  steps.push({
    step: "1-2 start graph in process A; checkpoint at human interrupt; process A is SIGKILLed",
    ...started,
  });
  const rowsAfterA = await checkpointRows(identity.thread_id);
  steps.push({ step: "3 process A terminated", checkpoint_rows_persisted: rowsAfterA });

  const inspected = child("inspect", JSON.stringify(identity));
  steps.push({ step: "verify persisted state from process B", ...inspected });

  const resumed = child("resume", JSON.stringify(identity));
  steps.push({ step: "4-5 resume same thread from process C; verify expected state", ...resumed });

  const repos = pgRepositories(t.db);
  const run = await repos.runs.get(identity.run_id as never);
  const events = await repos.events.listByRun(identity.run_id as never);
  const state = resumed["state"] as Record<string, unknown> | undefined;
  checks["three_distinct_processes"] =
    new Set([started["pid"], inspected["pid"], resumed["pid"], process.pid]).size === 4;
  checks["checkpointing_process_killed_abruptly"] = started["killed"] === true;
  checks["checkpoint_persisted_before_restart"] = rowsAfterA > 0;
  checks["interrupt_pending_after_restart"] =
    (inspected["snapshot"] as { pending_interrupt: { node: string } | null } | null)?.pending_interrupt
      ?.node === "interrupt_for_human";
  checks["resumed_to_completion"] = resumed["kind"] === "completed" && state?.["outcome"] === "completed";
  checks["explicit_human_response_recorded"] =
    JSON.stringify(state?.["approval"]) ===
    JSON.stringify({ decision: "approve", responder: "e2e-operator" });
  checks["run_status_completed"] = run?.status === "COMPLETED";
  checks["causal_chain_intact_across_processes"] = events
    .slice(1)
    .every((e, i) => e.causation_id === events[i]?.event_id);
  checks["pre_restart_nodes_not_reexecuted"] =
    events.filter(
      (e) =>
        e.event_type === "graph.node_started" && (e.payload as { node: string }).node === "record_intent",
    ).length === 1;

  // 6. Thread isolation, checked from yet another harness instance.
  const { config } = loadConfig({ ...childEnv });
  const h = await createSmokeHarness({ config });
  try {
    const other = await h.startRun({ goal: "isolation: other run", approval_required: true });
    const attempt = async (label: string, id: { run_id: string; thread_id: string; trace_id: string }) => {
      try {
        await h.resumeRun(id as never, { decision: "approve", responder: "intruder" });
        return { label, rejected: false, code: null };
      } catch (e) {
        return { label, rejected: true, code: isHarnessError(e) ? e.code : "UNCLASSIFIED" };
      }
    };
    const isolation = [
      await attempt("other run's identity targeting this run's pending thread", {
        ...other.identity,
        thread_id: (await h.startRun({ goal: "isolation: target", approval_required: true })).identity
          .thread_id,
      }),
      await attempt("unknown thread id", {
        run_id: other.identity.run_id,
        thread_id: newId("ThreadId"),
        trace_id: newTraceId(),
      }),
      await attempt("completed thread (nothing pending)", identity),
    ];
    steps.push({ step: "6 thread isolation attempts", attempts: isolation });
    checks["foreign_run_rejected_THREAD_MISMATCH"] = isolation[0]?.code === "THREAD_MISMATCH";
    checks["unknown_thread_rejected_THREAD_NOT_FOUND"] = isolation[1]?.code === "THREAD_NOT_FOUND";
    checks["completed_thread_rejected_GRAPH_NOT_INTERRUPTED"] =
      isolation[2]?.code === "GRAPH_NOT_INTERRUPTED";
    const otherSnap = await h.workflow.inspect(other.identity.thread_id);
    checks["other_thread_state_untouched"] =
      otherSnap?.pending_interrupt !== null && otherSnap?.state["goal"] === "isolation: other run";
  } finally {
    await h.close();
  }
  ok = Object.values(checks).every(Boolean);
} catch (e) {
  steps.push({ step: "error", error: e instanceof Error ? e.message : String(e) });
}

const evidence = {
  kind: "p00-persistence-resume",
  generated_at: new Date().toISOString(),
  database: "real PostgreSQL (fresh isolated database, dropped afterwards)",
  checkpoint_store:
    "postgresql schema harness_checkpoints (LangGraph PostgresSaver behind CheckpointPersistence)",
  steps,
  checks,
  ok,
};
if (jsonOut) {
  mkdirSync(dirname(resolve(jsonOut)), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`);
}
for (const [k, v] of Object.entries(checks)) console.log(`${v ? "PASS" : "FAIL"} ${k}`);
await t.drop();
process.exit(ok ? 0 : 1);
