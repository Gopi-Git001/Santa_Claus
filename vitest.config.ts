import { existsSync } from "node:fs";
import { defineConfig } from "vitest/config";

// Local runs read the git-ignored .env written by scripts/bootstrap.ts; CI sets
// the environment directly. Existing variables are never overridden.
if (existsSync(".env")) process.loadEnvFile(".env");

// Test layers are separate projects so each layer can be run, reported and
// gated independently (P00 spec section 24).
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", include: ["packages/*/test/**/*.test.ts"] } },
      { test: { name: "contract", include: ["tests/contract/**/*.test.ts"] } },
      {
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "failure",
          include: ["tests/failure/**/*.test.ts"],
          testTimeout: 60_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: "e2e",
          include: ["tests/e2e/**/*.test.ts"],
          testTimeout: 120_000,
          hookTimeout: 120_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
