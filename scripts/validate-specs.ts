/**
 * validate-spec-ledger / traceability-audit (P00 spec §11, §12, §27).
 *
 *   node scripts/validate-specs.ts [--json <out>]
 *
 * Exit codes: 0 VALID · 1 INVALID (errors) · 2 BLOCKED (no errors, but required
 * specification content is missing — e.g. the capability catalog).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  type DomainRegistry,
  DomainRegistrySchema,
  type Issue,
  P00_OPTIONS,
  type PhaseRegistry,
  PhaseRegistrySchema,
  validateDomains,
  validateInvariants,
  validateLedger,
  validatePhases,
} from "@harness/traceability";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
const load = (p: string): unknown => JSON.parse(readFileSync(join(root, p), "utf8"));

/** `path` must exist; `path#text` must exist and contain `text`. */
function refExists(ref: string): boolean {
  const [path, anchor] = ref.split("#", 2) as [string, string | undefined];
  const full = join(root, path);
  if (!existsSync(full)) return false;
  return anchor === undefined || readFileSync(full, "utf8").includes(anchor);
}
const fileSha256 = (path: string) => {
  const full = join(root, path);
  return existsSync(full) ? createHash("sha256").update(readFileSync(full)).digest("hex") : undefined;
};
const opts = { ...P00_OPTIONS, refExists, fileSha256 };

const sections: Record<string, { issues: Issue[]; stats: Record<string, number> }> = {};

const domainsRaw = load("specs/domains/domains.json");
sections["domains"] = {
  issues: validateDomains(domainsRaw, opts),
  stats: { count: (domainsRaw as DomainRegistry).domains?.length ?? 0 },
};

const invariantsRaw = load("specs/invariants/invariants.json") as {
  invariants?: Array<{ p00_scope: string }>;
};
const invScopes = (s: string) => invariantsRaw.invariants?.filter((i) => i.p00_scope === s).length ?? 0;
sections["invariants"] = {
  issues: validateInvariants(invariantsRaw, opts),
  stats: {
    count: invariantsRaw.invariants?.length ?? 0,
    enforced: invScopes("enforced"),
    boundary: invScopes("boundary"),
    deferred: invScopes("deferred"),
  },
};

const phasesRaw = load("specs/phases/phases.json");
sections["phases"] = {
  issues: validatePhases(phasesRaw, opts),
  stats: { count: (phasesRaw as PhaseRegistry).phases?.length ?? 0 },
};

const ledgerPath = "specs/capabilities/ledger.json";
if (!existsSync(join(root, ledgerPath))) {
  sections["capabilities"] = {
    issues: [
      {
        severity: "blocked",
        code: "LEDGER_MISSING",
        subject: "P00-BLK-001",
        message: `${ledgerPath} does not exist: the authoritative C001–C168 catalog has not been provided`,
      },
    ],
    stats: { records: 0, expected: P00_OPTIONS.capabilityRange.last - P00_OPTIONS.capabilityRange.first + 1 },
  };
} else {
  const ledger = load(ledgerPath) as { capabilities?: unknown[] };
  const domains = DomainRegistrySchema.safeParse(domainsRaw);
  const phases = PhaseRegistrySchema.safeParse(phasesRaw);
  sections["capabilities"] = {
    issues:
      domains.success && phases.success
        ? validateLedger(ledger, { domains: domains.data, phases: phases.data }, opts)
        : [
            {
              severity: "error",
              code: "REGISTRY_INVALID",
              message: "domain/phase registry invalid; ledger not checked",
            },
          ],
    stats: { records: ledger.capabilities?.length ?? 0, expected: 168 },
  };
}

const all = Object.values(sections).flatMap((s) => s.issues);
const errors = all.filter((i) => i.severity === "error").length;
const blocked = all.filter((i) => i.severity === "blocked").length;
const status = errors > 0 ? "INVALID" : blocked > 0 ? "BLOCKED" : "VALID";

const report = {
  audit: "p00-traceability",
  status,
  errors,
  blocked,
  generated_at: new Date().toISOString(),
  sections: Object.fromEntries(
    Object.entries(sections).map(([k, v]) => [
      k,
      {
        status: v.issues.some((i) => i.severity === "error")
          ? "INVALID"
          : v.issues.length > 0
            ? "BLOCKED"
            : "VALID",
        stats: v.stats,
        issues: v.issues,
      },
    ]),
  ),
};

for (const [k, v] of Object.entries(report.sections)) {
  console.log(`${k.padEnd(13)} ${v.status.padEnd(8)} ${JSON.stringify(v.stats)}`);
  for (const i of v.issues.filter((x) => x.severity === "error"))
    console.error(`  ERROR ${i.code}: ${i.message}`);
}
console.log(`traceability: ${status} (${errors} error(s), ${blocked} blocked item(s))`);
if (jsonOut) {
  mkdirSync(dirname(resolve(jsonOut)), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);
}
process.exit(status === "VALID" ? 0 : status === "BLOCKED" ? 2 : 1);
