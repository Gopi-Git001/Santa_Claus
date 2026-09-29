# Contributing

Read `CLAUDE.md` (authority order, scope discipline) and the current phase
specification before changing anything. Only the currently authorized phase may
be implemented.

## Workflow

1. Make a small, coherent change with its tests.
2. Run the narrowest tests, then the relevant layers
   (`corepack pnpm exec vitest run --project <layer>`).
3. Run static checks: `corepack pnpm exec tsc --noEmit -p tsconfig.json`,
   `corepack pnpm exec biome check .`, `node scripts/check-boundaries.ts`,
   `node scripts/export-schemas.ts --check`, `node scripts/check-secrets.ts`.
4. Record meaningful decisions as a **new** ADR in `docs/decisions/`.
5. Commit on a branch; never push, merge or force-push shared branches without authorization.

## Rules that CI enforces

- **Dependency direction:** only `@harness/orchestration` may import `@langchain/*`;
  `@harness/contracts` depends on nothing but zod. Update `scripts/lib/boundaries.ts`
  (with reasoning) when adding a package or dependency.
- **Exact versions:** every direct dependency is pinned exactly; lockfiles are committed.
- **Contracts:** changing a contract's shape requires bumping its version and running
  `node scripts/export-schemas.ts` to add a new snapshot; existing snapshots are frozen.
- **Registries:** edit JSON under `specs/`, then run `node scripts/generate-spec-docs.ts`.
  Never invent requirement content; unknown facts stay `null` and become blockers.
  Capability IDs C001–C168 are never renumbered; new ones start at C169.
- **Secrets:** never commit `.env` or secret-shaped literals; build test fixtures at runtime.
- **Tests:** never skip, weaken or delete a legitimate failing test to get green.
