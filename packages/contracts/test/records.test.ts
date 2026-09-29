import { describe, expect, it } from "vitest";
import {
  AgentSpecContract,
  ArtifactRecordContract,
  HarnessError,
  lineageViolations,
  newId,
  newTraceId,
  PolicyDecisionContract,
  ProposedActionContract,
  parseContract,
  RunContract,
  TaskContract,
} from "../src/index.ts";

const now = "2026-09-28T12:00:00.000Z";
const budget = { max_steps: 10, max_wall_clock_ms: 60_000, max_tokens: 1_000, max_cost_micro_usd: 0 };
const policy = { profile: "p00-default", params: {} };

function run(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    id: newId("RunId"),
    root_goal: "prove P00",
    status: "CREATED",
    created_at: now,
    updated_at: now,
    policy_profile: "p00-default",
    budget_profile: "p00-default",
    root_thread_id: newId("ThreadId"),
    metadata: {},
    ...overrides,
  };
}

function agent(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: 1,
    agent_id: newId("AgentId"),
    run_id: newId("RunId"),
    role: "smoke",
    objective: "do nothing harmful",
    success_criteria: ["returns"],
    model_policy: policy,
    context_policy: policy,
    allowed_capabilities: ["harness.echo"],
    denied_capabilities: [],
    workspace_scope: {},
    network_scope: {},
    secret_scope: {},
    memory_scope: {},
    budget,
    delegation_policy: policy,
    approval_policy: policy,
    verification_policy: policy,
    lifecycle_policy: policy,
    ...overrides,
  };
}

