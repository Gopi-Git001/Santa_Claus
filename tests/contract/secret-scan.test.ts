import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * The committed-secret scan must actually fail when a secret-shaped literal or
 * a .env file is committed. We plant them in a throwaway git repo and point the
 * real scanner at it with --root.
 */
const root = join(import.meta.dirname, "..", "..");
const scanner = join(root, "scripts", "check-secrets.ts");

function git(cwd: string, ...args: string[]) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
}

function scan(files: Record<string, string>): { status: number | null; out: string } {
  const repo = mkdtempSync(join(tmpdir(), "harness-secret-scan-"));
  git(repo, "init", "-q");
  for (const [name, content] of Object.entries(files)) writeFileSync(join(repo, name), content);
  git(repo, "add", "-A");
  const r = spawnSync(process.execPath, [scanner, "--root", repo], { cwd: root, encoding: "utf8" });
  return { status: r.status, out: r.stdout + r.stderr };
}

describe("committed-secret scan", () => {
  it("passes on the real repository", () => {
    const r = spawnSync(process.execPath, [scanner], { cwd: root, encoding: "utf8" });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });

  it("fails on a committed token literal and on a committed .env file", () => {
    const token = ["gh", "p_", "Q".repeat(36)].join("");
    const pw = ["super", "secret", "value"].join("");
    const r = scan({ "a.ts": `const t = "${token}";\nconst password = "${pw}";\n`, ".env": "X=1\n" });
    expect(r.status).toBe(1);
    expect(r.out).toContain("github-token");
    expect(r.out).toContain("secret-literal-assignment");
    expect(r.out).toContain("forbidden-file");
  });

  it("catches keyword-suffixed keys and secrets sharing a line with a redaction marker", () => {
    const pw = ["another", "secret", "value"].join("");
    const r = scan({
      "b.ts": [
        `const HARNESS_DB_PASSWORD = "${pw}";`,
        `const cfg = { clientSecret: "${pw}" };`,
        `log("[REDACTED]"); const api_token = "${pw}";`,
      ].join("\n"),
    });
    expect(r.status).toBe(1);
    expect(r.out.match(/secret-literal-assignment/g)).toHaveLength(3);
  });

  it("does not flag ordinary code", () => {
    const r = scan({
      "c.ts": "const secret = { required: true, secret: false };\nconst max_tokens = 100;\n",
    });
    expect(r.status, r.out).toBe(0);
  });
});
