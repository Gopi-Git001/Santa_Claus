import { mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkBoundaries, importsOf } from "../../scripts/lib/boundaries.ts";

const root = join(import.meta.dirname, "..", "..");

function fakeRepo(files: Record<string, string>, deps: Record<string, Record<string, string>> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-boundary-"));
  for (const [path, content] of Object.entries(files)) {
    const full = join(dir, path);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
  }
  for (const pkg of new Set(Object.keys(files).map((f) => f.split("/")[1]))) {
    writeFileSync(
      join(dir, "packages", String(pkg), "package.json"),
      JSON.stringify({ dependencies: deps[String(pkg)] ?? {} }),
    );
  }
  return dir;
}

describe("dependency-direction rules", () => {
  it("the real repository has no boundary violations", () => {
    expect(checkBoundaries(root)).toEqual([]);
  });

  it("detects core contracts importing LangGraph, a PostgreSQL client, or another harness package", () => {
    const dir = fakeRepo(
      {
        "packages/contracts/src/a.ts":
          'import { StateGraph } from "@langchain/langgraph";\nimport pg from "pg";\n',
        "packages/contracts/src/b.ts": 'export { x } from "@harness/events";\n',
      },
      { contracts: { "@langchain/langgraph": "1", pg: "1" } },
    );
    const reasons = checkBoundaries(dir).map((v) => v.specifier);
    expect(reasons).toEqual(expect.arrayContaining(["@langchain/langgraph", "pg", "@harness/events"]));
  });

  it("detects LangGraph imported outside the orchestration package", () => {
    const dir = fakeRepo({
      "packages/kernel/src/a.ts": 'import type { Command } from "@langchain/langgraph";\n',
    });
    expect(checkBoundaries(dir)).toHaveLength(1);
  });

  it("detects undeclared dependencies and unknown packages", () => {
    const dir = fakeRepo({
      "packages/events/src/a.ts": 'import { z } from "zod";\n',
      "packages/rogue/src/a.ts": "export const x = 1;\n",
    });
    const reasons = checkBoundaries(dir).map((v) => v.reason);
    expect(reasons).toEqual(
      expect.arrayContaining([
        "external dependency not declared in package.json",
        "package has no boundary rule",
      ]),
    );
  });

  it("parses static, type-only, re-export and dynamic imports", () => {
    expect(
      importsOf(
        'import a from "x";\nimport type { B } from "y";\nexport * from "z";\nconst m = await import("w");\n',
      ),
    ).toEqual(["x", "y", "z", "w"]);
  });

  it("only @harness/orchestration declares LangGraph dependencies", () => {
    const holders = readdirSync(join(root, "packages")).filter((pkg) => {
      const json = readFileSync(join(root, "packages", pkg, "package.json"), "utf8");
      return json.includes("@langchain/");
    });
    expect(holders).toEqual(["orchestration"]);
  });
});
