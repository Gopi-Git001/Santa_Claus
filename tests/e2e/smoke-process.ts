/**
 * Child process used by the restart/resume proofs. Each invocation is a fresh
 * OS process with no shared memory:
 *
 *   node tests/e2e/smoke-process.ts start           → run to the human interrupt, then SIGKILL itself
 *   node tests/e2e/smoke-process.ts inspect <json>   → report persisted state only
 *   node tests/e2e/smoke-process.ts resume <json>    → resume with an explicit approval
 *
 * Configuration comes from the environment (validated). The result is written
 * as JSON to the file named by HARNESS_E2E_OUT (written synchronously, so it
 * survives the kill).
 */
import { writeFileSync } from "node:fs";
import { loadConfig } from "@harness/config";
import type { WorkflowIdentity } from "@harness/kernel";
import { createSmokeHarness } from "@harness/testing";

const [mode, arg] = process.argv.slice(2);
const out = process.env["HARNESS_E2E_OUT"];
if (!out) throw new Error("HARNESS_E2E_OUT is required");
const emit = (result: Record<string, unknown>) =>
  writeFileSync(out, `${JSON.stringify({ pid: process.pid, ...result })}\n`);

const { config, source } = loadConfig(process.env);
const harness = await createSmokeHarness({ config, configSource: source });

if (mode === "start") {
  const { identity, outcome } = await harness.startRun({ goal: "restart proof", approval_required: true });
  emit({ identity, kind: outcome.kind });
  // Abrupt death right after the checkpoint: no pool shutdown, no cleanup, no graceful exit.
  process.kill(process.pid, "SIGKILL");
}

const identity = JSON.parse(arg ?? "{}") as WorkflowIdentity;
if (mode === "inspect") {
  const snap = await harness.workflow.inspect(identity.thread_id);
  emit({ snapshot: snap ?? null });
} else if (mode === "resume") {
  const outcome = await harness.resumeRun(identity, { decision: "approve", responder: "e2e-operator" });
  emit({ kind: outcome.kind, state: outcome.state });
} else {
  throw new Error(`unknown mode ${mode}`);
}
await harness.close();
