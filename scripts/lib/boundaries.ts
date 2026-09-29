import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Dependency-direction rules (P00 spec §28, ADR-0002). Each package may import
 * only the listed workspace packages and external modules. Core contracts must
 * not depend on LangGraph, PostgreSQL clients, web/UI frameworks or vendor SDKs.
 */
export const ALLOWED: Record<string, { workspace: string[]; external: string[] }> = {
  contracts: { workspace: [], external: ["zod"] },
  traceability: { workspace: [], external: ["zod"] },
  observability: { workspace: [], external: ["node:util"] },
  config: { workspace: ["contracts"], external: ["zod", "node:util"] },
  events: { workspace: ["contracts"], external: ["zod"] },
  kernel: { workspace: ["contracts"], external: ["zod"] },
  policy: { workspace: ["contracts"], external: [] },
  models: { workspace: ["contracts"], external: ["zod"] },
  capabilities: { workspace: ["contracts"], external: ["zod"] },
  artifacts: {
    workspace: ["contracts"],
    external: ["zod", "node:crypto", "node:fs", "node:fs/promises", "node:path"],
  },
  persistence: {
    workspace: ["contracts", "events"],
    external: ["pg", "node:crypto", "node:fs", "node:path"],
  },
  // The ONLY package allowed to import LangGraph (ADR-0002).
  orchestration: {
    workspace: ["contracts", "events", "kernel"],
    external: [
      "zod",
      "@langchain/langgraph",
      "@langchain/langgraph-checkpoint",
      "@langchain/langgraph-checkpoint-postgres",
      // Only to own the checkpoint pool's lifecycle and error handling (checkpoint-persistence.ts).
      "pg",
    ],
  },
  testing: {
    workspace: [
      "artifacts",
      "capabilities",
      "config",
      "contracts",
      "events",
      "kernel",
      "models",
      "observability",
      "orchestration",
      "persistence",
    ],
    external: ["zod", "node:crypto"],
  },
};

export interface BoundaryViolation {
  file: string;
  specifier: string;
  reason: string;
}

const IMPORT_RE =
  /(?:^|\n|;)\s*(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\sfrom\s+)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)|\brequire\(\s*["']([^"']+)["']\s*\)/g;

/** All files reachable from `entry` through relative imports (the entry included). */
export function relativeClosure(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    for (const spec of importsOf(readFileSync(file, "utf8")))
      if (spec.startsWith(".")) visit(join(file, "..", spec));
  };
  visit(entry);
  return [...seen];
}

/** Module specifiers referenced by static/dynamic imports, re-exports and require() calls. */
export function importsOf(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(IMPORT_RE)) {
    const spec = m[1] ?? m[2] ?? m[3];
    if (spec !== undefined) out.push(spec);
  }
  return out;
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return tsFiles(p);
    return p.endsWith(".ts") ? [p] : [];
  });
}

/** Check `packages/<name>/src/**` imports against the allow-list; also verifies every package is listed. */
export function checkBoundaries(root: string): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  const pkgsDir = join(root, "packages");
  for (const pkg of readdirSync(pkgsDir)) {
    const srcDir = join(pkgsDir, pkg, "src");
    const rule = ALLOWED[pkg];
    if (rule === undefined) {
      violations.push({ file: `packages/${pkg}`, specifier: "-", reason: "package has no boundary rule" });
      continue;
    }
    const declared = JSON.parse(readFileSync(join(pkgsDir, pkg, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    for (const file of tsFiles(srcDir)) {
      const rel = relative(root, file).replaceAll("\\", "/");
      for (const spec of importsOf(readFileSync(file, "utf8"))) {
        if (spec.startsWith(".")) continue;
        if (spec.startsWith("@harness/")) {
          const target = spec.slice("@harness/".length).split("/")[0] ?? "";
          if (!rule.workspace.includes(target))
            violations.push({
              file: rel,
              specifier: spec,
              reason: `packages/${pkg} may not depend on @harness/${target}`,
            });
          else if (declared.dependencies?.[`@harness/${target}`] === undefined)
            violations.push({
              file: rel,
              specifier: spec,
              reason: "workspace dependency not declared in package.json",
            });
          continue;
        }
        if (!rule.external.includes(spec))
          violations.push({ file: rel, specifier: spec, reason: `packages/${pkg} may not import ${spec}` });
        else if (!spec.startsWith("node:") && declared.dependencies?.[spec] === undefined)
          violations.push({
            file: rel,
            specifier: spec,
            reason: "external dependency not declared in package.json",
          });
      }
    }
  }
  return violations;
}
