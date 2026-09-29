import { z } from "zod";

/**
 * Opaque identifiers.
 *
 * Generated IDs are `<prefix>_<26 chars of lowercase Crockford base32>` (128 random
 * bits). The prefix names only the ID *kind*; IDs never encode secrets or mutable
 * business meaning (P00 spec section 8).
 *
 * Two kinds are deliberately not random:
 * - CapabilityId / ModelId are stable, human-assigned, namespaced names
 *   (e.g. `harness.echo`) because tools and models need stable identity across
 *   versions. They are *runtime* capability identifiers and are unrelated to the
 *   C001–C168 requirement IDs in the capability ledger.
 * - TraceId uses the W3C Trace Context format (32 lowercase hex, not all zero) so
 *   it can be propagated to standard tracing systems later.
 */

const CROCKFORD = "0123456789abcdefghjkmnpqrstvwxyz";
const OPAQUE_BODY = "[0-9a-hjkmnp-tv-z]{26}";

export const OpaqueIdPrefixes = {
  RunId: "run",
  ThreadId: "thr",
  AgentId: "agt",
  TaskId: "tsk",
  EventId: "evt",
  ArtifactId: "art",
  ApprovalId: "apr",
  EvidenceId: "evd",
} as const;

export type OpaqueIdKind = keyof typeof OpaqueIdPrefixes;

function opaqueId<K extends OpaqueIdKind>(kind: K) {
  const pattern = new RegExp(`^${OpaqueIdPrefixes[kind]}_${OPAQUE_BODY}$`);
  return z.string().regex(pattern, `invalid ${kind}`).brand<K>();
}

export const RunIdSchema = opaqueId("RunId");
export const ThreadIdSchema = opaqueId("ThreadId");
export const AgentIdSchema = opaqueId("AgentId");
export const TaskIdSchema = opaqueId("TaskId");
export const EventIdSchema = opaqueId("EventId");
export const ArtifactIdSchema = opaqueId("ArtifactId");
export const ApprovalIdSchema = opaqueId("ApprovalId");
export const EvidenceIdSchema = opaqueId("EvidenceId");

const STABLE_NAME = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;
export const CapabilityIdSchema = z
  .string()
  .max(128)
  .regex(STABLE_NAME, "invalid CapabilityId")
  .brand<"CapabilityId">();
export const ModelIdSchema = z.string().max(128).regex(STABLE_NAME, "invalid ModelId").brand<"ModelId">();
export const TraceIdSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/, "invalid TraceId")
  .refine((v) => !/^0+$/.test(v), "invalid TraceId: all zero")
  .brand<"TraceId">();

export type RunId = z.infer<typeof RunIdSchema>;
export type ThreadId = z.infer<typeof ThreadIdSchema>;
export type AgentId = z.infer<typeof AgentIdSchema>;
export type TaskId = z.infer<typeof TaskIdSchema>;
export type EventId = z.infer<typeof EventIdSchema>;
export type ArtifactId = z.infer<typeof ArtifactIdSchema>;
export type ApprovalId = z.infer<typeof ApprovalIdSchema>;
export type EvidenceId = z.infer<typeof EvidenceIdSchema>;
export type CapabilityId = z.infer<typeof CapabilityIdSchema>;
export type ModelId = z.infer<typeof ModelIdSchema>;
export type TraceId = z.infer<typeof TraceIdSchema>;

const idSchemas = {
  RunId: RunIdSchema,
  ThreadId: ThreadIdSchema,
  AgentId: AgentIdSchema,
  TaskId: TaskIdSchema,
  EventId: EventIdSchema,
  ArtifactId: ArtifactIdSchema,
  ApprovalId: ApprovalIdSchema,
  EvidenceId: EvidenceIdSchema,
} as const;

type OpaqueIdOf<K extends OpaqueIdKind> = z.infer<(typeof idSchemas)[K]>;

function randomBase32(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let out = "";
  for (const b of bytes) out += CROCKFORD[b & 31];
  return out;
}

/** Generate a fresh opaque ID of the given kind (130 bits of CSPRNG entropy). */
export function newId<K extends OpaqueIdKind>(kind: K): OpaqueIdOf<K> {
  return idSchemas[kind].parse(`${OpaqueIdPrefixes[kind]}_${randomBase32(26)}`) as OpaqueIdOf<K>;
}

export function newTraceId(): TraceId {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[15] = (bytes[15] ?? 0) | 1; // guarantee not all-zero
  return TraceIdSchema.parse(Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(""));
}
