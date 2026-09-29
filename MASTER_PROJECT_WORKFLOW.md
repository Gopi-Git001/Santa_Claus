# Autonomous Agent Harness --- Master Project Workflow

**Document:** `MASTER_PROJECT_WORKFLOW.md`\
**Version:** 1.0\
**Status:** Architecture baseline\
**Primary orchestration runtime:** LangGraph.js / TypeScript\
**Harness infrastructure:** Self-owned; open-source LangGraph is a
dependency, not the system boundary\
**Languages:** TypeScript, Python, Rust\
**Primary durable database:** PostgreSQL\
**Artifact storage:** Pluggable object/artifact store\
**Search/vector infrastructure:** Optional and replaceable\
**Scale target:** Elastic execution from one agent to hundreds of
concurrent agent instances\
**Authority model:** Human authority with policy-controlled autonomous
actions

------------------------------------------------------------------------

## 1. Project Idea

Build a model-agnostic autonomous execution harness that accepts a human
objective---from a short conversational request or Markdown
specification to a long-lived mission---and safely turns that objective
into verified work.

The harness must be able to select models, construct context, plan work,
create specialized agent instances, assign capabilities, execute tools
in isolated environments, coordinate parallel work, request human
authority when required, recover from failures, verify outputs
independently, preserve evidence, and improve safely over time.

The product is **not a single chatbot, a single coding agent, or a
collection of 500 prebuilt bots**. It is an operating system for
dynamically instantiated agents.

------------------------------------------------------------------------

## 2. Final Product Experience

The simplest experience must remain as easy as:

``` text
$ harness

> Build PROJECT.md
```

The same system must also support:

``` text
> Fix this bug.
> Review this repository.
> Research this problem and produce a verified report.
> Build the application described in MASTER_PLAN.md.
> Keep this repository healthy and wake when CI, security, or deployment events require work.
```

The harness decides whether the job requires one agent, a small team, or
a hierarchy of supervisors and workers.

### User interaction modes

1.  **Conversation mode** --- Claude Code/Codex-style interactive work.
2.  **Specification mode** --- provide Markdown/specification and
    request implementation.
3.  **Goal mode** --- provide outcome, constraints, budget, and success
    criteria.
4.  **Mission Control mode** --- supervise agent tree, task DAG,
    budgets, evidence, approvals, and failures.
5.  **Voice/realtime mode** --- converse, interrupt, approve, deny, and
    steer through voice.
6.  **Persistent mission mode** --- event-driven long-lived goals that
    sleep and wake.

------------------------------------------------------------------------

## 3. Fundamental Principles

1.  **The model proposes; the harness controls.**
2.  Models never constitute a security boundary.
3.  LangGraph orchestrates stateful workflows; it does not own the
    entire harness architecture.
4.  No external side effect bypasses policy, permission, budget, and
    execution controls.
5.  Human denial overrides agent intent.
6.  Agent instances are dynamically created from contracts/templates;
    they are not permanently prebuilt.
7.  Every agent receives finite authority, finite resources, and
    explicit success criteria.
8.  Every important state transition is durable and auditable.
9.  Every artifact has provenance.
10. Completion requires verification, not an LLM statement that work is
    complete.
11. External content is untrusted unless explicitly promoted by policy.
12. Secrets never become ordinary model context.
13. Cancellation propagates through graph execution and the complete
    process tree.
14. Crash recovery must distinguish unknown outcome from failure.
15. Model providers are replaceable without changing agent business
    logic.
16. Self-improvement cannot silently rewrite permanent authority or
    security controls.
17. Context is constructed intentionally and carries provenance.
18. The system must fail safely when state, authority, or execution
    outcome is uncertain.

------------------------------------------------------------------------

