/**
 * Classified harness errors. Every failure scenario in P00 maps to exactly one
 * code so evidence and debugging can assert on classification, not message text.
 */
export const HarnessErrorCodes = [
  "CONFIG_INVALID",
  "DB_UNAVAILABLE",
  "DB_DISCONNECTED",
  "PAYLOAD_INVALID",
  "UNSUPPORTED_SCHEMA_VERSION",
  "DUPLICATE_ID",
  "INVALID_REFERENCE",
  "THREAD_MISMATCH",
  "THREAD_NOT_FOUND",
  "GRAPH_NOT_INTERRUPTED",
  "NODE_FAILED",
  "ARTIFACT_HASH_MISMATCH",
  "ARTIFACT_NOT_FOUND",
  "STORAGE_UNAVAILABLE",
  "UNKNOWN_OUTCOME",
] as const;

export type HarnessErrorCode = (typeof HarnessErrorCodes)[number];

export class HarnessError extends Error {
  readonly code: HarnessErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: HarnessErrorCode,
    message: string,
    options: { details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "HarnessError";
    this.code = code;
    this.details = Object.freeze({ ...options.details });
  }
}

export function isHarnessError(value: unknown, code?: HarnessErrorCode): value is HarnessError {
  return value instanceof HarnessError && (code === undefined || value.code === code);
}
