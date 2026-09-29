/**
 * Committed-secret scan (P00 spec §27 "committed secret fixtures"). Scans every
 * git-tracked file (plus staged/untracked non-ignored files) with the same
 * value patterns the redactor uses, and fails on any match. Test fixtures must
 * assemble secret-shaped values at runtime instead of committing literals.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SECRET_VALUE_PATTERNS } from "@harness/observability";
import { run } from "./lib/proc.ts";

// --root lets tests point the real scanner at a throwaway repository.
const rootArg = process.argv.indexOf("--root");
const root = rootArg >= 0 ? String(process.argv[rootArg + 1]) : join(import.meta.dirname, "..");
const listed = run(["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"], { cwd: root });
if (listed.exitCode !== 0) {
  console.error(listed.stderr);
  process.exit(2);
}
const files = listed.stdout.split("\0").filter((f) => f !== "" && !/\.(png|jpg|gz)$/.test(f));

// Files whose job is to define/describe the patterns themselves.
const PATTERN_DEFINITIONS = new Set(["packages/observability/src/redact.ts"]);
// A committed .env file is always a finding, whatever it contains.
const FORBIDDEN_FILES = [/(^|\/)\.env$/, /(^|\/)\.env\.(?!example$)[^/]+$/, /\.pem$/, /id_(rsa|ed25519)$/];

/*
 * The log redactor's `key=value` rule is intentionally aggressive (it masks any
 * value after `password=`), which on source code matches ordinary syntax such as
 * `secret: false`. For committed files we use every high-confidence token
 * pattern unchanged, plus a stricter literal rule: a secret-named key assigned a
 * quoted literal of 8+ characters.
 */
const SCAN_PATTERNS = [
  ...SECRET_VALUE_PATTERNS.filter((p) => p.name !== "key-value-assignment"),
  {
    name: "secret-literal-assignment",
    pattern: /\b[A-Za-z0-9_]*?(password|passwd|secret|token|api[-_]?key)["']?\s*[=:]\s*["'][^"'\s$]{8,}["']/i,
  },
];

const findings: Array<{ file: string; pattern: string; line: number }> = [];
for (const file of files) {
  if (FORBIDDEN_FILES.some((re) => re.test(file))) {
    findings.push({ file, pattern: "forbidden-file", line: 0 });
    continue;
  }
  if (PATTERN_DEFINITIONS.has(file)) continue;
  let text: string;
  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    continue; // deleted in working tree
  }
  const lines = text.split("\n");
  for (const { name, pattern } of SCAN_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags.replace("g", ""));
    lines.forEach((l, i) => {
      // Only the matched text itself is exempt when it is a template placeholder (`${...}`)
      // or an already-redacted marker; a real secret elsewhere on the line is still reported.
      const m = re.exec(l);
      if (m !== null && !/\$\{[^}]+\}|\[REDACTED\]/.test(m[0]))
        findings.push({ file, pattern: name, line: i + 1 });
    });
  }
}

for (const f of findings) console.error(`SECRET? ${f.file}:${f.line} (${f.pattern})`);
console.log(
  JSON.stringify({ check: "committed-secrets", files_scanned: files.length, findings: findings.length }),
);
process.exit(findings.length === 0 ? 0 : 1);
