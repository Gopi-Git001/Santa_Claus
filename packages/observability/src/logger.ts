import { redact } from "./redact.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";
const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Correlation fields every log line may carry so failures can be located by run/thread/node. */
export interface LogContext {
  run_id?: string;
  thread_id?: string;
  trace_id?: string;
  graph?: string;
  node?: string;
  event_id?: string;
  component?: string;
}

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  child(context: LogContext): Logger;
}

export type LogWriter = (line: string) => void;

/**
 * Structured JSON-lines logger. Every line passes through `redact`, so secrets
 * are masked even when a caller passes them by mistake.
 */
export function createLogger(
  options: { level?: LogLevel; write?: LogWriter; context?: LogContext; now?: () => Date } = {},
): Logger {
  const level = options.level ?? "info";
  const write = options.write ?? ((line) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());
  const context = options.context ?? {};

  const emit = (lvl: LogLevel, msg: string, fields?: Record<string, unknown>) => {
    if (LEVELS[lvl] < LEVELS[level]) return;
    const record = redact({ ts: now().toISOString(), level: lvl, msg, ...context, ...fields });
    write(JSON.stringify(record));
  };

  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (extra) => createLogger({ level, write, now, context: { ...context, ...extra } }),
  };
}

/** Logger that captures lines in memory; for tests and evidence capture. */
export function createMemoryLogger(level: LogLevel = "debug"): { logger: Logger; lines: () => unknown[] } {
  const lines: string[] = [];
  return {
    logger: createLogger({ level, write: (l) => lines.push(l) }),
    lines: () => lines.map((l) => JSON.parse(l) as unknown),
  };
}
