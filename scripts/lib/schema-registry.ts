import {
  AgentSpecContract,
  ArtifactRecordContract,
  PolicyDecisionContract,
  ProposedActionContract,
  RunContract,
  TaskContract,
  type VersionedContract,
} from "@harness/contracts";
import { EventCatalog, EventEnvelopeSchema, EventTypes } from "@harness/events";
import { z } from "zod";

/**
 * Every portable contract whose shape is frozen per version. Snapshots are
 * written to specs/schemas/<name>.v<version>.json. A snapshot for a given
 * (name, version) must never change; changing a shape requires a new version.
 */
export function portableContracts(): VersionedContract[] {
  const contracts: VersionedContract[] = [
    RunContract,
    AgentSpecContract,
    TaskContract,
    ArtifactRecordContract,
    ProposedActionContract,
    PolicyDecisionContract,
    { name: "EventEnvelope", version: 1, schema: EventEnvelopeSchema },
  ];
  for (const type of EventTypes) {
    const entry = EventCatalog[type];
    contracts.push({ name: `event.${type}`, version: entry.version, schema: entry.payload });
  }
  return contracts;
}

export function snapshotFileName(c: VersionedContract): string {
  return `${c.name}.v${c.version}.json`;
}

export function renderSnapshot(c: VersionedContract): string {
  const json = z.toJSONSchema(c.schema, { target: "draft-2020-12", unrepresentable: "any" });
  const doc = {
    $id: `urn:harness:schema:${c.name}:v${c.version}`,
    title: c.name,
    "x-version": c.version,
    ...json,
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
}
