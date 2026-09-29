import { describe, expect, it } from "vitest";
import {
  type CapabilityRecord,
  type DomainRegistry,
  findCycles,
  type PhaseRegistry,
  type ValidationOptions,
  validateDomains,
  validateLedger,
  validatePhases,
} from "../src/index.ts";

/*
 * FIXTURES ONLY. These records use IDs C901–C903 — deliberately outside the
 * reserved C001–C168 range — so they can never be mistaken for authoritative
 * capability requirements (see evidence/P00/blockers.json P00-BLK-001).
 */
const opts: ValidationOptions = {
  capabilityRange: { first: 901, last: 903 },
  expectedDomainCount: 2,
  phaseRange: { first: 0, last: 2 },
  invariantRange: { first: 1, last: 1 },
  refExists: (ref) => !ref.includes("missing"),
};

const domains: DomainRegistry = {
  schema_version: 1,
  source: "fixture",
  domains: [
    { id: "S01", name: "A", responsibility: "a" },
    { id: "S02", name: "B", responsibility: "b" },
  ],
};

const phase = (id: string, prerequisites: string[] | null, owned: string[] | null = []) => ({
  id,
  purpose: "fixture",
  prerequisites,
  owned_capability_ids: owned,
  entry_criteria: [],
  exit_criteria: [],
  evidence_requirements: [],
  status: "NOT_STARTED" as const,
  sources: ["fixture"],
});

const phases: PhaseRegistry = {
  schema_version: 1,
  source: "fixture",
  phases: [phase("P00", [], ["C901"]), phase("P01", ["P00"], ["C902"]), phase("P02", ["P01"], ["C903"])],
};

const cap = (id: string, overrides: Partial<CapabilityRecord> = {}): CapabilityRecord => ({
  id,
  title: `FIXTURE ${id} — not a requirement`,
  description: "fixture",
  domain: "S01",
  owning_phase: "P01",
  dependencies: [],
  status: "SPECIFIED",
  mandatory: true,
  implementation_refs: [],
  test_refs: ["tests/x.test.ts"],
  security_refs: [],
  evidence_refs: ["evidence/x.json"],
  notes: "",
  ...overrides,
});

