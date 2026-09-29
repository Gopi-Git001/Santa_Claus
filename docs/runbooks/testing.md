# Testing guide

## Layers (P00 spec §24)

| Layer | Location | Command | Needs PostgreSQL |
|---|---|---|---|
| Unit | `packages/*/test` | `corepack pnpm exec vitest run --project unit` | no |
| Contract | `tests/contract` | `... --project contract` | no |
| Integration | `tests/integration` | `... --project integration` | **yes (real)** |
| Failure | `tests/failure` (F01–F15, §33) | `... --project failure` | **yes (real)** |
| End-to-end | `tests/e2e` (multi-process restart/resume) | `... --project e2e` | **yes (real)** |
| Python | `services/python/tests` | `node scripts/python-check.ts` | no |
| Rust | `services/rust` | `node scripts/rust-check.ts` | no (Docker) |

## Rules

- Tests that need PostgreSQL **fail** when it is unavailable; they are never
  skipped (`requireDatabaseUrl`). Each suite runs in its own freshly created,
  migrated database which is dropped afterwards.
- In-memory checkpoints are used only in orchestration unit tests; persistence
  and resume are proven only against real PostgreSQL in separate OS processes.
- Checks that must be able to fail are tested with planted violations (dependency
  boundaries, committed secrets, schema drift, ledger validation).
- Secret-shaped fixture values are assembled at runtime, so no secret-like
  literal is ever committed.
- Never delete, skip or weaken a legitimate failing test to get green.

## Full acceptance

```sh
node scripts/p00/acceptance.ts   # every rung, all evidence → evidence/P00/
node scripts/p00/verify.ts       # independent verdict → evidence/P00/verifier-result.json
```
