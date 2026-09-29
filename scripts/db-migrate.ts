/** Apply database migrations using validated configuration. */
import { loadConfig } from "@harness/config";
import { Database, migrate } from "@harness/persistence";

const { config } = loadConfig(process.env);
const db = await Database.connect({
  connectionString: config.database.url.reveal(),
  applicationName: "harness-migrate",
});
try {
  const report = await migrate(db);
  console.log(JSON.stringify({ migrations: report }));
} finally {
  await db.close();
}
