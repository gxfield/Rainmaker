import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWebServer } from "../src/web.ts";
import { setup } from "./helpers.ts";

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = createNetServer().listen(0, "127.0.0.1", () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/** A fake built dashboard: index.html plus one hashed asset. */
function webDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rm-web-"));
  mkdirSync(join(dir, "assets"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><div id=root></div>");
  writeFileSync(join(dir, "assets", "index-abc.js"), "console.log(1)");
  return dir;
}

async function withApi(fn: (env: ReturnType<typeof setup> & { base: string; call: (path: string, init?: { method?: string; body?: unknown; origin?: string }) => Promise<{ status: number; data: any }> }) => Promise<void>, dir = webDir()) {
  const port = await freePort();
  const env = setup([]);
  const server = createWebServer({ store: env.store, config: env.config, engine: env.engine, clis: env.clis, questions: env.questions, version: "test", webDir: dir });
  await new Promise<void>((r) => server.listen(port, "127.0.0.1", r));
  const base = `http://127.0.0.1:${port}`;
  const call = async (path: string, init: { method?: string; body?: unknown; origin?: string } = {}) => {
    const headers: Record<string, string> = {};
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (init.origin) headers.origin = init.origin;
    const res = await fetch(`${base}/api/${path}`, { method: init.method ?? "GET", headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
    return { status: res.status, data: await res.json() };
  };
  try {
    await fn({ ...env, base, call });
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}

const newJob = (env: ReturnType<typeof setup>, title = "Fix it") =>
  env.store.createJob({ repo: "o/r", issue_number: 7, issue_title: title, route: "sonnet", agent: "claude", model: "sonnet", provider: "default", skills: [] });

test("the overview, jobs and job detail feed the dashboard", async () => {
  await withApi(async (env) => {
    const job = newJob(env);
    env.store.finishJob(job.id, "succeeded", { summary: "Done.", input_tokens: 10, output_tokens: 5 });
    const q = env.store.createQuestion(job.id, "Which colour?");

    const overview = await env.call("overview");
    assert.equal(overview.status, 200);
    assert.deepEqual(overview.data.repos, ["o/r"]);
    assert.deepEqual(overview.data.setup, []);
    assert.equal(overview.data.questions[0].id, q.id);
    assert.equal(overview.data.questions[0].job.issue_title, "Fix it");

    const jobs = await env.call("jobs?limit=5");
    assert.equal(jobs.data.length, 1);
    assert.equal(jobs.data[0].running, false);

    const detail = await env.call(`jobs/${job.id}`);
    assert.equal(detail.data.summary, "Done.");
    assert.deepEqual(detail.data.log, { text: "", truncated: false });
    assert.equal(detail.data.questions[0].question, "Which colour?");

    const missing = await env.call("jobs/999");
    assert.equal(missing.status, 404);
    assert.match(missing.data.error, /No job #999/);
  });
});

test("stats cover whole days and include the window before", async () => {
  await withApi(async (env) => {
    newJob(env);
    const finished = newJob(env);
    env.store.finishJob(finished.id, "failed", { input_tokens: 100, output_tokens: 20 });
    const stats = (await env.call("stats?days=7")).data;
    assert.equal(stats.days, 7);
    assert.equal(stats.total, 2);
    assert.equal(stats.failed, 1);
    assert.equal(stats.success_rate, 0);
    assert.equal(stats.daily.length, 7);
    assert.equal(stats.daily.at(-1).total, 2, "today's bucket holds today's jobs");
    assert.equal(stats.daily.reduce((n: number, d: { total: number }) => n + d.total, 0), stats.total, "the chart and the totals agree");
    assert.equal(stats.previous.total, 0);
    assert.equal(stats.by_route[0].key, "sonnet");
  });
});

test("settings save in parts, keep the token secret, and reject bad input", async () => {
  await withApi(async (env) => {
    const before = (await env.call("settings")).data;
    assert.equal(before.githubTokenSet, true);
    assert.ok(!JSON.stringify(before).includes("ghp_faketoken123"), "the GitHub token is never sent back");
    assert.ok(!JSON.stringify(before).includes("sk-or-supersecret"), "secret values are never sent back");
    assert.deepEqual(before.secrets.map((s: { name: string }) => s.name), ["OPENROUTER_API_KEY"]);

    const saved = await env.call("settings", { method: "PUT", body: { pollIntervalSec: "90", dailyBranch: true } });
    assert.equal(saved.status, 200);
    assert.equal(saved.data.settings.pollIntervalSec, 90);
    assert.equal(saved.data.settings.dailyBranch, true);
    assert.deepEqual(saved.data.settings.repos, ["o/r"], "fields left out keep their values");

    const bad = await env.call("settings", { method: "PUT", body: { routes: "{not json" } });
    assert.equal(bad.status, 400);
    assert.equal(env.config.settings.pollIntervalSec, 90, "a failed save changes nothing");
  });
});

test("secrets can be added and deleted, and cross-site writes are refused", async () => {
  await withApi(async (env) => {
    const added = await env.call("secrets", { method: "POST", body: { name: "EXTRA_KEY", value: "v1" } });
    assert.ok(added.data.secrets.some((s: { name: string }) => s.name === "EXTRA_KEY"));
    const removed = await env.call("secrets/EXTRA_KEY", { method: "DELETE" });
    assert.ok(!removed.data.secrets.some((s: { name: string }) => s.name === "EXTRA_KEY"));

    const forged = await env.call("secrets", { method: "POST", body: { name: "EVIL", value: "x" }, origin: "https://evil.example" });
    assert.equal(forged.status, 403);
    assert.ok(!env.config.secretNames().some((s) => s.name === "EVIL"));
  });
});

test("questions are answered through the API, once", async () => {
  await withApi(async (env) => {
    const job = newJob(env);
    const q = env.store.createQuestion(job.id, "Ship it?");
    const empty = await env.call(`questions/${q.id}/answer`, { method: "POST", body: { answer: "  " } });
    assert.equal(empty.status, 400);
    const ok = await env.call(`questions/${q.id}/answer`, { method: "POST", body: { answer: "Yes" } });
    assert.deepEqual(ok.data, { ok: true });
    const again = await env.call(`questions/${q.id}/answer`, { method: "POST", body: { answer: "No" } });
    assert.equal(again.status, 409);
    assert.equal((await env.call("questions")).data.length, 0);
  });
});

test("the built dashboard is served for any page path, and files outside it are not", async () => {
  await withApi(async ({ base }) => {
    const home = await fetch(`${base}/`);
    assert.equal(home.headers.get("content-type"), "text/html; charset=utf-8");
    assert.match(await home.text(), /id=root/);
    assert.match(await (await fetch(`${base}/jobs/3`)).text(), /id=root/, "old page paths still load the app");

    const asset = await fetch(`${base}/assets/index-abc.js`);
    assert.equal(asset.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);

    const escape = await fetch(`${base}/..%2f..%2fetc%2fhostname`);
    assert.match(await escape.text(), /id=root/, "a path that climbs out of the build gets the app, not the file");

    const unknownApi = await fetch(`${base}/api/nope`);
    assert.equal(unknownApi.status, 404);
  });
});

test("a missing build gets a short explanation instead of a blank page", async () => {
  await withApi(async ({ base }) => {
    assert.match(await (await fetch(`${base}/`)).text(), /dashboard hasn't been built/);
  }, mkdtempSync(join(tmpdir(), "rm-empty-")));
});
