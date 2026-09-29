/**
 * Secret redaction for logs and evidence (P00 spec §22, INV-010).
 *
 * Two layers: sensitive *keys* have their whole value replaced, and known
 * secret *value patterns* are masked wherever they appear in strings.
 */

export const REDACTED = "[REDACTED]";

const SENSITIVE_KEY =
  /(pass(word|wd)?|secret|token|api[-_]?key|authorization|^auth$|cookie|credential|private[-_]?key|database[-_]?url|connection[-_]?string|^dsn$)/i;

/** Patterns for secret-like values. Each keeps a non-secret prefix where useful for debugging. */
export const SECRET_VALUE_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp; replace: string }> = [
  // user:password@ in any URL
  {
    name: "url-credentials",
    pattern: /([a-z][a-z0-9+.-]*:\/\/[^:/?#@\s]+):[^@/\s]+@/gi,
    replace: `$1:${REDACTED}@`,
  },
  { name: "bearer-token", pattern: /\b(bearer)\s+[a-z0-9._~+/=-]{8,}/gi, replace: `$1 ${REDACTED}` },
  {
    name: "private-key-block",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: REDACTED,
  },
  { name: "jwt", pattern: /\beyJ[a-z0-9_-]{5,}\.[a-z0-9_-]{5,}\.[a-z0-9_-]{5,}\b/gi, replace: REDACTED },
  { name: "aws-access-key-id", pattern: /\b(AKIA|ASIA)[A-Z0-9]{16}\b/g, replace: REDACTED },
  {
    name: "github-token",
    pattern: /\b(gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})\b/g,
    replace: REDACTED,
  },
  { name: "slack-token", pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g, replace: REDACTED },
  { name: "provider-api-key", pattern: /\bsk-(ant-|proj-)?[A-Za-z0-9_-]{20,}\b/g, replace: REDACTED },
  {
    // Keyword anywhere in an identifier (DB_PASSWORD, client_secret, dbPassword, "api_key" in JSON),
    // immediately followed by an optional quote and = or :.
    name: "key-value-assignment",
    pattern:
      /(\b[A-Za-z0-9_]*?(?:password|passwd|secret|token|api[-_]?key)["']?\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s,;&}]+)/gi,
    replace: `$1${REDACTED}`,
  },
];

export function redactString(value: string): string {
  let out = value;
  for (const { pattern, replace } of SECRET_VALUE_PATTERNS) out = out.replace(pattern, replace);
  return out;
}

/**
 * Deep-redact any value into a JSON-safe structure. Handles cycles (only true
 * ancestors are reported as circular; shared references are rendered) and errors
 * (name, message, code, details and cause, all redacted).
 */
export function redact(value: unknown, ancestors: Set<object> = new Set()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") {
    return typeof value === "bigint" ? value.toString() : value;
  }
  if (ancestors.has(value)) return "[Circular]";
  ancestors.add(value);
  try {
    // Objects with their own safe serialisation (e.g. SecretString) are trusted to redact themselves.
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === "function" && !(value instanceof Date))
      return redact(toJSON.call(value), ancestors);
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      const err: Record<string, unknown> = { name: value.name, message: redactString(value.message) };
      const { code, details } = value as { code?: unknown; details?: unknown };
      if (code !== undefined) err["code"] = code;
      if (details !== undefined) err["details"] = redact(details, ancestors);
      if (value.cause !== undefined) err["cause"] = redact(value.cause, ancestors);
      return err;
    }
    if (Array.isArray(value)) return value.map((v) => redact(v, ancestors));
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value))
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redact(v, ancestors);
    return out;
  } finally {
    ancestors.delete(value);
  }
}
