import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clis } from "../src/clis.ts";
import { SecretBox } from "../src/crypto.ts";
import { Store } from "../src/db.ts";
import { dailyBranchName } from "../src/daily.ts";
import { Engine, agentEnv } from "../src/engine.ts";
import { GitHub } from "../src/github.ts";
import { Config, DEFAULT_SETTINGS } from "../src/settings.ts";
import { Toolchains } from "../src/toolchain.ts";
import { Workspace } from "../src/workspace.ts";

interface FakeIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  labeledBy: string;
}

/** An in-memory stand-in for the parts of the GitHub API Rainmaker calls. */
function fakeGitHub(issues: FakeIssue[], bare?: string) {
  const comments: { number: number; body: string }[] = [];
  const pulls: { title: string; head: string; base: string; body: string }[] = [];
  /** PRs the test marks as merged, for the daily-branch PR. */
  const merged: { number: number; title: string; head: string; base: string; body: string }[] = [];
  const git = (...args: string[]) => execFileSync("git", ["--git-dir", bare!, ...args], { encoding: "utf8" }).trim();
  const reply = (status: number, data?: unknown) =>
    new Response(data === undefined ? null : JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const path = url.pathname;
    const issueOf = (n: string) => issues.find((i) => i.number === Number(n))!;
    const asJson = (i: FakeIssue) => ({ ...i, user: { login: "gxfield" }, labels: i.labels.map((name) => ({ name })), html_url: `https://github.com/o/r/issues/${i.number}` });
    let m: RegExpExecArray | null;
    if (path === "/user") return reply(200, { login: "gxfield", id: 729558 });
    if (path === "/repos/o/r" && method === "GET") return reply(200, { default_branch: "main" });
    if (path === "/repos/o/r/labels" && method === "POST") return reply(201, {});
    if (path === "/repos/o/r/issues" && method === "GET") {
      const label = url.searchParams.get("labels")!;
      return reply(200, issues.filter((i) => i.state === "open" && i.labels.includes(label)).map(asJson));
    }
    if ((m = /^\/repos\/o\/r\/issues\/(\d+)$/.exec(path))) return reply(200, asJson(issueOf(m[1]!)));
    if ((m = /^\/repos\/o\/r\/issues\/(\d+)\/events$/.exec(path))) {
      const i = issueOf(m[1]!);
      return reply(200, [{ event: "labeled", label: { name: "agent:ready" }, actor: { login: i.labeledBy } }]);
    }
    if ((m = /^\/repos\/o\/r\/issues\/(\d+)\/comments$/.exec(path))) {
      if (method === "POST") {
        comments.push({ number: Number(m[1]), body: body.body });
        return reply(201, {});
      }
      return reply(200, [{ user: { login: "gxfield" }, body: "Please keep it small.", created_at: "" }]);
    }
    if ((m = /^\/repos\/o\/r\/issues\/(\d+)\/labels$/.exec(path)) && method === "POST") {
      const i = issueOf(m[1]!);
      for (const l of body.labels) if (!i.labels.includes(l)) i.labels.push(l);
      return reply(200, []);
    }
    if ((m = /^\/repos\/o\/r\/issues\/(\d+)\/labels\/(.+)$/.exec(path)) && method === "DELETE") {
      const i = issueOf(m[1]!);
      const name = decodeURIComponent(m[2]!);
      if (!i.labels.includes(name)) return reply(404, { message: "Label does not exist" });
      i.labels = i.labels.filter((l) => l !== name);
      return reply(200, []);
    }
    if ((m = /^\/repos\/o\/r\/git\/matching-refs\/heads\/(.+)$/.exec(path))) {
      const refs = git("for-each-ref", "--format=%(refname)", "refs/heads/").split("\n").filter((r) => r.startsWith(`refs/heads/${m![1]}`));
      return reply(200, refs.map((ref) => ({ ref })));
    }
    if ((m = /^\/repos\/o\/r\/compare\/(.+)\.\.\.(.+)$/.exec(path))) {
      return reply(200, { ahead_by: Number(git("rev-list", "--count", `${m[1]}..${m[2]}`)) });
    }
    if (path === "/repos/o/r/pulls" && method === "GET" && url.searchParams.get("state") === "closed") {
      const base = url.searchParams.get("base");
      return reply(200, merged.filter((p) => p.base === base).map((p) => ({ ...p, head: { ref: p.head }, merged_at: "2026-11-02T12:00:00Z" })));
    }
    if (path === "/repos/o/r/pulls" && method === "POST") {
      pulls.push(body);
      return reply(201, { number: 100 + pulls.length, html_url: `https://github.com/o/r/pull/${100 + pulls.length}` });
    }
    return reply(404, { message: `unhandled ${method} ${path}` });
  }) as typeof fetch;
  return { fetchImpl, comments, pulls, merged };
}

