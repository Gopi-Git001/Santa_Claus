# ADR-0008: Human-authority policy model

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §3.11, §3.13, §9; MASTER_PROJECT_WORKFLOW.md §14

## Decision
- A model only *proposes* (`ToolCallProposal` → `ProposedAction`). Every consequential action is evaluated by a `PolicyEvaluator` into `PolicyDecision` = `AUTO_ALLOW | ASK_HUMAN | DENY` with reason code, policy version and constraints.
- `resolveAuthority`: policy `DENY` cannot be approved away; a human denial always wins over agent intent (INV-015).
- `failClosed`: any missing or malformed decision becomes `DENY` (INV-020).
- Authority lives in code and data, outside prompts (INV-004).
- P00 demonstrates the path in the smoke graph: `approval_gate` records a static demo decision (`policy.decision_recorded`), `interrupt_for_human` pauses durably, and resume requires an explicit validated human response.

The policy engine and approval workflow are P06; P00 implements interfaces plus the demonstration only.

## Enforcement
`tests/contract/extension-contracts.test.ts`, `packages/orchestration/test/smoke-graph.test.ts`, `tests/e2e/restart-resume.test.ts`.
