/**
 * Child process used by the restart/resume proof. Each invocation is a fresh
 * OS process with no shared memory:
 *
 *   node tests/e2e/smoke-process.ts start           → run to the human interrupt, then exit abruptly
 *   node tests/e2e/smoke-process.ts inspect <json>   → report persisted state only
 *   node tests/e2e/smoke-process.ts resume <json>    → resume with an explicit approval
 *
 * Configuration comes from the environment (validated). Output: one JSON line.
 */
import { loadConfig } from "@harness/config";
import type { WorkflowIdentity } from "@harness/kernel";
import { createSmokeHarness } from "@harness/testing";

const [mode, arg] = process.argv.slice(2);
const { config } = loadConfig(process.env);
const harness = await createSmokeHarness({ config });

if (mode === "start") {
  const { identity, outcome } = await harness.startRun({ goal: "restart proof", approval_required: true });
  process.stdout.write(`${JSON.stringify({ pid: process.pid, identity, kind: outcome.kind })}\n`);
  // Terminate without closing pools or flushing anything: simulates a crash after the checkpoint.
  process.exit(0);
}

const identity = JSON.parse(arg ?? "{}") as WorkflowIdentity;
if (mode === "inspect") {
  const snap = await harness.workflow.inspect(identity.thread_id);
  process.stdout.write(`${JSON.stringify({ pid: process.pid, snapshot: snap ?? null })}\n`);
} else if (mode === "resume") {
  const outcome = await harness.resumeRun(identity, { decision: "approve", responder: "e2e-operator" });
  process.stdout.write(`${JSON.stringify({ pid: process.pid, kind: outcome.kind, state: outcome.state })}\n`);
} else {
  throw new Error(`unknown mode ${mode}`);
}
await harness.close();
