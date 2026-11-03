import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dailyBranchName, zonedNow } from "./daily.ts";
import type { AgentName, Job } from "./db.ts";
import { errorMessage } from "./log.ts";
import type { Route, Settings } from "./settings.ts";
import type { WebDeps } from "./web.ts";

/**
 * The JSON API behind the dashboard (web/). Every page reads and writes through here.
 * Requests come through Umbrel's app proxy, which signs the user in; POST, PUT and DELETE
 * also have to come from the same origin.
 */

const DAY = 86_400_000;
const MAX_LOG_BYTES = 400_000;

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function send(res: ServerResponse, data: unknown, status = 200): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new ApiError(413, "Request too large");
  }
  if (!body.trim()) return {};
  try {
    const data = JSON.parse(body);
    if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new ApiError(400, "The request body must be a JSON object");
}

function sameOrigin(req: IncomingMessage): boolean {
  const source = req.headers.origin ?? req.headers.referer;
  if (!source) return true;
  try {
    return new URL(source).host === req.headers.host;
  } catch {
    return false;
  }
}

const text = (body: Record<string, unknown>, key: string): string | undefined => {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new ApiError(400, `"${key}" must be text`);
  return value;
};
const textList = (body: Record<string, unknown>, key: string): string[] => {
  const value = body[key];
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : String(value).split(/[\n,]/);
  return list.map((v) => String(v).trim()).filter(Boolean);
};
const whole = (body: Record<string, unknown>, key: string): number | undefined => {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isInteger(n)) throw new ApiError(400, `"${key}" must be a whole number`);
  return n;
};

export interface JobView extends Job {
  running: boolean;
  duration_ms: number | null;
}

function view(job: Job, deps: WebDeps): JobView {
  return {
    ...job,
    running: deps.engine.isRunning(job.id),
    duration_ms: job.started_at ? (job.finished_at ?? Date.now()) - job.started_at : null,
  };
}

function jobLog(deps: WebDeps, job: Job): { text: string; truncated: boolean } {
  if (deps.engine.isRunning(job.id)) return { text: deps.engine.tail(job.id).join("\n"), truncated: false };
  const path = deps.engine.logPath(job.id);
  if (!existsSync(path)) return { text: "", truncated: false };
  const full = readFileSync(path, "utf8");
  return full.length > MAX_LOG_BYTES ? { text: full.slice(-MAX_LOG_BYTES), truncated: true } : { text: full, truncated: false };
}

function pendingQuestions(deps: WebDeps) {
  const minutes = deps.config.settings.questionTimeoutMin;
  return deps.questions.pending().map((q) => {
    const job = deps.store.getJob(q.job_id);
    return {
      ...q,
      expires_at: q.asked_at + minutes * 60_000,
      job: job ? { id: job.id, repo: job.repo, issue_number: job.issue_number, issue_title: job.issue_title } : null,
    };
  });
}

/** Milliseconds since local midnight in `timeZone`. */
function sinceMidnight(now: number, timeZone: string): number {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  for (const p of format.formatToParts(now)) parts[p.type] = p.value;
  return ((Number(parts.hour) * 60 + Number(parts.minute)) * 60 + Number(parts.second)) * 1000 + (now % 1000);
}

/**
 * Totals plus one bucket per day (in the configured time zone) for the charts. The window
 * is whole local days, today included, so the totals and the chart always agree.
 */
function stats(deps: WebDeps, days: number) {
  const { store, config } = deps;
  const tz = config.settings.timeZone;
  const now = Date.now();
  const since = now - sinceMidnight(now, tz) - (days - 1) * DAY;
  const totals = store.stats(since);
  const finished = totals.succeeded + totals.failed;
  const before = store.stats(since - days * DAY, since);
  const finishedBefore = before.succeeded + before.failed;
  const buckets = new Map<string, { date: string; total: number; succeeded: number; failed: number; cancelled: number; tokens: number; cost_usd: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const date = zonedNow(new Date(now - i * DAY), tz).date;
    buckets.set(date, { date, total: 0, succeeded: 0, failed: 0, cancelled: 0, tokens: 0, cost_usd: 0 });
  }
  for (const job of store.jobsSince(since)) {
    const bucket = buckets.get(zonedNow(new Date(job.created_at), tz).date);
    if (!bucket) continue;
    bucket.total++;
    if (job.status === "succeeded") bucket.succeeded++;
    else if (job.status === "failed") bucket.failed++;
    else if (job.status === "cancelled") bucket.cancelled++;
    bucket.tokens += (job.input_tokens ?? 0) + (job.output_tokens ?? 0);
    bucket.cost_usd += job.cost_usd ?? 0;
  }
  return {
    days,
    ...totals,
    success_rate: finished ? totals.succeeded / finished : null,
    // The window just before this one, for the "from last period" deltas.
    previous: { ...before, success_rate: finishedBefore ? before.succeeded / finishedBefore : null },
    by_route: store.statsBy("route", since),
    by_repo: store.statsBy("repo", since),
    daily: [...buckets.values()],
  };
}

