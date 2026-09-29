import { spawnSync } from "node:child_process";

export interface RunResult {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Run a command synchronously and capture its output. Commands are given as an
 * argv array (never a shell string) except on Windows, where `.cmd` shims such
 * as corepack require the shell; arguments are fixed by our own scripts.
 */
export function run(
  argv: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; inherit?: boolean; input?: string } = {},
): RunResult {
  const [cmd, ...args] = argv;
  if (cmd === undefined) throw new Error("empty command");
  const started = performance.now();
  const common = {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8" as const,
    stdio: options.inherit ? ("inherit" as const) : ("pipe" as const),
    input: options.input,
    maxBuffer: 256 * 1024 * 1024,
  };
  const result =
    process.platform === "win32"
      ? spawnSync([cmd, ...args].map(quoteWin).join(" "), { ...common, shell: true })
      : spawnSync(cmd, args, common);
  return {
    command: argv.join(" "),
    exitCode: result.status ?? (result.error ? 127 : 1),
    stdout: result.stdout ?? "",
    stderr: (result.stderr ?? "") + (result.error ? `\n${result.error.message}` : ""),
    durationMs: Math.round(performance.now() - started),
  };
}

function quoteWin(arg: string): string {
  if (/[&|<>^%!]/.test(arg)) throw new Error(`refusing to pass shell metacharacter in argument: ${arg}`);
  return /[\s"]/.test(arg) ? `"${arg.replaceAll('"', '\\"')}"` : arg;
}

/** pnpm through corepack so the version pinned in package.json#packageManager is always used. */
export const PNPM = ["corepack", "pnpm"];
