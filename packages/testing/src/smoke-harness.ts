import { FilesystemArtifactStore } from "@harness/artifacts";
import type { HarnessConfig } from "@harness/config";
import {
  type ArtifactRecord,
  HarnessError,
  isHarnessError,
  newId,
  newTraceId,
  type Run,
  type RunStatus,
} from "@harness/contracts";
import { createEvent, type EventPayload, type EventType } from "@harness/events";
import type { WorkflowIdentity, WorkflowOutcome } from "@harness/kernel";
import { createLogger, type Logger } from "@harness/observability";
import {
  type CheckpointPersistence,
  type HumanResponse,
  HumanResponseSchema,
  LangGraphSmokeWorkflow,
  postgresCheckpointPersistence,
  type SmokeInput,
  type StreamObservation,
} from "@harness/orchestration";
import { Database, pgRepositories, type Queryable } from "@harness/persistence";

/**
 * Composition root for the P00 smoke workflow against real dependencies:
 * PostgreSQL system of record + PostgreSQL checkpoints + filesystem artifacts.
 * It owns the run lifecycle around the graph (the full kernel is P01).
 */
export interface SmokeHarness {
  readonly db: Database;
  readonly workflow: LangGraphSmokeWorkflow;
  readonly observations: StreamObservation[];
  startRun(input: SmokeInput): Promise<{ identity: WorkflowIdentity; outcome: WorkflowOutcome }>;
  resumeRun(identity: WorkflowIdentity, response: HumanResponse): Promise<WorkflowOutcome>;
  close(): Promise<void>;
}

export interface SmokeHarnessOptions {
  config: HarnessConfig;
  /** Override the database URL (e.g. a per-test database); defaults to config. */
  databaseUrl?: string;
  logger?: Logger;
}

/**
 * Legal run status transitions for the P00 smoke lifecycle. Terminal states
 * (COMPLETED, FAILED, CANCELLED, UNKNOWN) have no exits; the full run state
 * machine is owned by the P01 kernel.
 */
const LEGAL_RUN_TRANSITIONS: Record<RunStatus, RunStatus[]> = {
  CREATED: ["RUNNING", "CANCELLED"],
  RUNNING: ["INTERRUPTED", "COMPLETED", "FAILED", "UNKNOWN", "CANCELLED"],
  INTERRUPTED: ["RUNNING", "CANCELLED"],
  COMPLETED: [],
  FAILED: [],
  CANCELLED: [],
  UNKNOWN: [],
};

/** Append an event chained to the run's latest event, inside the caller's transaction. */
async function appendChained<T extends EventType>(
  tx: Queryable,
  identity: WorkflowIdentity,
  type: T,
  payload: EventPayload<T>,
): Promise<void> {
  const events = pgRepositories(tx).events;
  const last = await events.lastEventId(identity.run_id);
  await events.append(
    createEvent(
      type,
      payload,
      {
        run_id: identity.run_id,
        thread_id: identity.thread_id,
        trace_id: identity.trace_id,
        correlation_id: identity.run_id,
      },
      last === undefined ? {} : { causation_id: last },
    ),
  );
}

