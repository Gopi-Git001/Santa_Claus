import { z } from "zod";
import {
  AgentIdSchema,
  ArtifactIdSchema,
  CapabilityIdSchema,
  RunIdSchema,
  TaskIdSchema,
  ThreadIdSchema,
  TraceIdSchema,
} from "./ids.ts";
import { JsonObjectSchema } from "./json.ts";
import { defineContract } from "./versioning.ts";

/**
 * Core record contracts (P00 spec section 9). These are contracts only; later
 * phases own the behaviour behind them.
 */

const Timestamp = z.iso.datetime({ offset: true });
const NonEmpty = z.string().min(1);

/** Reference to a named policy profile plus parameters. Behaviour is owned by later phases. */
export const PolicyRefSchema = z.strictObject({
  profile: NonEmpty,
  params: JsonObjectSchema.default({}),
});

/**
 * Finite resource limits. Every field is required and finite so no agent or task
 * can exist without bounds (INV-005).
 */
export const BudgetSchema = z.strictObject({
  max_steps: z.int().positive(),
  max_wall_clock_ms: z.int().positive(),
  max_tokens: z.int().positive(),
  max_cost_micro_usd: z.int().nonnegative(),
});

/** Typed secret reference; raw secret values never travel through contracts (INV-010). */
export const SecretRefSchema = z.strictObject({
  kind: z.literal("secret_ref"),
  provider: z.enum(["env"]),
  name: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
});

// Scopes default to "no access" so nothing gets unrestricted authority by default (INV-017).
export const WorkspaceScopeSchema = z.strictObject({
  mode: z.enum(["none", "read", "read_write"]).default("none"),
  roots: z.array(NonEmpty).default([]),
});
export const NetworkScopeSchema = z.strictObject({
  mode: z.enum(["none", "allowlist"]).default("none"),
  hosts: z.array(NonEmpty).default([]),
});
export const SecretScopeSchema = z.strictObject({
  secret_refs: z.array(SecretRefSchema).default([]),
});
export const MemoryScopeSchema = z.strictObject({
  namespaces: z.array(NonEmpty).default([]),
});

// ---------------------------------------------------------------- Run

export const RunStatusSchema = z.enum([
  "CREATED",
  "RUNNING",
  "INTERRUPTED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  // Unknown outcome is a distinct state, never silently mapped to FAILED (INV-012).
  "UNKNOWN",
]);

export const RunContract = defineContract(
  "Run",
  1,
  z.strictObject({
    schema_version: z.literal(1),
    id: RunIdSchema,
    root_goal: NonEmpty,
    status: RunStatusSchema,
    created_at: Timestamp,
    updated_at: Timestamp,
    policy_profile: NonEmpty,
    budget_profile: NonEmpty,
    root_thread_id: ThreadIdSchema,
    metadata: JsonObjectSchema,
  }),
);

// ---------------------------------------------------------------- AgentSpec

export const AgentSpecContract = defineContract(
  "AgentSpec",
  1,
  z
    .strictObject({
      schema_version: z.literal(1),
      agent_id: AgentIdSchema,
      run_id: RunIdSchema,
      parent_agent_id: AgentIdSchema.optional(),
      role: NonEmpty,
      objective: NonEmpty,
      success_criteria: z.array(NonEmpty).min(1),
      model_policy: PolicyRefSchema,
      context_policy: PolicyRefSchema,
      allowed_capabilities: z.array(CapabilityIdSchema),
      denied_capabilities: z.array(CapabilityIdSchema),
      workspace_scope: WorkspaceScopeSchema,
      network_scope: NetworkScopeSchema,
      secret_scope: SecretScopeSchema,
      memory_scope: MemoryScopeSchema,
      budget: BudgetSchema,
      delegation_policy: PolicyRefSchema,
      approval_policy: PolicyRefSchema,
      verification_policy: PolicyRefSchema,
      lifecycle_policy: PolicyRefSchema,
    })
    .refine((a) => a.parent_agent_id !== a.agent_id, {
      message: "agent cannot be its own parent",
      path: ["parent_agent_id"],
    })
    .refine((a) => !a.allowed_capabilities.some((c) => a.denied_capabilities.includes(c)), {
      message: "capability cannot be both allowed and denied",
      path: ["allowed_capabilities"],
    }),
);

// ---------------------------------------------------------------- Task

export const TaskStatusSchema = z.enum([
  "PENDING",
  "READY",
  "RUNNING",
  "BLOCKED",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "UNKNOWN",
]);

