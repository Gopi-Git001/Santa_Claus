import type { EventId, RunId } from "@harness/contracts";
import { HarnessError } from "@harness/contracts";
import { type AnyEventEnvelope, type EventEnvelope, parseEvent } from "./envelope.ts";

/**
 * Harness event interface. P00 defines the port and a durable PostgreSQL
 * implementation (in @harness/persistence); the full event bus is P02.
 */
export interface EventSink {
  /** Durably append an event. Must reject duplicates of an existing event_id. */
  append(event: EventEnvelope): Promise<void>;
}

export interface EventLog extends EventSink {
  listByRun(runId: RunId): Promise<AnyEventEnvelope[]>;
  lastEventId(runId: RunId): Promise<EventId | undefined>;
}

/** In-process event log for unit tests only. Not a durable implementation. */
export class InMemoryEventLog implements EventLog {
  readonly #events: AnyEventEnvelope[] = [];

  async append(event: EventEnvelope): Promise<void> {
    if (this.#events.some((e) => e.event_id === event.event_id)) {
      throw new HarnessError("DUPLICATE_ID", `duplicate event_id ${event.event_id}`);
    }
    this.#events.push(parseEvent(event));
  }

  async listByRun(runId: RunId): Promise<AnyEventEnvelope[]> {
    return this.#events.filter((e) => e.run_id === runId);
  }

  async lastEventId(runId: RunId): Promise<EventId | undefined> {
    return (await this.listByRun(runId)).at(-1)?.event_id;
  }
}
