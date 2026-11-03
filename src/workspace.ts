import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { run } from "./proc.ts";

export interface Identity {
  name: string;
  email: string;
}

/**
 * Git plumbing for jobs. Each repo is kept as one bare clone, and each job gets
 * its own worktree on a fresh branch. The token is passed per command as an
 * HTTP header and is never written to git config, so the agent can't push.
 */
export class Workspace {
  readonly #reposDir: string;
  readonly #workDir: string;
  readonly #token: () => string;
  readonly #gitHost: string;

  constructor(dataDir: string, token: () => string, gitHost = "https://github.com") {
    this.#reposDir = join(dataDir, "repos");
    this.#workDir = join(dataDir, "work");
    this.#token = token;
    this.#gitHost = gitHost;
    mkdirSync(this.#reposDir, { recursive: true });
    mkdirSync(this.#workDir, { recursive: true });
  }

  #authArgs(): string[] {
    const basic = Buffer.from(`x-access-token:${this.#token()}`).toString("base64");
    return ["-c", `http.extraHeader=Authorization: Basic ${basic}`];
  }

  #bare(repo: string): string {
    return join(this.#reposDir, `${repo.replace("/", "__")}.git`);
  }

  worktreePath(jobId: number): string {
    return join(this.#workDir, `job-${jobId}`);
  }

  /** Clones the bare repo if needed and fetches every branch. */
  async #sync(repo: string): Promise<string> {
    const bare = this.#bare(repo);
    const url = `${this.#gitHost}/${repo}.git`;
    if (!existsSync(bare)) {
      await run("git", [...this.#authArgs(), "clone", "--bare", "--quiet", url, bare], { timeoutMs: 15 * 60_000 });
    }
    await run("git", ["--git-dir", bare, ...this.#authArgs(), "fetch", "--quiet", "--prune", "origin", "+refs/heads/*:refs/remotes/origin/*"], {
      timeoutMs: 15 * 60_000,
    });
    return bare;
  }

  /** Creates `branch` on the remote from `from` if it doesn't exist yet. Returns true if it was created. */
  async ensureBranch(repo: string, branch: string, from: string): Promise<boolean> {
    const bare = await this.#sync(repo);
    const has = async () =>
      (await run("git", ["--git-dir", bare, "rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], { check: false })).code === 0;
    if (await has()) return false;
    const push = await run("git", ["--git-dir", bare, ...this.#authArgs(), "push", "--quiet", "origin", `refs/remotes/origin/${from}:refs/heads/${branch}`], {
      check: false,
      timeoutMs: 5 * 60_000,
    });
    await this.#sync(repo);
    if (await has()) return push.code === 0;
    throw new Error(`Couldn't create ${branch} from ${from}: ${(push.stderr || push.stdout).trim().split("\n").slice(-3).join(" ")}`);
  }

  /** Clones or refreshes the bare repo, then creates a worktree for `branch` starting at the remote's `base` (or the branch itself). */
  async prepare(repo: string, base: string, branch: string, jobId: number, identity: Identity): Promise<string> {
    const bare = await this.#sync(repo);
    const path = this.worktreePath(jobId);
    if (existsSync(path)) await this.cleanup(repo, jobId);
    await run("git", ["--git-dir", bare, "worktree", "prune"]);
    await run("git", ["--git-dir", bare, "worktree", "add", "--quiet", "-B", branch, path, `refs/remotes/origin/${base}`]);
    await run("git", ["-C", path, "config", "user.name", identity.name]);
    await run("git", ["-C", path, "config", "user.email", identity.email]);
    return path;
  }

  /** Commits anything the agent left uncommitted. Returns how many commits the branch is ahead of base. */
  async finalize(path: string, base: string, message: string): Promise<number> {
    const status = await run("git", ["-C", path, "status", "--porcelain"]);
    if (status.stdout.trim()) {
      await run("git", ["-C", path, "add", "-A"]);
      await run("git", ["-C", path, "commit", "--quiet", "--no-verify", "-m", message]);
    }
    const ahead = await run("git", ["-C", path, "rev-list", "--count", `refs/remotes/origin/${base}..HEAD`]);
    return Number(ahead.stdout.trim()) || 0;
  }

  async diffStat(path: string, base: string): Promise<string> {
    const res = await run("git", ["-C", path, "diff", "--shortstat", `refs/remotes/origin/${base}...HEAD`], { check: false });
    return res.stdout.trim();
  }

  /**
   * Issue branches are Rainmaker's own (`rainmaker/issue-N`), so a retry force-pushes over the
   * previous attempt. A PR follow-up adds to the PR's branch, so it pushes with `force` off.
   */
  async push(path: string, branch: string, force = true): Promise<void> {
    await run("git", ["-C", path, ...this.#authArgs(), "push", "--quiet", ...(force ? ["--force"] : []), "origin", `HEAD:refs/heads/${branch}`], {
      timeoutMs: 10 * 60_000,
    });
  }

  async cleanup(repo: string, jobId: number): Promise<void> {
    const path = this.worktreePath(jobId);
    const bare = this.#bare(repo);
    if (existsSync(bare)) await run("git", ["--git-dir", bare, "worktree", "remove", "--force", path], { check: false });
    rmSync(path, { recursive: true, force: true });
  }
}
