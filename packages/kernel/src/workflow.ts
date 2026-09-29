import type { JsonObject, JsonValue, RunId, ThreadId, TraceId } from "@harness/contracts";

/**
 * Harness-owned orchestration port (ADR-0002). The kernel and every business
 * package talk to workflows only through this interface; LangGraph (or any
 * replacement) lives behind it in @harness/orchestration.
 */

export interface WorkflowIdentity {
  run_id: RunId;
  thread_id: ThreadId;
  trace_id: TraceId;
}

export interface PendingInterrupt {
  node: string;
  kind: string;
  prompt: JsonValue;
}

export type WorkflowOutcome =
  | { kind: "completed"; identity: WorkflowIdentity; state: JsonObject }
  | { kind: "interrupted"; identity: WorkflowIdentity; interrupt: PendingInterrupt; state: JsonObject };

export interface ThreadSnapshot {
  identity: WorkflowIdentity;
  state: JsonObject;
  /** Nodes that would run next; empty when the thread has finished. */
  next: string[];
  pending_interrupt: PendingInterrupt | null;
}

/**
 * A durable, resumable workflow.
 *
 * - `start` must bind the thread to the run exactly once; starting an existing thread fails.
 * - `resume` must fail with THREAD_NOT_FOUND for an unknown thread, THREAD_MISMATCH when the
 *   thread belongs to a different run, and GRAPH_NOT_INTERRUPTED when nothing is pending.
 * - Node failures surface as NODE_FAILED with the failing node recorded.
 */
export interface WorkflowRuntime<Input extends object, Response extends object> {
  readonly name: string;
  readonly version: string;
  start(identity: WorkflowIdentity, input: Input): Promise<WorkflowOutcome>;
  resume(identity: WorkflowIdentity, response: Response): Promise<WorkflowOutcome>;
  inspect(threadId: ThreadId): Promise<ThreadSnapshot | undefined>;
}
