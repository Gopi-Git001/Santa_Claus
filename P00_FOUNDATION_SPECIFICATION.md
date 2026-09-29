# P00 --- Foundation Specification and Initial Setup

**Document:** `P00_FOUNDATION_SPECIFICATION.md`\
**Version:** 1.0\
**Phase:** P00 of P00--P18\
**Purpose:** Establish the non-negotiable engineering foundation before
feature implementation begins.

------------------------------------------------------------------------

## 1. P00 Objective

P00 creates the project skeleton and proves that the architecture can be
built safely and incrementally.

P00 does **not** build the full agent. It establishes the contracts,
repository, development environment, traceability, LangGraph.js
foundation, PostgreSQL persistence baseline, extension boundaries,
test/evidence framework, and phase-gate machinery that every later phase
must use.

P00 succeeds when the project can prove:

> "We have a reproducible repository in which a minimal LangGraph.js
> workflow can execute, persist/resume state through the selected
> development persistence path, emit structured events/evidence, satisfy
> typed contracts, pass CI, and be traced to explicit requirements
> without granting the model uncontrolled authority."

------------------------------------------------------------------------

## 2. P00 Non-Goals

Do not implement these production capabilities in P00:

-   production model router;
-   autonomous planning;
-   multi-agent orchestration;
-   hundreds-of-agent execution;
-   production sandbox;
-   full capability/tool catalog;
-   MCP server/client behavior;
-   plugin marketplace;
-   skills runtime;
-   A2A federation;
-   browser/computer use;
-   voice/realtime;
-   persistent background missions;
-   full memory system;
-   self-improvement;
-   production Mission Control.

P00 **defines interfaces/extension points** for these when necessary to
prevent later rewrites.

------------------------------------------------------------------------

## 3. Decisions Frozen by P00

1.  Greenfield project.
2.  Model-agnostic architecture.
3.  LangGraph.js/TypeScript is the primary orchestration runtime.
4.  Open-source LangGraph core/library is used; hosted
    LangChain/LangSmith infrastructure is not required for correctness.
5.  TypeScript owns the control plane.
6.  Python owns ML/data-heavy extensions by default.
7.  Rust owns security/performance-sensitive native components by
    default.
8.  PostgreSQL is the production durable database baseline.
9.  Object/artifact storage is abstracted.
10. Vector/search infrastructure is optional and replaceable.
11. Human authority is mandatory for policy-defined consequential
    actions.
12. Agent instances scale dynamically; hundreds of agents are capacity,
    not prebuilt bots.
13. The model never directly owns permissions, secrets, sandboxing,
    verification, or durable truth.
14. Every mandatory requirement is traceable to implementation, tests,
    and evidence.

------------------------------------------------------------------------

## 4. Why LangGraph.js

LangGraph.js is used because the harness needs low-level control over
long-running, stateful workflows rather than a fixed high-level agent
loop.

P00 will prove only the minimum orchestration primitives required for
future phases:

-   typed graph state;
-   deterministic nodes;
-   resumable execution;
-   checkpoint/thread identity;
-   interrupt/resume path;
-   streaming/event observation;
-   subgraph compatibility boundary.

The harness wraps LangGraph behind our own interfaces. Business/security
contracts must not import LangGraph internals outside the orchestration
adapter package.

------------------------------------------------------------------------

## 5. Repository Architecture

Create a monorepo with strict package boundaries.

