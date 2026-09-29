import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type ArtifactId,
  ArtifactIdSchema,
  type ArtifactRecord,
  ArtifactRecordContract,
  HarnessError,
  newId,
  parseContract,
} from "@harness/contracts";
import type { ArtifactStore, HashVerification, PutArtifactInput } from "./store.ts";

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

const STORAGE_ERRNO = new Set([
  "ENOENT",
  "ENOTDIR",
  "EACCES",
  "EPERM",
  "EROFS",
  "ENOSPC",
  "EIO",
  "EISDIR",
  "EEXIST",
]);

function storageError(error: unknown, op: string): HarnessError {
  if (error instanceof HarnessError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  return new HarnessError("STORAGE_UNAVAILABLE", `artifact storage unavailable during ${op}`, {
    details: { errno: typeof code === "string" && STORAGE_ERRNO.has(code) ? code : "OTHER" },
    cause: error,
  });
}

/**
 * Local filesystem ArtifactStore for development and tests.
 *
 *   <root>/blobs/sha256/<aa>/<digest>      immutable content-addressed bytes
 *   <root>/records/<artifact_id>.json      ArtifactRecord metadata
 *
 * Writes go to a temp file then rename, so readers never see partial data.
 */
export class FilesystemArtifactStore implements ArtifactStore {
  readonly backend = "filesystem";
  readonly #root: string;

  private constructor(root: string) {
    this.#root = root;
  }

  /** Open a store; `create` makes the root if missing. Fails with STORAGE_UNAVAILABLE if unusable. */
  static async open(root: string, options: { create?: boolean } = {}): Promise<FilesystemArtifactStore> {
    try {
      if (options.create) await mkdir(root, { recursive: true });
      const s = await stat(root);
      if (!s.isDirectory()) throw Object.assign(new Error("root is not a directory"), { code: "ENOTDIR" });
      await mkdir(join(root, "blobs", "sha256"), { recursive: true });
      await mkdir(join(root, "records"), { recursive: true });
    } catch (error) {
      throw storageError(error, "open");
    }
    return new FilesystemArtifactStore(root);
  }

  #blobPath(digest: string): string {
    return join(this.#root, "blobs", "sha256", digest.slice(0, 2), digest);
  }

  #recordPath(id: ArtifactId): string {
    // Validate before touching the filesystem: IDs must never become path traversal.
    if (!ArtifactIdSchema.safeParse(id).success)
      throw new HarnessError("PAYLOAD_INVALID", "invalid ArtifactId", {
        details: { artifact_id: String(id) },
      });
    return join(this.#root, "records", `${id}.json`);
  }

  async #atomicWrite(path: string, data: Uint8Array | string): Promise<void> {
    const tmp = `${path}.${newId("EvidenceId")}.tmp`;
    await writeFile(tmp, data, { flag: "wx" });
    await rename(tmp, path);
  }

  async put(input: PutArtifactInput): Promise<ArtifactRecord> {
    const digest = sha256Hex(input.bytes);
    const record = parseContract(ArtifactRecordContract, {
      schema_version: 1,
      artifact_id: newId("ArtifactId"),
      run_id: input.run_id,
      producer: input.producer,
      media_type: input.media_type,
      size_bytes: input.bytes.byteLength,
      content_hash: { algorithm: "sha256", digest },
      storage_ref: { backend: this.backend, key: `sha256/${digest}` },
      created_at: new Date().toISOString(),
      provenance: {
        trace_id: input.provenance.trace_id,
        source: input.provenance.source,
        derived_from: input.provenance.derived_from ?? [],
      },
      verification_status: "UNVERIFIED",
    });
    try {
      const blob = this.#blobPath(digest);
      await mkdir(join(blob, ".."), { recursive: true });
      const existing = await stat(blob).catch(() => undefined);
      if (existing === undefined) await this.#atomicWrite(blob, input.bytes);
      await this.#atomicWrite(this.#recordPath(record.artifact_id), `${JSON.stringify(record, null, 2)}\n`);
    } catch (error) {
      throw storageError(error, "put");
    }
    return record;
  }

  async metadata(id: ArtifactId): Promise<ArtifactRecord> {
    let text: string;
    try {
      text = await readFile(this.#recordPath(id), "utf8");
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        throw new HarnessError("ARTIFACT_NOT_FOUND", `artifact ${id} not found`, {
          details: { artifact_id: id },
        });
      }
      throw storageError(error, "metadata");
    }
    return parseContract(ArtifactRecordContract, JSON.parse(text));
  }

  async exists(id: ArtifactId): Promise<boolean> {
    try {
      await this.metadata(id);
      return true;
    } catch (error) {
      if (error instanceof HarnessError && error.code === "ARTIFACT_NOT_FOUND") return false;
      throw error;
    }
  }

  async #readBlob(record: ArtifactRecord): Promise<Uint8Array | null> {
    try {
      return await readFile(this.#blobPath(record.content_hash.digest));
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null;
      throw storageError(error, "read");
    }
  }

  async verifyHash(id: ArtifactId): Promise<HashVerification> {
    const record = await this.metadata(id);
    const bytes = await this.#readBlob(record);
    const actual = bytes === null ? null : sha256Hex(bytes);
    return { ok: actual === record.content_hash.digest, expected: record.content_hash.digest, actual };
  }

  async get(id: ArtifactId): Promise<{ record: ArtifactRecord; bytes: Uint8Array }> {
    const record = await this.metadata(id);
    const bytes = await this.#readBlob(record);
    const actual = bytes === null ? null : sha256Hex(bytes);
    if (bytes === null || actual !== record.content_hash.digest) {
      throw new HarnessError("ARTIFACT_HASH_MISMATCH", `artifact ${id} failed integrity verification`, {
        details: { artifact_id: id, expected: record.content_hash.digest, actual },
      });
    }
    return { record, bytes };
  }
}
