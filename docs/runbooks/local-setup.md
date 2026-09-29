# Local setup

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | 24.18.0 (`.nvmrc`) | corepack ships with Node; pnpm 12.6.0 is fetched by corepack |
| Docker | Docker Desktop / Engine with Compose v2 | runs PostgreSQL and the Rust checks |
| uv | any recent | installs the pinned CPython 3.12.13 automatically |

No Rust toolchain, Visual Studio Build Tools or PostgreSQL client is needed on the host.

## Bootstrap

```sh
node scripts/bootstrap.ts
```

This (1) checks Node against `.nvmrc`, (2) runs `corepack pnpm install --frozen-lockfile`,
(3) writes a git-ignored `.env` from `.env.example` with a freshly generated database
password (never printed), (4) starts PostgreSQL via `infra/dev/docker-compose.yml`
(loopback port 55432) and waits for health, (5) applies migrations, (6) runs
`uv sync --frozen` for `services/python`.

Options: `--no-db`, `--no-python`, and — only when `.env` is first created —
`--db-port N --compose-project NAME` to run a second isolated checkout.

## Everyday commands

```sh
node scripts/dev-db.ts up | down | destroy     # database lifecycle (destroy deletes the volume)
node --env-file=.env scripts/db-migrate.ts     # apply migrations
node --env-file=.env scripts/smoke.ts          # LangGraph smoke run in an isolated database
corepack pnpm exec vitest run                  # all TS tests
node scripts/python-check.ts                   # Python gate
node scripts/rust-check.ts [--fresh]           # Rust gate (container)
node scripts/rust-check.ts --format            # apply rustfmt (container, writes sources)
```

## Configuration

All configuration is environment variables validated at startup
(`packages/config/src/config.ts`, `ENV_SCHEMA`). Missing or invalid values fail
with `CONFIG_INVALID` naming the variable, never its value. `DATABASE_URL` is a
secret and is held as a `SecretString` that redacts itself everywhere.
