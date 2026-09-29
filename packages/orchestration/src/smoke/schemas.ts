import { z } from "zod";

/** P00 smoke workflow: deliberately small and deterministic (P00 spec §14). */
export const SMOKE_GRAPH_NAME = "p00.smoke";
export const SMOKE_GRAPH_VERSION = "1";

export const SmokeNodes = [
  "initialize_run",
  "record_intent",
  "approval_gate",
  "interrupt_for_human",
  "finalize",
] as const;
export type SmokeNode = (typeof SmokeNodes)[number];

export const SmokeInputSchema = z.strictObject({
  goal: z.string().min(1).max(500),
  approval_required: z.boolean(),
  /** Failure injection for tests: the named node throws a controlled error. */
  fail_at_node: z.enum(SmokeNodes).nullable().default(null),
});
export type SmokeInput = z.input<typeof SmokeInputSchema>;

/** Explicit human response required to resume (P00.8). */
export const HumanResponseSchema = z.strictObject({
  decision: z.enum(["approve", "deny"]),
  responder: z.string().min(1).max(200),
  comment: z.string().max(2000).optional(),
});
export type HumanResponse = z.infer<typeof HumanResponseSchema>;
