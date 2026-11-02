import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dailyBranchName } from "../src/daily.ts";
import { agentEnv } from "../src/engine.ts";
import { drain, setup, type FakeIssue } from "./helpers.ts";

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

test("an agent that exits with an error fails the job", async () => {
  const issue: FakeIssue = { number: 13, title: "x", body: "x", state: "open", labels: ["agent:ready"], labeledBy: "gxfield" };
  const { engine, store } = setup([issue], { agent: "#!/bin/sh\necho 'Not logged in' >&2\nexit 1\n" });
  await engine.poll();
  await drain(engine);
  const job = store.getJob(1)!;
  assert.equal(job.status, "failed");
  assert.match(job.error!, /exited with code 1/);
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
