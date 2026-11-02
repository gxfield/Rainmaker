import type { Route } from "../settings.ts";
import { emptyOutcome, oneLine, type AgentAdapter, type Invocation, type Outcome, type StreamParser } from "./types.ts";

type Json = Record<string, any>;

const AUTH_ERROR = /failed to authenticate|not logged in|invalid (auth|bearer|api key|oauth)|oauth access token/i;
const AUTH_HINT =
  "Claude Code couldn't sign in: check the CLAUDE_CODE_OAUTH_TOKEN secret in Settings (or OPENROUTER_API_KEY for OpenRouter routes)";

/** Claude Code in print mode with stream-json output. */
export const claudeAdapter: AgentAdapter = {
  invocation(route: Route, prompt: string, _cwd: string, secrets: Record<string, string>): Invocation {
    const args = ["-p", "--output-format", "stream-json", "--verbose", "--permission-mode", "bypassPermissions"];
    if (route.model) args.push("--model", route.model);
    const env: Record<string, string | undefined> = {
      DISABLE_AUTOUPDATER: "1",
      CLAUDE_CODE_DISABLE_FEEDBACK_SURVEY: "1",
      IS_SANDBOX: "1",
    };
    if (route.provider === "openrouter") {
      const key = secrets.OPENROUTER_API_KEY;
      if (!key) throw new Error("This route uses OpenRouter, but no OPENROUTER_API_KEY secret is set");
      env.ANTHROPIC_BASE_URL = "https://openrouter.ai/api";
      env.ANTHROPIC_AUTH_TOKEN = key;
      env.ANTHROPIC_API_KEY = "";
      env.CLAUDE_CODE_OAUTH_TOKEN = undefined;
      if (route.model) {
        // Claude Code also calls the haiku/sonnet/opus aliases for background work and subagents.
        // OpenRouter doesn't know those names, so point every alias at the route's model.
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = route.model;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = route.model;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = route.model;
      }
    }
    return { args, env, stdin: prompt };
  },

  parser(): StreamParser {
    const outcome: Outcome = emptyOutcome();
    let sawResult = false;
    let lastText: string | null = null;
    return {
      feed(line: string): string | undefined {
        let msg: Json;
        try {
          msg = JSON.parse(line);
        } catch {
          return line.trim() || undefined;
        }
        if (msg.type === "system" && msg.subtype === "init") {
          outcome.sessionId = msg.session_id ?? null;
          outcome.version = msg.claude_code_version ?? null;
          return `▶ Claude Code ${msg.claude_code_version ?? ""} started (model ${msg.model ?? "default"})`;
        }
        if (msg.type === "system" && msg.subtype === "api_retry") {
          return `… API retry ${msg.attempt}/${msg.max_retries} (${msg.error ?? "error"})`;
        }
        if (msg.type === "assistant") {
          const out: string[] = [];
          for (const block of msg.message?.content ?? []) {
            if (block.type === "text" && block.text?.trim()) {
              if (!msg.parent_tool_use_id) lastText = block.text;
              out.push(block.text.trim());
            } else if (block.type === "tool_use") {
              const input = block.input ?? {};
              const hint = input.command ?? input.file_path ?? input.pattern ?? input.description ?? "";
              out.push(`⚙ ${block.name}${hint ? `: ${oneLine(String(hint), 160)}` : ""}`);
            }
          }
          return out.join("\n") || undefined;
        }
        if (msg.type === "result") {
          sawResult = true;
          outcome.ok = msg.is_error !== true && msg.subtype === "success";
          outcome.summary = typeof msg.result === "string" && msg.result.trim() ? msg.result : lastText;
          if (!outcome.ok) {
            outcome.error = typeof msg.result === "string" && msg.result ? oneLine(msg.result, 500) : `Claude Code ended with ${msg.subtype}`;
            if (AUTH_ERROR.test(outcome.error)) outcome.error += `. ${AUTH_HINT}`;
          }
          outcome.costUsd = typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null;
          outcome.numTurns = typeof msg.num_turns === "number" ? msg.num_turns : null;
          const usage = msg.usage ?? {};
          outcome.inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
          outcome.outputTokens = usage.output_tokens ?? null;
          outcome.cachedTokens = usage.cache_read_input_tokens ?? null;
          outcome.sessionId = msg.session_id ?? outcome.sessionId;
          return `■ Finished: ${outcome.ok ? msg.subtype : "error"}${outcome.numTurns != null ? `, ${outcome.numTurns} turns` : ""}`;
        }
        return undefined;
      },
      outcome(exitCode: number): Outcome {
        if (!sawResult) {
          outcome.ok = false;
          outcome.summary = lastText;
          outcome.error = `Claude Code exited with code ${exitCode} before reporting a result`;
        } else if (exitCode !== 0 && outcome.ok) {
          outcome.ok = false;
          outcome.error = `Claude Code exited with code ${exitCode}`;
        }
        return outcome;
      },
    };
  },
};