``` text
/
├── apps/
│   ├── api/                    # future public/control API
│   └── mission-control/        # future human UI shell
│
├── packages/
│   ├── contracts/              # shared schemas/types; no framework coupling
│   ├── kernel/                 # harness lifecycle interfaces
│   ├── orchestration/          # LangGraph adapter + graph primitives
│   ├── persistence/            # PostgreSQL and storage interfaces
│   ├── events/                 # event envelope/contracts
│   ├── policy/                 # authority interfaces only in P00
│   ├── models/                 # model gateway contracts only in P00
│   ├── capabilities/           # tool/capability contracts only in P00
│   ├── artifacts/              # artifact/evidence interfaces
│   ├── observability/          # logging/trace contracts
│   ├── testing/                # shared fixtures/harness
│   └── config/                 # typed configuration
│
├── services/
│   ├── python/                 # Python service/workers skeleton
│   └── rust/                   # Rust native/runtime skeleton
│
├── specs/
│   ├── capabilities/           # C001–C168 ledger
│   ├── invariants/             # architectural invariants
│   ├── phases/                 # P00–P18 specs
│   └── schemas/                # portable contract schemas
│
├── evidence/
│   ├── P00/
│   └── README.md
│
├── tests/
│   ├── contract/
│   ├── integration/
│   ├── failure/
│   └── e2e/
│
├── docs/
│   ├── architecture/
│   ├── decisions/              # ADRs
│   ├── runbooks/
│   └── threat-model/
│
├── scripts/
├── infra/
│   ├── dev/
│   └── ci/
│
└── .github/workflows/          # or equivalent CI provider
```

Exact tooling may refine folder names, but ownership boundaries must
remain clear.

------------------------------------------------------------------------

## 6. Workspace and Toolchain

### TypeScript

Required:

-   current supported Node.js LTS selected and pinned;
-   package manager selected and pinned;
-   TypeScript strict mode;
-   workspace/monorepo configuration;
-   formatter;
-   linter;
-   unit/integration test runner;
-   schema validation library;
-   LangGraph.js dependency pinned through lockfile.

### Python

Required:

-   supported Python version pinned;
-   isolated dependency/project configuration;
-   formatter/linter/type checker;
-   test runner;
-   no production ML framework required yet.

### Rust

Required:

-   stable Rust toolchain pinned;
-   workspace/crate skeleton;
-   formatting/lint/test commands;
-   no sandbox implementation yet.

### Reproducibility

Repository must record:

-   runtime/tool versions;
-   lockfiles;
-   deterministic install commands;
-   environment variable schema;
-   local bootstrap command;
-   CI bootstrap command.

------------------------------------------------------------------------

## 7. Local Development Infrastructure

P00 local stack should include only what is required to prove
foundations.

### Mandatory

-   PostgreSQL;
-   a local artifact/object-storage implementation or filesystem-backed
    adapter;
-   application services required for P00 smoke/integration tests.

### Optional at P00

-   S3-compatible development service if it improves artifact-contract
    testing;
-   PostgreSQL extensions needed for future search experiments.

### Not mandatory

-   dedicated vector database;
-   Redis;
-   Kafka;
-   Kubernetes;
-   service mesh;
-   GPU cluster.

Do not add infrastructure without a P00 requirement.

------------------------------------------------------------------------

## 8. Core IDs

Define opaque, validated IDs from the beginning:

-   `RunId`
-   `ThreadId`
-   `AgentId`
-   `TaskId`
-   `EventId`
-   `ArtifactId`
-   `ApprovalId`
-   `CapabilityId`
-   `ModelId`
-   `EvidenceId`
-   `TraceId`

IDs must not encode secrets or mutable business meaning.

------------------------------------------------------------------------

## 9. Minimum Core Contracts

P00 must create typed/versioned contracts for:

### Run

``` text
Run
- id
- root_goal
- status
- created_at
- updated_at
- policy_profile
- budget_profile
- root_thread_id
- metadata
```

### AgentSpec

``` text
AgentSpec
- agent_id
- run_id
- parent_agent_id?
- role
- objective
- success_criteria[]
- model_policy
- context_policy
- allowed_capabilities[]
- denied_capabilities[]
- workspace_scope
- network_scope
- secret_scope
- memory_scope
- budget
- delegation_policy
- approval_policy
- verification_policy
- lifecycle_policy
```

### Task

``` text
Task
- id
- run_id
- owner_agent_id?
- objective
- dependencies[]
- status
- priority
- success_criteria[]
- budget
- verification_policy
```

