import pg from "pg";
import { classifyDbError, isDriverError } from "./errors.ts";

export interface DatabaseOptions {
  /** Connection URL. Callers holding a SecretString pass `secret.reveal()` here and nowhere else. */
  connectionString: string;
  poolMax?: number;
  connectTimeoutMs?: number;
  applicationName?: string;
}

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export interface HealthStatus {
  ok: true;
  server_version: string;
  latency_ms: number;
}

/**
 * PostgreSQL access for the harness system of record: pooled connections,
 * health check and a transaction helper. All driver errors are classified.
 */
export class Database implements Queryable {
  readonly #pool: pg.Pool;
  #closed = false;

  private constructor(pool: pg.Pool) {
    this.#pool = pool;
  }

  /** Create a pool and prove connectivity; fails with DB_UNAVAILABLE otherwise. */
  static async connect(options: DatabaseOptions): Promise<Database> {
    const pool = new pg.Pool({
      connectionString: options.connectionString,
      max: options.poolMax ?? 5,
      connectionTimeoutMillis: options.connectTimeoutMs ?? 5_000,
      application_name: options.applicationName ?? "harness",
    });
    // An idle client dying (e.g. server restart) must not crash the process.
    pool.on("error", () => {});
    const db = new Database(pool);
    try {
      await db.healthCheck();
    } catch (error) {
      await pool.end().catch(() => {});
      throw classifyDbError(error, "connect");
    }
    return db;
  }

  async healthCheck(): Promise<HealthStatus> {
    const started = performance.now();
    const r = await this.query<{ v: string }>("SELECT current_setting('server_version') AS v");
    return { ok: true, server_version: r.rows[0]?.v ?? "unknown", latency_ms: performance.now() - started };
  }

  async query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<pg.QueryResult<R>> {
    try {
      return await this.#pool.query<R>(sql, params);
    } catch (error) {
      throw classifyDbError(error, "query");
    }
  }

  /**
   * Run `fn` inside a transaction on a dedicated client. Commits on success,
   * rolls back on error. If the connection dies mid-transaction the error is
   * DB_DISCONNECTED and the client is discarded rather than returned to the pool.
   */
  async withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    let client: pg.PoolClient;
    try {
      client = await this.#pool.connect();
    } catch (error) {
      throw classifyDbError(error, "connect");
    }
    // A client-level error listener prevents an unhandled 'error' event crash on disconnect.
    const onError = () => {};
    client.on("error", onError);
    const tx: Queryable = {
      query: async (sql, params = []) => {
        try {
          return await client.query(sql, params);
        } catch (error) {
          throw classifyDbError(error, "query");
        }
      },
    };
    let broken = false;
    try {
      await tx.query("BEGIN");
      const result = await fn(tx);
      await tx.query("COMMIT");
      return result;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        broken = true;
      }
      // Caller exceptions (logic errors, HarnessErrors) propagate unchanged; only driver
      // errors are classified, so a bug is never mislabelled as an unknown DB outcome.
      throw isDriverError(error) ? classifyDbError(error, "query") : error;
    } finally {
      client.off("error", onError);
      client.release(broken ? true : undefined);
    }
  }

  async close(): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    await this.#pool.end();
  }
}
