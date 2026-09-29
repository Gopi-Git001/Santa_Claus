import { describe, expect, it } from "vitest";
import {
  CapabilityIdSchema,
  ModelIdSchema,
  newId,
  newTraceId,
  type OpaqueIdKind,
  OpaqueIdPrefixes,
  RunIdSchema,
  ThreadIdSchema,
  TraceIdSchema,
} from "../src/index.ts";

describe("opaque IDs", () => {
  const kinds = Object.keys(OpaqueIdPrefixes) as OpaqueIdKind[];

  it.each(kinds)("generates a valid, prefixed %s", (kind) => {
    const id = newId(kind);
    expect(id.startsWith(`${OpaqueIdPrefixes[kind]}_`)).toBe(true);
    expect(id).toMatch(/^[a-z]{3}_[0-9a-hjkmnp-tv-z]{26}$/);
  });

  it("generates unique IDs", () => {
    const ids = new Set(Array.from({ length: 10_000 }, () => newId("RunId")));
    expect(ids.size).toBe(10_000);
  });

  it("rejects an ID of the wrong kind", () => {
    expect(RunIdSchema.safeParse(newId("ThreadId")).success).toBe(false);
    expect(ThreadIdSchema.safeParse(newId("RunId")).success).toBe(false);
  });

  it.each([
    "",
    "run_",
    "run_short",
    "RUN_0123456789abcdefghjkmnpqrs",
    "run_0123456789abcdefghjkmnpqri",
    " run_x",
  ])("rejects malformed RunId %j", (bad) => {
    expect(RunIdSchema.safeParse(bad).success).toBe(false);
  });

  it("does not accept Crockford-excluded letters i, l, o, u", () => {
    for (const letter of ["i", "l", "o", "u"]) {
      expect(RunIdSchema.safeParse(`run_${letter.repeat(26)}`).success).toBe(false);
    }
  });
});

describe("stable names and trace IDs", () => {
  it("accepts namespaced capability and model IDs", () => {
    expect(CapabilityIdSchema.safeParse("harness.echo").success).toBe(true);
    expect(ModelIdSchema.safeParse("fake.deterministic-v1").success).toBe(true);
  });

  it.each(["echo", "Harness.Echo", "harness..echo", "harness.echo.", "C001"])(
    "rejects stable name %j",
    (bad) => {
      expect(CapabilityIdSchema.safeParse(bad).success).toBe(false);
    },
  );

  it("generates W3C-format trace IDs and rejects the all-zero ID", () => {
    expect(newTraceId()).toMatch(/^[0-9a-f]{32}$/);
    expect(TraceIdSchema.safeParse("0".repeat(32)).success).toBe(false);
    expect(TraceIdSchema.safeParse("A".repeat(32)).success).toBe(false);
  });
});
