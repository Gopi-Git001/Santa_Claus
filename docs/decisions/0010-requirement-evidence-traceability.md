# ADR-0010: Requirement / evidence traceability

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §10–12, §16, §25; MASTER_PROJECT_WORKFLOW.md §22; CLAUDE.md

## Decision
- Machine-readable registries under `specs/` are the source of truth: domains (S01–S16), invariants (INV-001–020), phases (P00–P18), capability ledger (C001–C168). Markdown in `docs/generated/` is generated from them and checked for staleness.
- `@harness/traceability` validates them; `scripts/validate-specs.ts` resolves every `path` / `path#test title` reference against the repository and reports `VALID`, `INVALID` or `BLOCKED`.
- **Facts not present in the authoritative documents are recorded as `null` (pending), never guessed.** Missing specification content is a tracked blocker in `evidence/P00/blockers.json`; the independent verifier refuses `VERIFIED` while any blocker is open.
- C001–C168 are stable, reserved IDs; new capabilities start at C169.
- Evidence under `evidence/P00/` is produced by `scripts/p00/acceptance.ts`, hashed into `manifest.json`, and re-checked by `scripts/p00/verify.ts`, which trusts exit codes and parsed results rather than a single green command.

## Status note
At the time of this ADR the authoritative C001–C168 catalog has not been provided (P00-BLK-001), so the ledger does not exist and the capability/phase traceability gate is BLOCKED by design.