## 4. Architecture Domains

  -----------------------------------------------------------------------
  ID                      Domain                  Responsibility
  ----------------------- ----------------------- -----------------------
  S01                     Harness Kernel          Lifecycle, state
                                                  machines, contracts,
                                                  configuration

  S02                     Model Intelligence      Model adapters,
                          Plane                   routing, fallback,
                                                  inference

  S03                     Context & Knowledge     Context compilation,
                          Plane                   retrieval, indexing

  S04                     Agent Runtime           Agent identity,
                                                  lifecycle, spawning,
                                                  hierarchy

  S05                     Orchestration & Goals   Goals, planning, DAGs,
                                                  scheduling, delegation

  S06                     Capability & Tool Plane Tools, skills, hooks,
                                                  plugins, MCP

  S07                     Security & Human        Permissions, policy,
                          Authority               trust, approvals,
                                                  secrets

  S08                     Execution & Isolation   Processes, containers,
                          Fabric                  VMs, remote workers

  S09                     Memory & Durable State  Working memory, durable
                                                  memory, persistence

  S10                     Event & Automation      Events, triggers,
                          Plane                   schedules, background
                                                  agents

  S11                     Artifact & Verification Outputs, evidence,
                          Plane                   verification

  S12                     Multi-Agent             Structured messaging,
                          Communication           A2A, remote agents

  S13                     Multimodal / Voice /    Voice, vision, browser,
                          Computer                GUI/computer use

  S14                     Observability &         Logs, traces, replay,
                          Reliability             debugging, recovery

  S15                     Evaluation &            Evals, benchmarks,
                          Self-Improvement        controlled improvement

  S16                     Human Experience /      UI, steering,
                          Mission Control         approvals,
                                                  visualization
  -----------------------------------------------------------------------

------------------------------------------------------------------------

## 5. Capability Baseline

The initial architecture uses stable requirement IDs `C001`--`C168`.

  Range        Capability family
  ------------ ------------------------------------
  C001--C030   Core harness foundation
  C031--C040   Context engineering
  C041--C050   Skills, hooks, extensibility
  C051--C060   Persistent/background agents
  C061--C070   Advanced multi-agent orchestration
  C071--C078   Agent interoperability
  C079--C088   Voice/realtime
  C089--C098   Multimodal/computer use
  C099--C108   Environment architecture
  C109--C118   Autonomous-agent security
  C119--C128   Model intelligence
  C129--C138   Controlled self-improvement
  C139--C148   Evaluation/reliability
  C149--C158   Developer/user experience
  C159--C168   Event-driven autonomy

New discoveries become `C169+`; existing IDs are never renumbered.

------------------------------------------------------------------------

## 6. End-to-End Workflow

``` text
USER / API / IDE / VOICE
          |
          v
INTERACTION GATEWAY
          |
          v
GOAL + CONSTRAINTS + AUTHORITY + BUDGET + SUCCESS CRITERIA
          |
          v
HARNESS KERNEL
          |
          v
LANGGRAPH ORCHESTRATION GRAPH
          |
          +--> deterministic control nodes
          |
          +--> model-driven planning nodes
          |
          v
TASK DAG / SCHEDULER
          |
          v
AGENT FACTORY
          |
    +-----+------+----------------+
    |            |                |
    v            v                v
SUPERVISOR    SPECIALIST       VERIFIER
    |            |                |
    +------------+----------------+
                 |
                 v
CONTEXT COMPILER --> MODEL ROUTER --> MODEL
                 |                      |
                 |<---- proposal -------+
                 v
POLICY / HUMAN AUTHORITY GATE
                 |
        +--------+---------+
        |                  |
   AUTO_ALLOW          ASK_HUMAN / DENY
        |
        v
CAPABILITY GATEWAY
        |
        v
SANDBOX / EXECUTION FABRIC
        |
        v
ARTIFACTS + EVENTS + EVIDENCE
        |
        v
VERIFICATION
      /     \
   PASS     FAIL
    |        |
    |     diagnose/replan/retry
    |        |
    +--------+
        |
        v
VERIFIED OUTCOME
```

------------------------------------------------------------------------

## 7. LangGraph Strategy

LangGraph.js is the primary stateful orchestration runtime. It is used
for graph/state execution, deterministic + agentic node composition,
checkpoints, interrupts, resumable workflows, streaming, subgraphs, and
graph-level control flow.

LangGraph is **not** allowed to become the owner of:

-   authorization policy;
-   sandbox/process isolation;
-   secrets;
-   model-provider coupling;
-   artifact truth;
-   distributed worker authority;
-   audit truth;
-   verification truth;
-   product UI;
-   permanent memory semantics.

