/** Automated dependency-boundary audit (P00 spec §28). Exit 1 on any violation. */
import { join } from "node:path";
import { checkBoundaries } from "./lib/boundaries.ts";

const violations = checkBoundaries(join(import.meta.dirname, ".."));
for (const v of violations) console.error(`BOUNDARY ${v.file}: ${v.specifier} — ${v.reason}`);
console.log(JSON.stringify({ check: "dependency-boundaries", violations: violations.length }));
process.exit(violations.length === 0 ? 0 : 1);
