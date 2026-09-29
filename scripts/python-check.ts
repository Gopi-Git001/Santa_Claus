/**
 * Python baseline gate: frozen sync, ruff lint + format check, strict mypy, pytest.
 *   node scripts/python-check.ts [--json <out>] [--junit <out.xml>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { run } from "./lib/proc.ts";

const args = process.argv.slice(2);
const opt = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const jsonOut = opt("--json");
const junit = opt("--junit");
const project = join(import.meta.dirname, "..", "services", "python");

const steps: Array<{ name: string; argv: string[] }> = [
  { name: "sync", argv: ["uv", "sync", "--frozen", "--project", project] },
  { name: "versions", argv: ["uv", "run", "--frozen", "--project", project, "python", "--version"] },
  { name: "ruff-lint", argv: ["uv", "run", "--frozen", "--project", project, "ruff", "check", project] },
  {
    name: "ruff-format",
    argv: ["uv", "run", "--frozen", "--project", project, "ruff", "format", "--check", project],
  },
  {
    name: "mypy",
    argv: [
      "uv",
      "run",
      "--frozen",
      "--project",
      project,
      "mypy",
      "--config-file",
      join(project, "pyproject.toml"),
    ],
  },
  {
    name: "pytest",
    argv: [
      "uv",
      "run",
      "--frozen",
      "--project",
      project,
      "pytest",
      join(project, "tests"),
      ...(junit ? [`--junitxml=${resolve(junit)}`] : []),
    ],
  },
];

if (junit) mkdirSync(dirname(resolve(junit)), { recursive: true });
const results = steps.map((s) => {
  const r = run(s.argv, { cwd: project });
  console.log(`== python ${s.name}: exit ${r.exitCode} (${r.durationMs}ms)`);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  return {
    name: s.name,
    command: r.command,
    exit_code: r.exitCode,
    duration_ms: r.durationMs,
    output: (r.stdout + r.stderr).trim(),
  };
});
const summary = {
  uv: run(["uv", "--version"]).stdout.trim(),
  python: results.find((r) => r.name === "versions")?.output ?? "",
  steps: results.map(({ output: _o, ...rest }) => rest),
  ok: results.every((r) => r.exit_code === 0),
};
if (jsonOut) {
  mkdirSync(dirname(resolve(jsonOut)), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
}
process.exit(summary.ok ? 0 : 1);