### EventEnvelope

``` text
EventEnvelope
- event_id
- schema_version
- event_type
- timestamp
- run_id
- thread_id?
- agent_id?
- task_id?
- trace_id
- causation_id?
- correlation_id?
- payload
```

### ArtifactRecord

``` text
ArtifactRecord
- artifact_id
- run_id
- producer
- media_type
- content_hash
- storage_ref
- created_at
- provenance
- verification_status
```

### ProposedAction

``` text
ProposedAction
- actor
- capability
- operation
- arguments
- target
- risk_context
- estimated_budget
```

### PolicyDecision

``` text
PolicyDecision
- decision: AUTO_ALLOW | ASK_HUMAN | DENY
- reason_code
- policy_version
- constraints
```

These are contracts only; later phases implement full behavior.

------------------------------------------------------------------------

## 10. Architectural Invariants

Create machine-readable invariant IDs and human-readable explanations.

Minimum baseline:

-   `INV-001` Models cannot directly execute external side effects.
-   `INV-002` Tool execution must pass through the capability gateway.
-   `INV-003` Consequential actions require policy evaluation.
-   `INV-004` Permissions are enforced outside prompts.
-   `INV-005` Every agent has finite resource limits.
-   `INV-006` Every child agent belongs to a root run and parent
    lineage.
-   `INV-007` Important state-changing operations emit durable events.
-   `INV-008` Artifacts carry provenance and integrity hashes.
-   `INV-009` Completion follows verification policy.
-   `INV-010` Secrets do not enter ordinary prompt context.
-   `INV-011` Cancellation must eventually propagate to owned execution.
-   `INV-012` Unknown execution outcome is not automatically treated as
    failure.
-   `INV-013` Untrusted content cannot become trusted instruction
    implicitly.
-   `INV-014` Self-improvement cannot silently rewrite security
    authority.
-   `INV-015` Human denial overrides agent intent.
-   `INV-016` Model implementations are replaceable behind contracts.
-   `INV-017` No agent receives unrestricted system access by default.
-   `INV-018` Autonomous actions are auditable.
-   `INV-019` Context fragments have provenance.
-   `INV-020` Unknown authority/state fails safely.

P00 tests the invariants that are applicable to P00 contracts and
prevents later code from bypassing the intended boundaries.

------------------------------------------------------------------------

## 11. Capability Ledger C001--C168

Create a machine-readable ledger plus generated Markdown view.

Every capability record must include:

``` text
id
title
description
domain
owning_phase
dependencies[]
status
mandatory
implementation_refs[]
test_refs[]
security_refs[]
evidence_refs[]
notes
```

P00 acceptance requires:

-   168 unique IDs;
-   no duplicate IDs;
-   all assigned to one primary architectural domain;
-   all assigned to an owning phase;
-   dependencies reference valid IDs;
-   no impossible dependency cycles in mandatory phase ordering;
-   every P00-owned requirement has planned tests and evidence.

The ledger is the source of truth. Human-readable tables are generated
from it.

------------------------------------------------------------------------

## 12. Phase Registry P00--P18

Create a machine-readable phase registry containing:

-   phase ID;
-   purpose;
-   prerequisites;
-   owned capability IDs;
-   entry criteria;
-   exit criteria;
-   evidence requirements;
-   status.

CI must validate that every capability points to a valid phase.

------------------------------------------------------------------------

## 13. Architecture Decision Records

P00 creates ADRs for at least:

1.  LangGraph.js as orchestration runtime.
2.  LangGraph wrapped behind harness interfaces.
3.  TypeScript/Python/Rust responsibility split.
4.  PostgreSQL durable baseline.
5.  artifact/object-storage abstraction.
6.  optional vector/search strategy.
7.  dynamic agent instantiation vs predefined agent pool.
8.  human-authority policy model.
9.  event-envelope/versioning strategy.
10. requirement/evidence traceability.

Future changes require new ADRs rather than silently rewriting history.

