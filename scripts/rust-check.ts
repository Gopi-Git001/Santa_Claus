/**
 * Authoritative P00 Rust verification: runs inside a pinned official Rust
 * image, never on the host.
 *
 *   node scripts/rust-check.ts [--fresh] [--generate-lockfile] [--json <out>]
 *
 * Container hardening: source mounted read-only; no network; all Linux
 * capabilities dropped; no-new-privileges; read-only root filesystem. Build
 * output and cargo cache live in named Docker volumes (--fresh deletes them
 * first to prove a clean-state build). Nothing else from the host is mounted.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { run } from "./lib/proc.ts";

export const RUST_BASE_IMAGE =
  "rust:1.98.1-slim-trixie@sha256:4cd829461bd5c4d511c32e269da9cb8929223b666519d8004e35fc8d1d771ab7";
/** Local image = pinned base + rustfmt/clippy for the same toolchain (infra/ci/rust.Dockerfile). */
const RUST_IMAGE = "harness-rust-ci:1.98.1";
const VOLUMES = { target: "harness-rust-target", cargo: "harness-rust-cargo-home" };

const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const generateLock = args.includes("--generate-lockfile");
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : undefined;
const src = resolve(join(import.meta.dirname, "..", "services", "rust"));

function docker(dockerArgs: string[]) {
  return run(["docker", ...dockerArgs]);
}

const info = docker(["info", "--format", "{{.ServerVersion}}"]);
if (info.exitCode !== 0) {
  console.error("ENVIRONMENT BLOCKER: Docker is unavailable; mandatory Rust checks cannot run.");
  console.error(info.stderr.trim());
  process.exit(2);
}

if (fresh) {
  for (const v of Object.values(VOLUMES)) docker(["volume", "rm", "-f", v]);
}

// Build (or, with --fresh, rebuild from scratch) the verification image. Only the Dockerfile's
// directory is sent as build context.
const build = docker([
  "build",
  ...(fresh ? ["--no-cache"] : []),
  "-t",
  RUST_IMAGE,
  "-f",
  join(import.meta.dirname, "..", "infra", "ci", "rust.Dockerfile"),
  join(import.meta.dirname, "..", "infra", "ci"),
]);
if (build.exitCode !== 0) {
  console.error(`rust image build failed (exit ${build.exitCode})\n${build.stderr}`);
  process.exit(1);
}
const imageId = docker(["image", "inspect", "--format", "{{.Id}}", RUST_IMAGE]).stdout.trim();

function inContainer(command: string, writableSource = false) {
  return docker([
    "run",
    "--rm",
    "--network",
    "none",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,size=512m",
    "-v",
    `${src}:/src:${writableSource ? "rw" : "ro"}`,
    "-v",
    `${VOLUMES.target}:/cache/target`,
    "-v",
    `${VOLUMES.cargo}:/cache/cargo-home`,
    "-e",
    "CARGO_TARGET_DIR=/cache/target",
    "-e",
    "CARGO_HOME=/cache/cargo-home",
    "-e",
    "RUSTUP_HOME=/usr/local/rustup",
    "-e",
    "PATH=/usr/local/cargo/bin:/usr/bin:/bin",
    "-e",
    "CARGO_TERM_COLOR=never",
    "-w",
    "/src",
    RUST_IMAGE,
    "sh",
    "-c",
    command,
  ]);
}

// Developer write modes (source mounted read-write only here).
if (generateLock || args.includes("--format")) {
  const r = inContainer(generateLock ? "cargo generate-lockfile --offline" : "cargo fmt --all", true);
  process.stdout.write(r.stdout + r.stderr);
  process.exit(r.exitCode);
}

const steps = [
  {
    name: "versions",
    command: "rustc --version && cargo --version && cargo fmt --version && cargo clippy --version",
  },
  { name: "fmt", command: "cargo fmt --all --check" },
  { name: "clippy", command: "cargo clippy --locked --offline --workspace --all-targets -- -D warnings" },
  { name: "test", command: "cargo test --locked --offline --workspace" },
];

const results = steps.map((s) => {
  const r = inContainer(s.command);
  console.log(`== rust ${s.name}: exit ${r.exitCode} (${r.durationMs}ms)`);
  process.stdout.write(r.stdout);
  process.stderr.write(r.stderr);
  return {
    name: s.name,
    command: s.command,
    exit_code: r.exitCode,
    duration_ms: r.durationMs,
    stdout: r.stdout,
    stderr: r.stderr,
  };
});

const summary = {
  base_image: RUST_BASE_IMAGE,
  image: RUST_IMAGE,
  image_id: imageId,
  image_recipe: "infra/ci/rust.Dockerfile (base + rustup component add rustfmt clippy)",
  fresh_build: fresh,
  container_hardening: [
    "--network none",
    "--cap-drop ALL",
    "no-new-privileges",
    "--read-only rootfs",
    "source mounted ro",
  ],
  versions: results[0]?.stdout.trim().split("\n") ?? [],
  steps: results.map(({ stdout: _o, stderr: _e, ...rest }) => rest),
  ok: results.every((r) => r.exit_code === 0),
};
if (jsonOut) {
  mkdirSync(dirname(resolve(jsonOut)), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(summary, null, 2)}\n`);
}
process.exit(summary.ok ? 0 : 1);
