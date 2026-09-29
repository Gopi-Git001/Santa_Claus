# ADR-0002: LangGraph wrapped behind harness interfaces

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §4, §28; MASTER_PROJECT_WORKFLOW.md §7

## Context
LangGraph must not own authorization, sandboxing, secrets, model coupling, artifact/audit/verification truth, UI or memory semantics, and must be upgradeable or replaceable.

## Decision
- `@harness/kernel` defines the framework-neutral `WorkflowRuntime` port (`start`, `resume`, `inspect`) plus `ThreadRegistry`.
- `@harness/orchestration` is the **only** package that may import `@langchain/*`. It implements the port (`LangGraphSmokeWorkflow`) and exposes checkpoint persistence only as an opaque `CheckpointPersistence` handle; the underlying saver is reachable solely inside the package.
- Resume authorization is checked against the harness-owned durable thread→run binding (`harness_threads`), not against graph state alone.

## Alternatives considered
Using LangGraph types directly in kernel/business code — rejected: it makes LangGraph the architectural boundary.

## Consequences
Replacing LangGraph means reimplementing one package against the same port; contracts, persistence and events are unaffected.

## Enforcement
`scripts/check-boundaries.ts` (allow-list per package; fails on `@langchain/*` outside orchestration), `tests/contract/boundaries.test.ts` (including planted violations), `tests/contract/no-authority.test.ts`.
