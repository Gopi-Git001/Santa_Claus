/**
 * P00 acceptance procedure (P00 spec §25): runs the full ladder, writes all
 * evidence to evidence/P00/, and records every command with its expected and
 * actual exit code. It never stops at the first failure — every rung runs and
 * is recorded — and it never interprets results; scripts/p00/verify.ts does.
 *
 *   node scripts/p00/acceptance.ts [--skip-fresh-env]
 */
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { cpus, type as osType, platform, release } from "node:os";
import { join } from "node:path";
import { buildManifest } from "@harness/artifacts";
import { FAILURE_SCENARIOS } from "../../tests/failure/scenarios.ts";
import { PNPM, run } from "../lib/proc.ts";

const root = join(import.meta.dirname, "..", "..");
const EV = join(root, "evidence", "P00");
const rel = (f: string) => `evidence/P00/${f}`;
const skipFresh = process.argv.includes("--skip-fresh-env");
// In CI the database is a job service container; there is no docker compose stack or .env.
const ci = process.argv.includes("--ci");
const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0", FORCE_COLOR: "0", NO_COLOR: "1" };
const withDotEnv = ["node", "--env-file-if-exists=.env"];

// Evidence from a previous run must not survive into this one. Hand-maintained
// files (blockers, report) are kept.
// Record uncommitted code changes BEFORE anything runs: evidence is only valid for committed code.
const dirtyAtStart = run(["git", "status", "--porcelain", "--", ".", ":(exclude)evidence"], { cwd: root })
  .stdout.split("\n")
  .filter(Boolean);
if (dirtyAtStart.length > 0) {
  console.warn(
    `WARNING: ${dirtyAtStart.length} uncommitted non-evidence change(s); the verifier will reject this evidence.`,
  );
}
const KEEP = new Set(["blockers.json", "P00-REPORT.md", "hosted-ci.json"]);
const observationsFile = join(EV, "failure-observations.jsonl");
for (const f of readdirSync(EV)) if (!KEEP.has(f)) rmSync(join(EV, f), { recursive: true, force: true });

interface LogEntry {
  rung: string;
  command: string;
  expected_exit: number[];
  exit_code: number;
  ok: boolean;
  started_at: string;
  duration_ms: number;
  evidence: string[];
}
const log: LogEntry[] = [];

function rung(
  name: string,
  argv: string[],
  opts: {
    expected?: number[];
    evidence?: string[];
    textOut?: string;
    extraEnv?: Record<string, string>;
  } = {},
): LogEntry {
  const started_at = new Date().toISOString();
  const r = run(argv, { cwd: root, env: { ...env, ...opts.extraEnv } });
  const expected = opts.expected ?? [0];
  if (opts.textOut) {
    writeFileSync(
      join(EV, opts.textOut),
      `# command: ${argv.join(" ")}\n# started_at: ${started_at}\n# exit_code: ${r.exitCode}\n# duration_ms: ${r.durationMs}\n\n${(r.stdout + r.stderr).trim()}\n`,
    );
  }
  const entry: LogEntry = {
    rung: name,
    command: argv.join(" "),
    expected_exit: expected,
    exit_code: r.exitCode,
    ok: expected.includes(r.exitCode),
    started_at,
    duration_ms: r.durationMs,
    evidence: [...(opts.evidence ?? []), ...(opts.textOut ? [opts.textOut] : [])].map(rel),
  };
  log.push(entry);
  console.log(`${entry.ok ? "PASS" : "FAIL"}  ${name.padEnd(34)} exit ${r.exitCode} (${r.durationMs}ms)`);
  if (!entry.ok) console.log((r.stdout + r.stderr).trim().split("\n").slice(-15).join("\n"));
  return entry;
}

const vitest = (project: string, out: string, extraEnv?: Record<string, string>) =>
  rung(
    `${project} tests`,
    [
      ...PNPM,
      "exec",
      "vitest",
      "run",
      "--project",
      project,
      "--reporter=default",
      "--reporter=json",
      `--outputFile.json=${join(EV, out)}`,
    ],
    { evidence: [out], ...(extraEnv ? { extraEnv } : {}) },
  );

