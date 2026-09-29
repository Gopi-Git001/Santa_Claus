import {
  type PolicyDecision,
  PolicyDecisionContract,
  type ProposedAction,
  parseContract,
} from "@harness/contracts";

/**
 * Human-authority interfaces (P00: interfaces only; the policy engine and
 * approval workflow are P06). Authority lives here, in code — never in a prompt
 * (INV-004).
 */
export interface PolicyEvaluator {
  readonly policy_version: string;
  evaluate(action: ProposedAction): Promise<PolicyDecision>;
}

/** Outcome of a human review of an ASK_HUMAN decision. */
export interface HumanApproval {
  decision: "approve" | "deny" | "edit";
  responder: string;
  edited_arguments?: Record<string, unknown>;
}

/**
 * Unknown or malformed authority fails closed (INV-020): anything that is not a
 * valid PolicyDecision becomes DENY.
 */
export function failClosed(candidate: unknown): PolicyDecision {
  try {
    return parseContract(PolicyDecisionContract, candidate);
  } catch {
    return {
      schema_version: 1,
      decision: "DENY",
      reason_code: "UNKNOWN_AUTHORITY_FAIL_CLOSED",
      policy_version: "fail-closed",
      constraints: {},
    };
  }
}

/**
 * Combine a policy decision with a human response. A human denial always wins
 * over agent intent (INV-015); a policy DENY cannot be overridden by approval.
 */
export function resolveAuthority(
  decision: PolicyDecision,
  human: HumanApproval | undefined,
): "execute" | "deny" | "await_human" {
  if (decision.decision === "DENY") return "deny";
  if (decision.decision === "AUTO_ALLOW") return "execute";
  if (human === undefined) return "await_human";
  return human.decision === "deny" ? "deny" : "execute";
}
