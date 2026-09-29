import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const SMOKE_PROCESS_SCRIPT = join(import.meta.dirname, "smoke-process.ts");

export interface ChildResult extends Record<string, unknown> {
  pid: number;
  exit_code: number | null;
  signal: string | null;
  killed: boolean;
  duration_ms: number;
}

/**
 * Run one step of the smoke workflow in a fresh OS process. For `start`, the
 * child SIGKILLs itself after checkpointing, so `killed` must be true (a
 * non-zero status / signal) — a graceful exit would not prove crash recovery.
 */
export function runSmokeChild(env: NodeJS.ProcessEnv, ...args: string[]): ChildResult {
  const out = join(mkdtempSync(join(tmpdir(), "harness-child-")), "result.json");
  const started = performance.now();
  const r = spawnSync(process.execPath, [SMOKE_PROCESS_SCRIPT, ...args], {
    env: { ...env, HARNESS_E2E_OUT: out },
    encoding: "utf8",
    timeout: 60_000,
  });
  const killed = r.signal === "SIGKILL" || (r.status !== 0 && r.status !== null && args[0] === "start");
  const expectedOk = args[0] === "start" ? killed : r.status === 0;
  if (!expectedOk || !existsSync(out)) {
    throw new Error(`child ${args[0]} status=${r.status} signal=${r.signal}: ${r.stderr}`);
  }
  return {
    ...(JSON.parse(readFileSync(out, "utf8")) as { pid: number }),
    exit_code: r.status,
    signal: r.signal,
    killed,
    duration_ms: Math.round(performance.now() - started),
  };
}
