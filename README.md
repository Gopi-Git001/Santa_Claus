# Autonomous Agent Harness

A model-agnostic autonomous agent harness. LangGraph.js/TypeScript is the
orchestration runtime; the harness itself owns security, authority, execution,
persistence, artifacts, verification and observability.
*The model proposes; the harness controls.*

**Current phase: P00 — Foundation** (`P00_FOUNDATION_SPECIFICATION.md`).
Status and evidence: [`evidence/P00/P00-REPORT.md`](evidence/P00/P00-REPORT.md).

## Quick start

Prerequisites: Node.js 24.18.0 (with corepack), Docker, [uv](https://docs.astral.sh/uv/). Rust is **not** needed on the host: Rust checks run in a container.

```sh
node scripts/bootstrap.ts          # install (frozen), generate .env, start PostgreSQL, migrate, sync Python
corepack pnpm exec vitest run      # all TypeScript test layers (real PostgreSQL)
node scripts/p00/acceptance.ts     # full P00 acceptance ladder → evidence/P00/
node scripts/p00/verify.ts         # independent P00 verifier
```

## Repository map

| Path | Purpose |
|---|---|
| `packages/contracts` | IDs, errors, versioned core records (no framework coupling) |
| `packages/events` | Event catalog, envelope, event sink port |
| `packages/kernel` | Workflow runtime port, thread registry, scaling contract |
| `packages/orchestration` | **Only** LangGraph importer: adapter + P00 smoke graph |
| `packages/persistence` | PostgreSQL: migrations, repositories, test DB lifecycle |
| `packages/artifacts` | ArtifactStore (filesystem) + evidence manifest |
| `packages/config`, `packages/observability` | Typed config/secrets; redacting logger |
| `packages/policy`, `packages/models`, `packages/capabilities` | Authority, model gateway, tool/extension contracts |
| `packages/traceability` | Registry schemas and validators |
| `packages/testing` | Composition root for smoke runs, deterministic fakes |
| `services/python`, `services/rust` | Language skeletons (ADR-0003) |
| `specs/` | Machine-readable registries and portable schemas (source of truth) |
| `docs/` | Architecture, ADRs, runbooks, threat model, generated registry views |
| `evidence/P00` | Phase evidence and report |
| `apps/` | Reserved for later phases (no code in P00) |

## Documentation

- [Architecture overview](docs/architecture/overview.md)
- [Local setup](docs/runbooks/local-setup.md) · [Testing](docs/runbooks/testing.md) · [Debugging](docs/runbooks/debugging.md)
- [Evidence guide](evidence/README.md) · [Contributing](CONTRIBUTING.md)
- [ADR index](docs/decisions/README.md) · [Threat model](docs/threat-model/baseline.md)
- [Capability ledger](specs/capabilities/README.md) · [Phase registry](docs/generated/phases.md) · [Invariants](docs/generated/invariants.md) · [Domains](docs/generated/domains.md)
- Project direction: [`MASTER_PROJECT_WORKFLOW.md`](MASTER_PROJECT_WORKFLOW.md) · Agent instructions: [`CLAUDE.md`](CLAUDE.md)
