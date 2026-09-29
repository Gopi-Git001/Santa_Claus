/**
 * Local bootstrap (P00 spec §6 "local bootstrap command").
 *
 *   node scripts/bootstrap.ts [--no-db] [--no-python]
 *
 * 1. check the Node version against .nvmrc
 * 2. install JS dependencies from the lockfile (frozen)
 * 3. create .env from .env.example with freshly generated secrets (if absent)
 * 4. start PostgreSQL (docker compose) and wait until healthy
 * 5. apply database migrations
 * 6. sync the Python environment from its lockfile (frozen)
 *
 * Uses only Node built-ins so it can run before dependencies are installed.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PNPM, run } from "./lib/proc.ts";

const root = join(import.meta.dirname, "..");
const args = new Set(process.argv.slice(2));

function step(name: string, argv: string[], env?: NodeJS.ProcessEnv): void {
  console.log(`\n==> ${name}: ${argv.join(" ")}`);
  const r = run(argv, { cwd: root, inherit: true, ...(env ? { env } : {}) });
  if (r.exitCode !== 0) {
    console.error(`bootstrap failed at "${name}" (exit ${r.exitCode})`);
    process.exit(r.exitCode);
  }
}

// 1. Node version
const wanted = readFileSync(join(root, ".nvmrc"), "utf8").trim();
if (process.versions.node !== wanted) {
  console.error(`Node ${wanted} required (from .nvmrc), found ${process.versions.node}`);
  process.exit(1);
}
console.log(`node ${process.versions.node} OK`);

// 2. JS dependencies
step("install", [...PNPM, "install", "--frozen-lockfile"], {
  ...process.env,
  COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
});

// 3. .env
const envPath = join(root, ".env");
if (existsSync(envPath)) {
  console.log("\n==> .env exists; leaving it unchanged");
} else {
  const template = readFileSync(join(root, ".env.example"), "utf8");
  const values = new Map(
    template
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as const),
  );
  const password = randomBytes(24).toString("base64url");
  const url = `postgres://${values.get("HARNESS_DB_USER")}:${password}@127.0.0.1:${values.get("HARNESS_DB_PORT")}/${values.get("HARNESS_DB_NAME")}`;
  const rendered = template
    .replace(/^HARNESS_DB_PASSWORD=__GENERATED__$/m, `HARNESS_DB_PASSWORD=${password}`)
    .replace(/^DATABASE_URL=__GENERATED__$/m, `DATABASE_URL=${url}`);
  if (/^[A-Z_]+=__GENERATED__$/m.test(rendered))
    throw new Error(".env.example has an unhandled __GENERATED__ value");
  writeFileSync(envPath, rendered, { mode: 0o600 });
  console.log("\n==> wrote .env with generated credentials (values not printed)");
}

// 4 + 5. database
if (!args.has("--no-db")) {
  step("postgres", [
    "docker",
    "compose",
    "--env-file",
    ".env",
    "-f",
    "infra/dev/docker-compose.yml",
    "up",
    "-d",
    "--wait",
    "postgres",
  ]);
  step("migrate", ["node", "--env-file=.env", "scripts/db-migrate.ts"]);
}

// 6. python
if (!args.has("--no-python")) {
  step("python", ["uv", "sync", "--frozen", "--project", "services/python"]);
}

console.log("\nbootstrap complete");
