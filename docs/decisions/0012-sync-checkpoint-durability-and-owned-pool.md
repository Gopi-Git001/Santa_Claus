# ADR-0012: Synchronous checkpoint durability and a harness-owned checkpoint pool

- Status: Accepted (P00, 2026-09-28)
- Supersedes: nothing (refines ADR-0002 / ADR-0004)

## Context
The F03 failure scenario was strengthened to kill the database connection *during* a running
workflow (a one-shot trigger terminates the inserting backend). This exposed two defects in the
LangGraph stack as configured:

1. **Async durability.** LangGraph.js 1.4 defaults to `durability: "async"`: checkpoint writes are
   fired in the background and their rejections are only collected when the run ends. A checkpoint
   write that fails mid-run is an *unhandled promise rejection* in between — under Node's default
   `--unhandled-rejections=throw` this can crash the process. Observed as 5–6 unhandled rejections
   in F03.
2. **Dead-client recycling.** `@langchain/langgraph-checkpoint-postgres` 1.0.5 releases a client
   back to its pool with a plain `client.release()` even after the connection died inside the
   transaction, so later checkpoint writes reuse a dead connection. The saver's own pool also had no
   `error` listener, so an idle checkpoint connection dropping would emit an unhandled `error` event.

## Decision
- The smoke workflow runs with `durability: "sync"`: each step's checkpoint is durably written
  before the next step starts. This matches the harness principle that durable truth precedes
  progress, and it guarantees an interrupt is persisted before it is reported.
- `@harness/orchestration` creates and owns the checkpoint `pg.Pool` (with an `error` listener),
  passes it to `PostgresSaver`, and destroys any client whose connection ended or errored instead
  of returning it to the pool. `pg` becomes an allow-listed dependency of the orchestration package
  only (ADR-0002 boundary rules updated).

## Consequences
- Slightly higher per-step latency (checkpoint write is on the critical path); recorded in
  `performance-baseline.json`.
- A lost checkpoint connection surfaces as a classified `DB_DISCONNECTED` and the run is recorded
  `UNKNOWN` (INV-012), with no unhandled errors (F03 asserts both, and Vitest fails on unhandled errors).
- The dead-client guard wraps `pool.connect()` on a pool we own; it must be re-checked when the
  saver library is upgraded.
