import { HarnessError } from "@harness/contracts";

const UNAVAILABLE_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH"]);
// 57P01 admin_shutdown, 57P02 crash_shutdown, 57P03 cannot_connect_now, 08xxx connection exceptions
const DISCONNECT_SQLSTATES = /^(57P0[123]|08\d{3})$/;
const DISCONNECT_MESSAGES =
  /connection terminated|terminating connection|client has encountered a connection error|not queryable/i;
// Messages that only mean "cannot reach/login" while establishing a connection
// (e.g. `database "x" does not exist`); during a query, "does not exist" is a normal SQL error.
const CONNECT_ONLY_MESSAGES =
  /timeout expired|timeout exceeded when trying to connect|connection timeout|password authentication failed|does not exist/i;

const codeOf = (error: unknown) => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
};

/**
 * True for errors raised by the PostgreSQL driver or server (SQLSTATE / socket
 * errno / connection failures) as opposed to exceptions thrown by caller code.
 */
export function isDriverError(error: unknown): boolean {
  if (error instanceof HarnessError) return false;
  const code = codeOf(error);
  if (
    code !== undefined &&
    (/^[0-9A-Z]{5}$/.test(code) || UNAVAILABLE_CODES.has(code) || code === "ECONNRESET" || code === "EPIPE")
  )
    return true;
  const message = error instanceof Error ? error.message : "";
  return DISCONNECT_MESSAGES.test(message) || CONNECT_ONLY_MESSAGES.test(message);
}

/**
 * Map driver errors onto harness classifications. Messages are generic so a
 * connection string can never leak through an error (INV-010). Server errors
 * that are neither integrity nor connection failures stay UNKNOWN_OUTCOME
 * (fail-safe, INV-012) with the SQLSTATE in details.
 */
export function classifyDbError(error: unknown, phase: "connect" | "query"): HarnessError {
  if (error instanceof HarnessError) return error;
  const code = codeOf(error);
  const message = error instanceof Error ? error.message : String(error);
  const details = { driver_code: code ?? null };
  if (code === "23505") return new HarnessError("DUPLICATE_ID", "duplicate key", { details, cause: error });
  if (code === "23503") {
    return new HarnessError("INVALID_REFERENCE", "foreign key violation", { details, cause: error });
  }
  const disconnected =
    (code !== undefined && (DISCONNECT_SQLSTATES.test(code) || code === "ECONNRESET" || code === "EPIPE")) ||
    DISCONNECT_MESSAGES.test(message);
  if (phase === "connect") {
    if (
      disconnected ||
      (code !== undefined && UNAVAILABLE_CODES.has(code)) ||
      CONNECT_ONLY_MESSAGES.test(message)
    ) {
      return new HarnessError("DB_UNAVAILABLE", "database unavailable", { details, cause: error });
    }
  } else if (disconnected) {
    return new HarnessError("DB_DISCONNECTED", "database connection lost", { details, cause: error });
  } else if (code !== undefined && UNAVAILABLE_CODES.has(code)) {
    return new HarnessError("DB_UNAVAILABLE", "database unavailable", { details, cause: error });
  }
  return new HarnessError("UNKNOWN_OUTCOME", "database operation outcome unknown", { details, cause: error });
}
