import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importsOf } from "../../scripts/lib/boundaries.ts";

/*
 * P00 gate: "no general shell/network authority exists in P00 smoke graph"
 * (P00 spec §14, §34; INV-001, INV-017). The smoke graph modules may import
 * only these modules; anything granting process, shell, filesystem, network,
 * worker or environment access is forbidden, as are dynamic code/eval and
 * direct `process`/`fetch` use.
 */
const smokeDir = join(import.meta.dirname, "..", "..", "packages", "orchestration", "src", "smoke");
const ALLOWED_IMPORTS = new Set([
  "@harness/contracts",
  "@harness/events",
  "@harness/kernel",
  "@langchain/langgraph",
  "zod",
]);
const FORBIDDEN_TOKENS: Array<[string, RegExp]> = [
  ["process access", /\bprocess\s*\./],
  ["global fetch", /\bfetch\s*\(/],
  ["dynamic import", /\bimport\s*\(/],
  ["require", /\brequire\s*\(/],
  ["eval", /\beval\s*\(|new\s+Function\s*\(/],
  ["WebSocket", /\bWebSocket\b/],
];

const files = readdirSync(smokeDir).filter((f) => f.endsWith(".ts"));

describe("P00 smoke graph has no side-effect authority", () => {
  it("covers every smoke module", () => {
    expect(files.sort()).toEqual(["graph.ts", "runtime.ts", "schemas.ts"]);
  });

  it.each(files)("%s imports only allow-listed, side-effect-free modules", (file) => {
    const source = readFileSync(join(smokeDir, file), "utf8");
    const external = importsOf(source).filter((s) => !s.startsWith("."));
    for (const spec of external) expect(ALLOWED_IMPORTS, `${file} imports ${spec}`).toContain(spec);
  });

  it.each(files)("%s contains no process, network, eval or dynamic-import use", (file) => {
    const source = readFileSync(join(smokeDir, file), "utf8");
    for (const [name, pattern] of FORBIDDEN_TOKENS)
      expect(pattern.test(source), `${file}: ${name}`).toBe(false);
  });
});
