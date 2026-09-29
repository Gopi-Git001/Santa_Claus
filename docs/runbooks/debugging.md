# Debugging guide

Goal (P00 spec §26): answer *"Which node failed, with which run/thread, after
which event, and was state persisted?"*

## 1. Read the structured log line

Every failure logs one JSON line (secrets redacted), e.g.:

```json
{"level":"error","msg":"smoke run failed","component":"smoke-harness","run_id":"run_…","thread_id":"thr_…",
 "error":{"name":"HarnessError","message":"smoke graph failed in node finalize","code":"NODE_FAILED",
 "cause":{"message":"forced failure in node finalize","code":"NODE_FAILED"}}}
```

Errors are `HarnessError`s with a stable `code` (`packages/contracts/src/errors.ts`).

## 2. Reconstruct the causal chain

```sql
SELECT seq, event_type, envelope->'payload'->>'node' AS node, event_id, causation_id, occurred_at
FROM harness_events WHERE run_id = 'run_…' ORDER BY seq;
```

Each event's `causation_id` is the previous event, across process restarts. The
`graph.failed` event names the node and error code; the event before it is the
failing node's `graph.node_started`.

## 3. Was state persisted?

```sql
SELECT status, updated_at FROM harness_runs WHERE id = 'run_…';          -- CREATED/RUNNING/INTERRUPTED/COMPLETED/FAILED/UNKNOWN
SELECT run_id, graph_name FROM harness_threads WHERE thread_id = 'thr_…'; -- thread→run binding
SELECT count(*) FROM harness_checkpoints.checkpoints WHERE thread_id = 'thr_…';
```

From code: `workflow.inspect(threadId)` returns the checkpointed state, the next
nodes, and any pending interrupt.

Connect with the client inside the container (local socket; no password prompt):
`docker exec -it harness-dev-postgres-1 psql -U harness -d harness_dev`.

## Error classification quick reference

| Code | Meaning |
|---|---|
| `CONFIG_INVALID` | missing/invalid environment variable (named in the message) |
| `DB_UNAVAILABLE` / `DB_DISCONNECTED` | cannot connect / connection lost mid-operation |
| `PAYLOAD_INVALID` / `UNSUPPORTED_SCHEMA_VERSION` | contract validation failures |
| `THREAD_NOT_FOUND` / `THREAD_MISMATCH` / `GRAPH_NOT_INTERRUPTED` | rejected resume |
| `NODE_FAILED` | a graph node threw; `details.node` names it |
| `ARTIFACT_HASH_MISMATCH` / `STORAGE_UNAVAILABLE` | artifact integrity / backend failure |
| `UNKNOWN_OUTCOME` | outcome cannot be determined — never silently treated as failure |