// ---------------------------------------------------------------- ladder
rung("install (frozen lockfile)", [...PNPM, "install", "--frozen-lockfile"]);
if (!ci) rung("PostgreSQL up", ["node", "scripts/dev-db.ts", "up"]);
rung("migrations (reproducible)", [...withDotEnv, "scripts/db-migrate.ts"], { textOut: "migrations.txt" });
rung(
  "validate-lockfiles",
  ["node", "scripts/check-lockfiles.ts", "--json", join(EV, "dependency-lock-summary.json")],
  {
    evidence: ["dependency-lock-summary.json"],
  },
);
rung("typecheck-ts (strict)", [...PNPM, "exec", "tsc", "--noEmit", "-p", "tsconfig.json"], {
  textOut: "typecheck.txt",
});
rung("lint-ts (biome)", [...PNPM, "exec", "biome", "check", "."], { textOut: "lint.txt" });
rung("dependency-boundaries", ["node", "scripts/check-boundaries.ts"], {
  textOut: "dependency-boundaries.txt",
});
rung("schema drift", ["node", "scripts/export-schemas.ts", "--check"], { textOut: "schema-drift.txt" });
rung("generated spec docs current", ["node", "scripts/generate-spec-docs.ts", "--check"], {
  textOut: "generated-docs.txt",
});
vitest("unit", "unit-tests.json");
vitest("contract", "contract-tests.json");
vitest("integration", "integration-tests.json");
vitest("failure", "failure-tests.vitest.json", { HARNESS_FAILURE_OBSERVATIONS: observationsFile });
vitest("e2e", "e2e-tests.json");
rung(
  "python lint/type/test",
  [
    "node",
    "scripts/python-check.ts",
    "--json",
    join(EV, "python-checks.json"),
    "--junit",
    join(EV, "python-tests.xml"),
  ],
  {
    evidence: ["python-checks.json", "python-tests.xml"],
  },
);
rung(
  "rust fmt/clippy/test (container, fresh)",
  ["node", "scripts/rust-check.ts", "--fresh", "--json", join(EV, "rust-checks.json")],
  {
    evidence: ["rust-checks.json"],
  },
);
rung("langgraph-smoke", [...withDotEnv, "scripts/smoke.ts", "--json", join(EV, "langgraph-smoke.json")], {
  evidence: ["langgraph-smoke.json"],
});
rung(
  "persistence-resume (multi-process)",
  [...withDotEnv, "scripts/p00/persistence-resume.ts", "--json", join(EV, "persistence-resume.json")],
  {
    evidence: ["persistence-resume.json"],
  },
);
// Exit 2 = BLOCKED is the truthful expected outcome while P00-BLK-001 is open; the verifier decides the gate.
rung(
  "traceability-audit",
  ["node", "scripts/validate-specs.ts", "--json", join(EV, "traceability-audit.json")],
  {
    expected: [0, 2],
    evidence: ["traceability-audit.json"],
  },
);
if (!skipFresh) {
  rung(
    "fresh-environment reproduction",
    ["node", "scripts/p00/fresh-env.ts", "--json", join(EV, "fresh-environment.json")],
    {
      evidence: ["fresh-environment.json"],
    },
  );
}
const freshBootstrap = existsSync(join(EV, "fresh-environment.json"))
  ? String(
      (JSON.parse(readFileSync(join(EV, "fresh-environment.json"), "utf8")) as { bootstrap_ms: number })
        .bootstrap_ms,
    )
  : undefined;
rung(
  "performance baseline",
  [
    ...withDotEnv,
    "scripts/p00/perf-baseline.ts",
    "--json",
    join(EV, "performance-baseline.json"),
    ...(freshBootstrap ? ["--bootstrap-ms", freshBootstrap] : []),
  ],
  { evidence: ["performance-baseline.json"] },
);
rung("security: committed secrets", ["node", "scripts/check-secrets.ts"], {
  textOut: "security-secrets.txt",
});

// ---------------------------------------------------------------- derived evidence
// failure-tests.json joins the §33 scenario table to the actual test results.
{
  const raw = JSON.parse(readFileSync(join(EV, "failure-tests.vitest.json"), "utf8")) as {
    testResults: Array<{ assertionResults: Array<{ title: string; status: string; duration?: number }> }>;
  };
  const results = raw.testResults.flatMap((f) => f.assertionResults);
  // Classifications the tests actually observed (written by tests/failure/scenarios.ts#observe).
  const observations = existsSync(observationsFile)
    ? readFileSync(observationsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id: string; observed: string })
    : [];
  const scenarios = FAILURE_SCENARIOS.map((s) => {
    const r = results.find((x) => x.title.startsWith(`${s.id} `));
    return {
      ...s,
      observed: observations.filter((o) => o.id === s.id).map((o) => o.observed),
      test: r?.title ?? null,
      status: r?.status ?? "missing",
      duration_ms: r?.duration ?? null,
    };
  });
  writeFileSync(
    join(EV, "failure-tests.json"),
    `${JSON.stringify({ kind: "p00-failure-scenarios", source: rel("failure-tests.vitest.json"), scenarios, all_passed: scenarios.every((s) => s.status === "passed") }, null, 2)}\n`,
  );
}