Those remain harness contracts so LangGraph can be upgraded or replaced
without redesigning the whole platform.

### Graph hierarchy

``` text
Root Mission Graph
|
+-- Goal/Planning Subgraph
+-- Orchestration/Scheduler Subgraph
+-- Supervisor Subgraphs
|   +-- Worker Agent Graph
|   +-- Worker Agent Graph
|   +-- Review Graph
|
+-- Approval/Interrupt Subgraph
+-- Verification Subgraph
+-- Recovery/Replan Subgraph
```

------------------------------------------------------------------------

## 8. Agent Scaling Strategy

We do **not** define or launch 500 agents in advance.

We define reusable `AgentSpec`/role templates and create runtime
instances only when justified.

``` text
User task
   |
   v
Task decomposition
   |
   v
Task DAG width + dependencies
   |
   v
Scheduler capacity calculation
   |
   +-- budget
   +-- CPU/GPU/RAM
   +-- model concurrency
   +-- risk
   +-- workspace conflicts
   +-- rate limits
   +-- priority
   +-- max hierarchy depth
   |
   v
Agent Factory
   |
   v
N runtime agent instances
```

A small task may use one agent. A large task may create supervisors and
dozens/hundreds of workers. Agents terminate or sleep when their
responsibility ends.

### Scaling safety

Scale-up is bounded by:

-   global concurrency;
-   per-run concurrency;
-   per-model concurrency;
-   per-tool concurrency;
-   hierarchy depth;
-   total agent count;
-   token/compute/cost budget;
-   CPU/GPU/RAM/disk/network budgets;
-   workspace/lock conflicts;
-   rate limits;
-   risk policy;
-   human-defined limits.

Scale-down occurs when tasks finish, become blocked, are cancelled, are
deduplicated, or no longer contribute to the goal.

------------------------------------------------------------------------

## 9. Core Agent Contract

Every runtime agent must be created from a typed contract containing at
least:

``` text
AgentSpec
- agent_id
- run_id
- parent_agent_id
- role
- objective
- success_criteria
- model_policy
- context_policy
- allowed_capabilities
- denied_capabilities
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

The prompt is only one field of an agent. It is not the agent's
authority.

------------------------------------------------------------------------

## 10. Model Strategy

All models sit behind a normalized Model Gateway.

Supported deployment styles include:

-   local llama.cpp/Ollama-style runtimes;
-   vLLM/SGLang or similar inference servers;
-   private GPU clusters;
-   OpenAI-compatible APIs;
-   future proprietary or open providers;
-   specialized embedding, vision, audio, coding, and reasoning models.

The harness sees normalized concepts such as:

`ModelRequest`, `ModelResponse`, `ModelCapabilities`, `ToolCall`,
`StructuredOutput`, `StreamEvent`, `Usage`, `Cancellation`, and
`ModelError`.

Routing can later consider capability, quality, latency, context size,
privacy, availability, compute, and cost.

------------------------------------------------------------------------

## 11. Language Boundaries

### TypeScript

Primary control plane:

-   LangGraph.js orchestration;
-   harness kernel;
-   APIs;
-   agent runtime;
-   scheduler;
-   event coordination;
-   contracts/schemas;
-   Mission Control backend/frontend;
-   tool gateway.

### Python

Primary ML/data plane:

-   model-specific adapters where Python ecosystems dominate;
-   embeddings/reranking;
-   data science;
-   evaluations;
-   vision/audio integrations;
-   experimental ML components.

### Rust

Security/performance plane:

-   process supervision;
-   sandbox helpers;
-   resource enforcement;
-   high-performance execution components;
-   isolation primitives;
-   security-sensitive native utilities.

Cross-language boundaries use versioned RPC/event contracts rather than
importing implementation internals.

------------------------------------------------------------------------

## 12. Durable Data Strategy

### PostgreSQL

Primary system of record for:

-   runs;
-   agents;
-   tasks;
-   graph/thread metadata;
-   policies;
-   approvals;
-   budgets;
-   events;
-   artifact metadata;
-   verification results;
-   audit metadata;
-   durable memory metadata;
-   configuration/version metadata.

LangGraph checkpoint persistence must be database-backed in production.
In-memory persistence is allowed only for tests; SQLite may be allowed
for bounded local development.

### Artifact/Object Storage

Large immutable or versioned payloads:

-   files;
-   logs;
-   screenshots;
-   video/audio;
-   patches;
-   reports;
-   model/tool evidence;
-   build/test outputs.

The object store is abstracted behind an interface so local filesystem,
S3-compatible storage, or another backend can be selected by deployment.

### Search/Vector

Optional, replaceable infrastructure used only when requirements justify
it. PostgreSQL may provide initial search/vector functionality;
dedicated systems can be added later without changing memory contracts.

------------------------------------------------------------------------

## 13. Tools, Skills, MCP, Plugins, Hooks, A2A

These concepts remain separate.

-   **Tool:** executable capability with typed input/output and enforced
    authority.
-   **Skill:** reusable procedure/instructions/references that teach an
    agent how to perform work.
-   **Hook:** deterministic interception around
    lifecycle/tool/model/events.
-   **Plugin:** packaged extension that may provide tools, skills,
    hooks, UI, schemas, or adapters.
-   **MCP:** external capability/context interoperability.
-   **A2A/remote-agent protocol:** communication with independently
    operated agents.

All extensions enter through a capability registry and trust boundary.
Discovery never implies permission.

------------------------------------------------------------------------

## 14. Human Authority

Every consequential proposed action is evaluated by policy.

``` text
PROPOSED ACTION
      |
      v