------------------------------------------------------------------------

## 14. LangGraph.js P00 Smoke Graph

Implement a deliberately small graph, not an autonomous agent.

Suggested flow:

``` text
START
  |
  v
initialize_run
  |
  v
record_intent
  |
  v
approval_demo?
  | yes
  v
interrupt_for_human
  |
  v
finalize
  |
  v
END
```

Requirements:

-   typed state;
-   deterministic nodes only;
-   unique thread ID;
-   persistence adapter;
-   streaming observation;
-   optional interrupt/resume demonstration;
-   structured events emitted into harness event interface;
-   no shell/filesystem/network side effects.

This proves LangGraph integration without prematurely implementing agent
autonomy.

------------------------------------------------------------------------

## 15. Persistence Foundation

### PostgreSQL

P00 must provide:

-   development database bootstrap;
-   migrations;
-   connection health check;
-   test database lifecycle;
-   transaction helper;
-   repository interfaces;
-   schema/version tracking.

### LangGraph persistence

Provide a harness-owned persistence adapter boundary.

P00 test scenarios:

1.  start graph;
2.  create checkpoint/state;
3.  terminate/recreate application process or graph runtime where
    practical;
4.  resume using the same thread identity;
5.  verify expected state;
6.  prove a different thread cannot accidentally resume the first
    thread.

### Store separation

Explicitly distinguish:

-   graph/thread checkpoint state;
-   cross-thread application memory/store;
-   harness system-of-record records;
-   artifacts/blobs.

Do not collapse them into one conceptual "memory" bucket.

------------------------------------------------------------------------

## 16. Artifact and Evidence Foundation

P00 creates:

``` text
ArtifactStore
- put
- get
- exists
- metadata
- verify_hash
```

and an evidence convention:

``` text
evidence/P00/
├── environment.json
├── dependency-lock-summary.json
├── typecheck.txt
├── lint.txt
├── unit-tests.xml/json
├── contract-tests.xml/json
├── integration-tests.xml/json
├── langgraph-smoke.json
├── persistence-resume.json
├── failure-tests.json
├── traceability-audit.json
└── P00-REPORT.md
```

Evidence must be machine-readable where practical and summarized for
humans.

------------------------------------------------------------------------

## 17. Event Foundation

Define versioned event names without implementing the full event bus.

Minimum P00 event families:

``` text
run.created
run.status_changed
graph.started
graph.node_started
graph.node_completed
graph.interrupted
graph.resumed
graph.failed
graph.completed
artifact.created
policy.decision_recorded
test.evidence_recorded
```

Events must support causation/correlation so later distributed execution
can reconstruct causal chains.

------------------------------------------------------------------------

## 18. Model Gateway Foundation

P00 defines interfaces only.

Minimum concepts:

``` text
ModelCapabilities
ModelRequest
ModelResponse
ModelStreamEvent
ModelUsage
ModelError
ModelAdapter
ModelRegistry
```

A deterministic fake model adapter may be used for contract tests.

Do not integrate multiple production LLMs in P00; that belongs to P03.

------------------------------------------------------------------------

## 19. Capability/Tool Foundation

P00 defines:

``` text
CapabilityDescriptor
ToolSchema
ToolRequest
ToolResult
ToolError
CapabilityRegistry
```

Every future tool must declare:

-   stable ID/version;
-   description;
-   typed input;
-   typed output;
-   required permissions;
-   side-effect class;
-   timeout/cancellation behavior;
-   audit/evidence behavior.

P00 may include a harmless deterministic test capability such as `echo`
to prove the schema/registry boundary, but it must not grant general
shell/filesystem access.

------------------------------------------------------------------------

## 20. Skills, MCP, Plugins, Hooks, A2A Foundations

P00 does not implement these systems. It reserves explicit extension
contracts.

### Skill manifest contract

Metadata for ID, version, purpose, required capabilities, references,
trust/source, and compatibility.

### MCP boundary

