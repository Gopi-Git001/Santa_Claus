import { ArtifactIdSchema, CapabilityIdSchema, JsonObjectSchema, TrustLevelSchema } from "@harness/contracts";
import { z } from "zod";

/*
 * Reserved extension contracts (P00 spec §20). P00 defines the shapes and the
 * trust entry points only; the systems themselves are P13. Discovery never
 * implies authorisation: everything discovered enters as untrusted and
 * unauthorised until policy promotes it.
 */

const SemVer = z.string().regex(/^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/);
const ExtensionId = z.string().regex(/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/);

const SourceTrust = z.strictObject({
  origin: z.string().min(1),
  trust: TrustLevelSchema,
  signature: z
    .strictObject({ algorithm: z.string().min(1), value: z.string().min(1), key_id: z.string() })
    .nullable(),
});

const Compatibility = z.strictObject({ harness: z.string().min(1) });

// ---------------------------------------------------------------- Skill

export const SkillManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  id: ExtensionId,
  version: SemVer,
  purpose: z.string().min(1),
  required_capabilities: z.array(CapabilityIdSchema),
  references: z.array(z.string().min(1)),
  source: SourceTrust,
  compatibility: Compatibility,
});

// ---------------------------------------------------------------- Plugin

export const PluginManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  id: ExtensionId,
  version: SemVer,
  provides: z.strictObject({
    capabilities: z.array(CapabilityIdSchema),
    skills: z.array(ExtensionId),
    hooks: z.array(z.string().min(1)),
    schemas: z.array(z.string().min(1)),
  }),
  dependencies: z.array(z.strictObject({ id: ExtensionId, version_range: z.string().min(1) })),
  required_permissions: z.array(z.string().min(1)),
  compatibility: Compatibility,
  source: SourceTrust,
});

// ---------------------------------------------------------------- Hooks

export const HookPoints = [
  "before_model",
  "after_model",
  "before_tool",
  "after_tool",
  "agent_spawned",
  "task_completed",
  "approval_requested",
  "error",
  "checkpoint",
] as const;

export const HookContractSchema = z.strictObject({
  schema_version: z.literal(1),
  id: ExtensionId,
  point: z.enum(HookPoints),
  /** Hooks are deterministic interceptors: bounded time, no model calls. */
  timeout_ms: z.int().positive().max(10_000),
  may_modify: z.boolean(),
  may_block: z.boolean(),
});

export type HookPoint = (typeof HookPoints)[number];

// ---------------------------------------------------------------- MCP boundary

export const McpDiscoveredItemSchema = z.strictObject({
  server: z.string().min(1),
  kind: z.enum(["tool", "resource", "prompt"]),
  name: z.string().min(1),
  description: z.string(),
  input_schema: JsonObjectSchema.optional(),
});

/** The only entry point for MCP discoveries into the harness trust pipeline. */
export const CandidateCapabilitySchema = z.strictObject({
  origin: z.literal("mcp"),
  server: z.string().min(1),
  kind: z.enum(["tool", "resource", "prompt"]),
  name: z.string().min(1),
  description: z.string(),
  trust: z.literal("untrusted"),
  authorized: z.literal(false),
});

export type McpDiscoveredItem = z.infer<typeof McpDiscoveredItemSchema>;
export type CandidateCapability = z.infer<typeof CandidateCapabilitySchema>;

/**
 * Convert an MCP discovery into a candidate. Whatever the server claims about
 * itself (including text in its description), the result is untrusted and
 * unauthorised (INV-013).
 */
export function mcpDiscoveryToCandidate(item: unknown): CandidateCapability {
  const d = McpDiscoveredItemSchema.parse(item);
  return CandidateCapabilitySchema.parse({
    origin: "mcp",
    server: d.server,
    kind: d.kind,
    name: d.name,
    description: d.description,
    trust: "untrusted",
    authorized: false,
  });
}

// ---------------------------------------------------------------- A2A boundary

export const RemoteAgentIdentitySchema = z.strictObject({
  agent_uri: z.url(),
  display_name: z.string().min(1),
  public_key_id: z.string().min(1).nullable(),
});

export const AgentAdvertisementSchema = z.strictObject({
  schema_version: z.literal(1),
  identity: RemoteAgentIdentitySchema,
  advertised_capabilities: z.array(z.strictObject({ name: z.string().min(1), description: z.string() })),
  authentication: z.enum(["none", "mtls", "oauth2", "signed_envelope"]),
  trust: z.literal("untrusted"),
});

export const A2AArtifactReferenceSchema = z.strictObject({
  artifact_id: ArtifactIdSchema.nullable(),
  uri: z.url().nullable(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  media_type: z.string().min(1),
});

export const A2AMessageEnvelopeSchema = z.strictObject({
  schema_version: z.literal(1),
  message_id: z.string().min(1),
  from: RemoteAgentIdentitySchema,
  to: RemoteAgentIdentitySchema,
  sent_at: z.iso.datetime({ offset: true }),
  body: JsonObjectSchema,
  artifacts: z.array(A2AArtifactReferenceSchema),
  trust: TrustLevelSchema,
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;
export type HookContract = z.infer<typeof HookContractSchema>;
export type AgentAdvertisement = z.infer<typeof AgentAdvertisementSchema>;
export type A2AMessageEnvelope = z.infer<typeof A2AMessageEnvelopeSchema>;