POLICY ENGINE
      |
 +----+---------+
 |              |
 v              v
AUTO_ALLOW    ASK_HUMAN
 |              |
 |          approve/deny/edit
 |              |
 +-------+------+
         |
         v
      EXECUTE

DENY terminates the proposed action.
```

Policies can consider identity, tool, arguments, destination, workspace,
network, secret scope, risk, cost, side effects, trust, budget, and
organizational/user rules.

------------------------------------------------------------------------

## 15. Verification Philosophy

A model saying "done" never completes a task.

``` text
Agent completion claim
        |
        v
Artifact exists?
        |
Schema/contract valid?
        |
Expected state/change present?
        |
Build/test/checks pass?
        |
Security policy satisfied?
        |
Requirements satisfied?
        |
Independent verification where required?
        |
        v
VERIFIED
```

Every phase and every critical runtime task has explicit verification
policy.

------------------------------------------------------------------------

## 16. Testing and Phase Gates

Each implementation phase uses the following ladder:

1.  static/type/lint checks;
2.  unit tests;
3.  schema/contract tests;
4.  integration tests;
5.  real runtime tests;
6.  failure injection;
7.  security/authority tests;
8.  cancellation/recovery tests where applicable;
9.  end-to-end scenario;
10. independent verification;
11. retained evidence;
12. phase acceptance gate.

A phase is not complete because its code exists or because mocks pass.

------------------------------------------------------------------------

## 17. Debugging and Observability

Every run acts like a flight recorder. The system must be able to
reconstruct:

-   who initiated an action;
-   parent/root goal;
-   graph/node/task;
-   model and adapter;
-   context/provenance;
-   tool proposal;
-   policy decision;
-   human approval;
-   execution environment;
-   inputs/outputs;
-   budget usage;
-   artifacts;
-   verification;
-   retries;
-   errors;
-   cancellation;
-   timestamps and causal links.

Observability is part of correctness, not an optional dashboard feature.

------------------------------------------------------------------------

## 18. Security Baseline

The architecture must defend against:

-   direct/indirect prompt injection;
-   malicious repository/file/web content;
-   tool poisoning;
-   MCP/plugin poisoning;
-   memory poisoning;
-   agent-to-agent injection;
-   credential/data exfiltration;
-   confused-deputy behavior;
-   supply-chain compromise;
-   unauthorized network/filesystem access;
-   resource exhaustion;
-   uncontrolled recursive spawning.

Untrusted data never automatically becomes trusted instruction.

------------------------------------------------------------------------

## 19. Controlled Self-Improvement

Production behavior may improve through:

``` text
Observed failure/opportunity
        |
        v