export async function createSmokeHarness(options: SmokeHarnessOptions): Promise<SmokeHarness> {
  const { config } = options;
  const url = options.databaseUrl ?? config.database.url.reveal();
  const log = (options.logger ?? createLogger({ level: config.logging.level })).child({
    component: "smoke-harness",
  });
  const db = await Database.connect({
    connectionString: url,
    poolMax: config.database.pool_max,
    connectTimeoutMs: config.database.connect_timeout_ms,
    applicationName: "harness-smoke",
  });
  let persistence: CheckpointPersistence;
  try {
    persistence = await postgresCheckpointPersistence({
      connectionString: url,
      schema: config.langgraph.checkpoint_schema,
    });
  } catch (error) {
    await db.close();
    throw error;
  }
  const artifacts = await FilesystemArtifactStore.open(config.artifacts.root, { create: true });
  const repos = pgRepositories(db);
  const observations: StreamObservation[] = [];
  const workflow = new LangGraphSmokeWorkflow({
    persistence,
    events: repos.events,
    threads: repos.threads,
    maxSteps: config.langgraph.max_steps,
    onStream: (o) => observations.push(o),
  });

  /**
   * Compare-and-set run status change along the legal P00 run state machine.
   * Returns false (and changes nothing) if the run is not currently in `from`.
   */
  const transition = async (
    identity: WorkflowIdentity,
    from: RunStatus,
    to: RunStatus,
    reason: string,
  ): Promise<boolean> => {
    if (!LEGAL_RUN_TRANSITIONS[from].includes(to)) {
      throw new HarnessError("INVALID_REFERENCE", `illegal run transition ${from} -> ${to}`);
    }
    const changed = await db.withTransaction(async (tx) => {
      if (!(await pgRepositories(tx).runs.transition(identity.run_id, from, to, new Date()))) return false;
      await appendChained(tx, identity, "run.status_changed", { from, to, reason });
      return true;
    });
    if (changed) log.info("run status changed", { run_id: identity.run_id, from, to, reason });
    return changed;
  };

  const recordFinalArtifact = async (
    identity: WorkflowIdentity,
    outcome: WorkflowOutcome,
  ): Promise<ArtifactRecord> => {
    const record = await artifacts.put({
      run_id: identity.run_id,
      bytes: new TextEncoder().encode(`${JSON.stringify(outcome.state, null, 2)}\n`),
      media_type: "application/json",
      producer: { kind: "graph_node", id: "p00.smoke/finalize" },
      provenance: { trace_id: identity.trace_id, source: "p00.smoke final state" },
    });
    await db.withTransaction(async (tx) => {
      await pgRepositories(tx).artifacts.insert(record);
      await appendChained(tx, identity, "artifact.created", {
        artifact_id: record.artifact_id,
        content_hash: record.content_hash,
        media_type: record.media_type,
      });
    });
    return record;
  };

  const mustTransition = async (
    identity: WorkflowIdentity,
    from: RunStatus,
    to: RunStatus,
    reason: string,
  ) => {
    if (!(await transition(identity, from, to, reason))) {
      throw new HarnessError("UNKNOWN_OUTCOME", `run was not ${from} when moving to ${to}`, {
        details: { run_id: identity.run_id },
      });
    }
  };

  const settle = async (identity: WorkflowIdentity, execute: () => Promise<WorkflowOutcome>) => {
    try {
      const outcome = await execute();
      if (outcome.kind === "interrupted") {
        await mustTransition(identity, "RUNNING", "INTERRUPTED", "awaiting human response");
      } else {
        await recordFinalArtifact(identity, outcome);
        await mustTransition(identity, "RUNNING", "COMPLETED", String(outcome.state["outcome"]));
      }
      return outcome;
    } catch (error) {
      // A failed graph is FAILED; a lost connection leaves the outcome UNKNOWN (INV-012).
      const cause = isHarnessError(error) ? (error.details["cause_code"] ?? error.code) : "error";
      const status: RunStatus =
        cause === "DB_DISCONNECTED" || cause === "UNKNOWN_OUTCOME" ? "UNKNOWN" : "FAILED";
      await transition(identity, "RUNNING", status, String(cause)).catch((e: unknown) =>
        log.error("could not record run failure", { run_id: identity.run_id, error: e }),
      );
      log.error("smoke run failed", { run_id: identity.run_id, thread_id: identity.thread_id, error });
      throw error;
    }
  };

  return {
    db,
    workflow,
    observations,
    async startRun(input) {
      const identity: WorkflowIdentity = {
        run_id: newId("RunId"),
        thread_id: newId("ThreadId"),
        trace_id: newTraceId(),
      };
      const now = new Date().toISOString();
      const run: Run = {
        schema_version: 1,
        id: identity.run_id,
        root_goal: input.goal,
        status: "CREATED",
        created_at: now,
        updated_at: now,
        policy_profile: "p00-default",
        budget_profile: "p00-default",
        root_thread_id: identity.thread_id,
        metadata: { graph: workflow.name, graph_version: workflow.version },
      };
      await db.withTransaction(async (tx) => {
        await pgRepositories(tx).runs.create(run);
        await appendChained(tx, identity, "run.created", {
          root_goal: run.root_goal,
          policy_profile: run.policy_profile,
          budget_profile: run.budget_profile,
        });
      });
      await mustTransition(identity, "CREATED", "RUNNING", "smoke start");
      log.info("smoke run started", { run_id: identity.run_id, thread_id: identity.thread_id });
      const outcome = await settle(identity, () => workflow.start(identity, input));
      return { identity, outcome };
    },
    async resumeRun(identity, response) {
      // Every rejection happens before any state change: unknown/mismatched thread and
      // nothing-pending are classified by the workflow itself; an invalid response is
      // rejected here; and only one caller can win the INTERRUPTED -> RUNNING transition.
      const binding = await repos.threads.get(identity.thread_id);
      const snapshot = await workflow.inspect(identity.thread_id);
      if (binding?.run_id !== identity.run_id || snapshot?.pending_interrupt == null) {
        return workflow.resume(identity, response);
      }
      const parsed = HumanResponseSchema.safeParse(response);
      if (!parsed.success) {
        throw new HarnessError("PAYLOAD_INVALID", "invalid human response", {
          details: { issues: parsed.error.issues.map((i) => i.message) },
        });
      }
      if (!(await transition(identity, "INTERRUPTED", "RUNNING", "resume with human response"))) {
        throw new HarnessError("GRAPH_NOT_INTERRUPTED", "run is not awaiting a human response", {
          details: { run_id: identity.run_id },
        });
      }
      log.info("smoke run resumed", { run_id: identity.run_id, decision: parsed.data.decision });
      return settle(identity, () => workflow.resume(identity, parsed.data));
    },
    async close() {
      await persistence.close().catch(() => {});
      await db.close();
    },
  };
}
