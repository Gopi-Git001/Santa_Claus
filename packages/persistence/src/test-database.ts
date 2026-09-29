import { randomBytes } from "node:crypto";
import pg from "pg";
import { Database } from "./database.ts";
import { migrate } from "./migrate.ts";

/**
 * Test database lifecycle (P00 spec §15): each test suite gets its own freshly
 * created, fully migrated database which is dropped afterwards. Tests never
 * share state with the development database.
 */
export interface TestDatabase {
  name: string;
  url: string;
  db: Database;
  drop(): Promise<void>;
}

export async function createTestDatabase(
  adminUrl: string,
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  const name = `harness_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${name}`);
  } finally {
    await admin.end();
  }
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const db = await Database.connect({ connectionString: url.toString(), applicationName: "harness-test" });
  if (options.migrate !== false) await migrate(db);
  let dropped = false;
  return {
    name,
    url: url.toString(),
    db,
    async drop() {
      if (dropped) return;
      dropped = true;
      await db.close().catch(() => {});
      const c = new pg.Client({ connectionString: adminUrl });
      await c.connect();
      try {
        await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      } finally {
        await c.end();
      }
    },
  };
}

/** The admin/development URL for tests; fails loudly instead of silently skipping. */
export function requireDatabaseUrl(env: Record<string, string | undefined> = process.env): string {
  const url = env["DATABASE_URL"];
  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL is not set. Real-PostgreSQL tests are mandatory in P00 and are never skipped: " +
        "run `node scripts/bootstrap.ts` (or `pnpm db:up`) first.",
    );
  }
  return url;
}
