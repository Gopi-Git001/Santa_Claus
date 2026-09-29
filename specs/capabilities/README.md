# Capability ledger (C001–C168)

**Status: BLOCKED — awaiting the authoritative catalog (P00-BLK-001).**

`ledger.json` in this directory is the machine-readable source of truth for the
C001–C168 capability requirements. It does not exist yet on purpose.

The project specifications define only capability *families* by range
(`MASTER_PROJECT_WORKFLOW.md` §5). The individual records — title,
description, domain, owning phase, dependencies, mandatory flag — have not been
provided. The project owner will supply the official catalog; until then:

- C001–C168 are **reserved IDs**. Nothing in this repository invents, infers,
  renumbers or assigns them, and there are no placeholder records.
- New future capabilities begin at C169. Existing IDs are never renumbered.
- `scripts/validate-specs.ts` reports the ledger as **BLOCKED** (exit code 2) and
  the P00 verifier refuses a `VERIFIED` status while
  `evidence/P00/blockers.json` has an open blocker.

## Record schema

Defined in `packages/traceability/src/schemas.ts` (`CapabilityRecordSchema`):
`id, title, description, domain, owning_phase, dependencies[], status,
mandatory, implementation_refs[], test_refs[], security_refs[],
evidence_refs[], notes`.

Validation (`validateLedger`) enforces: exactly C001–C168, no duplicates, valid
domain (S01–S16) and owning phase (P00–P18), valid dependency IDs, no
mandatory dependency cycles, no mandatory dependency on a later phase, P00-owned
mandatory records mapped to tests and evidence, and every ref resolving to a
real file (and test title, for `path#title` refs).

## Importing the catalog

1. Convert the authoritative catalog to `specs/capabilities/ledger.json`
   (`{ "schema_version": 1, "source": "<catalog reference>", "capabilities": [...] }`).
2. Fill `owned_capability_ids` for each phase in `specs/phases/phases.json` only
   from the catalog.
3. Run `node scripts/validate-specs.ts` until it reports `VALID`, then close
   P00-BLK-001 in `evidence/P00/blockers.json` with a reference to the catalog.
