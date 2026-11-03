import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer as createNetServer } from "node:net";
import { join } from "node:path";
import { handleMcpBody, type McpTool } from "../src/mcp.ts";
import { Questions } from "../src/questions.ts";
import { Store } from "../src/db.ts";
import { createWebServer } from "../src/web.ts";
import { drain, setup, type FakeIssue } from "./helpers.ts";

const echo: McpTool = {
  name: "echo",
  description: "Echoes",
  inputSchema: { type: "object", properties: { text: { type: "string" } } },
  async handler(args) {
    if (args.text === "boom") throw new Error("it broke");
    return { said: args.text };
  },
};
const info = { name: "t", version: "1.0.0" };
const ctx = { caller: "test" };

test("initialize negotiates a supported protocol version", async () => {
  const r = (await handleMcpBody(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }), [echo], info, ctx)) as any;
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  const old = (await handleMcpBody(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }), [echo], info, ctx)) as any;
  assert.equal(old.result.protocolVersion, "2025-11-25");
});

test("tools are listed and called, and tool errors come back as isError results", async () => {
  const list = (await handleMcpBody(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }), [echo], info, ctx)) as any;
  assert.equal(list.result.tools[0].name, "echo");
  const call = (await handleMcpBody(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } }), [echo], info, ctx)) as any;
  assert.deepEqual(call.result.structuredContent, { said: "hi" });
  assert.match(call.result.content[0].text, /"said": "hi"/);
  const fail = (await handleMcpBody(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "boom" } } }), [echo], info, ctx)) as any;
  assert.equal(fail.result.isError, true);
  assert.equal(fail.result.content[0].text, "it broke");
});

test("notifications get no response and unknown methods get an error", async () => {
  assert.equal(await handleMcpBody(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), [echo], info, ctx), null);
  const r = (await handleMcpBody(JSON.stringify({ jsonrpc: "2.0", id: 9, method: "resources/list" }), [echo], info, ctx)) as any;
  assert.equal(r.error.code, -32601);
  const bad = (await handleMcpBody("{nope", [echo], info, ctx)) as any;
  assert.equal(bad.error.code, -32700);
});

test("an unanswered question expires and the agent is told to carry on", async () => {
  const store = new Store(":memory:");
  const questions = new Questions(store);
  let asked = 0;
  const result = await questions.ask(1, "Blue or green?", 30, undefined, () => asked++);
  assert.deepEqual(result, { answer: null, by: null });
  assert.equal(asked, 1);
  assert.equal(store.questionsFor(1)[0]!.status, "expired");
  assert.equal(questions.answer(store.questionsFor(1)[0]!.id, "late", "me"), false);
});

