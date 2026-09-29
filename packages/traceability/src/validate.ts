import type { z } from "zod";
import {
  type CapabilityLedger,
  CapabilityLedgerSchema,
  type DomainRegistry,
  DomainRegistrySchema,
  type InvariantRegistry,
  InvariantRegistrySchema,
  type PhaseRegistry,
  PhaseRegistrySchema,
} from "./schemas.ts";

export type IssueSeverity = "error" | "blocked";

export interface Issue {
  severity: IssueSeverity;
  code: string;
  message: string;
  subject?: string;
}

export interface ValidationOptions {
  /** Expected capability ID range, inclusive. P00 freezes C001–C168. */
  capabilityRange: { first: number; last: number };
  expectedDomainCount: number;
  phaseRange: { first: number; last: number };
  invariantRange: { first: number; last: number };
  /** Resolves a `path` or `path#title` reference. Injected so validation stays pure. */
  refExists: (ref: string) => boolean;
}

export const P00_OPTIONS: Omit<ValidationOptions, "refExists"> = {
  capabilityRange: { first: 1, last: 168 },
  expectedDomainCount: 16,
  phaseRange: { first: 0, last: 18 },
  invariantRange: { first: 1, last: 20 },
};

const cid = (n: number) => `C${String(n).padStart(3, "0")}`;
const pid = (n: number) => `P${String(n).padStart(2, "0")}`;
const iid = (n: number) => `INV-${String(n).padStart(3, "0")}`;
const range = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => first + i);

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const id of ids) (seen.has(id) ? dups : seen).add(id);
  return [...dups];
}

function schemaIssues(name: string, schema: z.ZodType, input: unknown): Issue[] {
  const r = schema.safeParse(input);
  return r.success
    ? []
    : r.error.issues.map((i) => ({
        severity: "error" as const,
        code: "SCHEMA_INVALID",
        subject: name,
        message: `${name}: ${i.path.join(".")}: ${i.message}`,
      }));
}

function missingAndUnexpected(kind: string, actual: string[], expected: string[]): Issue[] {
  const issues: Issue[] = [];
  for (const id of duplicates(actual))
    issues.push({ severity: "error", code: "DUPLICATE_ID", subject: id, message: `duplicate ${kind} ${id}` });
  const a = new Set(actual);
  const e = new Set(expected);
  for (const id of expected)
    if (!a.has(id))
      issues.push({ severity: "error", code: "MISSING_ID", subject: id, message: `missing ${kind} ${id}` });
  for (const id of a)
    if (!e.has(id))
      issues.push({
        severity: "error",
        code: "UNEXPECTED_ID",
        subject: id,
        message: `unexpected ${kind} ${id}`,
      });
  return issues;
}

export function validateDomains(input: unknown, opts: ValidationOptions): Issue[] {
  const s = schemaIssues("domains", DomainRegistrySchema, input);
  if (s.length) return s;
  const reg = input as DomainRegistry;
  const expected = range(1, opts.expectedDomainCount).map((n) => `S${String(n).padStart(2, "0")}`);
  return missingAndUnexpected(
    "domain",
    reg.domains.map((d) => d.id),
    expected,
  );
}

export function validateInvariants(input: unknown, opts: ValidationOptions): Issue[] {
  const s = schemaIssues("invariants", InvariantRegistrySchema, input);
  if (s.length) return s;
  const reg = input as InvariantRegistry;
  const issues = missingAndUnexpected(
    "invariant",
    reg.invariants.map((i) => i.id),
    range(opts.invariantRange.first, opts.invariantRange.last).map(iid),
  );
  for (const inv of reg.invariants) {
    if (inv.p00_scope === "enforced" && inv.p00_refs.length === 0)
      issues.push({
        severity: "error",
        code: "UNMAPPED_INVARIANT",
        subject: inv.id,
        message: `${inv.id} is marked enforced in P00 but has no refs`,
      });
    for (const ref of inv.p00_refs)
      if (!opts.refExists(ref))
        issues.push({
          severity: "error",
          code: "BROKEN_REF",
          subject: inv.id,
          message: `${inv.id}: missing ref ${ref}`,
        });
  }
  return issues;
}

export function validatePhases(input: unknown, opts: ValidationOptions): Issue[] {
  const s = schemaIssues("phases", PhaseRegistrySchema, input);
  if (s.length) return s;
  const reg = input as PhaseRegistry;
  const ids = reg.phases.map((p) => p.id);
  const issues = missingAndUnexpected(
    "phase",
    ids,
    range(opts.phaseRange.first, opts.phaseRange.last).map(pid),
  );
  const order = new Map(ids.map((id) => [id, Number(id.slice(1))]));
  for (const p of reg.phases) {
    for (const pre of p.prerequisites ?? []) {
      if (!order.has(pre))
        issues.push({
          severity: "error",
          code: "INVALID_PHASE_REF",
          subject: p.id,
          message: `${p.id}: unknown prerequisite ${pre}`,
        });
      else if ((order.get(pre) ?? 0) >= (order.get(p.id) ?? 0))
        issues.push({
          severity: "error",
          code: "PHASE_ORDER_VIOLATION",
          subject: p.id,
          message: `${p.id}: prerequisite ${pre} is not an earlier phase`,
        });
    }
    for (const field of ["prerequisites", "owned_capability_ids", "entry_criteria", "exit_criteria"] as const)
      if (p[field] === null)
        issues.push({
          severity: "blocked",
          code: "PHASE_FIELD_PENDING",
          subject: p.id,
          message: `${p.id}.${field} is not defined by the authoritative specifications`,
        });
  }
  return issues;
}