const ledger = (capabilities: CapabilityRecord[]) => ({
  schema_version: 1,
  source: "fixture",
  catalog: { path: "fixture-catalog.md", sha256: "a".repeat(64) },
  capabilities,
});
const valid = () => [cap("C901", { owning_phase: "P00" }), cap("C902"), cap("C903", { owning_phase: "P02" })];
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe("validateLedger", () => {
  it("accepts a complete, consistent ledger", () => {
    expect(validateLedger(ledger(valid()), { domains, phases }, opts)).toEqual([]);
  });

  it("detects duplicate and missing IDs", () => {
    const caps = valid();
    caps[2] = cap("C902");
    expect(codes(validateLedger(ledger(caps), { domains, phases }, opts))).toEqual(
      expect.arrayContaining(["DUPLICATE_ID", "MISSING_ID"]),
    );
  });

  it("detects IDs outside the frozen range", () => {
    expect(codes(validateLedger(ledger([...valid(), cap("C999")]), { domains, phases }, opts))).toContain(
      "UNEXPECTED_ID",
    );
  });

  it("detects an invalid dependency reference", () => {
    const caps = valid();
    caps[1] = cap("C902", { dependencies: ["C950"] });
    expect(codes(validateLedger(ledger(caps), { domains, phases }, opts))).toContain("INVALID_DEPENDENCY");
  });

  it("detects an invalid phase reference and invalid domain", () => {
    const caps = valid();
    caps[1] = cap("C902", { owning_phase: "P77", domain: "S09" });
    expect(codes(validateLedger(ledger(caps), { domains, phases }, opts))).toEqual(
      expect.arrayContaining(["INVALID_PHASE_REF", "INVALID_DOMAIN"]),
    );
  });

  it("detects mandatory dependency cycles", () => {
    const caps = [
      cap("C901", { owning_phase: "P00" }),
      cap("C902", { dependencies: ["C903"], owning_phase: "P02" }),
      cap("C903", { dependencies: ["C902"], owning_phase: "P02" }),
    ];
    expect(codes(validateLedger(ledger(caps), { domains, phases }, opts))).toContain("DEPENDENCY_CYCLE");
  });

  it("detects a mandatory capability depending on a later phase", () => {
    const caps = valid();
    caps[0] = cap("C901", { owning_phase: "P00", dependencies: ["C903"] });
    expect(codes(validateLedger(ledger(caps), { domains, phases }, opts))).toContain("PHASE_ORDER_VIOLATION");
  });

  it("requires tests and evidence for mandatory P00-owned capabilities", () => {
    const caps = valid();
    caps[0] = cap("C901", { owning_phase: "P00", test_refs: [], evidence_refs: [] });
    expect(codes(validateLedger(ledger(caps), { domains, phases }, opts))).toEqual(
      expect.arrayContaining(["P00_UNMAPPED_TESTS", "P00_UNMAPPED_EVIDENCE"]),
    );
  });

  it("detects broken refs and phase-ownership mismatch", () => {
    const caps = valid();
    caps[1] = cap("C902", { test_refs: ["tests/missing.test.ts"], owning_phase: "P02" });
    expect(codes(validateLedger(ledger(caps), { domains, phases }, opts))).toEqual(
      expect.arrayContaining(["BROKEN_REF", "OWNERSHIP_MISMATCH"]),
    );
  });

  it("binds the ledger to its authoritative catalog by sha256", () => {
    const withHash = (sha: string | undefined) => ({ ...opts, fileSha256: () => sha });
    expect(validateLedger(ledger(valid()), { domains, phases }, withHash("a".repeat(64)))).toEqual([]);
    expect(codes(validateLedger(ledger(valid()), { domains, phases }, withHash("b".repeat(64))))).toContain(
      "CATALOG_MISMATCH",
    );
    expect(codes(validateLedger(ledger(valid()), { domains, phases }, withHash(undefined)))).toContain(
      "CATALOG_MISSING",
    );
    const { catalog: _, ...unbound } = ledger(valid());
    expect(codes(validateLedger(unbound, { domains, phases }, opts))).toEqual(["SCHEMA_INVALID"]);
  });

  it("reports a ledger with no P00-owned requirements as blocked, not valid", () => {
    const caps = [cap("C901", { owning_phase: "P01" }), cap("C902"), cap("C903", { owning_phase: "P02" })];
    const issues = validateLedger(
      ledger(caps),
      {
        domains,
        phases: { ...phases, phases: phases.phases.map((p) => ({ ...p, owned_capability_ids: [] })) },
      },
      opts,
    );
    expect(issues).toEqual([expect.objectContaining({ severity: "blocked", code: "NO_P00_REQUIREMENTS" })]);
  });

  it("rejects records missing required fields", () => {
    const { notes: _, ...incomplete } = cap("C901");
    expect(
      codes(validateLedger(ledger([incomplete as CapabilityRecord]), { domains, phases }, opts)),
    ).toEqual(["SCHEMA_INVALID"]);
  });
});

describe("validatePhases and validateDomains", () => {
  it("accepts the fixture registries", () => {
    expect(validatePhases(phases, opts)).toEqual([]);
    expect(validateDomains(domains, opts)).toEqual([]);
  });

  it("flags unknown and non-earlier prerequisites", () => {
    const bad = { ...phases, phases: [phase("P00", ["P02"]), phase("P01", ["P09"]), phase("P02", [])] };
    expect(codes(validatePhases(bad, opts))).toEqual(
      expect.arrayContaining(["PHASE_ORDER_VIOLATION", "INVALID_PHASE_REF"]),
    );
  });

  it("reports pending phase fields as blocked, not as valid", () => {
    const pending = { ...phases, phases: [phase("P00", []), phase("P01", null, null), phase("P02", [])] };
    const issues = validatePhases(pending, opts);
    expect(issues.every((i) => i.severity === "blocked")).toBe(true);
    expect(issues).toHaveLength(2);
  });

  it("detects a missing domain", () => {
    expect(codes(validateDomains({ ...domains, domains: [domains.domains[0]] }, opts))).toEqual([
      "MISSING_ID",
    ]);
  });
});

describe("findCycles", () => {
  it("finds a simple cycle and ignores a DAG", () => {
    expect(
      findCycles(
        new Map([
          ["a", ["b"]],
          ["b", ["a"]],
        ]),
      ),
    ).toHaveLength(1);
    expect(
      findCycles(
        new Map([
          ["a", ["b"]],
          ["b", []],
        ]),
      ),
    ).toEqual([]);
  });
});
