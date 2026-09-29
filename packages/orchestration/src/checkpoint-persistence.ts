import { HarnessError } from "@harness/contracts";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { MemorySaver } from "@langchain/langgraph";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

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

/** Durable checkpoints in PostgreSQL. Creates the checkpoint schema/tables if needed. */
export async function postgresCheckpointPersistence(options: {
  connectionString: string;
  schema: string;
}): Promise<CheckpointPersistence> {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(options.schema)) {
    throw new HarnessError("CONFIG_INVALID", "invalid checkpoint schema name");
  }
  const saver = PostgresSaver.fromConnString(options.connectionString, { schema: options.schema });
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
