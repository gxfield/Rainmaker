import { test } from "node:test";
import assert from "node:assert/strict";
import { claudeAdapter } from "../src/agents/claude.ts";
import { codexAdapter } from "../src/agents/codex.ts";

test("Claude invocation is headless and routes OpenRouter through env", () => {
  const plain = claudeAdapter.invocation({ agent: "claude", model: "opus" }, "do it", "/w", {});
  assert.deepEqual(plain.args.slice(0, 2), ["-p", "--output-format"]);
  assert.ok(plain.args.includes("bypassPermissions"));
  assert.deepEqual(plain.args.slice(-2), ["--model", "opus"]);
  assert.equal(plain.stdin, "do it");
  assert.equal(plain.env.ANTHROPIC_BASE_URL, undefined);

  const or = claudeAdapter.invocation({ agent: "claude", model: "qwen/qwen3-coder", provider: "openrouter" }, "x", "/w", {
    OPENROUTER_API_KEY: "sk-or",
  });
  assert.equal(or.env.ANTHROPIC_BASE_URL, "https://openrouter.ai/api");
  assert.equal(or.env.ANTHROPIC_AUTH_TOKEN, "sk-or");
  assert.ok("CLAUDE_CODE_OAUTH_TOKEN" in or.env && or.env.CLAUDE_CODE_OAUTH_TOKEN === undefined);
  assert.equal(or.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "qwen/qwen3-coder");
  assert.equal(or.env.ANTHROPIC_DEFAULT_OPUS_MODEL, "qwen/qwen3-coder");
  assert.throws(() => claudeAdapter.invocation({ agent: "claude", provider: "openrouter" }, "x", "/w", {}), /OPENROUTER_API_KEY/);
});

test("Claude stream parser reports text, tools and the final result", () => {
  const p = claudeAdapter.parser();
  assert.match(p.feed(JSON.stringify({ type: "system", subtype: "init", session_id: "s1", model: "claude-opus", claude_code_version: "2.1.300" }))!, /2\.1\.300/);
  assert.equal(
    p.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] } })),
    "⚙ Bash: npm test",
  );
  p.feed(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Fixed the bug." }] } }));
  p.feed(
    JSON.stringify({
      type: "result",
      subtype: "success",
      is_error: false,
      result: "## Summary\nFixed the bug.",
      total_cost_usd: 0.42,
      num_turns: 7,
      usage: { input_tokens: 100, cache_read_input_tokens: 900, cache_creation_input_tokens: 50, output_tokens: 300 },
    }),
  );
  const o = p.outcome(0);
  assert.equal(o.ok, true);
  assert.equal(o.summary, "## Summary\nFixed the bug.");
  assert.equal(o.inputTokens, 1050);
  assert.equal(o.cachedTokens, 900);
  assert.equal(o.outputTokens, 300);
  assert.equal(o.costUsd, 0.42);
  assert.equal(o.version, "2.1.300");
});

test("Claude parser fails when the CLI dies before a result", () => {
  const p = claudeAdapter.parser();
  p.feed("not json at all");
  const o = p.outcome(1);
  assert.equal(o.ok, false);
  assert.match(o.error!, /before reporting a result/);
});

test("Claude parser surfaces error results", () => {
  const p = claudeAdapter.parser();
  p.feed(JSON.stringify({ type: "result", subtype: "error_max_turns", is_error: true, num_turns: 50 }));
  const o = p.outcome(1);
  assert.equal(o.ok, false);
  assert.match(o.error!, /error_max_turns/);
});

test("Codex invocation reads the prompt from stdin with full access", () => {
  const inv = codexAdapter.invocation({ agent: "codex", model: "gpt-5-codex" }, "task", "/work", {});
  assert.equal(inv.args[0], "exec");
  assert.ok(inv.args.includes("--json"));
  assert.ok(inv.args.includes("--dangerously-bypass-approvals-and-sandbox"));
  assert.deepEqual(inv.args.slice(-3), ["-m", "gpt-5-codex", "-"]);
  const or = codexAdapter.invocation({ agent: "codex", provider: "openrouter" }, "task", "/work", { OPENROUTER_API_KEY: "k" });
  assert.ok(or.args.includes('model_provider="openrouter"'));
});

test("Codex parser sums usage across turns and keeps the last message", () => {
  const p = codexAdapter.parser();
  p.feed(JSON.stringify({ type: "thread.started", thread_id: "t1" }));
  assert.equal(p.feed(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "npm test", exit_code: 0 } })), "⚙ npm test (exit 0)");
  p.feed(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5, reasoning_output_tokens: 2 } }));
  p.feed(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Done: updated the HUD." } }));
  p.feed(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, cached_input_tokens: 0, output_tokens: 1 } }));
  const o = p.outcome(0);
  assert.equal(o.ok, true);
  assert.equal(o.sessionId, "t1");
  assert.equal(o.inputTokens, 30);
  assert.equal(o.outputTokens, 8);
  assert.equal(o.cachedTokens, 4);
  assert.equal(o.numTurns, 2);
  assert.equal(o.summary, "Done: updated the HUD.");
});

test("Codex parser treats turn.failed as a failure even with exit 0", () => {
  const p = codexAdapter.parser();
  p.feed(JSON.stringify({ type: "turn.failed", error: { message: "usage limit reached" } }));
  const o = p.outcome(0);
  assert.equal(o.ok, false);
  assert.equal(o.error, "usage limit reached");
});

test("Codex transient errors don't fail a run that exits cleanly", () => {
  const p = codexAdapter.parser();
  assert.match(p.feed(JSON.stringify({ type: "error", message: "Reconnecting... waiting for network" }))!, /Reconnecting/);
  p.feed(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }));
  assert.equal(p.outcome(0).ok, true);
  const q = codexAdapter.parser();
  q.feed(JSON.stringify({ type: "error", message: "Not logged in" }));
  const o = q.outcome(1);
  assert.equal(o.ok, false);
  assert.equal(o.error, "Not logged in");
});
