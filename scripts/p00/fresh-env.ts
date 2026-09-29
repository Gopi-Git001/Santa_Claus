/**
 * Fresh-environment reproduction (P00 spec §25, §37).
 *
 *   node scripts/p00/fresh-env.ts [--json <out>] [--keep]
 *
 * Clones the committed HEAD of the current branch into a new temp directory,
 * bootstraps it with its own brand-new PostgreSQL (separate compose project,
 * port and volume), runs the full check ladder there, then destroys the
 * database and the clone (unless --keep). Only committed files are used, so
 * nothing untracked on this machine can make it pass.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { PNPM, run } from "../lib/proc.ts";

const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
const keep = args.includes("--keep");
const root = join(import.meta.dirname, "..", "..");

const git = (...a: string[]) => run(["git", ...a], { cwd: root }).stdout.trim();
const branch = git("rev-parse", "--abbrev-ref", "HEAD");
const commit = git("rev-parse", "HEAD");
const dir = join(mkdtempSync(join(tmpdir(), "harness-fresh-")), "repo");
const env: NodeJS.ProcessEnv = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
// The clone must not inherit this checkout's database configuration.
for (const k of Object.keys(env)) if (k === "DATABASE_URL" || k.startsWith("HARNESS_")) delete env[k];

interface Step {
  name: string;
  command: string;
  expected_exit: number[];
  exit_code: number;
  duration_ms: number;
  ok: boolean;
  tail: string;
}
const steps: Step[] = [];
function step(name: string, argv: string[], expected: number[] = [0], cwd = dir): Step {
  const r = run(argv, { cwd, env });
  const s: Step = {
    name,
    command: argv.join(" "),
    expected_exit: expected,
    exit_code: r.exitCode,
    duration_ms: r.durationMs,
    ok: expected.includes(r.exitCode),
    tail: (r.stdout + r.stderr).trim().split("\n").slice(-6).join("\n"),
  };
  steps.push(s);
  console.log(`${s.ok ? "PASS" : "FAIL"} ${name} (exit ${s.exit_code}, ${s.duration_ms}ms)`);
  return s;
}

step("clone", ["git", "clone", "--quiet", "--no-hardlinks", "--branch", branch, root, dir], [0], root);
const boot = step("bootstrap", [
  "node",
  "scripts/bootstrap.ts",
  "--db-port",
  "55433",
  "--compose-project",
  "harness-fresh",
]);
if (boot.ok) {
  step("typecheck", [...PNPM, "exec", "tsc", "--noEmit", "-p", "tsconfig.json"]);
  step("lint", [...PNPM, "exec", "biome", "check", "."]);
  step("tests (unit, contract, integration, failure, e2e)", [...PNPM, "exec", "vitest", "run"]);
  step("dependency boundaries", ["node", "scripts/check-boundaries.ts"]);
  step("schema drift", ["node", "scripts/export-schemas.ts", "--check"]);
  step("generated docs", ["node", "scripts/generate-spec-docs.ts", "--check"]);
  step("committed secrets", ["node", "scripts/check-secrets.ts"]);
  step("lockfiles", ["node", "scripts/check-lockfiles.ts"]);
  step("python", ["node", "scripts/python-check.ts"]);
  step("rust (fresh image + volumes)", ["node", "scripts/rust-check.ts", "--fresh"]);
  step("langgraph smoke", ["node", "--env-file=.env", "scripts/smoke.ts"]);
  // BLOCKED (exit 2) is the honest expected result while P00-BLK-001 is open.
  step("traceability audit (expected BLOCKED=2)", ["node", "scripts/validate-specs.ts"], [2]);
}
step("teardown database (down -v)", ["node", "scripts/dev-db.ts", "destroy"]);
if (!keep) rmSync(dirname(dir), { recursive: true, force: true });

const evidence = {
  kind: "p00-fresh-environment",
  generated_at: new Date().toISOString(),
  source: { branch, commit, clone: keep ? dir : "(deleted after run)" },
  isolation:
    "separate clone, separate compose project 'harness-fresh', port 55433, new volume, generated credentials",
  note: "pnpm and uv reuse the machine's content-addressed package caches; dependencies are still installed from the frozen lockfiles.",
  bootstrap_ms: boot.duration_ms,
  steps,
  ok: steps.every((s) => s.ok),
};
if (jsonOut) {
  mkdirSync(dirname(resolve(jsonOut)), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(evidence, null, 2)}\n`);
}
console.log(`fresh environment: ${evidence.ok ? "PASS" : "FAIL"} (${commit.slice(0, 7)})`);
process.exit(evidence.ok ? 0 : 1);
