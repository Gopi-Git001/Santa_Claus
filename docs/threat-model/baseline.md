# Threat model baseline (P00)

Scope: the P00 foundation. P00 does not solve every threat; it records the
threat, what P00 does, and which later phase owns full mitigation, and it makes
sure nothing in P00 prevents that mitigation (P00 spec §23). Phase ownership
below follows the phase purposes in `MASTER_PROJECT_WORKFLOW.md` §20.

## Assets and trust boundaries

Assets: run/graph state, the event log (audit truth), artifacts and evidence,
credentials (database URL), human approval decisions, the capability ledger and
phase gate. Trust levels: `trusted` (harness code/config), `harness`,
`user`, `untrusted` (model output, repository/external content, tool/MCP/plugin/
A2A content, other-agent output). Untrusted never becomes trusted implicitly (INV-013).

## Threats

| # | Threat | P00 controls (with tests) | Residual / owner |
|---|---|---|---|
| T1 | **Untrusted model output** executing actions | Models only return `ToolCallProposal` data; `ModelAdapter` has no execution method; proposals become `ProposedAction` that policy must evaluate; unknown authority fails closed (`extension-contracts.test.ts`) | Policy engine P06; context compiler P04 |
| T2 | **Untrusted user/project content** | Strict schemas reject unknown fields; all record input validated at write and read | Content trust labelling end-to-end P04/P06 |
| T3 | **Prompt injection** | Authority is outside prompts (INV-004): scopes, allowed/denied capabilities are structured data; human approval is a typed response, not text; MCP descriptions cannot grant trust (tested with an injection string) | Injection defences in context/runtime P04/P08 |
| T4 | **Malicious extension metadata** | Skill/plugin/hook/A2A manifests are strict (unknown keys rejected, e.g. `run_on_install`); discovery → `untrusted`, `authorized: false`; P00 registry refuses side-effecting capabilities | Signature verification and plugin trust P13 |
| T5 | **Secret leakage** | `SecretString` (redacts on string/JSON/inspect); typed `SecretRef` instead of raw values in agent specs; generated git-ignored `.env`; verifier scans evidence for the real DB password; DB errors never carry the URL | Secret provider/vault P06/P18 |
| T6 | **Unsafe logging** | Every log line passes through `redact` (sensitive keys + token/URL/PEM/JWT patterns); fixture proves it (F12) | Log pipeline hardening P18 |
| T7 | **Dependency / supply chain** | Exact pins + lockfiles for pnpm/uv/cargo, frozen installs, digest-pinned images, SHA-pinned CI actions, read-only CI token, pnpm lockfile policy checks, Rust checks offline in a hardened container | SBOM/provenance/vulnerability scanning P18 |
| T8 | **Privilege confusion harness ↔ workers** | Smoke graph has no shell/fs/network/process access (static audit); only orchestration imports LangGraph; Rust container runs with no network, no capabilities, read-only FS | Sandbox/execution fabric P07 |
| T9 | **Trace/evidence tampering** | Run manifest (SHA-256 per file, must cover every machine-evidence file) re-hashed by the verifier; sealed `final-manifest.json` re-checkable with `verify.ts --check-seal`; evidence bound to one git commit; `harness_events` append-only enforced by DB triggers (a privileged operator can still disable them — tested that tampering is then detected on read); artifacts content-addressed, hash-verified on read (F10) and re-verified before deduplication | Signed/immutable audit storage P18 |
| T10 | **ID / tenant / thread confusion** | Typed opaque IDs per kind (a RunId never validates as a ThreadId); durable thread→run binding checked on every resume (`THREAD_MISMATCH`/`THREAD_NOT_FOUND`); IDs validated before use as paths | Multi-tenant isolation P16/P18 |

## Known P00 gaps (accepted)

- No authentication/authorization of *callers* exists yet (no API in P00).
- The development database uses a password in a local `.env`; acceptable for a
  loopback-only dev container, not for deployment.
- Pattern-based redaction cannot catch every secret format; typed secret handling
  is the primary control.
