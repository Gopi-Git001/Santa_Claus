import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type HarnessConfig, loadConfig } from "@harness/config";

/** Validated config pointing at a per-test database and a temp artifact root. */
export function testConfig(databaseUrl: string, overrides: Record<string, string> = {}): HarnessConfig {
  return loadConfig({
    HARNESS_ENV: "test",
    DATABASE_URL: databaseUrl,
    HARNESS_ARTIFACT_ROOT: mkdtempSync(join(tmpdir(), "harness-art-")),
    HARNESS_LOG_LEVEL: "error",
    ...overrides,
  }).config;
}
