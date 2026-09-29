import type { ArtifactId, ArtifactRecord, RunId, TraceId } from "@harness/contracts";

/**
 * Replaceable artifact/object storage abstraction (P00 spec §16, ADR-0005).
 * Blobs are content-addressed by SHA-256; every artifact carries provenance
 * and an integrity hash (INV-008).
 */
export interface PutArtifactInput {
  run_id: RunId;
  bytes: Uint8Array;
  media_type: string;
  producer: ArtifactRecord["producer"];
  provenance: { trace_id: TraceId; source: string; derived_from?: ArtifactId[] };
}

export interface HashVerification {
  ok: boolean;
  expected: string;
  actual: string | null;
}

export interface ArtifactStore {
  readonly backend: string;
  put(input: PutArtifactInput): Promise<ArtifactRecord>;
  /** Returns the bytes only after verifying their hash; throws ARTIFACT_HASH_MISMATCH otherwise. */
  get(id: ArtifactId): Promise<{ record: ArtifactRecord; bytes: Uint8Array }>;
  exists(id: ArtifactId): Promise<boolean>;
  metadata(id: ArtifactId): Promise<ArtifactRecord>;
  verifyHash(id: ArtifactId): Promise<HashVerification>;
}
