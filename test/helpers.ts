import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clis } from "../src/clis.ts";
import { SecretBox } from "../src/crypto.ts";
import { Store } from "../src/db.ts";
import { Engine } from "../src/engine.ts";
import { GitHub } from "../src/github.ts";
import { Questions } from "../src/questions.ts";
import { Config, DEFAULT_SETTINGS } from "../src/settings.ts";
import { Toolchains } from "../src/toolchain.ts";
import { Workspace } from "../src/workspace.ts";

export interface FakeIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  labeledBy: string;
}

/** An in-memory stand-in for the parts of the GitHub API Rainmaker calls. */
export function fakeGitHub(issues: FakeIssue[], bare?: string) {
  const comments: { number: number; body: string }[] = [];
  /** Comments returned when listing an issue's discussion. */
  const thread: { user: { login: string }; body: string; created_at: string }[] = [
    { user: { login: "gxfield" }, body: "Please keep it small.", created_at: "2020-01-01T00:00:00Z" },
  ];
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
    if (path === "/repos/o/r/issues" && method === "POST") {
      const created: FakeIssue = { number: 100 + issues.length, title: body.title, body: body.body, state: "open", labels: body.labels, labeledBy: "gxfield" };
      issues.push(created);
      return reply(201, asJson(created));
    }
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
      return reply(200, thread);
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
  return { fetchImpl, comments, pulls, thread, merged };
}

/** A stand-in for Claude Code: edits a file, then prints stream-json like the real CLI. */
export const FAKE_CLAUDE = `#!/bin/sh
prompt=$(cat)
case "$prompt" in *"make no changes"*) ;; *) echo "fixed" > fix.txt ;; esac
echo '{"type":"system","subtype":"init","session_id":"s1","model":"sonnet","claude_code_version":"9.9.9"}'
echo '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Edit","input":{"file_path":"fix.txt"}}]}}'
echo "secret is $OPENROUTER_API_KEY" >&2
echo '{"type":"result","subtype":"success","is_error":false,"result":"Wrote fix.txt.","total_cost_usd":0.1,"num_turns":3,"usage":{"input_tokens":10,"output_tokens":20}}'
`;

export interface SetupOptions {
  /** Script installed as the fake `claude` binary. */
  agent?: string;
  /** Run agents with an ask_human MCP endpoint at this URL. */
  agentMcpUrl?: string;
}

export function setup(issues: FakeIssue[], opts: SetupOptions = {}) {
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
  writeFileSync(join(bin, "claude"), opts.agent ?? FAKE_CLAUDE);
  chmodSync(join(bin, "claude"), 0o755);

  const store = new Store(":memory:");
  const config = new Config(store, new SecretBox(Buffer.alloc(32, 3)));
  config.saveSettings({ ...DEFAULT_SETTINGS, repos: ["o/r"] });
  config.setGithubToken("ghp_faketoken123");
  config.putSecret("OPENROUTER_API_KEY", "sk-or-supersecret");
  const clis = { binDir: bin, binary: (n: string) => join(bin, n), busy: false, status: () => [] } as unknown as Clis;
  const gh = fakeGitHub(issues, join(remotes, "o", "r.git"));
  const questions = new Questions(store);
  const engine = new Engine({
    questions,
    agentMcpUrl: opts.agentMcpUrl,
    dataDir,
    store,
    config,
    clis,
    toolchains: new Toolchains(dataDir),
    workspace: new Workspace(dataDir, () => "ghp_faketoken123", `file://${remotes}`),
    github: (t) => new GitHub(t, { fetch: gh.fetchImpl }),
  });
  return { engine, store, config, questions, clis, gh, remotes, dataDir };
}

export async function drain(engine: Engine): Promise<void> {
  engine.tick();
  for (let i = 0; i < 200 && engine.runningCount > 0; i++) await new Promise((r) => setTimeout(r, 50));
}