const version = (argv: string[]) => {
  const r = run(argv, { cwd: root, env });
  return r.exitCode === 0 ? (r.stdout + r.stderr).trim().split("\n")[0] : `unavailable (exit ${r.exitCode})`;
};
const pkgVersion = (p: string) =>
  (
    JSON.parse(
      readFileSync(join(root, "packages", "orchestration", "node_modules", p, "package.json"), "utf8"),
    ) as { version: string }
  ).version;
const pgVersion = run(
  [
    "node",
    "--env-file-if-exists=.env",
    "-e",
    "const pg=require('./packages/persistence/node_modules/pg');const c=new pg.Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>c.query('SHOW server_version')).then(r=>{console.log(r.rows[0].server_version);return c.end()})",
  ],
  { cwd: root, env },
).stdout.trim();
const rust = existsSync(join(EV, "rust-checks.json"))
  ? (JSON.parse(readFileSync(join(EV, "rust-checks.json"), "utf8")) as Record<string, unknown>)
  : {};
const py = existsSync(join(EV, "python-checks.json"))
  ? (JSON.parse(readFileSync(join(EV, "python-checks.json"), "utf8")) as Record<string, unknown>)
  : {};
const gitOut = (...a: string[]) => run(["git", ...a], { cwd: root }).stdout.trim();

writeFileSync(
  join(EV, "environment.json"),
  `${JSON.stringify(
    {
      generated_at: new Date().toISOString(),
      os: { type: osType(), platform: platform(), release: release(), cpus: cpus().length },
      git: {
        branch: gitOut("rev-parse", "--abbrev-ref", "HEAD"),
        commit: gitOut("rev-parse", "HEAD"),
        // Uncommitted non-evidence changes when acceptance started (must be 0 for valid evidence).
        dirty_files: dirtyAtStart.length,
        dirty_paths: dirtyAtStart.slice(0, 20),
      },
      node: process.version,
      pnpm: version([...PNPM, "--version"]),
      typescript: version([...PNPM, "exec", "tsc", "--version"]),
      biome: version([...PNPM, "exec", "biome", "--version"]),
      vitest: version([...PNPM, "exec", "vitest", "--version"]),
      langgraph: {
        "@langchain/langgraph": pkgVersion("@langchain/langgraph"),
        "@langchain/langgraph-checkpoint": pkgVersion("@langchain/langgraph-checkpoint"),
        "@langchain/langgraph-checkpoint-postgres": pkgVersion("@langchain/langgraph-checkpoint-postgres"),
        "@langchain/core": pkgVersion("@langchain/core"),
      },
      postgresql: {
        server_version: pgVersion,
        image: "postgres:18.6-trixie@sha256:5a5a84b19854a9ffaa54082c166ff4ec27473a361e496e5ea167f298f2da9722",
      },
      docker: version(["docker", "version", "--format", "{{.Server.Version}}"]),
      python: { uv: py["uv"] ?? null, interpreter: py["python"] ?? null },
      rust: {
        base_image: rust["base_image"] ?? null,
        image_id: rust["image_id"] ?? null,
        versions: rust["versions"] ?? null,
      },
      remote_ci:
        "not run: branch not pushed (project-owner decision); CI jobs executed locally by this script",
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(EV, "acceptance-log.json"),
  `${JSON.stringify({ kind: "p00-acceptance-log", generated_at: new Date().toISOString(), rungs: log, all_rungs_ok: log.every((l) => l.ok) }, null, 2)}\n`,
);

// Manifest of every machine-produced evidence file (report and verifier output are added by the verifier run).
const files = readdirSync(EV)
  .filter((f) => !["manifest.json", "P00-REPORT.md", "verifier-result.json"].includes(f))
  .sort();
writeFileSync(
  join(EV, "manifest.json"),
  `${JSON.stringify(buildManifest(EV, files, { phase: "P00", gitCommit: gitOut("rev-parse", "HEAD") }), null, 2)}\n`,
);

const failed = log.filter((l) => !l.ok);
console.log(
  `\nacceptance: ${log.length - failed.length}/${log.length} rungs ok${failed.length ? `; FAILED: ${failed.map((f) => f.rung).join(", ")}` : ""}`,
);
console.log("next: node scripts/p00/verify.ts");
process.exit(failed.length === 0 ? 0 : 1);
