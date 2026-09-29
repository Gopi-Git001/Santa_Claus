# ADR-0009: Event envelope and versioning strategy

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §9, §17, §27

## Decision
- Every event is an `EventEnvelope` with an opaque `event_id`, `event_type` from a closed catalog, `schema_version` (the version of that event type), timestamp, `run_id`, optional thread/agent/task IDs, W3C-format `trace_id`, `causation_id` (the event that directly caused it) and `correlation_id` (the logical flow; the run ID in P00).
- Events are validated at creation and again at read; unknown types or payloads are `PAYLOAD_INVALID`, unknown versions `UNSUPPORTED_SCHEMA_VERSION`.
- All records are `strict` (unknown fields rejected) and carry `schema_version`.
- Portable JSON Schema snapshots are committed per `(contract, version)` in `specs/schemas/`. A snapshot never changes: a shape change without a version bump fails CI (`scripts/export-schemas.ts --check`); the exporter refuses to overwrite frozen snapshots.
- P00 event families: `run.created`, `run.status_changed`, `graph.started`, `graph.node_started`, `graph.node_completed`, `graph.interrupted`, `graph.resumed`, `graph.failed`, `graph.completed`, `artifact.created`, `policy.decision_recorded`, `test.evidence_recorded`.

## Consequences
Causal chains survive process restarts: the emitter resumes the chain from the run's last durable event. The full event bus is P02.

## Enforcement
`packages/events/test/envelope.test.ts`, `tests/contract/schemas.test.ts`, `tests/integration/langgraph-postgres.test.ts` (unbroken causation chain), `tests/e2e/restart-resume.test.ts`.
