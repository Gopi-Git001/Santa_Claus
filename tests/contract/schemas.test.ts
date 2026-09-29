import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defineContract, newId, newTraceId, parseContract, RunContract } from "@harness/contracts";
import { createEvent, EventTypes, parseEvent } from "@harness/events";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { portableContracts, renderSnapshot, snapshotFileName } from "../../scripts/lib/schema-registry.ts";

const dir = join(import.meta.dirname, "..", "..", "specs", "schemas");

describe("portable schema snapshots", () => {
  it.each(portableContracts().map((c) => [snapshotFileName(c), c] as const))(
    "%s matches the committed snapshot (no unversioned drift)",
    (file, contract) => {
      const path = join(dir, file);
      expect(existsSync(path), `${file} must be committed`).toBe(true);
      expect(readFileSync(path, "utf8").replaceAll("\r\n", "\n")).toBe(renderSnapshot(contract));
    },
  );

  it("detects drift when a shape changes without a version change", () => {
    const changed = defineContract(
      RunContract.name,
      RunContract.version,
      (RunContract.schema as unknown as z.ZodObject).extend({ extra: z.string() }),
    );
    expect(renderSnapshot(changed)).not.toBe(readFileSync(join(dir, snapshotFileName(RunContract)), "utf8"));
  });

  it("covers every event type", () => {
    const names = portableContracts().map((c) => c.name);
    for (const t of EventTypes) expect(names).toContain(`event.${t}`);
  });
});

describe("cross-package serialisation compatibility", () => {
  it("an event created in one package parses identically after JSON transport", () => {
    const e = createEvent(
      "policy.decision_recorded",
      {
        subject: "s",
        decision: {
          schema_version: 1,
          decision: "ASK_HUMAN",
          reason_code: "X",
          policy_version: "1",
          constraints: {},
        },
      },
      { run_id: newId("RunId"), trace_id: newTraceId() },
    );
    expect(parseEvent(JSON.parse(JSON.stringify(e)))).toEqual(e);
  });

  it("a v1 record is rejected by a hypothetical v2 reader and vice versa", () => {
    const v2 = defineContract("Run", 2, z.object({ schema_version: z.literal(2) }));
    const now = new Date().toISOString();
    const run = {
      schema_version: 1,
      id: newId("RunId"),
      root_goal: "g",
      status: "CREATED",
      created_at: now,
      updated_at: now,
      policy_profile: "p",
      budget_profile: "b",
      root_thread_id: newId("ThreadId"),
      metadata: {},
    };
    expect(() => parseContract(v2, run)).toThrow(/unsupported schema_version/);
    expect(() => parseContract(RunContract, { ...run, schema_version: 2 })).toThrow(
      /unsupported schema_version/,
    );
    expect(parseContract(RunContract, run).id).toBe(run.id);
  });
});
