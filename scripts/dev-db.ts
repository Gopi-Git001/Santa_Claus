/**
 * Manage the local PostgreSQL stack using the repo's .env.
 *   node scripts/dev-db.ts up       start and wait until healthy
 *   node scripts/dev-db.ts down     stop (data volume kept)
 *   node scripts/dev-db.ts destroy  stop and delete the data volume
 */
import { join } from "node:path";
import { composeArgs } from "./lib/dev-env.ts";
import { run } from "./lib/proc.ts";

const root = join(import.meta.dirname, "..");
const action = process.argv[2];
const sub: Record<string, string[]> = {
  up: ["up", "-d", "--wait", "postgres"],
  down: ["down"],
  destroy: ["down", "-v"],
};
const extra = action === undefined ? undefined : sub[action];
if (extra === undefined) {
  console.error("usage: node scripts/dev-db.ts up|down|destroy");
  process.exit(64);
}
const r = run([...composeArgs(root), ...extra], { cwd: root, inherit: true });
process.exit(r.exitCode);
