/**
 * validate-lockfiles (P00 spec §27): every ecosystem has a committed lockfile
 * that is consistent with its manifest, and toolchain pins are present.
 *   node scripts/check-lockfiles.ts [--json <out>]
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { PNPM, run } from "./lib/proc.ts";

const root = join(import.meta.dirname, "..");
const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
const sha = (p: string) =>
  createHash("sha256")
    .update(readFileSync(join(root, p)))
    .digest("hex");

const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

for (const f of [
  "pnpm-lock.yaml",
  "services/python/uv.lock",
  "services/rust/Cargo.lock",
  ".nvmrc",
  "services/python/.python-version",
  "services/rust/rust-toolchain.toml",
]) {
  check(`present:${f}`, existsSync(join(root, f)), f);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { packageManager?: string };
check(
  "pinned:packageManager",
  /^pnpm@\d+\.\d+\.\d+$/.test(pkg.packageManager ?? ""),
  pkg.packageManager ?? "missing",
);

// Every direct dependency in every workspace manifest must be an exact version or workspace link.
for (const manifest of [
  "package.json",
  ...run(["git", "ls-files", "packages/*/package.json"], { cwd: root }).stdout.split("\n").filter(Boolean),
]) {
  const m = JSON.parse(readFileSync(join(root, manifest), "utf8")) as Record<
    string,
    Record<string, string> | undefined
  >;
  for (const section of ["dependencies", "devDependencies"]) {
    for (const [name, spec] of Object.entries(m[section] ?? {})) {
      check(`exact:${manifest}:${name}`, /^(\d+\.\d+\.\d+|workspace:\*)$/.test(spec), spec);
    }
  }
}

const env = { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" };
const pnpm = run(
  // Not --offline: that made the result depend on the local metadata cache (observed flaky).
  [...PNPM, "install", "--frozen-lockfile", "--ignore-scripts", "--lockfile-only"],
  { cwd: root, env },
);
check(
  "pnpm-lock consistent",
  pnpm.exitCode === 0,
  (pnpm.stderr || pnpm.stdout).trim().split("\n").slice(-2).join(" "),
);
const uv = run(["uv", "lock", "--check", "--project", join(root, "services", "python")], { cwd: root });
check(
  "uv.lock consistent",
  uv.exitCode === 0,
  (uv.stderr || uv.stdout).trim().split("\n").slice(-1).join(" "),
);

const summary = {
  lockfiles: {
    "pnpm-lock.yaml": sha("pnpm-lock.yaml"),
    "services/python/uv.lock": sha("services/python/uv.lock"),
    "services/rust/Cargo.lock": sha("services/rust/Cargo.lock"),
  },
  checks,
  ok: checks.every((c) => c.ok),
};
for (const c of checks.filter((x) => !x.ok)) console.error(`LOCKFILE ${c.name}: ${c.detail}`);
console.log(
  JSON.stringify({ check: "lockfiles", total: checks.length, failed: checks.filter((c) => !c.ok).length }),
);
if (jsonOut) {
  mkdirSync(dirname(resolve(jsonOut)), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
}
process.exit(summary.ok ? 0 : 1);
