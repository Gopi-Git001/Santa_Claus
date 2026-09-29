import { appendFileSync } from "node:fs";

/**
 * Record the error classification a failure test actually observed. When the
 * acceptance runner sets HARNESS_FAILURE_OBSERVATIONS, each observation is
 * appended as a JSON line so evidence carries expected vs. observed codes.
 */
export function observe(id: string, observed: string): string {
  const out = process.env["HARNESS_FAILURE_OBSERVATIONS"];
  if (out) appendFileSync(out, `${JSON.stringify({ id, observed })}\n`);
  return observed;
}

/**
 * P00 failure scenarios (P00 spec §33) with their expected error
 * classification. Test titles start with the scenario ID so the acceptance
 * runner can join JUnit/JSON results to this table mechanically.
 */
export const FAILURE_SCENARIOS = [
  { id: "F01", scenario: "invalid configuration", expected: "CONFIG_INVALID" },
  { id: "F02", scenario: "PostgreSQL unavailable at startup", expected: "DB_UNAVAILABLE" },
  { id: "F03", scenario: "database disconnect during test workflow", expected: "DB_DISCONNECTED" },
  { id: "F04", scenario: "invalid/corrupted event payload", expected: "PAYLOAD_INVALID" },
  { id: "F05", scenario: "duplicate capability ID", expected: "DUPLICATE_ID" },
  { id: "F06", scenario: "invalid capability dependency", expected: "INVALID_DEPENDENCY" },
  { id: "F07", scenario: "invalid phase reference", expected: "INVALID_PHASE_REF" },
  { id: "F08", scenario: "wrong thread ID on resume", expected: "THREAD_MISMATCH" },
  { id: "F09", scenario: "interrupted graph not resumed", expected: "INTERRUPTED (state retained)" },
  { id: "F10", scenario: "artifact hash mismatch", expected: "ARTIFACT_HASH_MISMATCH" },
  { id: "F11", scenario: "artifact storage unavailable", expected: "STORAGE_UNAVAILABLE" },
  { id: "F12", scenario: "secret-like value passed to logger", expected: "REDACTED" },
  { id: "F13", scenario: "unsupported schema version", expected: "UNSUPPORTED_SCHEMA_VERSION" },
  { id: "F14", scenario: "forced node failure followed by controlled graph error", expected: "NODE_FAILED" },
  {
    id: "F15",
    scenario: "process restart followed by persisted-state verification",
    expected: "INTERRUPTED (persisted)",
  },
] as const;
