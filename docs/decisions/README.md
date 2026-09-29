# Architecture Decision Records

ADRs are immutable once accepted. A changed decision gets a **new** ADR that
supersedes the old one; history is never rewritten (P00 spec §13).

| ADR | Title | Status |
|---|---|---|
| [0001](0001-langgraph-js-orchestration-runtime.md) | LangGraph.js as the orchestration runtime | Accepted |
| [0002](0002-langgraph-behind-harness-interfaces.md) | LangGraph wrapped behind harness interfaces | Accepted |
| [0003](0003-language-responsibility-split.md) | TypeScript / Python / Rust responsibility split | Accepted |
| [0004](0004-postgresql-durable-baseline.md) | PostgreSQL as the durable baseline | Accepted |
| [0005](0005-artifact-storage-abstraction.md) | Artifact / object-storage abstraction | Accepted |
| [0006](0006-optional-vector-search.md) | Optional, replaceable vector/search | Accepted |
| [0007](0007-dynamic-agent-instantiation.md) | Dynamic agent instantiation, not a predefined pool | Accepted |
| [0008](0008-human-authority-policy-model.md) | Human-authority policy model | Accepted |
| [0009](0009-event-envelope-versioning.md) | Event envelope and versioning strategy | Accepted |
| [0010](0010-requirement-evidence-traceability.md) | Requirement / evidence traceability | Accepted |
| [0011](0011-p00-toolchain-and-environment.md) | P00 toolchain and environment choices | Accepted |

Template: Context · Decision · Alternatives considered · Consequences · Enforcement.
