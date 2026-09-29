import type { EventId, RunId, TraceId } from "@harness/contracts";
import {
  AgentIdSchema,
  EventIdSchema,
  HarnessError,
  newId,
  RunIdSchema,
  TaskIdSchema,
  ThreadIdSchema,
  TraceIdSchema,
} from "@harness/contracts";
import { z } from "zod";
import { EventCatalog, type EventPayload, type EventType, EventTypes } from "./catalog.ts";

/**
 * EventEnvelope (P00 spec section 9). `schema_version` is the version of the
 * named event type; the envelope shape itself is fixed by that version.
 * `causation_id` points at the event that directly caused this one and
 * `correlation_id` groups every event belonging to one logical flow.
 */
export const EventEnvelopeSchema = z.strictObject({
  event_id: EventIdSchema,
  schema_version: z.int().positive(),
  event_type: z.enum(EventTypes as [EventType, ...EventType[]]),
  timestamp: z.iso.datetime({ offset: true }),
  run_id: RunIdSchema,
  thread_id: ThreadIdSchema.optional(),
  agent_id: AgentIdSchema.optional(),
  task_id: TaskIdSchema.optional(),
  trace_id: TraceIdSchema,
  causation_id: EventIdSchema.optional(),
  correlation_id: z.string().min(1).max(128).optional(),
  payload: z.unknown(),
});

export type EventEnvelope<T extends EventType = EventType> = Omit<
  z.infer<typeof EventEnvelopeSchema>,
  "event_type" | "payload"
> & { event_type: T; payload: EventPayload<T> };

export type AnyEventEnvelope = { [T in EventType]: EventEnvelope<T> }[EventType];

/** Parse untrusted input into a fully validated envelope + payload. */
export function parseEvent(input: unknown): AnyEventEnvelope {
  const envelope = EventEnvelopeSchema.safeParse(input);
  if (!envelope.success) {
    throw new HarnessError("PAYLOAD_INVALID", "invalid event envelope", {
      details: { issues: envelope.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  const entry = EventCatalog[envelope.data.event_type];
  if (envelope.data.schema_version !== entry.version) {
    throw new HarnessError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `${envelope.data.event_type}: unsupported schema_version ${envelope.data.schema_version}`,
      {
        details: {
          event_type: envelope.data.event_type,
          received: envelope.data.schema_version,
          supported: [entry.version],
        },
      },
    );
  }
  const payload = entry.payload.safeParse(envelope.data.payload);
  if (!payload.success) {
    throw new HarnessError("PAYLOAD_INVALID", `${envelope.data.event_type}: invalid payload`, {
      details: { issues: payload.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })) },
    });
  }
  return { ...envelope.data, payload: payload.data } as AnyEventEnvelope;
}

export interface EventContext {
  run_id: RunId;
  trace_id: TraceId;
  thread_id?: EventEnvelope["thread_id"];
  agent_id?: EventEnvelope["agent_id"];
  task_id?: EventEnvelope["task_id"];
  correlation_id?: string;
}

/** Build and validate a new event. Validation happens at creation, not only at read. */
export function createEvent<T extends EventType>(
  type: T,
  payload: EventPayload<T>,
  context: EventContext,
  options: { causation_id?: EventId; now?: Date } = {},
): EventEnvelope<T> {
  const candidate = {
    event_id: newId("EventId"),
    schema_version: EventCatalog[type].version,
    event_type: type,
    timestamp: (options.now ?? new Date()).toISOString(),
    ...context,
    ...(options.causation_id === undefined ? {} : { causation_id: options.causation_id }),
    payload,
  };
  return parseEvent(candidate) as EventEnvelope<T>;
}
