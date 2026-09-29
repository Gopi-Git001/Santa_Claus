import {
  ArtifactIdSchema,
  ContentHashSchema,
  EvidenceIdSchema,
  HarnessErrorCodes,
  PolicyDecisionContract,
  RunStatusSchema,
} from "@harness/contracts";
import { z } from "zod";

/**
 * Versioned event catalog (P00 spec section 17). Each event type has a version
 * and a payload schema. Adding a type or changing a payload requires a version
 * bump and a new committed schema snapshot.
 */

const GraphRef = { graph: z.string().min(1), graph_version: z.string().min(1) };

export const EventCatalog = {
  "run.created": {
    version: 1,
    payload: z.strictObject({
      root_goal: z.string().min(1),
      policy_profile: z.string().min(1),
      budget_profile: z.string().min(1),
    }),
  },
  "run.status_changed": {
    version: 1,
    payload: z.strictObject({
      from: RunStatusSchema.nullable(),
      to: RunStatusSchema,
      reason: z.string().optional(),
    }),
  },
  "graph.started": { version: 1, payload: z.strictObject({ ...GraphRef }) },
  "graph.node_started": {
    version: 1,
    payload: z.strictObject({ ...GraphRef, node: z.string().min(1) }),
  },
  "graph.node_completed": {
    version: 1,
    payload: z.strictObject({ ...GraphRef, node: z.string().min(1), duration_ms: z.number().nonnegative() }),
  },
  "graph.interrupted": {
    version: 1,
    payload: z.strictObject({ ...GraphRef, node: z.string().min(1), interrupt_kind: z.string().min(1) }),
  },
  "graph.resumed": {
    version: 1,
    payload: z.strictObject({ ...GraphRef, resume_kind: z.string().min(1) }),
  },
  "graph.failed": {
    version: 1,
    payload: z.strictObject({
      ...GraphRef,
      node: z.string().min(1).optional(),
      error_code: z.enum(HarnessErrorCodes),
      message: z.string(),
    }),
  },
  "graph.completed": {
    version: 1,
    payload: z.strictObject({ ...GraphRef, outcome: z.string().min(1) }),
  },
  "artifact.created": {
    version: 1,
    payload: z.strictObject({
      artifact_id: ArtifactIdSchema,
      content_hash: ContentHashSchema,
      media_type: z.string().min(1),
    }),
  },
  "policy.decision_recorded": {
    version: 1,
    payload: z.strictObject({
      subject: z.string().min(1),
      decision: PolicyDecisionContract.schema,
    }),
  },
  "test.evidence_recorded": {
    version: 1,
    payload: z.strictObject({
      evidence_id: EvidenceIdSchema,
      name: z.string().min(1),
      path: z.string().min(1),
    }),
  },
} as const;

export type EventType = keyof typeof EventCatalog;
export const EventTypes = Object.keys(EventCatalog) as EventType[];
export type EventPayload<T extends EventType> = z.infer<(typeof EventCatalog)[T]["payload"]>;
