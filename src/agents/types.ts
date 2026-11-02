import type { Route } from "../settings.ts";

export interface Invocation {
  args: string[];
  /** Variables to set (string) or remove (undefined) on top of the base environment. */
  env: Record<string, string | undefined>;
  stdin: string;
}

export interface Outcome {
  ok: boolean;
  /** The agent's final message, used as the PR description. */
  summary: string | null;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cachedTokens: number | null;
  costUsd: number | null;
  numTurns: number | null;
  sessionId: string | null;
  version: string | null;
}

/** Reads the CLI's JSON lines as they stream in. */
export interface StreamParser {
  /** Takes one stdout line and returns readable text for the job log, if any. */
  feed(line: string): string | undefined;
  outcome(exitCode: number): Outcome;
}

/** Rainmaker's own MCP server for the agent, which provides `ask_human`. */
export interface AgentMcp {
  url: string;
  token: string;
  toolTimeoutSec: number;
}

export interface AgentAdapter {
  invocation(route: Route, prompt: string, cwd: string, secrets: Record<string, string>, mcp?: AgentMcp): Invocation;
  parser(): StreamParser;
}

export function emptyOutcome(): Outcome {
  return {
    ok: false,
    summary: null,
    error: null,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    costUsd: null,
    numTurns: null,
    sessionId: null,
    version: null,
  };
}

export function oneLine(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
