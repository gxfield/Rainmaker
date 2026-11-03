import { test } from "node:test";
import assert from "node:assert/strict";
import { dailyBranchName, dailyPrBody, pickDailyBranch, issueOfPull, validTimeZone, zonedNow } from "../src/daily.ts";
import { GitHub } from "../src/github.ts";
import { validateSettings } from "../src/settings.ts";

test("daily branch names follow the configured time zone", () => {
  const instant = new Date("2026-11-03T02:30:00Z");
  assert.equal(dailyBranchName(instant, "UTC"), "rainmaker/daily-2026-11-03");
  assert.equal(dailyBranchName(instant, "America/Los_Angeles"), "rainmaker/daily-2026-11-02");
  assert.deepEqual(zonedNow(instant, "America/Los_Angeles"), { date: "2026-11-02", hour: 18 });
  assert.equal(validTimeZone("Europe/London"), true);
  assert.equal(validTimeZone("Mars/Olympus"), false);
});

test("a later daily branch is kept, so changing the time zone never goes back a day", () => {
  const today = "rainmaker/daily-2026-11-02";
  assert.equal(pickDailyBranch(today, []), today);
  assert.equal(pickDailyBranch(today, ["rainmaker/daily-2026-11-01", today]), today);
  // Switched from UTC to America/Los_Angeles in the evening: UTC already made the 3rd.
  assert.equal(pickDailyBranch(today, ["rainmaker/daily-2026-11-01", "rainmaker/daily-2026-11-03"]), "rainmaker/daily-2026-11-03");
  assert.equal(pickDailyBranch(today, ["rainmaker/daily-2026-11-03-hotfix"]), today);
});

test("settings default to no daily branch in UTC and reject unknown time zones", () => {
  const s = validateSettings({});
  assert.equal(s.dailyBranch, false);
  assert.equal(s.timeZone, "UTC");
  assert.equal(validateSettings({ timeZone: " " }).timeZone, "UTC");
  assert.throws(() => validateSettings({ timeZone: "Pacific Time" }), /isn't a time zone/);
});

test("the daily PR lists merged PRs and closes their issues", () => {
  assert.equal(issueOfPull({ number: 1, title: "", head: "rainmaker/issue-12", body: "" }), 12);
  assert.equal(issueOfPull({ number: 2, title: "", head: "fix-typo", body: "This fixes #40." }), 40);
  assert.equal(issueOfPull({ number: 3, title: "", head: "chore", body: "No issue." }), undefined);
  const body = dailyPrBody("rainmaker/daily-2026-11-02", "main", [
    { number: 9, title: "Bigger buttons", head: "rainmaker/issue-8", body: "" },
    { number: 5, title: "Fix typo", head: "fix-typo", body: "Closes #4" },
    { number: 7, title: "Chore", head: "chore", body: "" },
  ]);
  assert.match(body, /- #5 Fix typo \(issue #4\)\n- #7 Chore\n- #9 Bigger buttons \(issue #8\)/);
  assert.match(body, /\nCloses #4\nCloses #8\n/);
});

test("opening a PR that already exists updates it and moves its base", async () => {
  const calls: { method: string; path: string; body?: any }[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({ method, path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const reply = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (method === "POST") return reply(422, { message: "A pull request already exists" });
    if (method === "GET") return reply(200, [{ number: 31, html_url: "https://github.com/o/r/pull/31", base: { ref: "rainmaker/daily-2026-11-01" } }]);
    return reply(200, {});
  }) as typeof fetch;
  const gh = new GitHub("t", { fetch: fetchImpl });
  const pr = await gh.openPullRequest("o/r", { title: "New title", head: "rainmaker/issue-3", base: "rainmaker/daily-2026-11-02", body: "New body" });
  assert.equal(pr.number, 31);
  const patch = calls.find((c) => c.method === "PATCH")!;
  assert.equal(patch.path, "/repos/o/r/pulls/31");
  assert.deepEqual(patch.body, { title: "New title", body: "New body", base: "rainmaker/daily-2026-11-02" });
});
