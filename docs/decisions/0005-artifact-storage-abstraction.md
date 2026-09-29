# ADR-0005: Artifact / object-storage abstraction

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §3.9, §7, §16

## Decision
`ArtifactStore` (`put`, `get`, `exists`, `metadata`, `verifyHash`) is the only way to store artifact bytes. Blobs are content-addressed by SHA-256; every `ArtifactRecord` carries provenance (trace ID, source, derivation) and an integrity hash (INV-008). `get` verifies the hash before returning bytes. P00 ships a filesystem backend with atomic writes (temp file + rename) and ID validation before any path is built. Artifact metadata is also recorded in PostgreSQL (`harness_artifacts`) together with an `artifact.created` event.

An S3-compatible backend is optional for P00 and was not added (no P00 requirement needs it).

## Enforcement
`tests/integration/artifacts.test.ts`, failure scenarios F10 and F11.
