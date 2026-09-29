# ADR-0007: Dynamic agent instantiation, not a predefined pool

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §3.12, §29; MASTER_PROJECT_WORKFLOW.md §8–9

## Decision
Agents are runtime instances created from typed `AgentSpec` contracts (role templates), never a fixed set of prebuilt bots. P00 defines the contracts only:
- `AgentSpec` with mandatory finite `budget` (INV-005), parent lineage within one run (INV-006, `lineageViolations`), and default-deny scopes (INV-017).
- `ScalingDecisionInput` / `ScalingDecision` and the `ScalingPolicy` port in `@harness/kernel`, plus `scalingViolations` which rejects any decision exceeding declared limits.

No requirement or code path assumes a fixed number of agents; every limit is data. The planner, agent factory, scheduler and distributed leases are P10/P11/P16.

## Enforcement
`packages/contracts/test/records.test.ts`, `tests/contract/extension-contracts.test.ts` (scaling).