Define where future MCP-discovered tools/resources/prompts enter the
capability/trust pipeline. Discovery must never imply authorization.

### Plugin manifest

Define package identity, version, provided extensions, dependencies,
required permissions, compatibility, and signature/trust metadata.

### Hook contract

Reserve deterministic lifecycle interception points such as:

`before_model`, `after_model`, `before_tool`, `after_tool`,
`agent_spawned`, `task_completed`, `approval_requested`, `error`,
`checkpoint`.

### A2A boundary

Reserve remote-agent identity, capability advertisement, authentication,
message envelope, trust, and artifact-reference concepts.

Implementation belongs primarily to P13.

------------------------------------------------------------------------

## 21. Configuration

All configuration must be typed and validated at startup.

Categories:

-   environment;
-   database;
-   artifact storage;
-   logging;
-   LangGraph;
-   feature flags;
-   development/test limits;
-   future model/capability placeholders.

Rules:

-   no secret values committed;
-   missing required configuration fails clearly;
-   configuration source is logged without secret contents;
-   configuration schema has a version.

------------------------------------------------------------------------

## 22. Secrets Baseline

P00 establishes the rule and interface, not a full secret-management
platform.

Requirements:

-   secrets supplied through approved environment/secret provider;
-   never written to evidence;
-   logging redaction utility;
-   typed secret references rather than passing raw secrets through
    agent state where possible;
-   test fixture proving known secret patterns are redacted.

------------------------------------------------------------------------

## 23. Security Baseline

P00 threat model must cover at least:

-   untrusted model output;
-   untrusted user/project content;
-   prompt injection;
-   malicious extension metadata;
-   secret leakage;
-   unsafe logging;
-   dependency/supply-chain risk;
-   privilege confusion between harness and future workers;
-   trace/evidence tampering;
-   ID/tenant/thread confusion.

P00 does not solve all threats; it records ownership by later phases and
ensures no P00 architecture makes them impossible to solve.

------------------------------------------------------------------------

## 24. Testing Infrastructure

Create distinct test layers.

### Unit

Pure functions, schemas, IDs, state reducers, configuration, redaction.

### Contract

Cross-package schemas and adapters; serialization/deserialization;
version compatibility.

### Integration

PostgreSQL, artifact adapter, LangGraph checkpointer, event recording.

### Failure

Database unavailable, invalid config, corrupted/invalid payload,
duplicate IDs, resume with wrong thread, interrupted graph, storage
failure.

### End-to-End P00

Bootstrap repository -\> start dependencies -\> run smoke graph -\>
persist -\> resume -\> emit evidence -\> traceability audit -\> clean
shutdown.

Mocks cannot be the only evidence for persistence/resume.

------------------------------------------------------------------------

## 25. How We Know P00 Actually Works

P00 uses an acceptance ladder:

``` text
install/bootstrap
    |
typecheck
    |
lint
    |
unit tests
    |
contract tests
    |
integration tests
    |
real PostgreSQL persistence test
    |
LangGraph interrupt/resume test
    |
failure injection
    |
traceability audit
    |
fresh-environment reproduction
    |
independent P00 verification script
    |
P00 evidence report
```

A single green test command is insufficient. The final verifier checks
expected evidence files, exit codes, capability mappings, and runtime
assertions.

------------------------------------------------------------------------

## 26. Debugging Requirements

P00 must make failures diagnosable.

Every smoke run records:

-   run ID;
-   thread ID;
-   graph/node;
-   timestamps;
-   event sequence;
-   correlation/causation;
-   persistence operations;
-   interrupt/resume;
-   final state;
-   error classification.

Logs must be structured and redact secrets.

A developer should be able to answer: "Which node failed, with which
run/thread, after which event, and was state persisted?"

------------------------------------------------------------------------

## 27. CI Pipeline

Minimum CI jobs:

