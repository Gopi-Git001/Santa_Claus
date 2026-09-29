# P00 Report — Foundation Specification and Initial Setup

**Final P00 gate status: INCOMPLETE**

P00 is **not VERIFIED**. Every implementable acceptance criterion passes against real
dependencies, but two items cannot pass yet:

1. **P00-BLK-001 (specification gap, open):** the authoritative C001–C168 capability catalog has
   not been provided. By project-owner instruction no capability records were invented, so the five
   *Requirements* criteria and "P00–P18 registry valid" are **BLOCKED**.
2. **Hosted CI (not verified):** the branch was not pushed (project-owner decision), so the GitHub
   Actions workflow has never run. All 14 CI job equivalents pass locally; "all mandatory CI jobs
   green" is **NOT_VERIFIED**.

Evidence commit: `1f25edc5e2da500941892b9498a79e6be7a0dd69` (branch `p00-foundation`, clean tree,
not pushed). Evidence produced 2026-09-28/29 by `scripts/p00/acceptance.ts`; verdict by the
independent verifier `scripts/p00/verify.ts` (`evidence/P00/verifier-result.json`).

---

## 1. Environment and dependency versions

From `environment.json`, `python-checks.json`, `rust-checks.json`, `dependency-lock-summary.json`.

| Component | Version / pin |
|---|---|
| OS | Windows 10 Home 10.0.19045 (4 CPUs) |
| Node.js | v24.18.0 (`.nvmrc`) |
| pnpm | 12.6.0 via corepack (`packageManager`) |
| TypeScript | 7.0.2 (strict, `erasableSyntaxOnly`) |
| Biome | 2.5.14 |
| Vitest | 5.0.2 |
| zod | 4.6.5 |
| @langchain/langgraph | 1.4.18 |
| @langchain/langgraph-checkpoint | 1.1.5 |
| @langchain/langgraph-checkpoint-postgres | 1.0.5 |
| @langchain/core | 1.2.13 |
| pg | 8.23.0 |
| PostgreSQL | 18.6 (Debian 18.6-1.pgdg13+2), image `postgres:18.6-trixie@sha256:5a5a84b1…` |
| Docker | 29.6.2 |
| Python | CPython 3.12.13 via uv 0.11.30; ruff 0.16.9, mypy 2.3.1, pytest 9.1.1 |
| Rust | rustc 1.98.1, cargo 1.98.1, rustfmt 1.9.0, clippy 0.1.98 — container only |
| Rust image | base `rust:1.98.1-slim-trixie@sha256:4cd82946…` + rustfmt/clippy (`infra/ci/rust.Dockerfile`), built image `sha256:2536cbc5…` |

Lockfiles: `pnpm-lock.yaml`, `services/python/uv.lock`, `services/rust/Cargo.lock` (hashes in
`dependency-lock-summary.json`). All direct dependencies are exact versions (67/67 lockfile checks pass).

## 2. Commands executed

The acceptance procedure (P00 spec §25) is one command; each rung's exact command, expected and
actual exit code and duration are in `acceptance-log.json`.

```sh
node scripts/p00/acceptance.ts        # 22/22 rungs ok, exit 0
node scripts/p00/verify.ts            # independent verdict (INCOMPLETE, exit 1 by design)
node scripts/p00/verify.ts --check-seal
```

Rungs run by `acceptance.ts` (in order): `corepack pnpm install --frozen-lockfile` ·
`node scripts/dev-db.ts up` · `node --env-file-if-exists=.env scripts/db-migrate.ts` ·
`node scripts/check-lockfiles.ts` · `corepack pnpm exec tsc --noEmit -p tsconfig.json` ·
`corepack pnpm exec biome check .` · `node scripts/check-boundaries.ts` ·
`node scripts/export-schemas.ts --check` · `node scripts/generate-spec-docs.ts --check` ·
`corepack pnpm exec vitest run --project unit|contract|integration|failure|e2e` (JSON reporters) ·
`node scripts/python-check.ts` · `node scripts/rust-check.ts --fresh` ·
`node --env-file-if-exists=.env scripts/smoke.ts` · `… scripts/p00/persistence-resume.ts` ·
`node scripts/validate-specs.ts` (expected exit 2 = BLOCKED) · `node scripts/p00/fresh-env.ts` ·
`… scripts/p00/perf-baseline.ts` · `node scripts/check-secrets.ts`.

## 3. Results

### Tests (all against real PostgreSQL where applicable; 0 skipped, 0 todo)

