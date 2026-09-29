/**
 * P00 performance baseline (P00 spec §30). Regression references, not SLOs.
 *
 *   node --env-file-if-exists=.env scripts/p00/perf-baseline.ts [--json <out>] [--bootstrap-ms N]
 *
 * All measurements exclude external LLMs (there are none in P00) and run on a
 * fresh isolated database on the local development PostgreSQL.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { cpus, platform, release, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { FilesystemArtifactStore } from "@harness/artifacts";
import { loadConfig } from "@harness/config";
import { newId, newTraceId, type Run } from "@harness/contracts";
import { createEvent } from "@harness/events";
import { createTestDatabase, pgRepositories, requireDatabaseUrl } from "@harness/persistence";
import { createSmokeHarness } from "@harness/testing";

const args = process.argv.slice(2);
const opt = (n: string) => (args.includes(n) ? args[args.indexOf(n) + 1] : undefined);
const jsonOut = opt("--json");
const bootstrapMs = opt("--bootstrap-ms");

function stats(samples: number[]) {
  const s = [...samples].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r = (x: number) => Math.round(x * 100) / 100;
  return {
    n: s.length,
    min_ms: r(s[0] ?? 0),
    p50_ms: r(q(0.5)),
    p95_ms: r(q(0.95)),
    max_ms: r(s.at(-1) ?? 0),
  };
}
async function time(n: number, fn: () => Promise<unknown>) {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    await fn();
    out.push(performance.now() - t0);
  }
  return out;
}

const t = await createTestDatabase(requireDatabaseUrl());
const { config } = loadConfig({
  ...process.env,
  DATABASE_URL: t.url,
  HARNESS_ARTIFACT_ROOT: mkdtempSync(join(tmpdir(), "harness-perf-")),
  HARNESS_LOG_LEVEL: "error",
});
const h = await createSmokeHarness({ config });
const repos = pgRepositories(t.db);

// Warm-up (JIT, connection pool, first checkpoint table access).
await h.startRun({ goal: "warmup", approval_required: false });

const graphRuns: string[] = [];
const graphLatency = await time(20, async () => {
  const r = await h.startRun({ goal: "perf", approval_required: false });
  graphRuns.push(r.identity.thread_id);
});
const cpRows = Number(
  (
    await t.db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM harness_checkpoints.checkpoints WHERE thread_id = $1",
      [graphRuns[0]],
    )
  ).rows[0]?.n,
);
const checkpointRead = await time(50, () => h.workflow.inspect(graphRuns[0] as never));

const now = new Date().toISOString();
const run: Run = {
  schema_version: 1,
  id: newId("RunId"),
  root_goal: "perf-events",
  status: "RUNNING",
  created_at: now,
  updated_at: now,
  policy_profile: "p",
  budget_profile: "b",
  root_thread_id: newId("ThreadId"),
  metadata: {},
};
await repos.runs.create(run);
const trace = newTraceId();
const eventWrite = await time(100, () =>
  repos.events.append(
    createEvent(
      "graph.node_started",
      { graph: "perf", graph_version: "1", node: "n" },
      { run_id: run.id, trace_id: trace },
    ),
  ),
);

const store = await FilesystemArtifactStore.open(config.artifacts.root, { create: true });
const fixture = new TextEncoder().encode("p00 small artifact fixture\n".repeat(40)); // ~1 KiB
const ids: string[] = [];
const artifactPut = await time(50, async () => {
  const rec = await store.put({
    run_id: run.id,
    bytes: fixture,
    media_type: "text/plain",
    producer: { kind: "test", id: "perf" },
    provenance: { trace_id: trace, source: "perf" },
  });
  ids.push(rec.artifact_id);
});
let i = 0;
const artifactGet = await time(50, () => store.get(ids[i++] as never));

const mem = process.memoryUsage();
const evidence = {
  kind: "p00-performance-baseline",
  generated_at: new Date().toISOString(),
  host: {
    platform: platform(),
    release: release(),
    cpus: cpus().length,
    cpu_model: cpus()[0]?.model,
    total_mem_mb: Math.round(totalmem() / 2 ** 20),
  },
  notes: [
    "Development machine, Docker Desktop PostgreSQL 18.6; not a production SLO.",
    "graph_invocation includes run/event bookkeeping and all checkpoint writes of a 4-node run (no LLM).",
    "checkpoint_write is not separable from graph execution through the public port; checkpoint rows per run are reported instead.",
  ],
  bootstrap_ms: bootstrapMs === undefined ? null : Number(bootstrapMs),
  graph_invocation: stats(graphLatency),
  checkpoint_rows_per_4_node_run: cpRows,
  checkpoint_read_inspect: stats(checkpointRead),
  event_write: stats(eventWrite),
  artifact_put_1kib: stats(artifactPut),
  artifact_get_verify_1kib: stats(artifactGet),
  smoke_process_memory_mb: {
    rss: Math.round(mem.rss / 2 ** 20),
    heap_used: Math.round(mem.heapUsed / 2 ** 20),
  },
};
if (jsonOut) {
  mkdirSync(dirname(resolve(jsonOut)), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(
  JSON.stringify({
    graph_p50_ms: evidence.graph_invocation.p50_ms,
    event_p50_ms: evidence.event_write.p50_ms,
    rss_mb: evidence.smoke_process_memory_mb.rss,
  }),
);
await h.close();
await t.drop();