/** A stand-in for Claude Code: edits a file, then prints stream-json like the real CLI. */
const FAKE_CLAUDE = `#!/bin/sh
prompt=$(cat)
case "$prompt" in *"make no changes"*) ;; *) echo "fixed" > fix.txt ;; esac
echo '{"type":"system","subtype":"init","session_id":"s1","model":"sonnet","claude_code_version":"9.9.9"}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"fix.txt"}}]}}'
echo "secret is $OPENROUTER_API_KEY" >&2
echo '{"type":"result","subtype":"success","is_error":false,"result":"Wrote fix.txt.","total_cost_usd":0.1,"num_turns":3,"usage":{"input_tokens":10,"output_tokens":20}}'
`;

function setup(issues: FakeIssue[]) {
  const root = mkdtempSync(join(tmpdir(), "rm-engine-"));
  const dataDir = join(root, "data");
  mkdirSync(dataDir);
  // A local "GitHub" remote with one commit on main.
  const remotes = join(root, "remotes");
  const seed = join(root, "seed");
  mkdirSync(join(remotes, "o"), { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", seed]);
  writeFileSync(join(seed, "README.md"), "hello\n");
  mkdirSync(join(seed, ".claude", "skills", "qa"), { recursive: true });
  writeFileSync(join(seed, ".claude", "skills", "qa", "SKILL.md"), "---\nname: qa\n---\nRun the tests.\n");
  execFileSync("git", ["-C", seed, "add", "."]);
  execFileSync("git", ["-C", seed, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init"]);
  execFileSync("git", ["clone", "-q", "--bare", seed, join(remotes, "o", "r.git")]);

  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
  chmodSync(join(bin, "claude"), 0o755);

  const store = new Store(":memory:");
  const config = new Config(store, new SecretBox(Buffer.alloc(32, 3)));
  config.saveSettings({ ...DEFAULT_SETTINGS, repos: ["o/r"] });
  config.setGithubToken("ghp_faketoken123");
  config.putSecret("OPENROUTER_API_KEY", "sk-or-supersecret");
  const clis = { binDir: bin, binary: (n: string) => join(bin, n), busy: false, status: () => [] } as unknown as Clis;
  const gh = fakeGitHub(issues, join(remotes, "o", "r.git"));
  const engine = new Engine({
    dataDir,
    store,
    config,
    clis,
    toolchains: new Toolchains(dataDir),
    workspace: new Workspace(dataDir, () => "ghp_faketoken123", `file://${remotes}`),
    github: (t) => new GitHub(t, { fetch: gh.fetchImpl }),
  });
  return { engine, store, gh, remotes, dataDir, config };
}

async function drain(engine: Engine): Promise<void> {
  engine.tick();
  for (let i = 0; i < 200 && engine.runningCount > 0; i++) await new Promise((r) => setTimeout(r, 50));
}

test("a ready issue becomes a pushed branch, a PR, and a done label", async () => {
  const issue: FakeIssue = { number: 7, title: "Fix the thing", body: "It is broken.", state: "open", labels: ["agent:ready", "skill:qa"], labeledBy: "gxfield" };
  const { engine, store, gh, remotes, dataDir } = setup([issue]);

  await engine.poll();
  assert.deepEqual(issue.labels.sort(), ["agent:working", "skill:qa"]);
  assert.match(gh.comments[0]!.body, /queued job #1: Claude Code, model `sonnet` with skills `qa`/);

  await drain(engine);
  const job = store.getJob(1)!;
  assert.equal(job.status, "succeeded", job.error ?? "");
  assert.equal(job.pr_number, 101);
  assert.equal(job.num_turns, 3);
  assert.equal(job.cli_version, "9.9.9");
  assert.deepEqual(issue.labels.sort(), ["agent:done", "skill:qa"]);

  const pr = gh.pulls[0]!;
  assert.equal(pr.head, "rainmaker/issue-7");
  assert.equal(pr.base, "main");
  assert.match(pr.body, /^Closes #7/);
  assert.match(pr.body, /Wrote fix\.txt\./);
  assert.match(gh.comments.at(-1)!.body, /opened #101/);

  const files = execFileSync("git", ["--git-dir", join(remotes, "o", "r.git"), "show", "--name-only", "--format=%an", "rainmaker/issue-7"], { encoding: "utf8" });
  assert.match(files, /gxfield/);
  assert.match(files, /fix\.txt/);

  const logText = readFileSync(join(dataDir, "logs", "job-1.log"), "utf8");
  assert.match(logText, /⚙ Edit: fix\.txt/);
  assert.ok(!logText.includes("sk-or-supersecret"), "secrets must be masked in logs");
  assert.match(logText, /secret is ••••••/);
});

test("an agent that changes nothing fails the job and labels the issue", async () => {
  const issue: FakeIssue = { number: 8, title: "Question", body: "Please make no changes.", state: "open", labels: ["agent:ready"], labeledBy: "gxfield" };
  const { engine, store, gh } = setup([issue]);
  await engine.poll();
  await drain(engine);
  const job = store.getJob(1)!;
  assert.equal(job.status, "failed");
  assert.match(job.error!, /without changing any files/);
  assert.deepEqual(issue.labels, ["agent:failed"]);
  assert.match(gh.comments.at(-1)!.body, /failed: The agent finished without changing any files/);
  assert.equal(gh.pulls.length, 0);
});

test("a skill label for a skill the repo doesn't have fails with a clear error", async () => {
  const issue: FakeIssue = { number: 12, title: "x", body: "x", state: "open", labels: ["agent:ready", "skill:nope"], labeledBy: "gxfield" };
  const { engine, store, gh } = setup([issue]);
  await engine.poll();
  await drain(engine);
  assert.equal(store.getJob(1)!.status, "failed");
  assert.match(gh.comments.at(-1)!.body, /skill:nope.*no nope\/SKILL\.md/);
});

test("labels applied by someone not on the allowed list are ignored", async () => {
  const issue: FakeIssue = { number: 9, title: "Do something", body: "x", state: "open", labels: ["agent:ready"], labeledBy: "stranger" };
  const { engine, store, gh } = setup([issue]);
  await engine.poll();
  assert.equal(store.listJobs().length, 0);
  assert.deepEqual(issue.labels, []);
  assert.match(gh.comments[0]!.body, /@stranger isn't on its list/);
});

test("an unknown model label fails fast with the available routes", async () => {
  const issue: FakeIssue = { number: 10, title: "x", body: "x", state: "open", labels: ["agent:ready", "model:gpt-9"], labeledBy: "gxfield" };
  const { engine, store, gh } = setup([issue]);
  await engine.poll();
  assert.equal(store.listJobs().length, 0);
  assert.ok(issue.labels.includes("agent:failed"));
  assert.match(gh.comments[0]!.body, /model:gpt-9.*isn't configured/);
});

test("closing the issue cancels a queued job", async () => {
  const issue: FakeIssue = { number: 11, title: "x", body: "x", state: "open", labels: ["agent:ready"], labeledBy: "gxfield" };
  const { engine, store } = setup([issue]);
  await engine.poll();
  issue.state = "closed";
  await engine.poll();
  assert.equal(store.getJob(1)!.status, "cancelled");
});

test("agent environment drops container variables and layers secrets", () => {
  const env = agentEnv({ PATH: "/usr/bin", HOME: "/data/home", APP_SEED: "nope", RANDOM_THING: "x" }, ["/tools/bin"], [
    { OPENROUTER_API_KEY: "k" },
    { CLAUDE_CODE_OAUTH_TOKEN: undefined, DISABLE_AUTOUPDATER: "1" },
  ]);
  assert.equal(env.APP_SEED, undefined);
  assert.equal(env.RANDOM_THING, undefined);
  assert.equal(env.PATH, "/tools/bin:/usr/bin");
  assert.equal(env.OPENROUTER_API_KEY, "k");
  assert.equal(env.DISABLE_AUTOUPDATER, "1");
});

test("with daily branches on, PRs target today's branch and one PR brings it to main", async () => {
  const issue: FakeIssue = { number: 21, title: "Tidy the menu", body: "x", state: "open", labels: ["agent:ready"], labeledBy: "gxfield" };
  const { engine, store, gh, remotes, config } = setup([issue]);
  config.saveSettings({ ...config.settings, dailyBranch: true, timeZone: "UTC" });
  const bare = join(remotes, "o", "r.git");
  const git = (...args: string[]) => execFileSync("git", ["--git-dir", bare, ...args], { encoding: "utf8" }).trim();

  await engine.poll();
  await drain(engine);
  const job = store.getJob(1)!;
  assert.equal(job.status, "succeeded", job.error ?? "");
  const today = dailyBranchName(new Date(), "UTC");
  assert.equal(git("rev-parse", today), git("rev-parse", "main"), "the daily branch is created from main");
  assert.equal(gh.pulls[0]!.base, today);
  assert.match(gh.pulls[0]!.body, new RegExp(`^For #21\\. This targets the daily branch \`${today}\``));
  assert.ok(!gh.pulls[0]!.body.includes("Closes #21"), "closing keywords don't work off the default branch");

  await assert.rejects(engine.openDailyPullRequest("o/r"), /Nothing has been merged/);

  // Review and merge the agent's PR into the daily branch.
  git("update-ref", `refs/heads/${today}`, "refs/heads/rainmaker/issue-21");
  gh.merged.push({ number: 101, title: "Tidy the menu", head: "rainmaker/issue-21", base: today, body: gh.pulls[0]!.body });
  const pr = await engine.openDailyPullRequest("o/r");
  assert.equal(pr.branch, today);
  assert.equal(pr.merged, 1);
  const main = gh.pulls[1]!;
  assert.equal(main.head, today);
  assert.equal(main.base, "main");
  assert.match(main.title, /^Rainmaker daily \d{4}-\d{2}-\d{2}: 1 change$/);
  assert.match(main.body, /- #101 Tidy the menu \(issue #21\)/);
  assert.match(main.body, /^Closes #21$/m);

  await assert.rejects(engine.openDailyPullRequest("someone/else"), /isn't one of the watched repos/);
});
