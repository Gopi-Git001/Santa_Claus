import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Parse a KEY=value .env file (no interpolation, no quotes handling needed for our generated file). */
export function readEnvFile(path: string): Map<string, string> {
  if (!existsSync(path)) return new Map();
  return new Map(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .filter((l) => /^[A-Z_][A-Z0-9_]*=/.test(l))
      .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)] as const),
  );
}

/** docker compose argv for the dev stack, bound to the repo's .env and compose project. */
export function composeArgs(root: string): string[] {
  const env = readEnvFile(join(root, ".env"));
  const project = env.get("HARNESS_COMPOSE_PROJECT") ?? "harness-dev";
  return [
    "docker",
    "compose",
    "-p",
    project,
    "--env-file",
    join(root, ".env"),
    "-f",
    join(root, "infra", "dev", "docker-compose.yml"),
  ];
}