| Layer | Total | Passed | Failed | Skipped |
|---|---|---|---|---|
| Unit (`packages/*/test`) | 130 | 130 | 0 | 0 |
| Contract (`tests/contract`) | 50 | 50 | 0 | 0 |
| Integration (`tests/integration`, real PostgreSQL) | 28 | 28 | 0 | 0 |
| Failure (`tests/failure`, F01–F15 + coverage) | 16 | 16 | 0 | 0 |
| End-to-end (`tests/e2e`, multi-process) | 2 | 2 | 0 | 0 |
| **TypeScript total** | **226** | **226** | **0** | **0** |
| Python (pytest) | 4 | 4 | 0 | 0 |
| Rust (cargo test, in container) | 4 | 4 | 0 | 0 (0 ignored) |

Static checks: strict typecheck exit 0; Biome exit 0; dependency boundaries 0 violations; schema
drift 0 (19 frozen contract snapshots); generated registry views current; committed-secret scan 0
findings; ruff lint/format, strict mypy exit 0; `cargo fmt --check`, `clippy -D warnings` exit 0.

### Real-runtime verification

- **LangGraph.js smoke** (`langgraph-smoke.json`): straight-through run completed (4 streamed node
  updates, unbroken causation chain); interrupt → PostgreSQL checkpoint → explicit human response →
  completed; forced node failure → classified `NODE_FAILED`, run `FAILED`, failing node recorded.
  Checkpoint-store schema version 4; harness schema version 2.
- **Restart/resume** (`persistence-resume.json`, 13/13 checks): process A runs to the human interrupt
  and is **SIGKILLed** right after checkpointing; process B sees the persisted pending interrupt;
  process C resumes the same thread with an explicit approval to completion; one causal event chain
  across all processes; pre-restart nodes not re-executed.
- **Thread isolation**: another run's identity → `THREAD_MISMATCH`; unknown thread →
  `THREAD_NOT_FOUND`; finished thread → `GRAPH_NOT_INTERRUPTED`; the other thread's state untouched.
- **Fresh-environment reproduction** (`fresh-environment.json`): clean clone of `1f25edc` into a temp
  directory, bootstrap with its own new PostgreSQL (separate compose project, port 55433, new volume,
  generated credentials) in 33.5 s, then typecheck, lint, all 226 tests, boundaries, schema drift,
  generated docs, secret scan, lockfiles, Python, Rust (fresh image + volumes), smoke, and traceability
  (BLOCKED as expected) — all as expected; database destroyed afterwards.

### Failure scenarios (§33) — expected vs observed classification (`failure-tests.json`)

| ID | Scenario | Expected | Observed | Result |
|---|---|---|---|---|
| F01 | invalid configuration | CONFIG_INVALID | CONFIG_INVALID | pass |
| F02 | PostgreSQL unavailable at startup | DB_UNAVAILABLE | DB_UNAVAILABLE | pass |
| F03 | disconnect during workflow (event log **and** checkpoint store, mid-run) | DB_DISCONNECTED | DB_DISCONNECTED | pass (runs recorded UNKNOWN, not FAILED) |
| F04 | invalid/corrupted event payload | PAYLOAD_INVALID | PAYLOAD_INVALID | pass |
| F05 | duplicate capability ID | DUPLICATE_ID | DUPLICATE_ID | pass |
| F06 | invalid capability dependency | INVALID_DEPENDENCY | INVALID_DEPENDENCY | pass |
| F07 | invalid phase reference | INVALID_PHASE_REF | INVALID_PHASE_REF | pass |
| F08 | wrong thread ID on resume | THREAD_MISMATCH | THREAD_MISMATCH | pass |
| F09 | interrupted graph not resumed | INTERRUPTED | INTERRUPTED | pass |
| F10 | artifact hash mismatch | ARTIFACT_HASH_MISMATCH | ARTIFACT_HASH_MISMATCH | pass |
| F11 | artifact storage unavailable | STORAGE_UNAVAILABLE | STORAGE_UNAVAILABLE | pass |
| F12 | secret-like value to logger | REDACTED | REDACTED | pass |
| F13 | unsupported schema version | UNSUPPORTED_SCHEMA_VERSION | UNSUPPORTED_SCHEMA_VERSION | pass |
| F14 | forced node failure | NODE_FAILED | NODE_FAILED | pass |
| F15 | process restart + persisted-state verification | INTERRUPTED | INTERRUPTED | pass (child SIGKILLed) |

F05–F07 exercise the ledger/phase validators on clearly labelled fixture data (IDs C901+), because
no real ledger exists yet.

### Performance baseline (`performance-baseline.json`; development machine, not an SLO)

