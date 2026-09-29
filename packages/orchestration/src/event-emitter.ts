import type { EventId } from "@harness/contracts";
import { createEvent, type EventLog, type EventPayload, type EventType } from "@harness/events";
import type { WorkflowIdentity } from "@harness/kernel";

/**
 * Emits validated events for one workflow invocation into the harness event
 * log, chaining `causation_id` so the causal sequence can be reconstructed —
 * including across a process restart, where the chain resumes from the last
 * durably recorded event of the run.
 */
export class RunEventEmitter {
  readonly #log: EventLog;
  readonly #identity: WorkflowIdentity;
  #last: EventId | undefined;

  private constructor(log: EventLog, identity: WorkflowIdentity, last: EventId | undefined) {
    this.#log = log;
    this.#identity = identity;
    this.#last = last;
  }

  static async open(log: EventLog, identity: WorkflowIdentity): Promise<RunEventEmitter> {
    return new RunEventEmitter(log, identity, await log.lastEventId(identity.run_id));
  }

  async emit<T extends EventType>(type: T, payload: EventPayload<T>): Promise<EventId> {
    const event = createEvent(
      type,
      payload,
      {
        run_id: this.#identity.run_id,
        thread_id: this.#identity.thread_id,
        trace_id: this.#identity.trace_id,
        correlation_id: this.#identity.run_id,
      },
      this.#last === undefined ? {} : { causation_id: this.#last },
    );
    await this.#log.append(event);
    this.#last = event.event_id;
    return event.event_id;
  }
}
