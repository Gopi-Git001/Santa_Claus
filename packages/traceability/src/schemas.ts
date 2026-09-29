import { z } from "zod";

/**
 * Machine-readable specification registries (P00 spec sections 10–12).
 * The JSON files under specs/ are the source of truth; Markdown is generated.
 */

export const DomainIdSchema = z.string().regex(/^S\d{2}$/);
export const PhaseIdSchema = z.string().regex(/^P\d{2}$/);
export const CapabilityRequirementIdSchema = z.string().regex(/^C\d{3,}$/);
export const InvariantIdSchema = z.string().regex(/^INV-\d{3}$/);

/** Citation of where a registry fact comes from, e.g. "MASTER_PROJECT_WORKFLOW.md §4". */
const Source = z.string().min(1);

/** `path` or `path#exact test/section title` — resolved by the audit script. */
export const RefSchema = z.string().min(1);

export const DomainRegistrySchema = z.strictObject({
  schema_version: z.literal(1),
  source: Source,
  domains: z.array(
    z.strictObject({
      id: DomainIdSchema,
      name: z.string().min(1),
      responsibility: z.string().min(1),
    }),
  ),
});

export const InvariantRegistrySchema = z.strictObject({
  schema_version: z.literal(1),
  source: Source,
  invariants: z.array(
    z.strictObject({
      id: InvariantIdSchema,
      statement: z.string().min(1),
      // enforced: P00 has an executable check; boundary: P00 provides the contract
      // boundary a later phase enforces; deferred: nothing exists in P00 yet.
      p00_scope: z.enum(["enforced", "boundary", "deferred"]),
      p00_refs: z.array(RefSchema),
      notes: z.string(),
    }),
  ),
});

export const PhaseStatusSchema = z.enum(["NOT_STARTED", "IN_PROGRESS", "VERIFIED"]);

/**
 * Fields that the authoritative specifications do not yet define are `null`
 * (pending), never guessed. The audit reports pending fields as BLOCKED.
 */
export const PhaseRegistrySchema = z.strictObject({
  schema_version: z.literal(1),
  source: Source,
  phases: z.array(
    z.strictObject({
      id: PhaseIdSchema,
      purpose: z.string().min(1),
      prerequisites: z.array(PhaseIdSchema).nullable(),
      owned_capability_ids: z.array(CapabilityRequirementIdSchema).nullable(),
      entry_criteria: z.array(z.string().min(1)).nullable(),
      exit_criteria: z.array(z.string().min(1)).nullable(),
      evidence_requirements: z.array(z.string().min(1)).nullable(),
      status: PhaseStatusSchema,
      sources: z.array(Source).min(1),
    }),
  ),
});

export const CapabilityStatusSchema = z.enum([
  "NOT_STARTED",
  "SPECIFIED",
  "IMPLEMENTING",
  "IMPLEMENTED",
  "TESTED",
  "VERIFIED",
  "PRODUCTION_READY",
]);

export const CapabilityRecordSchema = z.strictObject({
  id: CapabilityRequirementIdSchema,
  title: z.string().min(1),
  description: z.string().min(1),
  domain: DomainIdSchema,
  owning_phase: PhaseIdSchema,
  dependencies: z.array(CapabilityRequirementIdSchema),
  status: CapabilityStatusSchema,
  mandatory: z.boolean(),
  implementation_refs: z.array(RefSchema),
  test_refs: z.array(RefSchema),
  security_refs: z.array(RefSchema),
  evidence_refs: z.array(RefSchema),
  notes: z.string(),
});

export const CapabilityLedgerSchema = z.strictObject({
  schema_version: z.literal(1),
  source: Source,
  /** Binds the ledger to the authoritative catalog document supplied by the project owner. */
  catalog: z.strictObject({
    path: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }),
  capabilities: z.array(CapabilityRecordSchema),
});

export type DomainRegistry = z.infer<typeof DomainRegistrySchema>;
export type InvariantRegistry = z.infer<typeof InvariantRegistrySchema>;
export type PhaseRegistry = z.infer<typeof PhaseRegistrySchema>;
export type Phase = PhaseRegistry["phases"][number];
export type CapabilityRecord = z.infer<typeof CapabilityRecordSchema>;
export type CapabilityLedger = z.infer<typeof CapabilityLedgerSchema>;
