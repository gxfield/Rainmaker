import type { Route } from "../settings.ts";
import { emptyOutcome, oneLine, type AgentAdapter, type Invocation, type Outcome, type StreamParser } from "./types.ts";

type Json = Record<string, any>;

/** Codex in `exec` mode with JSON Lines output. The container is the sandbox, so Codex runs with full access inside it. */
export const codexAdapter: AgentAdapter = {
  invocation(route: Route, prompt: string, cwd: string, secrets: Record<string, string>): Invocation {
    const args = [
      "exec",
      "--json",
      "--dangerously-bypass-approvals-and-sandbox",
      "--skip-git-repo-check",
      "-C",
      cwd,
    ];
    if (route.model) args.push("-m", route.model);
    if (route.provider === "openrouter") {
      if (!secrets.OPENROUTER_API_KEY) throw new Error("This route uses OpenRouter, but no OPENROUTER_API_KEY secret is set");
      args.push(
        "-c",
        'model_provider="openrouter"',
        "-c",
        'model_providers.openrouter.name="OpenRouter"',
        "-c",
        'model_providers.openrouter.base_url="https://openrouter.ai/api/v1"',
        "-c",
        'model_providers.openrouter.env_key="OPENROUTER_API_KEY"',
      );
    }
    args.push("-"); // read the prompt from stdin
    return { args, env: {}, stdin: prompt };
  },

  parser(): StreamParser {
    const outcome: Outcome = emptyOutcome();
    let completedTurns = 0;
    let failed: string | null = null;
    // "error" events are often transient (e.g. "Reconnecting..."), so they only explain a non-zero exit.
    let lastError: string | null = null;
    const add = (key: "inputTokens" | "outputTokens" | "cachedTokens", n: unknown) => {
      if (typeof n === "number") outcome[key] = (outcome[key] ?? 0) + n;
    };
    return {
      feed(line: string): string | undefined {
        let msg: Json;
        try {
          msg = JSON.parse(line);
        } catch {
          return line.trim() || undefined;
        }
        switch (msg.type) {
          case "thread.started":
            outcome.sessionId = msg.thread_id ?? null;
            return "▶ Codex started";
          case "turn.completed":
            completedTurns++;
            add("inputTokens", msg.usage?.input_tokens);
            add("cachedTokens", msg.usage?.cached_input_tokens);
            add("outputTokens", (msg.usage?.output_tokens ?? 0) + (msg.usage?.reasoning_output_tokens ?? 0));
            return undefined;
          case "turn.failed":
            failed = msg.error?.message ?? "Codex turn failed";
            return `✖ ${failed}`;
          case "error":
            lastError = msg.message ?? "Codex reported an error";
            return `… ${lastError}`;
          case "item.completed": {
            const item = msg.item ?? {};
            const kind = item.type ?? item.item_type;
            if (kind === "agent_message" || kind === "assistant_message") {
              if (item.text) outcome.summary = item.text;
              return item.text?.trim() || undefined;
            }
            if (kind === "command_execution") return `⚙ ${oneLine(String(item.command ?? ""), 160)} (exit ${item.exit_code ?? "?"})`;
            if (kind === "file_change") {
              const files = (item.changes ?? []).map((c: Json) => c.path).filter(Boolean);
              return `✎ ${files.length ? files.join(", ") : "files changed"}`;
            }
            if (kind === "mcp_tool_call") return `⚙ ${item.server ?? "mcp"}.${item.tool ?? "tool"}`;
            if (kind === "error") return `… ${item.message ?? "error"}`;
            return undefined;
          }
          default:
            return undefined;
        }
      },
      outcome(exitCode: number): Outcome {
        outcome.numTurns = completedTurns || null;
        outcome.ok = exitCode === 0 && !failed;
        if (!outcome.ok) outcome.error = failed ?? lastError ?? `Codex exited with code ${exitCode}`;
        return outcome;
      },
    };
  },
};
