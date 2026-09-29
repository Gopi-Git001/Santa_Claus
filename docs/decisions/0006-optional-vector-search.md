# ADR-0006: Optional, replaceable vector/search

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §3.10, §7; MASTER_PROJECT_WORKFLOW.md §12

## Decision
No vector database or search engine is part of P00. When a later phase (P04/P12) justifies retrieval, it starts behind a harness-owned retrieval/memory contract; PostgreSQL extensions may provide the first implementation, and dedicated systems can replace it without changing that contract.

## Consequences
P00 has no search dependency to install, secure or operate. Nothing in P00 contracts assumes a particular index technology.