function overview(deps: WebDeps) {
  const { config, engine, clis } = deps;
  const s = config.settings;
  const setup: string[] = [];
  if (!config.githubToken) setup.push("Add a GitHub token in Settings.");
  if (!s.repos.length) setup.push("Add at least one repository in Settings.");
  return {
    version: deps.version,
    setup,
    running: engine.runningCount,
    concurrency: s.concurrency,
    lastPoll: engine.lastPoll,
    pollIntervalSec: s.pollIntervalSec,
    repos: s.repos,
    routes: Object.keys(s.routes),
    defaultRoute: s.defaultRoute,
    dailyBranch: s.dailyBranch ? dailyBranchName(new Date(), s.timeZone) : null,
    timeZone: s.timeZone,
    autoUpdateHour: s.autoUpdateHour,
    clis: clis.status(),
    cliBusy: clis.busy,
    questions: pendingQuestions(deps),
  };
}

function settingsView(deps: WebDeps) {
  const { config } = deps;
  return {
    settings: config.settings,
    githubTokenSet: Boolean(config.githubToken),
    secrets: config.secretNames(),
    mcp: { url: "http://gxfield-rainmaker_web_1:3000/mcp", token: config.mcpToken },
  };
}

function saveSettings(deps: WebDeps, body: Record<string, unknown>): void {
  const { config } = deps;
  const current = config.settings;
  const routes = body.routes === undefined ? current.routes : typeof body.routes === "string" ? JSON.parse(body.routes) : body.routes;
  const hour = body.autoUpdateHour;
  const next: Settings = {
    ...current,
    repos: body.repos === undefined ? current.repos : textList(body, "repos"),
    allowedUsers: body.allowedUsers === undefined ? current.allowedUsers : textList(body, "allowedUsers"),
    pollIntervalSec: whole(body, "pollIntervalSec") ?? current.pollIntervalSec,
    concurrency: whole(body, "concurrency") ?? current.concurrency,
    jobTimeoutMin: whole(body, "jobTimeoutMin") ?? current.jobTimeoutMin,
    questionTimeoutMin: whole(body, "questionTimeoutMin") ?? current.questionTimeoutMin,
    retentionDays: whole(body, "retentionDays") ?? current.retentionDays,
    autoUpdateHour: hour === undefined ? current.autoUpdateHour : hour === null || hour === "" ? null : (whole(body, "autoUpdateHour") as number),
    dailyBranch: body.dailyBranch === undefined ? current.dailyBranch : body.dailyBranch === true,
    timeZone: text(body, "timeZone") ?? current.timeZone,
    defaultRoute: text(body, "defaultRoute") ?? current.defaultRoute,
    routes: routes as Record<string, Route>,
  };
  config.saveSettings(next);
  const token = text(body, "githubToken")?.trim();
  if (token) config.setGithubToken(token);
}

