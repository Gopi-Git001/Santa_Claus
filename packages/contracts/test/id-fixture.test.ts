import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentIdSchema,
  ApprovalIdSchema,
  ArtifactIdSchema,
  EventIdSchema,
  EvidenceIdSchema,
  RunIdSchema,
  TaskIdSchema,
  ThreadIdSchema,
} from "../src/index.ts";

/** The same fixture is asserted by the Rust crate, so both languages provably agree (ADR-0003). */
const fixture = join(import.meta.dirname, "..", "..", "..", "specs", "fixtures", "opaque-ids.txt");
const byPrefix = {
  run: RunIdSchema,
  thr: ThreadIdSchema,
  agt: AgentIdSchema,
  tsk: TaskIdSchema,
  evt: EventIdSchema,
  art: ArtifactIdSchema,
  apr: ApprovalIdSchema,
  evd: EvidenceIdSchema,
} as const;

const cases = readFileSync(fixture, "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l !== "" && !l.startsWith("#"))
  .map((l) => l.split(/\s+/) as [string, keyof typeof byPrefix, string]);

describe("shared opaque-ID fixture", () => {
  it("has both valid and invalid cases for every prefix used", () => {
    expect(cases.length).toBeGreaterThan(15);
    expect(new Set(cases.filter((c) => c[0] === "valid").map((c) => c[1]))).toEqual(
      new Set(Object.keys(byPrefix)),
    );
  });

  it.each(cases)("%s %s %s", (expected, prefix, candidate) => {
    expect(byPrefix[prefix].safeParse(candidate).success).toBe(expected === "valid");
  });
});
