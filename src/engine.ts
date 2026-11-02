import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { claudeAdapter } from "./agents/claude.ts";
import { codexAdapter } from "./agents/codex.ts";
import type { AgentAdapter, Invocation, Outcome, StreamParser } from "./agents/types.ts";
import type { Clis } from "./clis.ts";
import { maskSecrets } from "./crypto.ts";
import type { AgentName, Job, Store } from "./db.ts";
import { GitHub, type Viewer } from "./github.ts";
import { describeRoute, resolveLabels } from "./labels.ts";
import { errorMessage, log } from "./log.ts";
import { SKILL_DIRS, buildPrompt } from "./prompt.ts";
import { LABELS, type Config, type Route } from "./settings.ts";
import type { Toolchains } from "./toolchain.ts";
import type { Workspace } from "./workspace.ts";

export const ADAPTERS: Record<AgentName, AgentAdapter> = { claude: claudeAdapter, codex: codexAdapter };

/** Environment variables passed through from the container to agent runs. Everything else is dropped. */
const PASSTHROUGH_ENV = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TZ",
  "TMPDIR",
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
];

const LOG_TAIL_LINES = 300;

export interface EngineDeps {
  dataDir: string;
  store: Store;
  config: Config;
  clis: Clis;
  toolchains: Toolchains;
  workspace: Workspace;
  github?: (token: string) => GitHub;
}

interface RunningJob {
  abort: AbortController;
  reason?: string;
  /** Set on shutdown: the job goes back in the queue instead of being marked cancelled. */
  requeue?: boolean;
}

export function branchFor(issueNumber: number): string {
  return `rainmaker/issue-${issueNumber}`;
}

export function agentEnv(
  base: NodeJS.ProcessEnv,
  extraPath: string[],
  layers: Record<string, string | undefined>[],
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of PASSTHROUGH_ENV) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value === undefined) delete env[key];
      else env[key] = value;
    }
  }
  env.PATH = [...extraPath, env.PATH ?? "/usr/local/bin:/usr/bin:/bin"].join(":");
  env.CI = "1";
  env.TERM = "dumb";
  return env;
}

/** Polls GitHub, queues jobs, and runs them. */
export class Engine {
  readonly #deps: EngineDeps;
  readonly #running = new Map<number, RunningJob>();
  readonly #tails = new Map<number, string[]>();
  readonly #labelsEnsured = new Set<string>();
  #gh?: { token: string; client: GitHub; viewer?: Viewer };
  lastPoll: { at: number; error: string | null } | null = null;
  stopped = false;

  constructor(deps: EngineDeps) {
    this.#deps = deps;
    mkdirSync(this.logDir, { recursive: true });
  }

  get logDir(): string {
    return join(this.#deps.dataDir, "logs");
  }

  logPath(jobId: number): string {
    return join(this.logDir, `job-${jobId}.log`);
  }

  isRunning(jobId: number): boolean {
    return this.#running.has(jobId);
  }

  get runningCount(): number {
    return this.#running.size;
  }

  tail(jobId: number): string[] {
    return this.#tails.get(jobId) ?? [];
  }

  #github(): GitHub | undefined {
    const token = this.#deps.config.githubToken;
    if (!token) return undefined;
    if (this.#gh?.token !== token) {
      this.#gh = { token, client: (this.#deps.github ?? ((t) => new GitHub(t)))(token) };
    }
    return this.#gh.client;
  }

  async viewer(): Promise<Viewer> {
    const gh = this.#github();
    if (!gh || !this.#gh) throw new Error("No GitHub token is set");
    this.#gh.viewer ??= await gh.viewer();
    return this.#gh.viewer;
  }

  async #allowedUsers(): Promise<string[]> {
    const configured = this.#deps.config.settings.allowedUsers;
    const users = configured.length ? configured : [(await this.viewer()).login];
    return users.map((u) => u.toLowerCase());
  }

  #mask(text: string): string {
    return maskSecrets(text, this.#deps.config.sensitiveValues());
  }