/** Detect cycles among dependencies; returns each cycle as an ID path. */
export function findCycles(graph: Map<string, string[]>): string[][] {
  const cycles: string[][] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (node: string) => {
    state.set(node, "visiting");
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      if (state.get(next) === "visiting") cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(node, "done");
  };
  for (const node of graph.keys()) if (!state.has(node)) visit(node);
  return cycles;
}

export function validateLedger(
  input: unknown,
  context: { domains: DomainRegistry; phases: PhaseRegistry },
  opts: ValidationOptions,
): Issue[] {
  const s = schemaIssues("ledger", CapabilityLedgerSchema, input);
  if (s.length) return s;
  const ledger = input as CapabilityLedger;
  const caps = ledger.capabilities;
  const issues = missingAndUnexpected(
    "capability",
    caps.map((c) => c.id),
    range(opts.capabilityRange.first, opts.capabilityRange.last).map(cid),
  );
  const domainIds = new Set(context.domains.domains.map((d) => d.id));
  const phaseOrder = new Map(context.phases.phases.map((p) => [p.id, Number(p.id.slice(1))]));
  const byId = new Map(caps.map((c) => [c.id, c]));

  for (const c of caps) {
    if (!domainIds.has(c.domain))
      issues.push({
        severity: "error",
        code: "INVALID_DOMAIN",
        subject: c.id,
        message: `${c.id}: unknown domain ${c.domain}`,
      });
    if (!phaseOrder.has(c.owning_phase))
      issues.push({
        severity: "error",
        code: "INVALID_PHASE_REF",
        subject: c.id,
        message: `${c.id}: unknown owning phase ${c.owning_phase}`,
      });
    for (const dep of c.dependencies) {
      const target = byId.get(dep);
      if (dep === c.id)
        issues.push({
          severity: "error",
          code: "SELF_DEPENDENCY",
          subject: c.id,
          message: `${c.id} depends on itself`,
        });
      else if (target === undefined)
        issues.push({
          severity: "error",
          code: "INVALID_DEPENDENCY",
          subject: c.id,
          message: `${c.id}: unknown dependency ${dep}`,
        });
      else if (
        c.mandatory &&
        target.mandatory &&
        (phaseOrder.get(target.owning_phase) ?? 0) > (phaseOrder.get(c.owning_phase) ?? 0)
      )
        issues.push({
          severity: "error",
          code: "PHASE_ORDER_VIOLATION",
          subject: c.id,
          message: `${c.id} (${c.owning_phase}) depends on ${dep} owned by later phase ${target.owning_phase}`,
        });
    }
    if (c.owning_phase === "P00" && c.mandatory) {
      if (c.test_refs.length === 0)
        issues.push({
          severity: "error",
          code: "P00_UNMAPPED_TESTS",
          subject: c.id,
          message: `${c.id}: no test refs`,
        });
      if (c.evidence_refs.length === 0)
        issues.push({
          severity: "error",
          code: "P00_UNMAPPED_EVIDENCE",
          subject: c.id,
          message: `${c.id}: no evidence refs`,
        });
    }
    for (const ref of [...c.implementation_refs, ...c.test_refs, ...c.security_refs, ...c.evidence_refs])
      if (!opts.refExists(ref))
        issues.push({
          severity: "error",
          code: "BROKEN_REF",
          subject: c.id,
          message: `${c.id}: missing ref ${ref}`,
        });
  }

  const mandatoryGraph = new Map(
    caps.filter((c) => c.mandatory).map((c) => [c.id, c.dependencies.filter((d) => byId.get(d)?.mandatory)]),
  );
  for (const cycle of findCycles(mandatoryGraph))
    issues.push({
      severity: "error",
      code: "DEPENDENCY_CYCLE",
      subject: cycle[0] ?? "",
      message: `mandatory dependency cycle: ${cycle.join(" -> ")}`,
    });

  // Cross-check the phase registry's owned IDs against ledger ownership.
  for (const p of context.phases.phases)
    for (const owned of p.owned_capability_ids ?? []) {
      const c = byId.get(owned);
      if (c === undefined)
        issues.push({
          severity: "error",
          code: "INVALID_DEPENDENCY",
          subject: p.id,
          message: `${p.id} owns unknown capability ${owned}`,
        });
      else if (c.owning_phase !== p.id)
        issues.push({
          severity: "error",
          code: "OWNERSHIP_MISMATCH",
          subject: p.id,
          message: `${p.id} lists ${owned}, but the ledger assigns it to ${c.owning_phase}`,
        });
    }
  return issues;
}
