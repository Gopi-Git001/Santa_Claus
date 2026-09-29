-- P00 harness system-of-record baseline.
-- Graph checkpoints are NOT stored here: they live in the separate checkpoint
-- schema managed by the orchestration adapter (store separation, P00 spec §15).

CREATE TABLE harness_runs (
  id              text PRIMARY KEY,
  schema_version  integer     NOT NULL,
  root_goal       text        NOT NULL,
  status          text        NOT NULL,
  created_at      timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  policy_profile  text        NOT NULL,
  budget_profile  text        NOT NULL,
  root_thread_id  text        NOT NULL UNIQUE,
  metadata        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT harness_runs_status_chk CHECK (status IN
    ('CREATED','RUNNING','INTERRUPTED','COMPLETED','FAILED','CANCELLED','UNKNOWN'))
);

-- Graph thread identity bound to exactly one run. Resume must match this binding.
CREATE TABLE harness_threads (
  thread_id      text PRIMARY KEY,
  run_id         text        NOT NULL REFERENCES harness_runs(id),
  graph_name     text        NOT NULL,
  graph_version  text        NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX harness_threads_run_idx ON harness_threads(run_id);

-- Append-only event log. seq gives a total order for replay.
CREATE TABLE harness_events (
  seq             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id        text        NOT NULL UNIQUE,
  run_id          text        NOT NULL REFERENCES harness_runs(id),
  thread_id       text,
  event_type      text        NOT NULL,
  schema_version  integer     NOT NULL,
  occurred_at     timestamptz NOT NULL,
  trace_id        text        NOT NULL,
  causation_id    text,
  correlation_id  text,
  envelope        jsonb       NOT NULL
);
CREATE INDEX harness_events_run_seq_idx ON harness_events(run_id, seq);

-- Artifact metadata (the blob itself lives in the ArtifactStore backend).
CREATE TABLE harness_artifacts (
  artifact_id      text PRIMARY KEY,
  run_id           text        NOT NULL REFERENCES harness_runs(id),
  content_sha256   text        NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  media_type       text        NOT NULL,
  size_bytes       bigint      NOT NULL CHECK (size_bytes >= 0),
  storage_backend  text        NOT NULL,
  storage_key      text        NOT NULL,
  created_at       timestamptz NOT NULL,
  record           jsonb       NOT NULL
);
CREATE INDEX harness_artifacts_run_idx ON harness_artifacts(run_id);
