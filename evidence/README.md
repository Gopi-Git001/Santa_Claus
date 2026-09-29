# Evidence guide

Each phase keeps its evidence in `evidence/<PHASE>/`. Evidence is produced by
scripts, never written by hand — except the phase report and the blocker
register, which are human-reviewed documents.

## Producing and checking P00 evidence

```sh
node scripts/p00/acceptance.ts   # runs the ladder; rewrites all machine evidence
node scripts/p00/verify.ts       # independent verdict + sealed final manifest
```

`acceptance.ts` deletes stale machine evidence first, so a file present after a
run was produced by that run.

## Files

| File | Content |
|---|---|
| `acceptance-log.json` | every rung: command, expected vs actual exit code, duration |
| `environment.json` | OS, git commit, Node/pnpm/TS/Biome/Vitest, LangGraph, PostgreSQL, Docker, Python, Rust versions |
| `dependency-lock-summary.json` | lockfile hashes and consistency checks |
| `typecheck.txt`, `lint.txt`, `migrations.txt`, `dependency-boundaries.txt`, `schema-drift.txt`, `generated-docs.txt`, `security-secrets.txt` | command output with header (command, exit code, duration) |
| `unit-tests.json`, `contract-tests.json`, `integration-tests.json`, `e2e-tests.json`, `failure-tests.vitest.json` | raw Vitest JSON results |
| `failure-tests.json` | §33 scenarios F01–F15 joined to their test results |
| `python-checks.json`, `python-tests.xml`, `rust-checks.json` | language gates (Rust: image digest, versions) |
| `langgraph-smoke.json` | smoke runs: IDs, node sequence, events, causation, checkpoints, final state, errors |
| `persistence-resume.json` | multi-process restart/resume and thread-isolation proof |
| `performance-baseline.json` | §30 baseline metrics |
| `traceability-audit.json` | registry validation (VALID / INVALID / BLOCKED) |
| `fresh-environment.json` | clean clone + bootstrap + full ladder on a new database |
| `blockers.json` | open specification/environment blockers (hand-maintained) |
| `manifest.json` | SHA-256 of machine evidence at the end of acceptance |
| `verifier-result.json` | per-criterion §34 verdict |
| `final-manifest.json` | seal over all evidence including report and verdict |
| `P00-REPORT.md` | human-readable phase report |

## Rules

- Never fabricate, edit or "fix" evidence by hand; rerun the producing command.
- Evidence must never contain secrets. The verifier scans every evidence file for
  this machine's real database credentials.
- Skipped mandatory tests are failures unless explicitly explained in the report.
