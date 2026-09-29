import type { z } from "zod";
import { HarnessError } from "./errors.ts";

/**
 * A versioned contract: a stable name, the current schema version, and the zod
 * schema for that version. Every serialised record carries `schema_version`.
 *
 * Changing a schema's shape requires bumping `version`; the committed JSON Schema
 * snapshots under `specs/schemas/` make unversioned drift fail CI.
 */
export interface VersionedContract<S extends z.ZodType = z.ZodType> {
  readonly name: string;
  readonly version: number;
  readonly schema: S;
}

export function defineContract<S extends z.ZodType>(
  name: string,
  version: number,
  schema: S,
): VersionedContract<S> {
  return Object.freeze({ name, version, schema });
}

/**
 * Parse untrusted input against a versioned contract. Unsupported versions and
 * invalid payloads are classified distinctly (P00 failure scenarios 4 and 13).
 */
export function parseContract<S extends z.ZodType>(
  contract: VersionedContract<S>,
  input: unknown,
): z.infer<S> {
  const version =
    typeof input === "object" && input !== null
      ? (input as { schema_version?: unknown }).schema_version
      : undefined;
  if (version !== contract.version) {
    throw new HarnessError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `${contract.name}: unsupported schema_version ${JSON.stringify(version)} (supported: ${contract.version})`,
      { details: { contract: contract.name, received: version ?? null, supported: [contract.version] } },
    );
  }
  const result = contract.schema.safeParse(input);
  if (!result.success) {
    throw new HarnessError("PAYLOAD_INVALID", `${contract.name}: invalid payload`, {
      details: {
        contract: contract.name,
        issues: result.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      },
    });
  }
  return result.data;
}
