import { BudgetSchema, TaskIdSchema } from "@harness/contracts";
import { z } from "zod";

/**
 * Dynamic agent scaling control contract (P00 spec §29). Contract only: the
 * planner, agent factory and scheduler that act on it are P10/P11/P16.
 * Nothing here assumes a fixed number of agents — every limit is data.
 */

const Limits = z.strictObject({
  max_concurrent_agents: z.int().nonnegative(),
  max_total_agents: z.int().nonnegative(),
  max_hierarchy_depth: z.int().nonnegative(),
});

export const ScalingDecisionInputSchema = z.strictObject({
  schema_version: z.literal(1),
  runnable_tasks: z.array(TaskIdSchema),
  dependency_state: z.record(z.string(), z.enum(["satisfied", "pending", "failed"])),
  global_limits: Limits,
  run_limits: Limits,
  model_limits: z.record(z.string(), z.strictObject({ max_concurrent_requests: z.int().nonnegative() })),
  execution_limits: z.strictObject({
    max_cpu_millis: z.int().nonnegative(),
    max_memory_mb: z.int().nonnegative(),
  }),
  budget_remaining: BudgetSchema,
  risk_constraints: z.array(z.string().min(1)),
  workspace_conflicts: z.array(z.strictObject({ task_id: TaskIdSchema, conflicts_with: TaskIdSchema })),
  priority: z.int().min(0).max(100),
});

export const ScalingDecisionSchema = z.strictObject({
  schema_version: z.literal(1),
  desired_new_agents: z.int().nonnegative(),
  role_templates: z.array(z.string().min(1)),
  task_assignments: z.array(z.strictObject({ task_id: TaskIdSchema, role_template: z.string().min(1) })),
  deferred: z.array(z.strictObject({ task_id: TaskIdSchema, reason: z.string().min(1) })),
  rejected: z.array(z.strictObject({ task_id: TaskIdSchema, reason: z.string().min(1) })),
});

export type ScalingDecisionInput = z.infer<typeof ScalingDecisionInputSchema>;
export type ScalingDecision = z.infer<typeof ScalingDecisionSchema>;

/** Future scheduler port (P10/P11). Implementations must never exceed any limit in the input. */
export interface ScalingPolicy {
  decide(input: ScalingDecisionInput): Promise<ScalingDecision>;
}

/**
 * Checks a decision against the input's hard limits. Returns violations; used
 * to reject any future scheduler output that exceeds declared bounds (INV-005).
 */
export function scalingViolations(input: ScalingDecisionInput, decision: ScalingDecision): string[] {
  const v: string[] = [];
  const cap = Math.min(input.global_limits.max_concurrent_agents, input.run_limits.max_concurrent_agents);
  if (decision.desired_new_agents > cap)
    v.push(`desired_new_agents ${decision.desired_new_agents} exceeds limit ${cap}`);
  const runnable = new Set(input.runnable_tasks);
  for (const a of decision.task_assignments)
    if (!runnable.has(a.task_id)) v.push(`task ${a.task_id} is not runnable`);
  if (decision.task_assignments.length > decision.desired_new_agents && decision.desired_new_agents === 0)
    v.push("tasks assigned while no agents requested");
  return v;
}
