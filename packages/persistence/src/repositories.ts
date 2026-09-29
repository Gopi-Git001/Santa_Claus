import {
  type ArtifactId,
  type ArtifactRecord,
  ArtifactRecordContract,
  type EventId,
  HarnessError,
  parseContract,
  type Run,
  RunContract,
  type RunId,
  type RunStatus,
  type ThreadId,
} from "@harness/contracts";
import { type AnyEventEnvelope, type EventEnvelope, type EventLog, parseEvent } from "@harness/events";
import type { Database, Queryable } from "./database.ts";

/*
 * Repository ports (storage-agnostic) and their PostgreSQL implementations.
 * Every record is validated against its contract on write AND on read, so
 * corrupted rows surface as PAYLOAD_INVALID instead of propagating.
 */

export interface RunRepository {
  create(run: Run): Promise<void>;
  get(id: RunId): Promise<Run | undefined>;
  /** Compare-and-set status transition; returns false if the current status was not `from`. */
  transition(id: RunId, from: RunStatus, to: RunStatus, at: Date): Promise<boolean>;
}

export interface ThreadBinding {
  thread_id: ThreadId;
  run_id: RunId;
  graph_name: string;
  graph_version: string;
}

export interface ThreadRepository {
  bind(binding: ThreadBinding): Promise<void>;
  get(threadId: ThreadId): Promise<ThreadBinding | undefined>;
}

export interface ArtifactRecordRepository {
  insert(record: ArtifactRecord): Promise<void>;
  get(id: ArtifactId): Promise<ArtifactRecord | undefined>;
}

const ts = (v: Date | string) => (v instanceof Date ? v.toISOString() : new Date(v).toISOString());

export class PgRunRepository implements RunRepository {
  readonly #db: Queryable;
  constructor(db: Queryable) {
    this.#db = db;
  }

  async create(run: Run): Promise<void> {
    const r = parseContract(RunContract, run);
    await this.#db.query(
      `INSERT INTO harness_runs (id, schema_version, root_goal, status, created_at, updated_at,
         policy_profile, budget_profile, root_thread_id, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        r.id,
        r.schema_version,
        r.root_goal,
        r.status,
        r.created_at,
        r.updated_at,
        r.policy_profile,
        r.budget_profile,
        r.root_thread_id,
        JSON.stringify(r.metadata),
      ],
    );
  }

  async get(id: RunId): Promise<Run | undefined> {
    const res = await this.#db.query("SELECT * FROM harness_runs WHERE id = $1", [id]);
    const row = res.rows[0];
    if (row === undefined) return undefined;
    return parseContract(RunContract, {
      schema_version: row["schema_version"],
      id: row["id"],
      root_goal: row["root_goal"],
      status: row["status"],
      created_at: ts(row["created_at"]),
      updated_at: ts(row["updated_at"]),
      policy_profile: row["policy_profile"],
      budget_profile: row["budget_profile"],
      root_thread_id: row["root_thread_id"],
      metadata: row["metadata"],
    });
  }

  async transition(id: RunId, from: RunStatus, to: RunStatus, at: Date): Promise<boolean> {
    const res = await this.#db.query(
      "UPDATE harness_runs SET status = $3, updated_at = $4 WHERE id = $1 AND status = $2",
      [id, from, to, at.toISOString()],
    );
    return res.rowCount === 1;
  }
}

export class PgThreadRepository implements ThreadRepository {
  readonly #db: Queryable;
  constructor(db: Queryable) {
    this.#db = db;
  }

  async bind(b: ThreadBinding): Promise<void> {
    await this.#db.query(
      "INSERT INTO harness_threads (thread_id, run_id, graph_name, graph_version) VALUES ($1,$2,$3,$4)",
      [b.thread_id, b.run_id, b.graph_name, b.graph_version],
    );
  }

  async get(threadId: ThreadId): Promise<ThreadBinding | undefined> {
    const res = await this.#db.query(
      "SELECT thread_id, run_id, graph_name, graph_version FROM harness_threads WHERE thread_id = $1",
      [threadId],
    );
    return res.rows[0] as ThreadBinding | undefined;
  }
}

/** Durable, append-only event log (INV-007). */
export class PgEventLog implements EventLog {
  readonly #db: Queryable;
  constructor(db: Queryable) {
    this.#db = db;
  }

  async append(event: EventEnvelope): Promise<void> {
    const e = parseEvent(event);
    await this.#db.query(
      `INSERT INTO harness_events (event_id, run_id, thread_id, event_type, schema_version, occurred_at,
         trace_id, causation_id, correlation_id, envelope)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        e.event_id,
        e.run_id,
        e.thread_id ?? null,
        e.event_type,
        e.schema_version,
        e.timestamp,
        e.trace_id,
        e.causation_id ?? null,
        e.correlation_id ?? null,
        JSON.stringify(e),
      ],
    );
  }

  async listByRun(runId: RunId): Promise<AnyEventEnvelope[]> {
    const res = await this.#db.query<{ envelope: unknown }>(
      "SELECT envelope FROM harness_events WHERE run_id = $1 ORDER BY seq",
      [runId],
    );
    return res.rows.map((r) => parseEvent(r.envelope));
  }

  async lastEventId(runId: RunId): Promise<EventId | undefined> {
    const res = await this.#db.query<{ event_id: EventId }>(
      "SELECT event_id FROM harness_events WHERE run_id = $1 ORDER BY seq DESC LIMIT 1",
      [runId],
    );
    return res.rows[0]?.event_id;
  }
}

export class PgArtifactRecordRepository implements ArtifactRecordRepository {
  readonly #db: Queryable;
  constructor(db: Queryable) {
    this.#db = db;
  }

  async insert(record: ArtifactRecord): Promise<void> {
    const r = parseContract(ArtifactRecordContract, record);
    await this.#db.query(
      `INSERT INTO harness_artifacts (artifact_id, run_id, content_sha256, media_type, size_bytes,
         storage_backend, storage_key, created_at, record)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        r.artifact_id,
        r.run_id,
        r.content_hash.digest,
        r.media_type,
        r.size_bytes,
        r.storage_ref.backend,
        r.storage_ref.key,
        r.created_at,
        JSON.stringify(r),
      ],
    );
  }

  async get(id: ArtifactId): Promise<ArtifactRecord | undefined> {
    const res = await this.#db.query<{ record: unknown }>(
      "SELECT record FROM harness_artifacts WHERE artifact_id = $1",
      [id],
    );
    const row = res.rows[0];
    return row === undefined ? undefined : parseContract(ArtifactRecordContract, row.record);
  }
}

/** Convenience bundle of the system-of-record repositories over one database. */
export function pgRepositories(db: Database | Queryable) {
  return {
    runs: new PgRunRepository(db),
    threads: new PgThreadRepository(db),
    events: new PgEventLog(db),
    artifacts: new PgArtifactRecordRepository(db),
  };
}

export function assertFound<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new HarnessError("INVALID_REFERENCE", `${what} not found`);
  return value;
}
