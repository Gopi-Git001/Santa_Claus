import { HarnessError } from "@harness/contracts";
import { z } from "zod";
import { SecretString } from "./secret.ts";

/**
 * Typed, versioned harness configuration validated at startup (P00 spec §21).
 * Configuration comes only from the process environment (optionally populated
 * from a git-ignored `.env` file via `node --env-file-if-exists`).
 */
export const CONFIG_SCHEMA_VERSION = 1;

const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const intFrom = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

/** Environment variable → config path mapping; also the documented env schema. */
export const ENV_SCHEMA = {
  HARNESS_ENV: { required: true, secret: false, description: "development | test | ci" },
  DATABASE_URL: { required: true, secret: true, description: "postgres:// connection URL" },
  HARNESS_DB_POOL_MAX: { required: false, secret: false, description: "max pool connections (default 5)" },
  HARNESS_DB_CONNECT_TIMEOUT_MS: {
    required: false,
    secret: false,
    description: "connect timeout (default 5000)",
  },
  HARNESS_ARTIFACT_ROOT: { required: true, secret: false, description: "filesystem artifact store root" },
  HARNESS_LOG_LEVEL: {
    required: false,
    secret: false,
    description: "debug | info | warn | error (default info)",
  },
  HARNESS_CHECKPOINT_SCHEMA: {
    required: false,
    secret: false,
    description: "PostgreSQL schema for graph checkpoints (default harness_checkpoints)",
  },
  HARNESS_FF_INTERRUPT_DEMO: { required: false, secret: false, description: "true | false (default true)" },
  HARNESS_MAX_GRAPH_STEPS: {
    required: false,
    secret: false,
    description: "graph recursion limit (default 25)",
  },
} as const;

export type EnvKey = keyof typeof ENV_SCHEMA;

const EnvSchema = z.object({
  HARNESS_ENV: z.enum(["development", "test", "ci"]),
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\/[^\s]+$/, "must be a postgres:// URL")
    .refine((v) => URL.canParse(v), "must be a parseable URL"),
  HARNESS_DB_POOL_MAX: intFrom(1, 50).default(5),
  HARNESS_DB_CONNECT_TIMEOUT_MS: intFrom(100, 60_000).default(5_000),
  HARNESS_ARTIFACT_ROOT: z.string().min(1),
  HARNESS_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  HARNESS_CHECKPOINT_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/, "must be a lowercase SQL identifier")
    .default("harness_checkpoints"),
  HARNESS_FF_INTERRUPT_DEMO: bool.default(true),
  HARNESS_MAX_GRAPH_STEPS: intFrom(1, 1_000).default(25),
});

export interface HarnessConfig {
  readonly config_schema_version: typeof CONFIG_SCHEMA_VERSION;
  readonly environment: "development" | "test" | "ci";
  readonly database: { url: SecretString; pool_max: number; connect_timeout_ms: number };
  readonly artifacts: { backend: "filesystem"; root: string };
  readonly logging: { level: "debug" | "info" | "warn" | "error" };
  readonly langgraph: { checkpoint_schema: string; max_steps: number };
  readonly feature_flags: { interrupt_demo: boolean };
  /** Reserved for P03 (model gateway) and P05 (capability system); disabled in P00. */
  readonly models: { gateway: "disabled" };
  readonly capabilities: { registry: "static-p00" };
}

export interface ConfigSource {
  kind: "environment";
  keys_present: EnvKey[];
  secret_keys: EnvKey[];
}

/**
 * Validate configuration. Throws CONFIG_INVALID naming the offending variables;
 * error details never contain values.
 */
export function loadConfig(env: Record<string, string | undefined>): {
  config: HarnessConfig;
  source: ConfigSource;
} {
  const keys = Object.keys(ENV_SCHEMA) as EnvKey[];
  const picked = Object.fromEntries(
    keys.filter((k) => env[k] !== undefined && env[k] !== "").map((k) => [k, env[k]]),
  );
  const parsed = EnvSchema.safeParse(picked);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => ({
      variable: String(i.path[0] ?? "?"),
      problem: i.code === "invalid_type" && i.input === undefined ? "missing required variable" : i.message,
    }));
    throw new HarnessError(
      "CONFIG_INVALID",
      `invalid configuration: ${problems.map((p) => `${p.variable} (${p.problem})`).join("; ")}`,
      { details: { problems } },
    );
  }
  const e = parsed.data;
  return {
    config: Object.freeze({
      config_schema_version: CONFIG_SCHEMA_VERSION,
      environment: e.HARNESS_ENV,
      database: {
        url: new SecretString("DATABASE_URL", e.DATABASE_URL),
        pool_max: e.HARNESS_DB_POOL_MAX,
        connect_timeout_ms: e.HARNESS_DB_CONNECT_TIMEOUT_MS,
      },
      artifacts: { backend: "filesystem", root: e.HARNESS_ARTIFACT_ROOT },
      logging: { level: e.HARNESS_LOG_LEVEL },
      langgraph: { checkpoint_schema: e.HARNESS_CHECKPOINT_SCHEMA, max_steps: e.HARNESS_MAX_GRAPH_STEPS },
      feature_flags: { interrupt_demo: e.HARNESS_FF_INTERRUPT_DEMO },
      models: { gateway: "disabled" },
      capabilities: { registry: "static-p00" },
    } as const),
    source: {
      kind: "environment",
      keys_present: keys.filter((k) => k in picked),
      secret_keys: keys.filter((k) => ENV_SCHEMA[k].secret),
    },
  };
}
