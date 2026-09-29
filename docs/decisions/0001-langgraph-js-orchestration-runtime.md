# ADR-0001: LangGraph.js as the orchestration runtime

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §3.3, §4; MASTER_PROJECT_WORKFLOW.md §7

## Context
The harness needs long-running, stateful workflows with typed state, deterministic and agentic nodes, checkpoints, interrupts, resumption, streaming and subgraphs. A fixed high-level agent loop cannot express supervisor/worker hierarchies, approval subgraphs or recovery subgraphs.

## Decision
Use the open-source LangGraph.js library (`@langchain/langgraph` 1.4.x, pinned by lockfile) with `@langchain/langgraph-checkpoint-postgres` for durable checkpoints. Hosted LangChain/LangSmith services are not used and are not required for correctness.

## Alternatives considered
- Hand-written state machine: full control, but re-implements checkpointing, interrupts and streaming.
- Temporal-style durable execution engine: strong durability, but adds a service and a second workflow model for P00.
- Python LangGraph: conflicts with the TypeScript control plane (ADR-0003).

## Consequences
- P00 proves only: typed state, deterministic nodes, resumable execution, thread identity, interrupt/resume, streaming observation. Subgraph compatibility is preserved by the port (ADR-0002), not yet exercised.
- LangGraph upgrades are lockfile changes validated by the P00 integration and e2e suites.

## Enforcement
`tests/integration/langgraph-postgres.test.ts`, `tests/e2e/restart-resume.test.ts`.
