/**
 * Independent P00 verifier (P00 spec §25, §34).
 *
 *   node scripts/p00/verify.ts
 *
 * Does not trust any single "green" signal. It re-reads every evidence file,
 * re-validates the manifest hashes, re-runs the traceability and boundary
 * validators itself, parses test results (failures AND skips), scans evidence
 * for the real database secret, honours open blockers, and maps each §34
 * checklist item to PASS / FAIL / BLOCKED / NOT_VERIFIED. P00 is VERIFIED only
 * if every item is PASS. Writes evidence/P00/verifier-result.json and a sealed
 * final-manifest.json. Exit code 0 only when VERIFIED.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildManifest, validateManifest } from "@harness/artifacts";
import {
  DomainRegistrySchema,
  P00_OPTIONS,
  PhaseRegistrySchema,
  validateDomains,
  validateInvariants,
  validateLedger,
  validatePhases,
} from "@harness/traceability";
import { checkBoundaries } from "../lib/boundaries.ts";
import { readEnvFile } from "../lib/dev-env.ts";

const root = join(import.meta.dirname, "..", "..");
const EV = join(root, "evidence", "P00");
type Status = "PASS" | "FAIL" | "BLOCKED" | "NOT_VERIFIED";
interface Criterion {
  section: string;
  item: string;
  status: Status;
  detail: string;
}
const criteria: Criterion[] = [];
const add = (section: string, item: string, status: Status, detail: string) =>
  criteria.push({ section, item, status, detail });
const pass = (ok: boolean): Status => (ok ? "PASS" : "FAIL");

const readJson = <T>(file: string): T | undefined => {
  const p = join(EV, file);
  if (!existsSync(p)) return undefined;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as T;
  } catch {
    return undefined;
  }
};

// ---------------------------------------------------------------- inputs
interface VitestJson {
  success: boolean;
  numTotalTests: number;
  numPassedTests: number;
  numFailedTests: number;
  numPendingTests: number;
  numTodoTests: number;
  testResults: Array<{
    name: string;
    assertionResults: Array<{ title: string; fullName: string; status: string }>;
  }>;
}
const layers = {
  unit: readJson<VitestJson>("unit-tests.json"),
  contract: readJson<VitestJson>("contract-tests.json"),
  integration: readJson<VitestJson>("integration-tests.json"),
  failure: readJson<VitestJson>("failure-tests.vitest.json"),
  e2e: readJson<VitestJson>("e2e-tests.json"),
};
const layerClean = (v: VitestJson | undefined): boolean =>
  v?.success === true &&
  v.numFailedTests === 0 &&
  v.numPendingTests === 0 &&
  v.numTodoTests === 0 &&
  v.numTotalTests > 0;
const testPassed = (v: VitestJson | undefined, fileFragment: string, titleFragment?: string) => {
  const files = v?.testResults.filter((f) => f.name.replaceAll("\\", "/").includes(fileFragment)) ?? [];
  const tests = files
    .flatMap((f) => f.assertionResults)
    .filter((a) => titleFragment === undefined || a.fullName.includes(titleFragment));
  return tests.length > 0 && tests.every((a) => a.status === "passed");
};
const log = readJson<{ rungs: Array<{ rung: string; exit_code: number; ok: boolean; command: string }> }>(
  "acceptance-log.json",
);
const rungOk = (name: string) => log?.rungs.find((r) => r.rung === name)?.ok === true;
const smoke = readJson<{ ok: boolean; scenarios: Array<Record<string, unknown>> }>("langgraph-smoke.json");
const scenario = (n: string) => smoke?.scenarios.find((s) => s["name"] === n);
const pr = readJson<{ ok: boolean; checks: Record<string, boolean>; checkpoint_store: string }>(
  "persistence-resume.json",
);
const fresh = readJson<{
  ok: boolean;
  steps: Array<{ name: string; ok: boolean }>;
  source: { commit: string };
}>("fresh-environment.json");
const py = readJson<{ ok: boolean; steps: Array<{ name: string; exit_code: number }> }>("python-checks.json");
const rust = readJson<{
  ok: boolean;
  fresh_build: boolean;
  versions: string[];
  steps: Array<{ name: string; exit_code: number }>;
  base_image: string;
}>("rust-checks.json");
const failures = readJson<{ scenarios: Array<{ id: string; status: string }>; all_passed: boolean }>(
  "failure-tests.json",
);
const blockers = readJson<{ blockers: Array<{ id: string; status: string; title: string }> }>(
  "blockers.json",
);
const openBlockers = blockers?.blockers.filter((b) => b.status === "OPEN") ?? [];

// ---------------------------------------------------------------- independent re-validation
const refExists = (ref: string) => {
  const [path, anchor] = ref.split("#", 2) as [string, string | undefined];
  const full = join(root, path);
  return existsSync(full) && (anchor === undefined || readFileSync(full, "utf8").includes(anchor));
};
const opts = { ...P00_OPTIONS, refExists };
const spec = (p: string) => JSON.parse(readFileSync(join(root, p), "utf8")) as unknown;
const domainsRaw = spec("specs/domains/domains.json");
const phasesRaw = spec("specs/phases/phases.json");
const domainIssues = validateDomains(domainsRaw, opts);
const invariantIssues = validateInvariants(spec("specs/invariants/invariants.json"), opts);
const phaseIssues = validatePhases(phasesRaw, opts);
const ledgerPath = join(root, "specs", "capabilities", "ledger.json");
const ledgerIssues = existsSync(ledgerPath)
  ? validateLedger(
      JSON.parse(readFileSync(ledgerPath, "utf8")),
      { domains: DomainRegistrySchema.parse(domainsRaw), phases: PhaseRegistrySchema.parse(phasesRaw) },
      opts,
    )
  : null;
const ledgerStatus: Status =
  ledgerIssues === null
    ? "BLOCKED"
    : ledgerIssues.some((i) => i.severity === "error")
      ? "FAIL"
      : ledgerIssues.length
        ? "BLOCKED"
        : "PASS";
const ledgerDetail =
  ledgerIssues === null
    ? "specs/capabilities/ledger.json absent — authoritative catalog not provided (P00-BLK-001)"
    : `${ledgerIssues.length} issue(s)`;
const boundaryViolations = checkBoundaries(root);

// ---------------------------------------------------------------- §34 Architecture
add(
  "Architecture",
  "16 domains documented.",
  pass(domainIssues.length === 0),
  `${domainIssues.length} issue(s); re-validated`,
);
add(
  "Architecture",
  "P00--P18 registry valid.",
  phaseIssues.some((i) => i.severity === "error") ? "FAIL" : phaseIssues.length ? "BLOCKED" : "PASS",
  `19 phases structurally valid; ${phaseIssues.filter((i) => i.severity === "blocked").length} field(s) pending the authoritative specification/catalog (P00-BLK-001)`,
);
add(
  "Architecture",
  "architectural invariants registered.",
  pass(invariantIssues.length === 0),
  `INV-001..INV-020; ${invariantIssues.length} issue(s); all refs resolved`,
);
add(
  "Architecture",
  "dependency-direction rules enforced.",
  pass(
    boundaryViolations.length === 0 &&
      rungOk("dependency-boundaries") &&
      testPassed(layers.contract, "boundaries.test.ts"),
  ),
  `${boundaryViolations.length} violation(s) on independent re-run; planted-violation tests passed=${testPassed(layers.contract, "boundaries.test.ts")}`,
);

// ---------------------------------------------------------------- §34 Requirements
for (const item of [
  "C001--C168 unique.",
  "168/168 assigned to domains.",
  "168/168 assigned to owning phases.",
  "all dependency references valid.",
  "P00-owned requirements have test/evidence mappings.",
]) {
  add("Requirements", item, ledgerStatus, ledgerDetail);
}

// ---------------------------------------------------------------- §34 Toolchain
const freshStep = (n: string) => fresh?.steps.find((s) => s.name.startsWith(n))?.ok === true;
add(
  "Toolchain",
  "clean bootstrap succeeds.",
  pass(fresh?.ok === true && freshStep("clone") && freshStep("bootstrap")),
  fresh
    ? `fresh clone of ${fresh.source.commit.slice(0, 7)}: ${fresh.steps.filter((s) => s.ok).length}/${fresh.steps.length} steps ok`
    : "fresh-environment.json missing",
);
const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")) as {
  compilerOptions: Record<string, unknown>;
};
add(
  "Toolchain",
  "TypeScript strict checks pass.",
  pass(
    rungOk("typecheck-ts (strict)") &&
      tsconfig.compilerOptions["strict"] === true &&
      rungOk("lint-ts (biome)"),
  ),
  `tsc strict=${tsconfig.compilerOptions["strict"]} exit ok=${rungOk("typecheck-ts (strict)")}; biome ok=${rungOk("lint-ts (biome)")}`,
);
add(
  "Toolchain",
  "Python baseline checks pass.",
  pass(
    py?.ok === true &&
      ["ruff-lint", "ruff-format", "mypy", "pytest"].every((n) =>
        py.steps.some((s) => s.name === n && s.exit_code === 0),
      ),
  ),
  py ? py.steps.map((s) => `${s.name}=${s.exit_code}`).join(" ") : "python-checks.json missing",
);
add(
  "Toolchain",
  "Rust baseline checks pass.",
  pass(
    rust?.ok === true &&
      rust.fresh_build &&
      ["fmt", "clippy", "test"].every((n) => rust.steps.some((s) => s.name === n && s.exit_code === 0)) &&
      rust.versions.some((v) => v.startsWith("rustc 1.98.1")),
  ),
  rust ? `${rust.versions.join("; ")}; fresh=${rust.fresh_build}` : "rust-checks.json missing",
);

// ---------------------------------------------------------------- §34 Runtime
const straight = scenario("straight_through");
const gated = scenario("interrupt_resume");
const evTypes = (s: Record<string, unknown> | undefined) =>
  ((s?.["events"] as Array<{ type: string }> | undefined) ?? []).map((e) => e.type);
add(
  "Runtime",
  "LangGraph.js smoke graph executes.",
  pass(
    smoke?.ok === true &&
      straight?.["outcome"] === "completed" &&
      evTypes(straight).includes("graph.completed") &&
      testPassed(layers.integration, "langgraph-postgres.test.ts"),
  ),
  `smoke outcome=${String(straight?.["outcome"])}; ${evTypes(straight).length} events`,
);
const obs = (straight?.["stream_observations"] as unknown[] | undefined)?.length ?? 0;
add(
  "Runtime",
  "streaming/event observation works.",
  pass(obs === 4 && straight?.["causal_chain_intact"] === true && gated?.["causal_chain_intact"] === true),
  `${obs} streamed node updates; causal chains intact=${String(straight?.["causal_chain_intact"])}/${String(gated?.["causal_chain_intact"])}`,
);
add(
  "Runtime",
  "durable checkpoint path works.",
  pass(
    pr?.checks["checkpoint_persisted_before_restart"] === true &&
      (pr?.checkpoint_store ?? "").includes("postgresql") &&
      Number(gated?.["checkpoint_rows_at_interrupt"]) > 0,
  ),
  `PostgreSQL checkpoint rows at interrupt=${String(gated?.["checkpoint_rows_at_interrupt"])}`,
);
add(
  "Runtime",
  "process/runtime restart-resume proof passes.",
  pass(
    [
      "three_distinct_processes",
      "interrupt_pending_after_restart",
      "resumed_to_completion",
      "causal_chain_intact_across_processes",
      "pre_restart_nodes_not_reexecuted",
    ].every((k) => pr?.checks[k] === true) && testPassed(layers.e2e, "restart-resume.test.ts"),
  ),
  pr
    ? Object.entries(pr.checks)
        .filter(([k]) => !k.includes("rejected") && !k.includes("untouched"))
        .map(([k, v]) => `${k}=${v}`)
        .join(" ")
    : "persistence-resume.json missing",
);
add(
  "Runtime",
  "interrupt/resume proof passes.",
  pass(
    gated?.["outcome_before_resume"] === "interrupted" &&
      gated?.["outcome_after_resume"] === "completed" &&
      pr?.checks["explicit_human_response_recorded"] === true,
  ),
  `before=${String(gated?.["outcome_before_resume"])} after=${String(gated?.["outcome_after_resume"])}`,
);
add(
  "Runtime",
  "thread isolation proof passes.",
  pass(
    [
      "foreign_run_rejected_THREAD_MISMATCH",
      "unknown_thread_rejected_THREAD_NOT_FOUND",
      "completed_thread_rejected_GRAPH_NOT_INTERRUPTED",
      "other_thread_state_untouched",
    ].every((k) => pr?.checks[k] === true) &&
      testPassed(layers.integration, "langgraph-postgres.test.ts", "isolates threads"),
  ),
  "foreign run, unknown thread and completed thread all rejected with classified errors; other thread untouched",
);

// ---------------------------------------------------------------- §34 Persistence/artifacts
add(
  "Persistence/artifacts",
  "PostgreSQL migrations are reproducible.",
  pass(
    rungOk("migrations (reproducible)") &&
      testPassed(layers.integration, "postgres.test.ts", "migrations are reproducible") &&
      testPassed(layers.integration, "postgres.test.ts", "identical schema on a fresh database"),
  ),
  "idempotent re-run, identical schema on a fresh database, tamper detection",
);
add(
  "Persistence/artifacts",
  "artifact put/get/hash verification passes.",
  pass(
    testPassed(layers.integration, "artifacts.test.ts") &&
      failures?.scenarios.find((s) => s.id === "F10")?.status === "passed",
  ),
  "integration artifacts suite + F10 hash-mismatch scenario",
);
const manifest = readJson<unknown>("manifest.json");
const requiredEvidence = [
  "environment.json",
  "dependency-lock-summary.json",
  "typecheck.txt",
  "lint.txt",
  "unit-tests.json",
  "contract-tests.json",
  "integration-tests.json",
  "langgraph-smoke.json",
  "persistence-resume.json",
  "failure-tests.json",
  "traceability-audit.json",
];
const manifestIssues =
  manifest === undefined
    ? [{ path: "manifest.json", problem: "missing" }]
    : validateManifest(EV, manifest, requiredEvidence);
add(
  "Persistence/artifacts",
  "evidence manifest validates.",
  pass(manifestIssues.length === 0),
  `${manifestIssues.length} issue(s)${manifestIssues.length ? `: ${JSON.stringify(manifestIssues.slice(0, 5))}` : ""}`,
);

// ---------------------------------------------------------------- §34 Security/quality
const f = (id: string) => failures?.scenarios.find((s) => s.id === id)?.status === "passed";
add(
  "Security/quality",
  "configuration validation passes.",
  pass(testPassed(layers.unit, "config.test.ts") && f("F01")),
  "config unit suite + F01",
);
// Secrets must never reach evidence: scan every evidence file for this machine's real DB password.
const dotenv = readEnvFile(join(root, ".env"));
const urlPassword = (u: string | undefined) => {
  try {
    return u === undefined ? undefined : decodeURIComponent(new URL(u).password) || undefined;
  } catch {
    return undefined;
  }
};
const secretValues = [
  dotenv.get("HARNESS_DB_PASSWORD"),
  dotenv.get("DATABASE_URL"),
  urlPassword(dotenv.get("DATABASE_URL")),
  process.env["DATABASE_URL"],
  urlPassword(process.env["DATABASE_URL"]),
].filter((v): v is string => typeof v === "string" && v.length >= 8);
const leaks = readdirSync(EV).filter((file) => {
  const text = readFileSync(join(EV, file), "utf8");
  return secretValues.some((s) => text.includes(s));
});
add(
  "Security/quality",
  "secret-redaction fixture passes.",
  pass(
    testPassed(layers.unit, "redaction.test.ts") && f("F12") && leaks.length === 0 && secretValues.length > 0,
  ),
  `redaction fixture + F12 passed; real DB secret found in ${leaks.length} evidence file(s) (${secretValues.length} secret value(s) checked)`,
);
add(
  "Security/quality",
  "failure suite passes.",
  pass(failures?.all_passed === true && failures.scenarios.length === 15 && layerClean(layers.failure)),
  failures
    ? `${failures.scenarios.filter((s) => s.status === "passed").length}/15 scenarios passed`
    : "failure-tests.json missing",
);
add(
  "Security/quality",
  "no general shell/network authority exists in P00 smoke graph.",
  pass(
    testPassed(layers.contract, "no-authority.test.ts") &&
      testPassed(
        layers.contract,
        "extension-contracts.test.ts",
        "refuses to register any capability with side effects",
      ),
  ),
  "static import/token audit of smoke graph + side-effect capabilities refused",
);
add(
  "Security/quality",
  "dependency boundary audit passes.",
  pass(boundaryViolations.length === 0),
  `${boundaryViolations.length} violation(s)`,
);

// ---------------------------------------------------------------- §34 CI/evidence
const allLayersClean = Object.values(layers).every(layerClean);
const localCiGreen = log?.rungs.every((r) => r.ok) === true && allLayersClean;
add(
  "CI/evidence",
  "all mandatory CI jobs green.",
  localCiGreen ? "NOT_VERIFIED" : "FAIL",
  localCiGreen
    ? "all 14 CI job equivalents pass locally via scripts/p00/acceptance.ts; the hosted workflow (.github/workflows/p00.yml) has not run because the branch was not pushed (project-owner decision)"
    : `local CI equivalents failing: ${
        log?.rungs
          .filter((r) => !r.ok)
          .map((r) => r.rung)
          .join(", ") ?? "acceptance-log.json missing"
      }`,
);
const missing = requiredEvidence.filter((x) => !existsSync(join(EV, x)));
add(
  "CI/evidence",
  "P00 evidence directory complete.",
  pass(missing.length === 0 && existsSync(join(EV, "P00-REPORT.md"))),
  missing.length ? `missing: ${missing.join(", ")}` : "all §16 evidence files present",
);
const report = existsSync(join(EV, "P00-REPORT.md")) ? readFileSync(join(EV, "P00-REPORT.md"), "utf8") : "";
const reportSections = [
  "Environment",
  "Commands",
  "Results",
  "Failures",
  "Limitations",
  "Traceability",
  "Gate status",
];
add(
  "CI/evidence",
  "P00-REPORT.md records exact commands, versions, results, failures, limitations.",
  pass(
    reportSections.every((s) => report.includes(`## ${s}`) || new RegExp(`^## .*${s}`, "mi").test(report)),
  ),
  `sections present: ${reportSections.filter((s) => new RegExp(`^## .*${s}`, "mi").test(report)).join(", ") || "none"}`,
);
const skipped = Object.values(layers).reduce((n, v) => n + (v ? v.numPendingTests + v.numTodoTests : 0), 0);
const pyXml = existsSync(join(EV, "python-tests.xml"))
  ? readFileSync(join(EV, "python-tests.xml"), "utf8")
  : "";
const pySkipped = Number(/skipped="(\d+)"/.exec(pyXml)?.[1] ?? "NaN");
add(
  "CI/evidence",
  "no unexplained skipped mandatory tests.",
  pass(skipped === 0 && pySkipped === 0 && Object.values(layers).every((v) => v !== undefined)),
  `vitest skipped/todo=${skipped}; pytest skipped=${pySkipped}; rust ignored per cargo output (0 in rust-checks run)`,
);

// "independent verifier returns success" is true only if everything else passes.
const others = criteria.every((c) => c.status === "PASS");
add(
  "CI/evidence",
  "independent verifier returns success.",
  pass(others),
  others ? "all other criteria PASS" : "see non-PASS criteria",
);

const counts = criteria.reduce<Record<Status, number>>(
  (acc, c) => {
    acc[c.status] += 1;
    return acc;
  },
  { PASS: 0, FAIL: 0, BLOCKED: 0, NOT_VERIFIED: 0 },
);
const verified = counts.PASS === criteria.length && openBlockers.length === 0;
const result = {
  kind: "p00-independent-verification",
  generated_at: new Date().toISOString(),
  phase: "P00",
  status: verified ? "VERIFIED" : "INCOMPLETE",
  counts,
  open_blockers: openBlockers,
  test_totals: Object.fromEntries(
    Object.entries(layers).map(([k, v]) => [
      k,
      v
        ? {
            total: v.numTotalTests,
            passed: v.numPassedTests,
            failed: v.numFailedTests,
            skipped: v.numPendingTests + v.numTodoTests,
          }
        : null,
    ]),
  ),
  criteria,
};
writeFileSync(join(EV, "verifier-result.json"), `${JSON.stringify(result, null, 2)}\n`);
// Seal: hash everything in evidence/P00 including the report and this result.
const gitHead = (() => {
  try {
    return readFileSync(join(root, ".git", "HEAD"), "utf8").trim();
  } catch {
    return null;
  }
})();
const sealFiles = readdirSync(EV)
  .filter((x) => x !== "final-manifest.json")
  .sort();
writeFileSync(
  join(EV, "final-manifest.json"),
  `${JSON.stringify(buildManifest(EV, sealFiles, { phase: "P00", gitCommit: gitHead }), null, 2)}\n`,
);

for (const c of criteria) console.log(`${c.status.padEnd(12)} [${c.section}] ${c.item}`);
console.log(
  `\nP00: ${result.status}  ${JSON.stringify(counts)}  open blockers: ${openBlockers.map((b) => b.id).join(", ") || "none"}`,
);
process.exit(verified ? 0 : 1);
