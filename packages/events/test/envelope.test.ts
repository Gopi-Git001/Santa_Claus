import { HarnessError, newId, newTraceId } from "@harness/contracts";
import { describe, expect, it } from "vitest";
import { createEvent, EventCatalog, EventTypes, InMemoryEventLog, parseEvent } from "../src/index.ts";

const ctx = () => ({ run_id: newId("RunId"), trace_id: newTraceId(), correlation_id: "corr-1" });

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof HarnessError ? e.code : "NOT_HARNESS_ERROR";
  }
  return undefined;
}

describe("event catalog", () => {
  it("contains exactly the P00 minimum event families", () => {
    expect([...EventTypes].sort()).toEqual(
      [
        "run.created",
        "run.status_changed",
        "graph.started",
        "graph.node_started",
        "graph.node_completed",
        "graph.interrupted",
        "graph.resumed",
        "graph.failed",
        "graph.completed",
        "artifact.created",
        "policy.decision_recorded",
        "test.evidence_recorded",
      ].sort(),
    );
    for (const t of EventTypes) expect(EventCatalog[t].version).toBeGreaterThanOrEqual(1);
  });
});

describe("createEvent / parseEvent", () => {
  it("round-trips through JSON serialisation", () => {
    const e = createEvent("graph.node_started", { graph: "g", graph_version: "1", node: "n" }, ctx());
    const back = parseEvent(JSON.parse(JSON.stringify(e)));
    expect(back).toEqual(e);
  });

  it("links causation and correlation", () => {
    const c = ctx();
    const first = createEvent("graph.started", { graph: "g", graph_version: "1" }, c);
    const second = createEvent("graph.completed", { graph: "g", graph_version: "1", outcome: "ok" }, c, {
      causation_id: first.event_id,
    });
    expect(second.causation_id).toBe(first.event_id);
    expect(second.correlation_id).toBe(first.correlation_id);
  });

  it("rejects a corrupted payload for a known type", () => {
    const e = createEvent("graph.started", { graph: "g", graph_version: "1" }, ctx());
    expect(codeOf(() => parseEvent({ ...e, payload: { graph: 42 } }))).toBe("PAYLOAD_INVALID");
  });

  it("rejects an unknown event type and non-object input", () => {
    const e = createEvent("graph.started", { graph: "g", graph_version: "1" }, ctx());
    expect(codeOf(() => parseEvent({ ...e, event_type: "graph.exploded" }))).toBe("PAYLOAD_INVALID");
    expect(codeOf(() => parseEvent("not json object"))).toBe("PAYLOAD_INVALID");
  });

  it("rejects an unsupported schema version", () => {
    const e = createEvent("graph.started", { graph: "g", graph_version: "1" }, ctx());
    expect(codeOf(() => parseEvent({ ...e, schema_version: 99 }))).toBe("UNSUPPORTED_SCHEMA_VERSION");
  });

  it("validates at creation time", () => {
    expect(codeOf(() => createEvent("graph.started", { graph: "" } as never, ctx()))).toBe("PAYLOAD_INVALID");
  });
});

describe("InMemoryEventLog", () => {
  it("rejects duplicate event IDs", async () => {
    const log = new InMemoryEventLog();
    const e = createEvent("graph.started", { graph: "g", graph_version: "1" }, ctx());
    await log.append(e);
    await expect(log.append(e)).rejects.toMatchObject({ code: "DUPLICATE_ID" });
    expect(await log.lastEventId(e.run_id)).toBe(e.event_id);
  });
});
