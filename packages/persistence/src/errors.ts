import { HarnessError } from "@harness/contracts";

const UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH"]);
// 57P01 admin_shutdown, 57P02 crash_shutdown, 57P03 cannot_connect_now, 08xxx connection exceptions
const DISCONNECT_SQLSTATES = /^(57P0[123]|08\d{3})$/;

/**
 * Map driver errors onto harness classifications. Messages are generic so a
 * connection string can never leak through an error (INV-010).
 */
export function classifyDbError(error: unknown, phase: "connect" | "query"): HarnessError {
  if (error instanceof HarnessError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof code === "string" && code === "23505") {
    return new HarnessError("DUPLICATE_ID", "duplicate key", { details: { sqlstate: code }, cause: error });
  }
  if (typeof code === "string" && code === "23503") {
    return new HarnessError("INVALID_REFERENCE", "foreign key violation", {
      details: { sqlstate: code },
      cause: error,
    });
  }
  const unavailable =
    (typeof code === "string" && UNAVAILABLE_CODES.has(code)) ||
    /timeout expired|connection timeout|password authentication failed|does not exist/i.test(message);
  if (phase === "connect" && (unavailable || (typeof code === "string" && DISCONNECT_SQLSTATES.test(code)))) {
    return new HarnessError("DB_UNAVAILABLE", "database unavailable", {
      details: { driver_code: typeof code === "string" ? code : null },
      cause: error,
    });
  }
  if (
    (typeof code === "string" &&
      (DISCONNECT_SQLSTATES.test(code) || code === "ECONNRESET" || code === "EPIPE")) ||
    /connection terminated|terminating connection|client has encountered a connection error|not queryable/i.test(
      message,
    )
  ) {
    return new HarnessError("DB_DISCONNECTED", "database connection lost", {
      details: { driver_code: typeof code === "string" ? code : null },
      cause: error,
    });
  }
  if (unavailable) {
    return new HarnessError("DB_UNAVAILABLE", "database unavailable", {
      details: { driver_code: typeof code === "string" ? code : null },
      cause: error,
    });
  }
  return new HarnessError("UNKNOWN_OUTCOME", "database operation outcome unknown", {
    details: { driver_code: typeof code === "string" ? code : null },
    cause: error,
  });
}
