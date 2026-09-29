# ADR-0003: TypeScript / Python / Rust responsibility split

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §3.5–3.7, §6; MASTER_PROJECT_WORKFLOW.md §11

## Decision
- **TypeScript** owns the control plane: contracts, kernel, orchestration, persistence, events, policy/model/capability contracts, APIs, future Mission Control.
- **Python** (`services/python`) owns ML/data-heavy extensions by default. P00: a typed, tested skeleton, no ML framework.
- **Rust** (`services/rust`) owns security/performance-sensitive native components by default. P00: a dependency-free, `unsafe`-forbidden crate; no sandbox.
- Cross-language boundaries use **versioned portable contracts** (`specs/schemas/*.v<N>.json`, exported from the TypeScript contracts), never shared internals. The Python skeleton reads those snapshots; the Rust skeleton implements the opaque-ID rule, and
  agreement is proven by one shared fixture (`specs/fixtures/opaque-ids.txt`) asserted by both the
  TypeScript contracts and the Rust crate (the fixture directory is mounted read-only into the Rust container).

## Consequences
Each language has its own pinned toolchain, lockfile and gate (see ADR-0011); RPC/event transport between languages is deferred until a phase needs it.

## Enforcement
`scripts/python-check.ts`, `scripts/rust-check.ts`, `scripts/export-schemas.ts --check`.
