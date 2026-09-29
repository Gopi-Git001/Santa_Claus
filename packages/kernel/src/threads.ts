import type { RunId, ThreadId } from "@harness/contracts";

/**
 * System-of-record binding between a workflow thread and the run that owns it.
 * Implemented durably by @harness/persistence (PgThreadRepository). Resume
 * authorisation is checked against this binding, not against graph state alone.
 */
export interface ThreadBinding {
  thread_id: ThreadId;
  run_id: RunId;
  graph_name: string;
  graph_version: string;
}

export interface ThreadRegistry {
  bind(binding: ThreadBinding): Promise<void>;
  get(threadId: ThreadId): Promise<ThreadBinding | undefined>;
}