export const TaskContract = defineContract(
  "Task",
  1,
  z
    .strictObject({
      schema_version: z.literal(1),
      id: TaskIdSchema,
      run_id: RunIdSchema,
      owner_agent_id: AgentIdSchema.optional(),
      objective: NonEmpty,
      dependencies: z.array(TaskIdSchema),
      status: TaskStatusSchema,
      priority: z.int().min(0).max(100),
      success_criteria: z.array(NonEmpty).min(1),
      budget: BudgetSchema,
      verification_policy: PolicyRefSchema,
    })
    .refine((t) => !t.dependencies.includes(t.id), {
      message: "task cannot depend on itself",
      path: ["dependencies"],
    })
    .refine((t) => new Set(t.dependencies).size === t.dependencies.length, {
      message: "duplicate task dependency",
      path: ["dependencies"],
    }),
);

// ---------------------------------------------------------------- ArtifactRecord

export const ContentHashSchema = z.strictObject({
  algorithm: z.literal("sha256"),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
});

export const ProducerSchema = z.strictObject({
  kind: z.enum(["harness", "graph_node", "agent", "human", "test"]),
  id: NonEmpty,
});

export const ArtifactRecordContract = defineContract(
  "ArtifactRecord",
  1,
  z.strictObject({
    schema_version: z.literal(1),
    artifact_id: ArtifactIdSchema,
    run_id: RunIdSchema,
    producer: ProducerSchema,
    media_type: z.string().regex(/^[a-z]+\/[a-z0-9.+-]+$/i),
    size_bytes: z.int().nonnegative(),
    content_hash: ContentHashSchema,
    storage_ref: z.strictObject({ backend: NonEmpty, key: NonEmpty }),
    created_at: Timestamp,
    // Provenance is mandatory (INV-008).
    provenance: z.strictObject({
      trace_id: TraceIdSchema,
      source: NonEmpty,
      derived_from: z.array(ArtifactIdSchema).default([]),
    }),
    verification_status: z.enum(["UNVERIFIED", "VERIFIED", "FAILED"]),
  }),
);

// ---------------------------------------------------------------- ProposedAction / PolicyDecision

export const TrustLevelSchema = z.enum(["trusted", "harness", "user", "untrusted"]);

export const SideEffectClassSchema = z.enum([
  "none",
  "read_only",
  "local_write",
  "external_write",
  "irreversible",
]);

export const ProposedActionContract = defineContract(
  "ProposedAction",
  1,
  z.strictObject({
    schema_version: z.literal(1),
    actor: ProducerSchema,
    capability: CapabilityIdSchema,
    operation: NonEmpty,
    arguments: JsonObjectSchema,
    target: z.strictObject({ kind: NonEmpty, ref: NonEmpty }),
    risk_context: z.strictObject({
      side_effect_class: SideEffectClassSchema,
      input_trust: TrustLevelSchema,
      notes: z.string().optional(),
    }),
    estimated_budget: BudgetSchema.partial(),
  }),
);

export const PolicyDecisionContract = defineContract(
  "PolicyDecision",
  1,
  z.strictObject({
    schema_version: z.literal(1),
    decision: z.enum(["AUTO_ALLOW", "ASK_HUMAN", "DENY"]),
    reason_code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    policy_version: NonEmpty,
    constraints: JsonObjectSchema,
  }),
);

export type Run = z.infer<typeof RunContract.schema>;
export type RunStatus = z.infer<typeof RunStatusSchema>;
export type AgentSpec = z.infer<typeof AgentSpecContract.schema>;
export type Task = z.infer<typeof TaskContract.schema>;
export type ArtifactRecord = z.infer<typeof ArtifactRecordContract.schema>;
export type ProposedAction = z.infer<typeof ProposedActionContract.schema>;
export type PolicyDecision = z.infer<typeof PolicyDecisionContract.schema>;
export type Budget = z.infer<typeof BudgetSchema>;
export type SecretRef = z.infer<typeof SecretRefSchema>;
export type PolicyRef = z.infer<typeof PolicyRefSchema>;
export type TrustLevel = z.infer<typeof TrustLevelSchema>;
export type SideEffectClass = z.infer<typeof SideEffectClassSchema>;

/**
 * Cross-record lineage rule (INV-006): a child agent must belong to the same root
 * run as its parent. Returns a list of violations (empty when valid).
 */
export function lineageViolations(child: AgentSpec, parent: AgentSpec | undefined): string[] {
  if (child.parent_agent_id === undefined) return [];
  if (parent === undefined) return [`parent ${child.parent_agent_id} not found`];
  const violations: string[] = [];
  if (parent.agent_id !== child.parent_agent_id) violations.push("parent_agent_id does not match parent");
  if (parent.run_id !== child.run_id)
    violations.push("child agent belongs to a different run than its parent");
  return violations;
}