/** Handles /api/*. Returns false when the path isn't an API route. */
export async function handleApi(req: IncomingMessage, res: ServerResponse, path: string, url: URL, deps: WebDeps): Promise<boolean> {
  if (!path.startsWith("/api/")) return false;
  const { store, config, engine, clis } = deps;
  const method = req.method ?? "GET";
  try {
    if (method !== "GET" && !sameOrigin(req)) throw new ApiError(403, "Cross-origin request refused");
    let m: RegExpExecArray | null;

    if (method === "GET") {
      if (path === "/api/overview") return send(res, overview(deps)), true;
      if (path === "/api/status") {
        return send(res, { version: deps.version, running: engine.runningCount, lastPoll: engine.lastPoll, clis: clis.status(), stats30d: store.stats(Date.now() - 30 * DAY) }), true;
      }
      if (path === "/api/stats") {
        const days = Math.min(365, Math.max(1, Number(url.searchParams.get("days") ?? 30) || 30));
        return send(res, stats(deps, days)), true;
      }
      if (path === "/api/jobs") {
        const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") ?? 200) || 200));
        return send(res, store.listJobs(limit).map((j) => view(j, deps))), true;
      }
      if ((m = /^\/api\/jobs\/(\d+)$/.exec(path))) {
        const job = store.getJob(Number(m[1]));
        if (!job) throw new ApiError(404, `No job #${m[1]}`);
        // `tail` stays for API clients from before the dashboard rebuild.
        return send(res, { ...view(job, deps), tail: engine.tail(job.id), log: jobLog(deps, job), questions: store.questionsFor(job.id) }), true;
      }
      if (path === "/api/questions") return send(res, pendingQuestions(deps)), true;
      if (path === "/api/settings") return send(res, settingsView(deps)), true;
      throw new ApiError(404, "Not found");
    }

    const body = method === "POST" || method === "PUT" ? await readJson(req) : {};
    if (method === "PUT" && path === "/api/settings") {
      try {
        saveSettings(deps, body);
      } catch (err) {
        throw err instanceof ApiError ? err : new ApiError(400, errorMessage(err));
      }
      return send(res, settingsView(deps)), true;
    }
    if (method === "DELETE" && (m = /^\/api\/secrets\/([^/]+)$/.exec(path))) {
      config.deleteSecret(decodeURIComponent(m[1]!));
      return send(res, settingsView(deps)), true;
    }
    if (method !== "POST") throw new ApiError(405, "Method not allowed");

    if (path === "/api/secrets") {
      try {
        config.putSecret(text(body, "name") ?? "", text(body, "value") ?? "");
      } catch (err) {
        throw new ApiError(400, errorMessage(err));
      }
      return send(res, settingsView(deps)), true;
    }
    if (path === "/api/mcp-token/rotate") {
      config.rotateMcpToken();
      return send(res, settingsView(deps)), true;
    }
    if (path === "/api/poll") {
      await engine.poll();
      engine.tick();
      return send(res, { lastPoll: engine.lastPoll }), true;
    }
    if (path === "/api/tasks") {
      const repo = text(body, "repo");
      const title = text(body, "title")?.trim();
      if (!repo || !title) throw new ApiError(400, "A repo and a title are needed");
      const issue = await engine.createTask({ repo, title, body: text(body, "body") ?? "", model: text(body, "model") || undefined, skills: textList(body, "skills") });
      return send(res, { issue }), true;
    }
    if (path === "/api/issues/start") {
      const repo = text(body, "repo");
      const number = whole(body, "issue_number");
      if (!repo || !number) throw new ApiError(400, "A repo and an issue number are needed");
      const issue = await engine.startIssue(repo, number, text(body, "model") || undefined, textList(body, "skills"));
      return send(res, { issue }), true;
    }
    if ((m = /^\/api\/questions\/(\d+)\/answer$/.exec(path))) {
      const answer = text(body, "answer")?.trim();
      if (!answer) throw new ApiError(400, "Write an answer first");
      if (!deps.questions.answer(Number(m[1]), answer, "the dashboard")) throw new ApiError(409, "That question isn't waiting for an answer any more");
      return send(res, { ok: true }), true;
    }
    if ((m = /^\/api\/jobs\/(\d+)\/(cancel|retry|retry-comments)$/.exec(path))) {
      const id = Number(m[1]);
      if (m[2] === "retry-comments") {
        const job = store.getJob(id);
        if (!job) throw new ApiError(404, `No job #${id}`);
        if (!job.pr_number) throw new ApiError(400, `Job #${id} has no pull request`);
        const pr = await engine.retryWithComments(job.repo, job.pr_number, text(body, "model") || undefined, job.skills);
        return send(res, { pr: pr.number, url: pr.html_url }), true;
      }
      if (m[2] === "cancel") {
        await engine.cancel(id, "it was cancelled from the Rainmaker dashboard");
        return send(res, view(store.getJob(id)!, deps)), true;
      }
      const job = await engine.retry(id);
      engine.tick();
      return send(res, view(job, deps)), true;
    }
    if ((m = /^\/api\/daily\/([^/]+)\/open-pr$/.exec(path))) {
      return send(res, await engine.openDailyPullRequest(decodeURIComponent(m[1]!))), true;
    }
    if ((m = /^\/api\/clis\/(claude|codex)\/(update|rollback)$/.exec(path))) {
      if (engine.runningCount) throw new ApiError(409, "Wait for running jobs to finish before updating");
      const name = m[1] as AgentName;
      const version = m[2] === "update" ? await clis.update(name) : await clis.rollback(name);
      return send(res, { name, version, clis: clis.status() }), true;
    }
    throw new ApiError(404, "Not found");
  } catch (err) {
    const status = err instanceof ApiError ? err.status : 400;
    send(res, { error: errorMessage(err) }, status);
    return true;
  }
}

