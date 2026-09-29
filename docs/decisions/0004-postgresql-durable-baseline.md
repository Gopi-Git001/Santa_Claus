# ADR-0004: PostgreSQL as the durable baseline

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §3.8, §15; MASTER_PROJECT_WORKFLOW.md §12

## Decision
PostgreSQL (18.6 in development, digest-pinned image) is the system of record. P00 provides: bootstrap (`infra/dev/docker-compose.yml`), checksummed forward-only migrations under an advisory lock (`packages/persistence/migrations`), health check, transaction helper, repository ports with PostgreSQL implementations, a per-test database lifecycle, and schema-version tracking (`harness_schema_migrations`).

**Store separation** (P00 spec §15) — four distinct stores, never one "memory" bucket:

| Store | Where | Owner |
|---|---|---|
| Graph/thread checkpoint state | PostgreSQL schema `harness_checkpoints` (LangGraph saver tables) | `@harness/orchestration` |
| Harness system-of-record | `public.harness_runs / harness_threads / harness_events / harness_artifacts` | `@harness/persistence` |
| Cross-thread application memory/store | **Not implemented in P00** (reserved; P12) | — |
| Artifacts/blobs | `ArtifactStore` backend (filesystem in P00) | `@harness/artifacts` |

In-memory checkpoints (`memoryCheckpointPersistence`) exist for unit tests only and are never evidence of persistence.

**Known limitation:** the checkpoint tables are created and versioned by the LangGraph saver's own
`setup()` (its `checkpoint_migrations` table), not by the harness migration runner. The harness
records that version in `langgraph-smoke.json` (`checkpoint_store_schema_version`) so drift is
visible, but "migrations are reproducible" as tested covers the harness schema only.

The event log is append-only in the database itself (migration `0002`: UPDATE/DELETE/TRUNCATE on
`harness_events` are rejected by triggers).

## Consequences
Every record is validated against its contract on write and read; corrupted rows surface as `PAYLOAD_INVALID`. Driver errors are classified (`DB_UNAVAILABLE`, `DB_DISCONNECTED`, `DUPLICATE_ID`, `INVALID_REFERENCE`) without leaking connection strings.

## Enforcement
`tests/integration/postgres.test.ts`, `tests/integration/langgraph-postgres.test.ts`, `tests/failure/p00-failures.test.ts` (F02, F03, F15).