Bootstrap (fresh clone) 33.5 s · graph invocation p50 196.6 ms / p95 254.3 ms (4-node run incl.
6 synchronous checkpoint writes, run/event bookkeeping, no LLM) · checkpoint read p50 2.9 ms ·
event write p50 3.5 ms · artifact put 1 KiB p50 3.5 ms · get+verify p50 2.2 ms · smoke process RSS 201 MB.

## 4. Traceability status (C001–C168)

From `traceability-audit.json` (`node scripts/validate-specs.ts`, re-run independently by the verifier):

| Registry | Status | Detail |
|---|---|---|
| Domains S01–S16 | VALID | 16/16, verbatim from MASTER_PROJECT_WORKFLOW.md §4 |
| Invariants INV-001–020 | VALID | 12 enforced (each backed by tests that **passed** in this run), 7 boundary, 1 deferred (INV-014 → P17) |
| Phases P00–P18 | BLOCKED | 19 phases structurally valid; prerequisites/entry/exit/owned-capability fields not defined by the specifications are `null`, never guessed |
| Capability ledger C001–C168 | **BLOCKED** | `specs/capabilities/ledger.json` absent — 0/168 records (P00-BLK-001) |

C001–C168 remain reserved and unassigned. The ledger schema, validators (duplicates, missing/extra
IDs, domain/phase references, dependency references, mandatory cycles, phase-order violations,
P00 test/evidence mapping, ref resolution, and binding to the catalog file by SHA-256) are built and
tested; they will run against the real ledger as soon as the catalog is imported.

## 5. Failures encountered and their resolutions

Failures found during implementation (all root-caused; none resolved by weakening a test):

| # | Failure | Root cause | Resolution |
|---|---|---|---|
| 1 | Bootstrap aborted: "unhandled `__GENERATED__`" | placeholder check matched a comment | check only `KEY=value` lines |
| 2 | Commit impossible / hash instability | no git identity; `core.autocrlf=true` would change checksums on Windows checkouts | per-command identity (existing repo author, see Limitations); `.gitattributes` forces LF |
| 3 | Biome `useLiteralKeys` vs TS `noPropertyAccessFromIndexSignature` | contradictory rules | kept the stricter compiler rule, disabled the Biome rule |
| 4 | Rust checks failed in container | official rust images (slim and full) ship without rustfmt/clippy | derived image adding exactly those components for the pinned toolchain |
| 5 | `cargo fmt --check` failed | source not rustfmt-formatted | containerised `--format` mode, re-run |
| 6 | Secret scan: 16 findings | redactor's aggressive `key=value` rule matched code (`secret: false`) — all 16 manually checked, none real | stricter literal rule for scanning; planted-secret tests prove it still fails on real literals |
| 7 | Planted-secret test failed | copied scanner could not resolve workspace modules | real scanner with `--root` |
| 8 | Lockfile check failed once | `--offline` made the result depend on the local metadata cache | removed `--offline`; lockfile confirmed consistent |

Defects found by two independent reviews after the first complete build (each verified, fixed with a regression test):

| # | Defect | Resolution |
|---|---|---|
| R1 | Invalid human response flipped an INTERRUPTED run to FAILED while the thread stayed resumable; concurrent resumes could both execute | validate before any state change; legal run state machine; compare-and-set INTERRUPTED→RUNNING (tests proved failing on the old code) |
| R2 | F03 did not disconnect *during* a workflow | one-shot trigger kills the inserting backend mid-run on event log and checkpoint store |
| R3 | (found by R2) node start-event failure not attributed to the node | hook moved inside the node's try |
| R4 | (found by R2) LangGraph async durability → failed checkpoint writes were unhandled rejections (process-crash risk) | `durability: "sync"` (ADR-0012) |
| R5 | (found by R2) checkpoint saver recycled dead pool clients; no pool error listener | harness-owned checkpoint pool with error listener; dead clients destroyed (ADR-0012) |
| R6 | raw checkpoint connection errors classified NODE_FAILED → run FAILED instead of UNKNOWN (INV-012) | classified DB_DISCONNECTED |
| R7 | `withTransaction` relabelled caller errors as UNKNOWN_OUTCOME; one test asserted that mislabel | caller errors propagate unchanged; **the incorrect test was corrected** (documented in the test) |
| R8 | secret patterns missed `DB_PASSWORD=`, `client_secret=`, camelCase and JSON keys; shared objects logged as "[Circular]" | patterns fixed + tests; ancestor-based cycle detection |
| R9 | verifier: missing/invalid `blockers.json` treated as "no blockers"; evidence not bound to a commit; "enforced" invariants not checked against passing tests; seal never re-checked | all fixed (`scripts/p00/verify.ts`; rules described in `evidence/README.md`) |
| R10 | event log "append-only" by convention only | migration 0002 triggers reject UPDATE/DELETE/TRUNCATE (tested) |
| R11 | restart proof child exited normally, not a crash | child SIGKILLs itself after checkpointing |
| R12 | no cross-language test for the Rust ID rule; dead feature flag; config source not logged; artifact store deduplicated against corrupted blobs | shared fixture (TS + Rust), flag wired, source logged, blobs re-verified |

