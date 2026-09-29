/**
 * Export portable JSON Schema snapshots, or with --check verify that no
 * contract drifted without a version change (P00 spec section 27).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { portableContracts, renderSnapshot, snapshotFileName } from "./lib/schema-registry.ts";

const dir = join(import.meta.dirname, "..", "specs", "schemas");
const check = process.argv.includes("--check");
const problems: string[] = [];
let written = 0;

mkdirSync(dir, { recursive: true });
for (const contract of portableContracts()) {
  const file = join(dir, snapshotFileName(contract));
  const rendered = renderSnapshot(contract);
  const committed = existsSync(file) ? readFileSync(file, "utf8").replaceAll("\r\n", "\n") : undefined;
  if (committed === rendered) continue;
  if (check) {
    problems.push(
      committed === undefined
        ? `missing snapshot ${snapshotFileName(contract)} (run pnpm schemas:export and commit it)`
        : `schema drift in ${contract.name} without version change (snapshot ${snapshotFileName(contract)} differs)`,
    );
  } else if (committed !== undefined) {
    problems.push(
      `refusing to overwrite frozen snapshot ${snapshotFileName(contract)}: bump ${contract.name} version instead`,
    );
  } else {
    writeFileSync(file, rendered);
    written++;
  }
}

if (problems.length > 0) {
  for (const p of problems) console.error(`ERROR ${p}`);
  process.exit(1);
}
console.log(
  check ? `schemas OK (${portableContracts().length} contracts)` : `wrote ${written} new snapshot(s)`,
);
