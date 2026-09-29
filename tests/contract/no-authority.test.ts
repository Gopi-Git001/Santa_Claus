import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { importsOf, relativeClosure } from "../../scripts/lib/boundaries.ts";

/*
 * P00 gate: "no general shell/network authority exists in P00 smoke graph"
 * (P00 spec §14, §34; INV-001, INV-017).
 *
 * Two audited surfaces, each followed through ALL relative imports:
 * - node code (graph.ts, schemas.ts): may import only contracts/events/kernel,
 *   the LangGraph graph API and zod — no I/O of any kind.
 * - the runtime adapter (runtime.ts): additionally reaches the harness-owned
 *   checkpoint store (PostgreSQL via the LangGraph saver and pg). That is
 *   harness persistence, not authority granted to graph nodes; it still may not
 *   touch shell, filesystem, network sockets/HTTP, workers or the environment.
 */
const orchestrationSrc = join(import.meta.dirname, "..", "..", "packages", "orchestration", "src");
const smokeDir = join(orchestrationSrc, "smoke");
const NODE_CODE_IMPORTS = [
  "@harness/contracts",
  "@harness/events",
  "@harness/kernel",
  "@langchain/langgraph",
  "zod",
];
const ADAPTER_IMPORTS = [...NODE_CODE_IMPORTS, "@langchain/langgraph-checkpoint-postgres", "pg"];
const FORBIDDEN_TOKENS: Array<[string, RegExp]> = [
  ["process access", /\bprocess\s*\./],
  ["global fetch", /\bfetch\s*\(/],
  ["dynamic import", /\bimport\s*\(/],
  ["require", /\brequire\s*\(/],
  ["eval", /\beval\s*\(|new\s+Function\s*\(/],
  ["WebSocket", /\bWebSocket\b/],
];

function audit(entries: string[], allowed: string[]) {
  const files = [...new Set(entries.flatMap((e) => relativeClosure(join(smokeDir, e))))];
  const problems: string[] = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    // Token checks apply to code, not prose in comments.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
    const name = relative(orchestrationSrc, file).replaceAll("\\", "/");
    for (const spec of importsOf(source).filter((s) => !s.startsWith(".")))
      if (!allowed.includes(spec)) problems.push(`${name} imports ${spec}`);
    for (const [label, pattern] of FORBIDDEN_TOKENS)
      if (pattern.test(code)) problems.push(`${name}: ${label}`);
  }
  return { files: files.map((f) => relative(orchestrationSrc, f).replaceAll("\\", "/")).sort(), problems };
}

describe("P00 smoke graph has no side-effect authority", () => {
  it("node code (graph + schemas, transitively) imports only side-effect-free modules and uses no process/network/eval", () => {
    const r = audit(["graph.ts", "schemas.ts"], NODE_CODE_IMPORTS);
    expect(r.files).toEqual(["smoke/graph.ts", "smoke/schemas.ts"]);
    expect(r.problems).toEqual([]);
  });

  it("runtime adapter (transitively) reaches only the harness-owned checkpoint store — no shell, filesystem, HTTP or environment", () => {
    const r = audit(["runtime.ts"], ADAPTER_IMPORTS);
    expect(r.files).toEqual(
      expect.arrayContaining(["smoke/runtime.ts", "checkpoint-persistence.ts", "event-emitter.ts"]),
    );
    expect(r.problems).toEqual([]);
  });

  it("the audit itself detects a forbidden import", () => {
    expect(importsOf('import { execSync } from "node:child_process";')).toEqual(["node:child_process"]);
    expect(importsOf('const cp = require("child_process");')).toEqual(["child_process"]);
  });
});