## 6. Evidence produced

`evidence/P00/`: `acceptance-log.json`, `environment.json`, `dependency-lock-summary.json`,
`typecheck.txt`, `lint.txt`, `migrations.txt`, `dependency-boundaries.txt`, `schema-drift.txt`,
`generated-docs.txt`, `security-secrets.txt`, `unit-tests.json`, `contract-tests.json`,
`integration-tests.json`, `e2e-tests.json`, `failure-tests.vitest.json`, `failure-tests.json`,
`failure-observations.jsonl`, `python-checks.json`, `python-tests.xml`, `rust-checks.json`,
`langgraph-smoke.json`, `persistence-resume.json`, `performance-baseline.json`,
`traceability-audit.json`, `fresh-environment.json`, `blockers.json`, `manifest.json` (run manifest,
covers every machine-evidence file), `verifier-result.json`, `final-manifest.json` (seal), this report.
The verifier found the real database secret in 0 evidence files.

## 7. Known limitations

- **Capability catalog missing** (P00-BLK-001): no C001–C168 records; phase registry fields that the
  specifications do not define are `null`.
- **Hosted CI never ran**: `.github/workflows/p00.yml` (14 jobs, SHA-pinned actions) is written and its
  YAML parses, but GitHub has not executed it; runner-specific issues cannot be excluded until it does.
- **Single platform**: all runs were on Windows 10 with Docker Desktop. Linux behaviour (CI target) is
  expected but unproven; on Linux the SIGKILL is reported as a signal rather than exit code 1.
- **Fresh-environment caches**: the fresh clone reused the machine's pnpm/uv package caches and Docker
  image cache (dependencies still installed from frozen lockfiles; the Rust image was rebuilt with no cache).
- **Checkpoint schema** is created/versioned by the LangGraph saver's own `setup()`, outside the harness
  migration runner; its version (4) is recorded in evidence.
- **Dead-client guard** wraps `pool.connect()` of our own pool to work around a saver-library behaviour;
  must be re-checked on library upgrades (ADR-0012).
- **Git authorship**: commits use the repository's existing author identity passed per command
  (`Gopi Thungam <gopi.thungam.001@gmail.com>`), because no git identity is configured on this machine
  and global config was not modified. Unpushed; easy to re-author if a different identity is wanted.
- **Evidence secret scan** checks the real database secrets known to this machine; it cannot prove the
  absence of arbitrary unknown secrets (pattern scan + typed secrets are the primary controls).
- **Performance numbers** are single-machine development baselines, not SLOs.

## 8. Unexplained or unverified items

- None unexplained. Unverified: hosted CI (above). Blocked: capability ledger and phase-registry
  content (P00-BLK-001).
- No mandatory test was skipped (0 skipped/todo in all layers; 0 skipped in pytest; 0 ignored in cargo).

## 9. Gate status (§34, from `verifier-result.json`)

| Section | PASS | Not passing |
|---|---|---|
| Architecture | 3 | registry valid — BLOCKED |
| Requirements | 0 | all 5 — BLOCKED (P00-BLK-001) |
| Toolchain | 4 | — |
| Runtime | 6 | — |
| Persistence/artifacts | 3 | — |
| Security/quality | 5 | — |
| CI/evidence | evidence commit binding, evidence complete, report, no skips | CI jobs green — NOT_VERIFIED; independent verifier success — FAIL (follows from the above) |

**Final P00 gate status: INCOMPLETE.** To reach VERIFIED:

1. Provide the authoritative C001–C168 catalog → import into `specs/capabilities/ledger.json`
   (bound by SHA-256), fill phase ownership from it, run `node scripts/validate-specs.ts` to VALID,
   then mark P00-BLK-001 `RESOLVED`.
2. Authorize pushing `p00-foundation` (or run the workflow yourself) → record the hosted run in
   `evidence/P00/hosted-ci.json`.
3. Re-run `node scripts/p00/acceptance.ts` and `node scripts/p00/verify.ts` on the resulting commit.

P01 has not been started and will not be without explicit authorization.
