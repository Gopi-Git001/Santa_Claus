import { inspect } from "node:util";
import { HarnessError } from "@harness/contracts";
import { describe, expect, it } from "vitest";
import { ENV_SCHEMA, loadConfig, SecretString } from "../src/index.ts";

const pw = ["unit", "only", "pw"].join("-");
const valid = {
  HARNESS_ENV: "test",
  DATABASE_URL: `postgres://harness:${pw}@127.0.0.1:55432/harness_dev`,
  HARNESS_ARTIFACT_ROOT: ".data/artifacts",
};

function configError(env: Record<string, string | undefined>): HarnessError {
  try {
    loadConfig(env);
  } catch (e) {
    if (e instanceof HarnessError) return e;
    throw e;
  }
  throw new Error("expected CONFIG_INVALID");
}

describe("loadConfig", () => {
  it("parses a valid environment and applies defaults", () => {
    const { config, source } = loadConfig(valid);
    expect(config.config_schema_version).toBe(1);
    expect(config.database.pool_max).toBe(5);
    expect(config.langgraph.checkpoint_schema).toBe("harness_checkpoints");
    expect(config.feature_flags.interrupt_demo).toBe(true);
    expect(config.models.gateway).toBe("disabled");
    expect(source.keys_present.sort()).toEqual(["DATABASE_URL", "HARNESS_ARTIFACT_ROOT", "HARNESS_ENV"]);
  });

  it("fails clearly when required configuration is missing", () => {
    const err = configError({ HARNESS_ENV: "test" });
    expect(err.code).toBe("CONFIG_INVALID");
    expect(err.message).toContain("DATABASE_URL (missing required variable)");
    expect(err.message).toContain("HARNESS_ARTIFACT_ROOT (missing required variable)");
  });

  it.each([
    ["HARNESS_ENV", "production-ish"],
    ["DATABASE_URL", "mysql://nope"],
    ["HARNESS_DB_POOL_MAX", "0"],
    ["HARNESS_LOG_LEVEL", "verbose"],
    ["HARNESS_CHECKPOINT_SCHEMA", "Bad-Name"],
    ["HARNESS_FF_INTERRUPT_DEMO", "yes"],
    ["HARNESS_MAX_GRAPH_STEPS", "1.5"],
  ])("rejects invalid %s", (key, value) => {
    const err = configError({ ...valid, [key]: value });
    expect(err.code).toBe("CONFIG_INVALID");
    expect(err.message).toContain(key);
  });

  it("never includes secret values in errors or serialised config", () => {
    const badUrl = `postgres://harness:${pw}@ bad host/x`;
    const err = configError({ ...valid, DATABASE_URL: badUrl });
    expect(JSON.stringify({ m: err.message, d: err.details })).not.toContain(pw);
    const { config } = loadConfig(valid);
    expect(JSON.stringify(config)).not.toContain(pw);
    expect(inspect(config, { depth: 5 })).not.toContain(pw);
    expect(`${config.database.url}`).toBe("[REDACTED]");
    expect(config.database.url.reveal()).toContain(pw);
  });

  it("documents every variable, marking DATABASE_URL secret", () => {
    expect(ENV_SCHEMA.DATABASE_URL.secret).toBe(true);
    expect(Object.values(ENV_SCHEMA).filter((v) => v.secret)).toHaveLength(1);
  });
});

describe("SecretString", () => {
  it("redacts under every conversion", () => {
    const s = new SecretString("X", pw);
    expect(String(s)).toBe("[REDACTED]");
    expect(JSON.stringify({ s })).toBe('{"s":"[REDACTED]"}');
    expect(inspect(s)).not.toContain(pw);
  });
});
