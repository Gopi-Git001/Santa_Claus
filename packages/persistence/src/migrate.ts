import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { HarnessError } from "@harness/contracts";
import type { Database } from "./database.ts";

export interface Migration {
  version: number;
  name: string;
  sql: string;
  checksum: string;
}

export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");
// Arbitrary constant key so concurrent migrators serialise.
const MIGRATION_LOCK_KEY = 7_300_001;

/** Load `NNNN_name.sql` files in version order; checksums detect edits to applied migrations. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  const migrations = files.map((file) => {
    const sql = readFileSync(join(dir, file), "utf8").replaceAll("\r\n", "\n");
    return {
      version: Number(file.slice(0, 4)),
      name: file.slice(5, -4),
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    };
  });
  migrations.forEach((m, i) => {
    if (m.version !== i + 1)
      throw new HarnessError(
        "INVALID_REFERENCE",
        `migration versions must be contiguous from 1; found ${m.version}`,
      );
  });
  return migrations;
}

export interface MigrationReport {
  applied: number[];
  already_applied: number[];
  schema_version: number;
}

/**
 * Apply pending migrations, each in its own transaction, under an advisory lock.
 * Refuses to run if an already-applied migration was modified.
 */
export async function migrate(
  db: Database,
  migrations: Migration[] = loadMigrations(),
): Promise<MigrationReport> {
  return db.withTransaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [MIGRATION_LOCK_KEY]);
    await tx.query(`CREATE TABLE IF NOT EXISTS harness_schema_migrations (
      version    integer PRIMARY KEY,
      name       text NOT NULL,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const existing = await tx.query<{ version: number; checksum: string }>(
      "SELECT version, checksum FROM harness_schema_migrations ORDER BY version",
    );
    const appliedMap = new Map(existing.rows.map((r) => [r.version, r.checksum]));
    const report: MigrationReport = { applied: [], already_applied: [], schema_version: 0 };
    for (const m of migrations) {
      const prior = appliedMap.get(m.version);
      if (prior !== undefined) {
        if (prior !== m.checksum)
          throw new HarnessError(
            "INVALID_REFERENCE",
            `applied migration ${m.version}_${m.name} was modified`,
            {
              details: { version: m.version },
            },
          );
        report.already_applied.push(m.version);
        continue;
      }
      await tx.query(m.sql);
      await tx.query("INSERT INTO harness_schema_migrations(version, name, checksum) VALUES ($1, $2, $3)", [
        m.version,
        m.name,
        m.checksum,
      ]);
      report.applied.push(m.version);
    }
    for (const v of appliedMap.keys())
      if (!migrations.some((m) => m.version === v))
        throw new HarnessError(
          "INVALID_REFERENCE",
          `database has unknown migration ${v} (newer code required)`,
        );
    report.schema_version = migrations.at(-1)?.version ?? 0;
    return report;
  });
}

export async function schemaVersion(db: Database): Promise<number> {
  const r = await db.query<{ v: number | null }>("SELECT max(version) AS v FROM harness_schema_migrations");
  return r.rows[0]?.v ?? 0;
}