/** A stand-in for Claude Code that asks a question through Rainmaker's agent MCP endpoint and commits the answer. */
const ASKING_AGENT = `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const server = JSON.parse(args[args.indexOf("--mcp-config") + 1]).mcpServers.rainmaker;
let prompt = "";
process.stdin.on("data", (d) => (prompt += d));
process.stdin.on("end", async () => {
  const res = await fetch(server.url, {
    method: "POST",
    headers: { ...server.headers, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "ask_human", arguments: { question: "Blue or green?" } } }),
  });
  const data = await res.json();
  fs.writeFileSync("answer.txt", data.result.content[0].text + "\\n" + (prompt.includes("ask_human") ? "prompt mentions ask_human" : ""));
  console.log(JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Used the answer.", num_turns: 1, usage: { input_tokens: 1, output_tokens: 1 } }));
});
`;

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function withServer(issues: FakeIssue[], fn: (env: ReturnType<typeof setup> & { base: string; rpc: (method: string, params?: object, token?: string) => Promise<any> }) => Promise<void>) {
  const port = await freePort();
  const env = setup(issues, { agent: ASKING_AGENT, agentMcpUrl: `http://127.0.0.1:${port}/mcp/agent` });
  const server = createWebServer({ store: env.store, config: env.config, engine: env.engine, clis: env.clis, questions: env.questions, version: "test" });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const base = `http://127.0.0.1:${port}`;
  let id = 0;
  const rpc = async (method: string, params: object = {}, token = env.config.mcpToken) => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    return res.status === 200 ? res.json() : { status: res.status };
  };
  try {
    await fn({ ...env, base, rpc });
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

async function until(check: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}

test("the Hermes endpoint needs the bearer token and lists its tools", async () => {
  await withServer([], async ({ rpc, base }) => {
    assert.deepEqual(await rpc("tools/list", {}, "wrong"), { status: 401 });
    const get = await fetch(`${base}/mcp`);
    assert.equal(get.status, 405);
    const list = await rpc("tools/list");
    const names = list.result.tools.map((t: { name: string }) => t.name);
    assert.deepEqual(names, ["list_repos", "list_jobs", "get_job", "create_task", "start_issue", "retry_job", "retry_with_comments", "open_daily_pr", "cancel_job", "list_questions", "answer_question", "get_stats"]);
    const repos = await rpc("tools/call", { name: "list_repos", arguments: {} });
    assert.deepEqual(repos.result.structuredContent.repos, ["o/r"]);
    const daily = await rpc("tools/call", { name: "open_daily_pr", arguments: { repo: "o/r" } });
    assert.equal(daily.result.isError, true);
    assert.match(daily.result.content[0].text, /no daily branch yet/);
    // The agent endpoint refuses tokens that don't belong to a running job.
    const agent = await fetch(`${base}/mcp/agent`, { method: "POST", headers: { authorization: "Bearer nope" }, body: "{}" });
    assert.equal(agent.status, 401);
  });
});

test("create_task opens a labeled issue that Rainmaker queues", async () => {
  const issues: FakeIssue[] = [];
  await withServer(issues, async ({ rpc, store }) => {
    const bad = await rpc("tools/call", { name: "create_task", arguments: { repo: "o/r", title: "x", body: "y", model: "gpt-9" } });
    assert.equal(bad.result.isError, true);
    assert.match(bad.result.content[0].text, /model:gpt-9/);
    const other = await rpc("tools/call", { name: "create_task", arguments: { repo: "someone/else", title: "x", body: "y" } });
    assert.match(other.result.content[0].text, /isn't one of the watched repos/);

    const res = await rpc("tools/call", { name: "create_task", arguments: { repo: "o/r", title: "Add a pause menu", body: "Esc opens it.", model: "codex" } });
    assert.equal(res.result.isError, undefined);
    assert.equal(issues[0]!.title, "Add a pause menu");
    assert.ok(issues[0]!.labels.includes("model:codex"));
    // The issue was created with agent:ready, so the immediate poll picks it up.
    await until(() => store.listJobs().length === 1);
    assert.equal(store.listJobs()[0]!.route, "codex");
  });
});

test("an agent's question reaches Hermes and the answer reaches the agent", async () => {
  const issue: FakeIssue = { number: 21, title: "Pick a color", body: "Recolor the HUD.", state: "open", labels: ["agent:ready"], labeledBy: "gxfield" };
  await withServer([issue], async ({ engine, rpc, store, questions, gh, remotes }) => {
    await engine.poll();
    engine.tick();
    await until(() => questions.pending().length === 1);
    await until(() => gh.comments.some((c) => c.body.includes("has a question")));
    assert.match(gh.comments.find((c) => c.body.includes("has a question"))!.body, /> Blue or green\?/);

    const listed = await rpc("tools/call", { name: "list_questions", arguments: {} });
    const q = listed.result.structuredContent.questions[0];
    assert.equal(q.question, "Blue or green?");
    assert.equal(q.issue, 21);
    const answered = await rpc("tools/call", { name: "answer_question", arguments: { question_id: q.question_id, answer: "Green" } });
    assert.deepEqual(answered.result.structuredContent, { answered: q.question_id });

    await drain(engine);
    const job = store.getJob(1)!;
    assert.equal(job.status, "succeeded", job.error ?? "");
    const file = execFileSync("git", ["--git-dir", join(remotes, "o", "r.git"), "show", "rainmaker/issue-21:answer.txt"], { encoding: "utf8" });
    assert.match(file, /Answer from MCP:\n\nGreen/);
    assert.match(file, /prompt mentions ask_human/);
    assert.equal(store.questionsFor(1)[0]!.answered_by, "MCP");

    const detail = await rpc("tools/call", { name: "get_job", arguments: { job_id: 1, log_lines: 300 } });
    assert.ok(detail.result.structuredContent.log_tail.some((l: string) => l.includes("Answer from MCP: Green")));
  });
});

test("a GitHub comment from an allowed user answers a pending question", async () => {
  const issue: FakeIssue = { number: 22, title: "Pick a color", body: "Recolor the HUD.", state: "open", labels: ["agent:ready"], labeledBy: "gxfield" };
  await withServer([issue], async ({ engine, store, questions, gh, remotes }) => {
    await engine.poll();
    engine.tick();
    await until(() => questions.pending().length === 1);
    gh.thread.push({ user: { login: "stranger" }, body: "Red!", created_at: new Date(Date.now() + 1000).toISOString() });
    await engine.poll();
    assert.equal(questions.pending().length, 1, "comments from users who aren't allowed are ignored");
    gh.thread.push({ user: { login: "gxfield" }, body: "Blue, please.", created_at: new Date(Date.now() + 1000).toISOString() });
    await engine.poll();
    await drain(engine);
    assert.equal(store.getJob(1)!.status, "succeeded");
    const file = execFileSync("git", ["--git-dir", join(remotes, "o", "r.git"), "show", "rainmaker/issue-22:answer.txt"], { encoding: "utf8" });
    assert.match(file, /Answer from @gxfield on GitHub:\n\nBlue, please\./);
  });
});

test("a finished job's page and Hermes can retry its PR with the comments", async () => {
  const pr: FakeIssue = { number: 101, title: "Add a menu", body: "Closes #7", state: "open", labels: [], labeledBy: "gxfield", pull: { head: "rainmaker/issue-7", base: "main" } };
  await withServer([pr], async ({ base, store, clis, rpc }) => {
    (clis as { busy: boolean }).busy = true; // queue jobs without running them
    const job = store.createJob({ repo: "o/r", issue_number: 7, issue_title: "Add a menu", route: "opus", agent: "claude", model: "opus", provider: "default", skills: [] });
    store.finishJob(job.id, "succeeded", { pr_url: "https://github.com/o/r/pull/101", pr_number: 101 });
    const queued = async (id: number) => {
      await until(() => store.getJob(id)?.status === "queued");
      return store.getJob(id)!;
    };

    const res = await fetch(`${base}/api/jobs/${job.id}/retry-comments`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: "haiku" }) });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).pr, 101);
    const fromButton = await queued(2);
    assert.equal(fromButton.issue_number, 101);
    assert.equal(fromButton.route, "haiku");

    const busy = await rpc("tools/call", { name: "retry_with_comments", arguments: { repo: "o/r", pr_number: 101 } });
    assert.match(busy.result.content[0].text, /already has a job queued or running/);
    store.finishJob(2, "cancelled");
    const call = await rpc("tools/call", { name: "retry_with_comments", arguments: { job_id: job.id } });
    assert.equal(call.result.structuredContent.pr, 101);
    assert.equal((await queued(3)).route, "opus", "the PR's last route is reused");

    const noPr = store.createJob({ repo: "o/r", issue_number: 8, issue_title: "No PR", route: "opus", agent: "claude", model: "opus", provider: "default", skills: [] });
    store.finishJob(noPr.id, "failed");
    const refused = await fetch(`${base}/api/jobs/${noPr.id}/retry-comments`, { method: "POST" });
    assert.equal(refused.status, 400);
    assert.match((await refused.json()).error, /has no pull request/);
  });
});
