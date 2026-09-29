import { HarnessError } from "@harness/contracts";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import pg from "pg";

/**
 * Harness-owned persistence boundary for graph checkpoints (P00 spec §15).
 *
 * Callers only ever hold this opaque handle; the LangGraph saver inside is
 * reachable solely from this package. Graph/thread checkpoint state lives in
 * its own PostgreSQL schema, separate from the harness system-of-record
 * tables, the (future, P12) cross-thread memory store, and artifact blobs.
 */
export interface CheckpointPersistence {
  readonly kind: "postgres" | "memory";
  close(): Promise<void>;
}

const savers = new WeakMap<CheckpointPersistence, BaseCheckpointSaver>();

/** Internal to @harness/orchestration; deliberately not exported from the package index. */
export function saverOf(p: CheckpointPersistence): BaseCheckpointSaver {
  const saver = savers.get(p);
  if (saver === undefined)
    throw new HarnessError("INVALID_REFERENCE", "unknown checkpoint persistence handle");
  return saver;
}

/**
 * PostgresSaver (1.0.5) releases a client back to the pool with a plain
 * `client.release()` even after its connection died mid-transaction, so the
 * dead connection is reused and later checkpoint writes fail again. Every
 * client handed out by our pool therefore tracks its own connection loss and
 * is destroyed (release(true)) instead of recycled when that happened.
 */
function hardenReleasedClients(pool: pg.Pool): void {
  type Callback = (
    err: Error | undefined,
    client?: pg.PoolClient,
    done?: (release?: unknown) => void,
  ) => void;
  const connect = pool.connect.bind(pool) as (cb?: Callback) => Promise<pg.PoolClient> | undefined;
  (pool as unknown as { connect: (cb?: Callback) => unknown }).connect = (cb?: Callback) => {
    // Callback form is used internally by pool.query(), which already releases with the error.
    if (cb !== undefined) return connect(cb);
    return connectHardened();
  };
  const connectHardened = async () => {
    const client = (await connect()) as pg.PoolClient;
    let lost = false;
    const markLost = () => {
      lost = true;
    };
    client.on("error", markLost);
    client.on("end", markLost);
    const release = client.release.bind(client);
    client.release = (err?: Error | boolean) => {
      client.off("error", markLost);
      client.off("end", markLost);
      return release(err ?? (lost ? true : undefined));
    };
    return client;
  };
}

/** Durable checkpoints in PostgreSQL. Creates the checkpoint schema/tables if needed. */
export async function postgresCheckpointPersistence(options: {
  connectionString: string;
  schema: string;
  poolMax?: number;
}): Promise<CheckpointPersistence> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(options.schema)) {
    throw new HarnessError("CONFIG_INVALID", "invalid checkpoint schema name");
  }
  // The harness owns the checkpoint pool so it can attach an error listener: without one, an
  // idle checkpoint connection dropping (server restart, network loss) emits an unhandled
  // 'error' event and crashes the process. Query-time failures still reject normally.
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.poolMax ?? 5,
    application_name: "harness-checkpoints",
  });
  pool.on("error", () => {});
  hardenReleasedClients(pool);
  const saver = new PostgresSaver(pool, undefined, { schema: options.schema });
  try {
    await saver.setup();
  } catch (error) {
    await saver.end().catch(() => {});
    throw new HarnessError("DB_UNAVAILABLE", "checkpoint store unavailable", {
      details: { driver_code: (error as { code?: string }).code ?? null },
      cause: error,
    });
  }
  const handle: CheckpointPersistence = { kind: "postgres", close: () => saver.end() };
  savers.set(handle, saver);
  return handle;
}

/**
 * In-memory checkpoints. Tests only: never durable, never valid evidence for
 * persistence/resume (MASTER_PROJECT_WORKFLOW.md §12).
 */
export function memoryCheckpointPersistence(): CheckpointPersistence {
  const handle: CheckpointPersistence = { kind: "memory", close: async () => {} };
  savers.set(handle, new MemorySaver());
  return handle;
}
