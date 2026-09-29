# ADR-0011: P00 toolchain and environment choices

- Status: Accepted (P00, 2026-09-28)
- Source: P00 spec §6, §7, §27; project-owner decisions recorded 2026-09-28

## Decision
| Concern | Choice | Pin |
|---|---|---|
| Node.js | LTS | `24.18.0` (`.nvmrc`, `engines`) |
| Package manager | pnpm via corepack | `pnpm@12.6.0` (`packageManager`) |
| TypeScript | strict + `erasableSyntaxOnly`; Node runs `.ts` directly (no build step) | `7.0.2` |
| Lint + format | Biome (one tool for both) | `2.5.14` |
| Tests | Vitest, one project per layer (unit/contract/integration/failure/e2e) | `5.0.2` |
| Schemas | zod v4 (+ JSON Schema export) | `4.6.5` |
| PostgreSQL | Docker Compose, loopback-only port, generated git-ignored credentials | `postgres:18.6-trixie@sha256:5a5a84b1…` |
| Python | uv project; ruff, strict mypy, pytest | CPython `3.12.13`, `uv.lock` |
| Rust | **checks run only in Docker** (project-owner decision): `infra/ci/rust.Dockerfile` = `rust:1.98.1-slim-trixie@sha256:4cd82946…` + `rustfmt`/`clippy` for the same toolchain | rustc/cargo `1.98.1`, `Cargo.lock` |

Notes:
- The official Rust images (slim and full) do not include `rustfmt` or `clippy`; the derived image adds exactly those components. Checks then run with `--network none`, `--cap-drop ALL`, `no-new-privileges`, a read-only root filesystem and a read-only source mount; build output lives in named volumes. `--fresh` rebuilds without cache and deletes the volumes to prove a clean-state build.
- `.gitattributes` forces LF line endings so migration checksums and evidence hashes are identical on Windows and Linux.
- All direct dependencies are exact versions; `scripts/check-lockfiles.ts` enforces this and lockfile consistency.
- Git: work is committed on the local branch `p00-foundation`; nothing is pushed (project-owner decision), so hosted CI has not run.