function expectCode(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(HarnessError);
    expect((e as HarnessError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe("Run", () => {
  it("parses a valid run", () => {
    expect(parseContract(RunContract, run()).status).toBe("CREATED");
  });
  it("rejects unknown fields (strict contracts)", () => {
    expectCode(() => parseContract(RunContract, run({ extra: 1 })), "PAYLOAD_INVALID");
  });
  it("rejects a missing schema_version as unsupported", () => {
    const { schema_version: _, ...rest } = run();
    expectCode(() => parseContract(RunContract, rest), "UNSUPPORTED_SCHEMA_VERSION");
  });
  it("rejects a future schema_version as unsupported", () => {
    expectCode(() => parseContract(RunContract, run({ schema_version: 2 })), "UNSUPPORTED_SCHEMA_VERSION");
  });
  it("keeps UNKNOWN distinct from FAILED (INV-012)", () => {
    expect(parseContract(RunContract, run({ status: "UNKNOWN" })).status).toBe("UNKNOWN");
  });
  it("rejects non-JSON metadata", () => {
    expectCode(() => parseContract(RunContract, run({ metadata: { n: Number.NaN } })), "PAYLOAD_INVALID");
  });
});

describe("AgentSpec", () => {
  it("defaults every scope to no access (INV-017)", () => {
    const spec = parseContract(AgentSpecContract, agent());
    expect(spec.workspace_scope).toEqual({ mode: "none", roots: [] });
    expect(spec.network_scope).toEqual({ mode: "none", hosts: [] });
    expect(spec.secret_scope).toEqual({ secret_refs: [] });
    expect(spec.memory_scope).toEqual({ namespaces: [] });
  });
  it("requires a finite budget (INV-005)", () => {
    const { max_tokens: _, ...partial } = budget;
    expectCode(() => parseContract(AgentSpecContract, agent({ budget: partial })), "PAYLOAD_INVALID");
    expectCode(
      () =>
        parseContract(
          AgentSpecContract,
          agent({ budget: { ...budget, max_steps: Number.POSITIVE_INFINITY } }),
        ),
      "PAYLOAD_INVALID",
    );
  });
  it("rejects a capability that is both allowed and denied", () => {
    expectCode(
      () => parseContract(AgentSpecContract, agent({ denied_capabilities: ["harness.echo"] })),
      "PAYLOAD_INVALID",
    );
  });
  it("rejects raw secret values in secret scope (INV-010)", () => {
    expectCode(
      () => parseContract(AgentSpecContract, agent({ secret_scope: { secret_refs: ["hunter2"] } })),
      "PAYLOAD_INVALID",
    );
  });
  it("enforces parent lineage within one root run (INV-006)", () => {
    const parent = parseContract(AgentSpecContract, agent());
    const child = parseContract(
      AgentSpecContract,
      agent({ run_id: parent.run_id, parent_agent_id: parent.agent_id }),
    );
    expect(lineageViolations(child, parent)).toEqual([]);
    const stranger = parseContract(AgentSpecContract, agent({ parent_agent_id: parent.agent_id }));
    expect(lineageViolations(stranger, parent)).toContain(
      "child agent belongs to a different run than its parent",
    );
    expect(lineageViolations(child, undefined)).toHaveLength(1);
  });
  it("rejects an agent that is its own parent", () => {
    const id = newId("AgentId");
    expectCode(
      () => parseContract(AgentSpecContract, agent({ agent_id: id, parent_agent_id: id })),
      "PAYLOAD_INVALID",
    );
  });
});

describe("Task", () => {
  const task = (o: Record<string, unknown> = {}) => ({
    schema_version: 1,
    id: newId("TaskId"),
    run_id: newId("RunId"),
    objective: "o",
    dependencies: [],
    status: "PENDING",
    priority: 50,
    success_criteria: ["done"],
    budget,
    verification_policy: policy,
    ...o,
  });
  it("parses a valid task", () => {
    expect(parseContract(TaskContract, task()).priority).toBe(50);
  });
  it("rejects self and duplicate dependencies", () => {
    const id = newId("TaskId");
    expectCode(() => parseContract(TaskContract, task({ id, dependencies: [id] })), "PAYLOAD_INVALID");
    const dep = newId("TaskId");
    expectCode(() => parseContract(TaskContract, task({ dependencies: [dep, dep] })), "PAYLOAD_INVALID");
  });
});

describe("ArtifactRecord, ProposedAction, PolicyDecision", () => {
  it("requires provenance and a sha256 digest (INV-008)", () => {
    const base = {
      schema_version: 1,
      artifact_id: newId("ArtifactId"),
      run_id: newId("RunId"),
      producer: { kind: "test", id: "t" },
      media_type: "text/plain",
      size_bytes: 1,
      content_hash: { algorithm: "sha256", digest: "a".repeat(64) },
      storage_ref: { backend: "fs", key: "k" },
      created_at: now,
      provenance: { trace_id: newTraceId(), source: "unit" },
      verification_status: "UNVERIFIED",
    };
    expect(parseContract(ArtifactRecordContract, base).provenance.derived_from).toEqual([]);
    const { provenance: _, ...noProvenance } = base;
    expectCode(() => parseContract(ArtifactRecordContract, noProvenance), "PAYLOAD_INVALID");
    expectCode(
      () =>
        parseContract(ArtifactRecordContract, { ...base, content_hash: { algorithm: "md5", digest: "x" } }),
      "PAYLOAD_INVALID",
    );
  });

  it("parses a proposed action and each policy decision kind", () => {
    const action = {
      schema_version: 1,
      actor: { kind: "agent", id: "a" },
      capability: "harness.echo",
      operation: "echo",
      arguments: { text: "hi" },
      target: { kind: "none", ref: "-" },
      risk_context: { side_effect_class: "none", input_trust: "untrusted" },
      estimated_budget: {},
    };
    expect(parseContract(ProposedActionContract, action).capability).toBe("harness.echo");
    for (const decision of ["AUTO_ALLOW", "ASK_HUMAN", "DENY"]) {
      const d = { schema_version: 1, decision, reason_code: "TEST", policy_version: "0", constraints: {} };
      expect(parseContract(PolicyDecisionContract, d).decision).toBe(decision);
    }
    expectCode(
      () =>
        parseContract(PolicyDecisionContract, {
          schema_version: 1,
          decision: "MAYBE",
          reason_code: "X",
          policy_version: "0",
          constraints: {},
        }),
      "PAYLOAD_INVALID",
    );
  });
});
