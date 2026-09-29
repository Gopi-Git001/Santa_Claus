# Architecture overview (P00)

P00 builds the foundation only: contracts, persistence, orchestration adapter,
extension boundaries, traceability and the evidence/gate machinery. It does not
build an agent (see P00 spec §2 non-goals).

## Package dependency direction

```text
                      contracts            traceability   observability
                     ▲  ▲  ▲  ▲  ▲
          ┌──────────┘  │  │  │  └───────────┐
       events         kernel  policy  models  capabilities   config   artifacts
          ▲  ▲          ▲
          │  └───────┐  │
     persistence   orchestration  (only package importing @langchain/*)
          ▲             ▲
          └──── testing (composition root) ────┘
```

Rules are enforced by `scripts/check-boundaries.ts` (allow-list per package).
Core contracts depend on nothing but zod — no LangGraph, PostgreSQL client,
web/UI framework or vendor SDK.

## The P00 runtime path

```text
SmokeHarness.startRun ──► harness_runs (CREATED→RUNNING) + run.created event
        │
        ▼
WorkflowRuntime port (@harness/kernel)
        │  implemented by
        ▼
LangGraphSmokeWorkflow (@harness/orchestration)
   initialize_run → record_intent → approval_gate ─┬─► finalize → END
                                                   └─► interrupt_for_human ─(resume)─► finalize
        │ checkpoints                     │ events (causation-chained)
        ▼                                 ▼
PostgreSQL schema harness_checkpoints   public.harness_events
```

- Nodes are deterministic and have no shell/filesystem/network access (tested transitively).
- Checkpoints are written synchronously before each next step (`durability: "sync"`, ADR-0012).
- `approval_gate` records a demo `PolicyDecision`; `interrupt_for_human` pauses durably.
- Resume requires an explicit, validated `HumanResponse` and is authorised against
  the durable thread→run binding (`harness_threads`): wrong run → `THREAD_MISMATCH`,
  unknown thread → `THREAD_NOT_FOUND`, nothing pending → `GRAPH_NOT_INTERRUPTED`.
- The final state is stored as an artifact (SHA-256, provenance) with an
  `artifact.created` event; the run ends `COMPLETED`, `FAILED` or `UNKNOWN`.

## Store separation

See ADR-0004. Graph checkpoints, harness system-of-record tables, the (future)
cross-thread memory store and artifact blobs are four separate stores.

## Extension boundaries (contracts only)

| Concern | Contract | Implementation phase |
|---|---|---|
| Model gateway | `ModelAdapter`, `ModelRegistry`, request/response/stream/usage/error | P03 |
| Tools | `CapabilityDescriptor`, `ToolRequest/Result/Error`, `CapabilityRegistry` (harmless tools only) | P05 |
| Authority | `PolicyEvaluator`, `resolveAuthority`, `failClosed` | P06 |
| Skills / plugins / hooks / MCP / A2A | manifests, hook points, `mcpDiscoveryToCandidate` (always untrusted, unauthorised) | P13 |
| Agent scaling | `ScalingDecisionInput`, `ScalingDecision`, `ScalingPolicy`, `scalingViolations` | P10/P11/P16 |

## Languages

TypeScript control plane; Python (`services/python`) and Rust
(`services/rust`) skeletons consume versioned portable contracts from
`specs/schemas/` (ADR-0003).