``` text
validate-lockfiles
validate-spec-ledger
typecheck-ts
lint-ts
test-ts
lint-type-test-python
fmt-clippy-test-rust
contract-tests
integration-postgres
langgraph-smoke
persistence-resume
security-baseline
traceability-audit
evidence-manifest
```

CI should fail on:

-   unmapped P00 requirements;
-   invalid capability IDs;
-   schema drift without version change;
-   forbidden dependency direction;
-   committed secret fixtures;
-   failed real persistence/resume test;
-   missing mandatory evidence.

------------------------------------------------------------------------

## 28. Dependency Direction Rules

Example allowed direction:

``` text
contracts
   ^
   |
kernel <- orchestration
   ^         ^
   |         |
events   persistence
```

Framework-specific packages may depend on core contracts. Core contracts
must not depend on LangGraph, PostgreSQL clients, web frameworks, UI
frameworks, or vendor SDKs.

Add automated dependency-boundary checks.

------------------------------------------------------------------------

## 29. Dynamic Agent Scaling Contract

P00 does not scale agents yet, but it must define the future control
contract.

``` text
ScalingDecisionInput
- runnable_tasks
- dependency_state
- global_limits
- run_limits
- model_limits
- execution_limits
- budget_remaining
- risk_constraints
- workspace_conflicts
- priority

ScalingDecision
- desired_new_agents
- roles/templates
- task_assignments
- defer/reject reasons
```

No requirement may assume a fixed number of agents.

Later P10/P11/P16 implement the planner, agent factory, scheduler,
distributed leases, and high-concurrency proof.

------------------------------------------------------------------------

## 30. P00 Performance Baseline

P00 is not a scale benchmark, but record reproducible baseline metrics:

-   bootstrap time;
-   graph invocation latency excluding external LLMs;
-   checkpoint write/read latency in development;
-   event write latency;
-   artifact put/get for small fixture;
-   memory/process footprint of smoke service.

These become regression references, not production SLOs.

------------------------------------------------------------------------

## 31. Documentation Required in P00

P00 must leave:

-   root README;
-   architecture overview;
-   local setup guide;
-   testing guide;
-   debugging guide;
-   evidence guide;
-   contribution guide;
-   ADR index;
-   threat-model baseline;
-   capability ledger documentation;
-   phase registry;
-   P00 report.

A new engineer must be able to bootstrap and reproduce P00 without
undocumented tribal knowledge.

------------------------------------------------------------------------

## 32. Implementation Sequence

Execute P00 in this order.

### P00.1 --- Repository/bootstrap

Create monorepo, language skeletons, version pins, lockfiles, local
bootstrap.

### P00.2 --- Contracts

Implement IDs, schemas, event envelopes, core records, versioning.

### P00.3 --- Traceability

Create C001--C168 ledger, phase registry, invariant registry,
validators.

### P00.4 --- PostgreSQL foundation

Local database, migrations, repositories, test lifecycle.

### P00.5 --- Artifact/evidence foundation

Artifact adapter, hashing, evidence manifest.

### P00.6 --- LangGraph adapter

Create orchestration boundary and deterministic smoke graph.

### P00.7 --- Persistence/resume

Connect durable checkpoint path and prove thread resume/isolation.

### P00.8 --- Human-interrupt demonstration

Demonstrate interrupt -\> persisted state -\> resume with explicit
response.

### P00.9 --- Extension contracts

Model, capability/tool, skill, MCP, plugin, hook, A2A
placeholders/contracts.

### P00.10 --- Observability/security baseline

Structured logs, redaction, trace IDs, threat model.

### P00.11 --- Test/failure suite

Run real integration/failure/recovery cases.

### P00.12 --- CI and independent gate

Automate all checks and generate evidence.

### P00.13 --- P00 audit

Verify exit criteria, document known limitations, freeze evidence, hand
off to P01.

------------------------------------------------------------------------

## 33. P00 Failure Scenarios to Test

At minimum:

