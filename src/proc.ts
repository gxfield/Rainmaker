import { spawn } from "node:child_process";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs?: number;
  /** Throw when the exit code is not 0 (default true). */
  check?: boolean;
}

/** Runs a command to completion and collects its output. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timer: NodeJS.Timeout | undefined;
    if (opts.timeoutMs) timer = setTimeout(() => child.kill("SIGKILL"), opts.timeoutMs);
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      const result = { code: code ?? (signal ? 128 : 1), stdout, stderr };
      if (opts.check !== false && result.code !== 0) {
        const detail = (stderr || stdout).trim().split("\n").slice(-5).join("\n");
        reject(new Error(`${cmd} ${args[0] ?? ""} exited with ${result.code}${detail ? `: ${detail}` : ""}`));
      } else resolve(result);
    });
    child.stdin.on("error", () => undefined); // the command may exit without reading stdin
    child.stdin.end(opts.input ?? "");
  });
}