  #jobLog(jobId: number, text: string): void {
    const masked = this.#mask(text);
    const lines = masked.split("\n");
    const tail = this.#tails.get(jobId) ?? [];
    tail.push(...lines);
    if (tail.length > LOG_TAIL_LINES) tail.splice(0, tail.length - LOG_TAIL_LINES);
    this.#tails.set(jobId, tail);
    const stamp = new Date().toISOString().slice(11, 19);
    appendFileSync(this.logPath(jobId), lines.map((l) => `${stamp} ${l}`).join("\n") + "\n");
  }

  /** Marks jobs that were running when the app stopped as failed. */
  async recover(): Promise<void> {
    for (const job of this.#deps.store.jobsWithStatus("running")) {
      const error = "Rainmaker restarted while this job was running.";
      this.#deps.store.finishJob(job.id, "failed", { error });
      try {
        const gh = this.#github();
        if (gh) {
          await gh.setStateLabel(job.repo, job.issue_number, LABELS.failed);
          await gh.comment(job.repo, job.issue_number, `Rainmaker job #${job.id} stopped: ${error} Add \`${LABELS.ready}\` again to retry.`);
        }
      } catch (err) {
        log.warn("Could not update GitHub for interrupted job", { job: job.id, error: errorMessage(err) });
      }
      await this.#deps.workspace.cleanup(job.repo, job.id).catch(() => undefined);
    }
  }

  /** One pass over every configured repo: picks up newly labeled issues and cancels runs whose issue changed. */
  async poll(): Promise<void> {
    const gh = this.#github();
    if (!gh) {
      this.lastPoll = { at: Date.now(), error: "No GitHub token is set" };
      return;
    }
    const settings = this.#deps.config.settings;
    const errors: string[] = [];
    try {
      const allowed = await this.#allowedUsers();
      for (const repo of settings.repos) {
        try {
          await this.#pollRepo(gh, repo, allowed);
        } catch (err) {
          errors.push(`${repo}: ${errorMessage(err)}`);
          log.warn("Poll failed", { repo, error: errorMessage(err) });
        }
      }
      await this.#checkCancellations(gh);
    } catch (err) {
      errors.push(errorMessage(err));
    }
    this.lastPoll = { at: Date.now(), error: errors.length ? errors.join("; ") : null };
  }

  async #pollRepo(gh: GitHub, repo: string, allowed: string[]): Promise<void> {
    if (!this.#labelsEnsured.has(repo)) {
      await gh.ensureLabels(repo);
      this.#labelsEnsured.add(repo);
    }
    const settings = this.#deps.config.settings;
    for (const issue of await gh.issuesWithLabel(repo, LABELS.ready)) {
      if (this.#deps.store.activeJobFor(repo, issue.number)) continue;
      const actor = await gh.labelActor(repo, issue.number, LABELS.ready);
      if (!actor || !allowed.includes(actor.toLowerCase())) {
        log.warn("Ignoring ready label from a user who isn't allowed", { repo, issue: issue.number, actor });
        await gh.removeLabel(repo, issue.number, LABELS.ready);
        await gh.comment(
          repo,
          issue.number,
          `Rainmaker ignored \`${LABELS.ready}\` because ${actor ? `@${actor}` : "an unknown user"} isn't on its list of allowed users.`,
        );
        continue;
      }
      const resolved = resolveLabels(issue.labels, settings);
      if (!resolved.ok) {
        await gh.setStateLabel(repo, issue.number, LABELS.failed);
        await gh.comment(repo, issue.number, `Rainmaker couldn't start: ${resolved.error}`);
        continue;
      }
      const job = this.#deps.store.createJob({
        repo,
        issue_number: issue.number,
        issue_title: issue.title,
        route: resolved.routeName,
        agent: resolved.route.agent,
        model: resolved.route.model ?? null,
        provider: resolved.route.provider ?? "default",
        skills: resolved.skills,
      });
      await gh.setStateLabel(repo, issue.number, LABELS.working);
      const skills = resolved.skills.length ? ` with skills ${resolved.skills.map((s) => `\`${s}\``).join(", ")}` : "";
      await gh.comment(repo, issue.number, `Rainmaker queued job #${job.id}: ${describeRoute(resolved.route)}${skills}.`);
      log.info("Queued job", { job: job.id, repo, issue: issue.number, route: resolved.routeName });
    }
  }

  async #checkCancellations(gh: GitHub): Promise<void> {
    for (const job of this.#deps.store.jobsWithStatus("queued", "running")) {
      try {
        const issue = await gh.issue(job.repo, job.issue_number);
        if (issue.state === "closed") await this.cancel(job.id, "the issue was closed", { relabel: false });
        else if (!issue.labels.includes(LABELS.working)) await this.cancel(job.id, `the \`${LABELS.working}\` label was removed`, { relabel: false });
      } catch (err) {
        log.debug("Cancellation check failed", { job: job.id, error: errorMessage(err) });
      }
    }
  }

  /** Starts queued jobs while there are free slots. */
  tick(): void {
    if (this.stopped || this.#deps.clis.busy) return;
    const { concurrency } = this.#deps.config.settings;
    while (this.#running.size < concurrency) {
      const job = this.#deps.store.nextQueued();
      if (!job) return;
      this.#deps.store.markRunning(job.id);
      const entry: RunningJob = { abort: new AbortController() };
      this.#running.set(job.id, entry);
      void this.#execute(job, entry).finally(() => {
        this.#running.delete(job.id);
        setTimeout(() => this.#tails.delete(job.id), 10 * 60_000).unref();
        this.tick();
      });
    }
  }

  async cancel(jobId: number, reason: string, opts: { relabel?: boolean } = {}): Promise<void> {
    const job = this.#deps.store.getJob(jobId);
    if (!job) throw new Error(`No job #${jobId}`);
    const running = this.#running.get(jobId);
    if (running) {
      running.reason = reason;
      running.abort.abort();
    } else if (job.status === "queued") {
      this.#deps.store.finishJob(jobId, "cancelled", { error: `Cancelled: ${reason}` });
    } else return;
    const gh = this.#github();
    if (!gh) return;
    try {
      if (opts.relabel !== false) await gh.removeLabel(job.repo, job.issue_number, LABELS.working);
      await gh.comment(job.repo, job.issue_number, `Rainmaker cancelled job #${jobId} because ${reason}.`);
    } catch (err) {
      log.warn("Could not update GitHub after cancelling", { job: jobId, error: errorMessage(err) });
    }
  }

  /** Queues a new job for the same issue, using the issue's current labels. */
  async retry(jobId: number): Promise<Job> {
    const old = this.#deps.store.getJob(jobId);
    if (!old) throw new Error(`No job #${jobId}`);
    if (this.#deps.store.activeJobFor(old.repo, old.issue_number)) throw new Error("That issue already has a job queued or running");
    const gh = this.#github();
    if (!gh) throw new Error("No GitHub token is set");
    const issue = await gh.issue(old.repo, old.issue_number);
    const resolved = resolveLabels(issue.labels, this.#deps.config.settings);
    if (!resolved.ok) throw new Error(resolved.error);
    const job = this.#deps.store.createJob({
      repo: old.repo,
      issue_number: old.issue_number,
      issue_title: issue.title,
      route: resolved.routeName,
      agent: resolved.route.agent,
      model: resolved.route.model ?? null,
      provider: resolved.route.provider ?? "default",
      skills: resolved.skills,
    });
    await gh.setStateLabel(old.repo, old.issue_number, LABELS.working);
    await gh.comment(old.repo, old.issue_number, `Rainmaker queued job #${job.id} as a retry of #${old.id}: ${describeRoute(resolved.route)}.`);
    return job;
  }

  async #execute(job: Job, entry: RunningJob): Promise<void> {
    const { store, config, workspace, toolchains, clis, dataDir } = this.#deps;
    const gh = this.#github();
    const route: Route = { agent: job.agent, ...(job.model ? { model: job.model } : {}), ...(job.provider === "openrouter" ? { provider: "openrouter" as const } : {}) };
    const branch = branchFor(job.issue_number);
    const say = (text: string) => this.#jobLog(job.id, text);
    let base = "main";
    let worktree: string | undefined;
    let pushed = false;
    try {
      if (!gh) throw new Error("No GitHub token is set");
      say(`Job #${job.id}: ${job.repo}#${job.issue_number} "${job.issue_title}" with ${describeRoute(route)}`);
      const viewer = await this.viewer();
      const allowed = await this.#allowedUsers();
      const issue = await gh.issue(job.repo, job.issue_number);
      const comments = (await gh.comments(job.repo, job.issue_number)).filter(
        (c) => allowed.includes(c.user.toLowerCase()) && !c.body.startsWith("Rainmaker "),
      );
      base = await gh.defaultBranch(job.repo);
      say(`Preparing worktree on ${branch} from ${base}`);
      worktree = await workspace.prepare(job.repo, base, branch, job.id, {
        name: viewer.login,
        email: `${viewer.id}+${viewer.login}@users.noreply.github.com`,
      });
      store.updateJob(job.id, { branch });

      const skills = job.skills.map((name) => {
        const dir = SKILL_DIRS.find((d) => existsSync(join(worktree!, d, name, "SKILL.md")));
        if (!dir) throw new Error(`\`skill:${name}\` was requested, but there is no ${name}/SKILL.md under ${SKILL_DIRS.join(", ")} in the repo.`);
        return { name, path: `${dir}/${name}/SKILL.md` };
      });
      const secrets = config.secretEnv();
      const tc = await toolchains.prepare(worktree, join(dataDir, "work", `job-${job.id}-bin`), process.env);
      for (const note of tc.notes) say(`Toolchain: ${note}`);
      const prompt = buildPrompt({ repo: job.repo, issue, comments, branch, base, skills, toolchainNotes: tc.notes });
      const adapter = ADAPTERS[job.agent];
      const invocation = adapter.invocation(route, prompt, worktree, secrets);
      const env = agentEnv(process.env, [...tc.path, clis.binDir], [tc.env, secrets, invocation.env]);
      const timeoutMs = config.settings.jobTimeoutMin * 60_000;
      const outcome = await this.#spawn(job.id, clis.binary(job.agent), invocation, worktree, env, timeoutMs, entry.abort.signal, adapter.parser());
      store.updateJob(job.id, {
        input_tokens: outcome.inputTokens,
        output_tokens: outcome.outputTokens,
        cached_tokens: outcome.cachedTokens,
        cost_usd: outcome.costUsd,
        num_turns: outcome.numTurns,
        cli_version: outcome.version ?? clis.status().find((c) => c.name === job.agent)?.version ?? null,
        summary: outcome.summary ? this.#mask(outcome.summary) : null,
      });
      if (entry.abort.signal.aborted) throw new Error(`Cancelled: ${entry.reason ?? "cancelled"}`);

      const ahead = await workspace.finalize(worktree, base, `Rainmaker: work on #${job.issue_number}\n\n${job.issue_title}`);
      if (!outcome.ok) {
        if (ahead > 0) {
          await workspace.push(worktree, branch);
          pushed = true;
        }
        throw new Error(outcome.error ?? "The agent run failed");
      }
      if (ahead === 0) throw new Error("The agent finished without changing any files.");
      say(`Pushing ${ahead} commit(s) to ${branch}`);
      await workspace.push(worktree, branch);
      pushed = true;
      const stat = await workspace.diffStat(worktree, base);
      const pr = await gh.openPullRequest(job.repo, {
        title: job.issue_title,
        head: branch,
        base,
        body: this.#mask(prBody(job, route, outcome, stat)),
      });
      say(`Opened ${pr.html_url}`);
      store.finishJob(job.id, "succeeded", { pr_url: pr.html_url, pr_number: pr.number });
      await gh.setStateLabel(job.repo, job.issue_number, LABELS.done);
      await gh.comment(job.repo, job.issue_number, `Rainmaker opened #${pr.number} for this issue (job #${job.id}, ${formatStats(outcome)}).`);
    } catch (err) {
      if (entry.requeue) {
        say("Rainmaker is shutting down; this job will start again after the restart.");
        store.requeue(job.id);
        return;
      }
      const cancelled = entry.abort.signal.aborted;
      const message = this.#mask(errorMessage(err));
      say(`${cancelled ? "Cancelled" : "Failed"}: ${message}`);
      store.finishJob(job.id, cancelled ? "cancelled" : "failed", { error: message });
      if (!cancelled && gh) {
        const partial = pushed ? `\n\nPartial work was pushed to \`${branch}\`.` : "";
        const tail = this.tail(job.id).slice(-25).join("\n");
        try {
          await gh.setStateLabel(job.repo, job.issue_number, LABELS.failed);
          await gh.comment(
            job.repo,
            job.issue_number,
            `Rainmaker job #${job.id} failed: ${message}${partial}\n\n<details><summary>Last log lines</summary>\n\n\`\`\`\n${tail.replaceAll("```", "ʼʼʼ")}\n\`\`\`\n</details>\n\nAdd \`${LABELS.ready}\` again to retry.`,
          );
        } catch (ghErr) {
          log.warn("Could not report failure on GitHub", { job: job.id, error: errorMessage(ghErr) });
        }
      }
      log.warn("Job ended without a PR", { job: job.id, cancelled, error: message });
    } finally {
      if (worktree) await workspace.cleanup(job.repo, job.id).catch(() => undefined);
      rmSync(join(dataDir, "work", `job-${job.id}-bin`), { recursive: true, force: true });
    }
  }

  #spawn(
    jobId: number,
    binary: string,
    invocation: Invocation,
    cwd: string,
    env: Record<string, string>,
    timeoutMs: number,
    signal: AbortSignal,
    parser: StreamParser,
  ): Promise<Outcome> {
    return new Promise((resolve, reject) => {
      if (!existsSync(binary)) return reject(new Error(`${binary} is not installed yet`));
      const child = spawn(binary, invocation.args, { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
      const killGroup = (sig: NodeJS.Signals) => {
        try {
          if (child.pid) process.kill(-child.pid, sig);
        } catch {
          // already gone
        }
      };
      const escalate = () => {
        killGroup("SIGINT");
        setTimeout(() => killGroup("SIGTERM"), 15_000).unref();
        setTimeout(() => killGroup("SIGKILL"), 30_000).unref();
      };
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        this.#jobLog(jobId, `Timed out after ${Math.round(timeoutMs / 60_000)} minutes, stopping the agent`);
        escalate();
      }, timeoutMs);
      const onAbort = () => escalate();
      signal.addEventListener("abort", onAbort, { once: true });

      let buffer = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          const text = parser.feed(line);
          if (text) this.#jobLog(jobId, text);
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        const text = chunk.trimEnd();
        if (text) this.#jobLog(jobId, `[stderr] ${text}`);
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
        if (buffer.trim()) {
          const text = parser.feed(buffer);
          if (text) this.#jobLog(jobId, text);
        }
        const outcome = parser.outcome(code ?? 1);
        if (timedOut) {
          outcome.ok = false;
          outcome.error = `Timed out after ${Math.round(timeoutMs / 60_000)} minutes`;
        }
        resolve(outcome);
      });
      child.stdin.end(invocation.stdin);
    });
  }

  /** Deletes jobs, logs, and leftover worktrees older than the retention window. */
  async prune(): Promise<void> {
    const { retentionDays } = this.#deps.config.settings;
    const ids = this.#deps.store.pruneJobs(Date.now() - retentionDays * 86_400_000);
    for (const id of ids) rmSync(this.logPath(id), { force: true });
    const workDir = join(this.#deps.dataDir, "work");
    if (existsSync(workDir)) {
      for (const name of readdirSync(workDir)) {
        const id = Number(/^job-(\d+)/.exec(name)?.[1]);
        if (id && !this.#running.has(id)) rmSync(join(workDir, name), { recursive: true, force: true });
      }
    }
    if (ids.length) log.info(`Pruned ${ids.length} old job(s)`);
  }

  /** Stops starting jobs, interrupts running ones so they rerun after a restart, and waits for them to exit. */
  async stop(maxWaitMs = 45_000): Promise<void> {
    this.stopped = true;
    for (const entry of this.#running.values()) {
      entry.requeue = true;
      entry.reason = "Rainmaker is shutting down";
      entry.abort.abort();
    }
    const deadline = Date.now() + maxWaitMs;
    while (this.#running.size && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
  }
}

export function formatStats(outcome: Outcome): string {
  const parts: string[] = [];
  if (outcome.numTurns != null) parts.push(`${outcome.numTurns} turns`);
  if (outcome.inputTokens != null || outcome.outputTokens != null) {
    parts.push(`${(outcome.inputTokens ?? 0).toLocaleString("en-US")} in / ${(outcome.outputTokens ?? 0).toLocaleString("en-US")} out tokens`);
  }
  if (outcome.costUsd != null) parts.push(`~$${outcome.costUsd.toFixed(2)} API-equivalent`);
  return parts.join(", ") || "no usage reported";
}

export function prBody(job: Job, route: Route, outcome: Outcome, diffStat: string): string {
  const lines = [
    `Closes #${job.issue_number}`,
    "",
    outcome.summary?.trim() || "_The agent didn't leave a summary._",
    "",
    "---",
    `Made by Rainmaker job #${job.id} with ${describeRoute(route)}${job.skills.length ? `, skills ${job.skills.map((s) => `\`${s}\``).join(", ")}` : ""}.`,
    `${formatStats(outcome)}${diffStat ? ` · ${diffStat}` : ""}`,
  ];
  return lines.join("\n");
}