1.  invalid configuration;
2.  PostgreSQL unavailable at startup;
3.  database disconnect during test workflow;
4.  invalid/corrupted event payload;
5.  duplicate capability ID;
6.  invalid capability dependency;
7.  invalid phase reference;
8.  wrong thread ID on resume;
9.  interrupted graph not resumed;
10. artifact hash mismatch;
11. artifact storage unavailable;
12. secret-like value passed to logger;
13. unsupported schema version;
14. forced node failure followed by controlled graph error;
15. process restart followed by persisted-state verification.

Each failure must have expected error classification and evidence.

------------------------------------------------------------------------

## 34. P00 Acceptance Gate

P00 is complete only when all mandatory conditions pass.

### Architecture

-   [ ] 16 domains documented.
-   [ ] P00--P18 registry valid.
-   [ ] architectural invariants registered.
-   [ ] dependency-direction rules enforced.

### Requirements

-   [ ] C001--C168 unique.
-   [ ] 168/168 assigned to domains.
-   [ ] 168/168 assigned to owning phases.
-   [ ] all dependency references valid.
-   [ ] P00-owned requirements have test/evidence mappings.

### Toolchain

-   [ ] clean bootstrap succeeds.
-   [ ] TypeScript strict checks pass.
-   [ ] Python baseline checks pass.
-   [ ] Rust baseline checks pass.

### Runtime

-   [ ] LangGraph.js smoke graph executes.
-   [ ] streaming/event observation works.
-   [ ] durable checkpoint path works.
-   [ ] process/runtime restart-resume proof passes.
-   [ ] interrupt/resume proof passes.
-   [ ] thread isolation proof passes.

### Persistence/artifacts

-   [ ] PostgreSQL migrations are reproducible.
-   [ ] artifact put/get/hash verification passes.
-   [ ] evidence manifest validates.

### Security/quality

-   [ ] configuration validation passes.
-   [ ] secret-redaction fixture passes.
-   [ ] failure suite passes.
-   [ ] no general shell/network authority exists in P00 smoke graph.
-   [ ] dependency boundary audit passes.

### CI/evidence

-   [ ] all mandatory CI jobs green.
-   [ ] P00 evidence directory complete.
-   [ ] independent verifier returns success.
-   [ ] `P00-REPORT.md` records exact commands, versions, results,
    failures, limitations.
-   [ ] no unexplained skipped mandatory tests.

Only then set P00 status to `VERIFIED`.

------------------------------------------------------------------------

## 35. P00 Exit Artifacts

Expected deliverables:

``` text
MASTER_PROJECT_WORKFLOW.md
P00_FOUNDATION_SPECIFICATION.md

specs/capabilities/*
specs/invariants/*
specs/phases/*
docs/architecture/*
docs/decisions/*
docs/threat-model/*
packages/contracts/*
packages/orchestration/*
packages/persistence/*
packages/events/*
packages/artifacts/*
packages/testing/*
services/python/*
services/rust/*
infra/dev/*
evidence/P00/*
```

------------------------------------------------------------------------

## 36. Handoff to P01

P01 may begin only after P00 is `VERIFIED`.

P01 will build the **Harness Kernel** on top of the contracts and
evidence discipline established here. It must not bypass P00's event,
traceability, configuration, persistence, or authority boundaries.

If P01 reveals that a P00 contract is inadequate, update the
specification through a versioned ADR/migration rather than silently
changing the foundation.

------------------------------------------------------------------------

## 37. P00 Definition of Success

P00 is successful when a fresh developer/CI environment can:

``` text
clone
  -> bootstrap
  -> start PostgreSQL
  -> validate C001–C168
  -> run strict checks
  -> execute LangGraph.js smoke workflow
  -> persist graph state
  -> interrupt
  -> restart/resume
  -> verify thread isolation
  -> write artifact/evidence
  -> run failure suite
  -> generate traceability audit
  -> independently verify P00
  -> produce a complete evidence report
```

with no hidden manual steps and no unverified mandatory requirement.

That is the foundation on which P01--P18 are allowed to build.
