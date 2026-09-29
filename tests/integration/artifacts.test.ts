import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildManifest, FilesystemArtifactStore, sha256Hex, validateManifest } from "@harness/artifacts";
import { type ArtifactId, newId, newTraceId, type Run } from "@harness/contracts";
import { createEvent } from "@harness/events";
import {
  createTestDatabase,
  pgRepositories,
  requireDatabaseUrl,
  type TestDatabase,
} from "@harness/persistence";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let dir: string;
let t: TestDatabase;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "harness-artifacts-"));
  t = await createTestDatabase(requireDatabaseUrl());
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await t?.drop();
});

const input = (text: string) => ({
  run_id: newId("RunId"),
  bytes: new TextEncoder().encode(text),
  media_type: "text/plain",
  producer: { kind: "test" as const, id: "artifacts.test" },
  provenance: { trace_id: newTraceId(), source: "integration-test" },
});

describe("FilesystemArtifactStore", () => {
  it("put/get/exists/metadata/verify_hash round-trip", async () => {
    const store = await FilesystemArtifactStore.open(join(dir, "a"), { create: true });
    const record = await store.put(input("hello artifact"));
    expect(record.content_hash.digest).toBe(sha256Hex(new TextEncoder().encode("hello artifact")));
    expect(record.size_bytes).toBe(14);
    expect(await store.exists(record.artifact_id)).toBe(true);
    expect(await store.metadata(record.artifact_id)).toEqual(record);
    expect(await store.verifyHash(record.artifact_id)).toMatchObject({ ok: true });
    const got = await store.get(record.artifact_id);
    expect(new TextDecoder().decode(got.bytes)).toBe("hello artifact");
  });

  it("deduplicates identical content but keeps distinct records and provenance", async () => {
    const store = await FilesystemArtifactStore.open(join(dir, "b"), { create: true });
    const r1 = await store.put(input("same"));
    const r2 = await store.put(input("same"));
    expect(r1.artifact_id).not.toBe(r2.artifact_id);
    expect(r1.storage_ref.key).toBe(r2.storage_ref.key);
    expect(r1.provenance.trace_id).not.toBe(r2.provenance.trace_id);
  });

  it("repairs a corrupted blob on re-put instead of deduplicating against it", async () => {
    const root = join(dir, "repair");
    const store = await FilesystemArtifactStore.open(root, { create: true });
    const first = await store.put(input("repair me"));
    const d = first.content_hash.digest;
    await writeFile(join(root, "blobs", "sha256", d.slice(0, 2), d), "corrupted");
    expect((await store.verifyHash(first.artifact_id)).ok).toBe(false);
    const second = await store.put(input("repair me"));
    expect((await store.verifyHash(second.artifact_id)).ok).toBe(true);
    expect((await store.verifyHash(first.artifact_id)).ok).toBe(true);
  });

  it("rejects metadata that is not JSON or describes a different artifact", async () => {
    const root = join(dir, "meta");
    const store = await FilesystemArtifactStore.open(root, { create: true });
    const a = await store.put(input("a"));
    const b = await store.put(input("b"));
    await writeFile(join(root, "records", `${a.artifact_id}.json`), "{not json");
    await expect(store.metadata(a.artifact_id)).rejects.toMatchObject({ code: "PAYLOAD_INVALID" });
    await writeFile(join(root, "records", `${a.artifact_id}.json`), JSON.stringify(b));
    await expect(store.metadata(a.artifact_id)).rejects.toMatchObject({ code: "PAYLOAD_INVALID" });
  });

  it("reports a missing artifact without throwing from exists()", async () => {
    const store = await FilesystemArtifactStore.open(join(dir, "c"), { create: true });
    expect(await store.exists(newId("ArtifactId"))).toBe(false);
    await expect(store.metadata(newId("ArtifactId"))).rejects.toMatchObject({ code: "ARTIFACT_NOT_FOUND" });
  });

  it("rejects path-traversal IDs before touching the filesystem", async () => {
    const store = await FilesystemArtifactStore.open(join(dir, "d"), { create: true });
    await expect(store.metadata("../../etc/passwd" as ArtifactId)).rejects.toMatchObject({
      code: "PAYLOAD_INVALID",
    });
  });

  it("records artifact metadata and an artifact.created event in PostgreSQL", async () => {
    const store = await FilesystemArtifactStore.open(join(dir, "e"), { create: true });
    const repos = pgRepositories(t.db);
    const now = new Date().toISOString();
    const run: Run = {
      schema_version: 1,
      id: newId("RunId"),
      root_goal: "artifact",
      status: "RUNNING",
      created_at: now,
      updated_at: now,
      policy_profile: "p",
      budget_profile: "b",
      root_thread_id: newId("ThreadId"),
      metadata: {},
    };
    await repos.runs.create(run);
    const record = await store.put({ ...input("db-backed"), run_id: run.id });
    await t.db.withTransaction(async (tx) => {
      const r = pgRepositories(tx);
      await r.artifacts.insert(record);
      await r.events.append(
        createEvent(
          "artifact.created",
          {
            artifact_id: record.artifact_id,
            content_hash: record.content_hash,
            media_type: record.media_type,
          },
          { run_id: run.id, trace_id: record.provenance.trace_id },
        ),
      );
    });
    expect(await repos.artifacts.get(record.artifact_id)).toEqual(record);
    expect((await repos.events.listByRun(run.id)).map((e) => e.event_type)).toEqual(["artifact.created"]);
  });
});

describe("evidence manifest", () => {
  it("validates and then detects tampering and loss", async () => {
    const ev = join(dir, "evidence");
    await FilesystemArtifactStore.open(ev, { create: true });
    await writeFile(join(ev, "one.json"), '{"a":1}\n');
    await writeFile(join(ev, "two.txt"), "two\n");
    const manifest = buildManifest(ev, ["one.json", "two.txt"], { phase: "P00", gitCommit: null });
    expect(validateManifest(ev, manifest, ["one.json"])).toEqual([]);
    expect(validateManifest(ev, manifest, ["three.json"])).toEqual([
      { path: "three.json", problem: "required_not_listed" },
    ]);
    await writeFile(join(ev, "one.json"), '{"a":2}\n');
    await rm(join(ev, "two.txt"));
    expect(validateManifest(ev, manifest)).toEqual([
      { path: "one.json", problem: "hash_mismatch" },
      { path: "two.txt", problem: "missing" },
    ]);
    expect(validateManifest(ev, { nonsense: true })).toEqual([
      { path: "manifest.json", problem: "invalid_manifest" },
    ]);
  });
});