Improvement proposal
        |
Candidate skill/prompt/tool/router change
        |
Sandbox evaluation
        |
Regression + security + performance tests
        |
Human/policy approval
        |
Versioned candidate
        |
Canary
        |
Production or rollback
```

Agents may propose changes; they do not silently rewrite permanent
security or authority.

------------------------------------------------------------------------

## 20. Build Phases

There are **19 phases total: P00--P18**.

  -----------------------------------------------------------------------
  Phase                               Purpose
  ----------------------------------- -----------------------------------
  P00                                 Specification, invariants,
                                      traceability, repository/tooling
                                      foundation

  P01                                 Harness kernel

  P02                                 Durable state and event foundation

  P03                                 Model gateway

  P04                                 Context engine

  P05                                 Capability/tool system

  P06                                 Security and human authority

  P07                                 Sandbox/execution fabric

  P08                                 Single-agent runtime

  P09                                 Artifacts and verification

  P10                                 Planning and orchestration

  P11                                 Multi-agent runtime

  P12                                 Memory and knowledge

  P13                                 Skills, MCP, plugins, hooks, A2A

  P14                                 Background agents, events,
                                      automation

  P15                                 Browser, computer use, multimodal,
                                      voice

  P16                                 Distributed scale and
                                      hundreds-of-agents capacity

  P17                                 Evaluation and controlled
                                      self-improvement

  P18                                 Production hardening
  -----------------------------------------------------------------------

A later phase may refine an earlier subsystem, but cannot bypass its
contracts.

------------------------------------------------------------------------

## 21. Universal Phase Contract

Every phase specification must answer:

1.  What is being built?
2.  Why is it required?
3.  What responsibility does it own?
4.  Which capability IDs does it satisfy?
5.  What dependencies must already exist?
6.  What is the architecture?
7.  What data/state is owned?
8.  What APIs/events/contracts exist?
9.  What repository modules are created?
10. What is the implementation sequence?
11. How are models wired?
12. How are agents wired?
13. What security boundaries apply?
14. What can fail?
15. How is it tested?
16. How is it debugged?
17. What telemetry/evidence exists?
18. How is it independently verified?
19. What is the acceptance gate?
20. What evidence is retained?
21. What future evolution is anticipated?
22. What is explicitly not implemented yet?

------------------------------------------------------------------------

## 22. Requirement Traceability

Every `Cxxx` requirement must eventually map to:

``` text
Capability ID
Domain
Owning phase
Dependencies
Architecture component
Repository implementation
Contracts/events
Tests
Security controls
Evidence
Status
```

Allowed lifecycle:

`NOT_STARTED -> SPECIFIED -> IMPLEMENTING -> IMPLEMENTED -> TESTED -> VERIFIED -> PRODUCTION_READY`

A machine-checkable audit must report zero unmapped, untested, or
unverified mandatory requirements before production readiness.

------------------------------------------------------------------------

## 23. Project Definition of Done

The harness is not complete merely when P18 is reached. Production
readiness requires:

-   mandatory capability ledger mapped and verified;
-   no unowned architectural responsibilities;
-   supported models interchangeable through adapters;
-   human authority enforced outside prompts;
-   durable restart/recovery demonstrated;
-   tool and execution isolation demonstrated;
-   verification/evidence operational;
-   multi-agent scheduling proven under realistic contention;
-   distributed scaling proven to declared target;
-   security/adversarial suites passing;
-   observability sufficient to reconstruct runs;
-   self-improvement constrained by evaluation and authority;
-   documented deployment/runbooks;
-   explicit known limitations and residual risks.

------------------------------------------------------------------------

## 24. Immediate Next Step

Begin **P00 --- Foundation Specification and Setup**.

P00 must establish the repository, engineering contracts, traceability
system, architectural invariants, LangGraph.js smoke foundation,
PostgreSQL development persistence, extension interfaces,
testing/evidence system, and CI baseline. It must **not** prematurely
implement later-phase product features.

See `P00_FOUNDATION_SPECIFICATION.md`.
