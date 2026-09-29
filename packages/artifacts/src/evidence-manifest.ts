import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * Evidence manifest: a machine-checkable list of evidence files with their
 * SHA-256 digests, so later tampering or loss is detectable (P00 spec §16).
 */
export const EvidenceManifestSchema = z.strictObject({
  schema_version: z.literal(1),
  phase: z.string().regex(/^P\d{2}$/),
  generated_at: z.iso.datetime({ offset: true }),
  git_commit: z.string().nullable(),
  files: z.array(
    z.strictObject({
      path: z.string().min(1),
      sha256: z.string().regex(/^[0-9a-f]{64}$/),
      size_bytes: z.int().nonnegative(),
    }),
  ),
});

export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;

export function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function buildManifest(
  dir: string,
  files: string[],
  meta: { phase: string; gitCommit: string | null; now?: Date },
): EvidenceManifest {
  return EvidenceManifestSchema.parse({
    schema_version: 1,
    phase: meta.phase,
    generated_at: (meta.now ?? new Date()).toISOString(),
    git_commit: meta.gitCommit,
    files: [...files].sort().map((path) => ({
      path,
      sha256: fileSha256(join(dir, path)),
      size_bytes: statSync(join(dir, path)).size,
    })),
  });
}

export interface ManifestIssue {
  path: string;
  problem: "missing" | "hash_mismatch" | "required_not_listed" | "invalid_manifest";
}

/** Validate a manifest against the files on disk and a list of required entries. */
export function validateManifest(dir: string, manifest: unknown, required: string[] = []): ManifestIssue[] {
  const parsed = EvidenceManifestSchema.safeParse(manifest);
  if (!parsed.success) return [{ path: "manifest.json", problem: "invalid_manifest" }];
  const issues: ManifestIssue[] = [];
  const listed = new Set(parsed.data.files.map((f) => f.path));
  for (const req of required)
    if (!listed.has(req)) issues.push({ path: req, problem: "required_not_listed" });
  for (const f of parsed.data.files) {
    const full = join(dir, f.path);
    if (!existsSync(full)) issues.push({ path: f.path, problem: "missing" });
    else if (fileSha256(full) !== f.sha256) issues.push({ path: f.path, problem: "hash_mismatch" });
  }
  return issues;
}
