import { existsSync, readFileSync } from "node:fs";
import type { Job, Store } from "./db.ts";
import type { Engine } from "./engine.ts";
import { describeRoute } from "./labels.ts";
import { int, str, strList, type McpTool } from "./mcp.ts";
import type { Questions } from "./questions.ts";
import type { Config } from "./settings.ts";

export interface ToolDeps {
  store: Store;
  config: Config;
  engine: Engine;
  questions: Questions;
}

const object = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});

function compactJob(job: Job) {
  return {
    id: job.id,
    status: job.status,
    repo: job.repo,
    issue: job.issue_number,
    title: job.issue_title,
    route: job.route,
    agent: job.agent,
    model: job.model,
    skills: job.skills,
    pr_url: job.pr_url,
    error: job.error,
    created_at: new Date(job.created_at).toISOString(),
    duration_sec: job.started_at ? Math.round(((job.finished_at ?? Date.now()) - job.started_at) / 1000) : null,
  };
}

function logTail(engine: Engine, jobId: number, lines: number): string[] {
  if (engine.isRunning(jobId)) return engine.tail(jobId).slice(-lines);
  const path = engine.logPath(jobId);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8").trimEnd().split("\n").slice(-lines);
}

/** Tools for Hermes and other apps on the Umbrel, served at /mcp. */
export function hermesTools({ store, config, engine, questions }: ToolDeps): McpTool[] {
  const repoProp = { type: "string", description: "Repository as owner/name. Must be one Rainmaker watches (see list_repos)." };
  const modelProp = { type: "string", description: "Route name, as in the model:<route> label (see list_repos). Omit for the default." };
  const skillsProp = { type: "array", items: { type: "string" }, description: "Skill names from the repo's skills folder, as in skill:<name> labels." };

  return [
    {
      name: "list_repos",
      title: "List repos and routes",
      description: "Lists the repositories Rainmaker watches and the routes (agent and model) a task can use.",
      inputSchema: object({}),
      annotations: { readOnlyHint: true },
      async handler() {
        const s = config.settings;
        return {
          repos: s.repos,
          default_route: s.defaultRoute,
          routes: Object.fromEntries(Object.entries(s.routes).map(([name, r]) => [name, describeRoute(r)])),
        };
      },
    },
    {
      name: "list_jobs",
      title: "List jobs",
      description: "Lists recent Rainmaker jobs, newest first. Filter by status (queued, running, succeeded, failed, cancelled) or repo.",
      inputSchema: object({
        status: { type: "string", enum: ["queued", "running", "succeeded", "failed", "cancelled"] },
        repo: repoProp,
        limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      }),
      annotations: { readOnlyHint: true },
      async handler(args) {
        const status = str(args, "status");
        const repo = str(args, "repo");
        const limit = int(args, "limit", { min: 1, max: 100 }) ?? 20;
        const jobs = store
          .listJobs(500)
          .filter((j) => (!status || j.status === status) && (!repo || j.repo === repo))
          .slice(0, limit);
        return { jobs: jobs.map(compactJob), pending_questions: questions.pending().length };
      },
    },
    {
      name: "get_job",
      title: "Get a job and its output",
      description: "Shows one job: its status, usage, PR, the agent's summary, any questions, and the last lines of its log (live while it runs).",
      inputSchema: object({ job_id: { type: "integer" }, log_lines: { type: "integer", minimum: 0, maximum: 300, default: 60 } }, ["job_id"]),
      annotations: { readOnlyHint: true },
      async handler(args) {
        const id = int(args, "job_id", { required: true })!;
        const job = store.getJob(id);
        if (!job) throw new Error(`No job #${id}`);
        const lines = int(args, "log_lines", { min: 0, max: 300 }) ?? 60;
        return {
          ...compactJob(job),
          summary: job.summary,
          usage: {
            turns: job.num_turns,
            input_tokens: job.input_tokens,
            output_tokens: job.output_tokens,
            cost_usd_api_equivalent: job.cost_usd,
          },
          cli_version: job.cli_version,
          questions: store.questionsFor(id).map((q) => ({ id: q.id, question: q.question, status: q.status, answer: q.answer, answered_by: q.answered_by })),
          log_tail: logTail(engine, id, lines),
        };
      },
    },
    {
      name: "create_task",
      title: "Create a coding task",
      description:
        "Opens a GitHub issue in a watched repo, already labeled agent:ready, so Rainmaker runs an agent on it and opens a PR. Write the body like a good issue: the goal, where to look, and how to check the result.",
      inputSchema: object(
        { repo: repoProp, title: { type: "string", maxLength: 200 }, body: { type: "string", maxLength: 20000 }, model: modelProp, skills: skillsProp },
        ["repo", "title", "body"],
      ),
      async handler(args) {
        const issue = await engine.createTask({
          repo: str(args, "repo", { required: true })!,
          title: str(args, "title", { required: true, max: 200 })!,
          body: str(args, "body", { required: true, max: 20000 })!,
          model: str(args, "model"),
          skills: strList(args, "skills"),
        });
        return { issue: issue.number, url: issue.html_url, labels: issue.labels, note: "Rainmaker is polling now; the job appears in list_jobs within a few seconds." };
      },
    },
    {
      name: "start_issue",
      title: "Start an existing issue",
      description: "Adds agent:ready (and optional model and skill labels) to an existing open issue in a watched repo, so Rainmaker picks it up.",
      inputSchema: object({ repo: repoProp, issue_number: { type: "integer" }, model: modelProp, skills: skillsProp }, ["repo", "issue_number"]),
      async handler(args) {
        const issue = await engine.startIssue(
          str(args, "repo", { required: true })!,
          int(args, "issue_number", { required: true, min: 1 })!,
          str(args, "model"),
          strList(args, "skills"),
        );
        return { issue: issue.number, url: issue.html_url, labels: issue.labels };
      },
    },
    {
      name: "retry_job",
      title: "Retry a job",
      description: "Queues a new run for a finished job's issue, using the issue's current labels. The new run replaces the old branch and updates the same PR.",
      inputSchema: object({ job_id: { type: "integer" } }, ["job_id"]),
      async handler(args) {
        const job = await engine.retry(int(args, "job_id", { required: true })!);
        engine.tick();
        return { job: compactJob(job) };
      },
    },
    {
      name: "open_daily_pr",
      title: "Open the daily branch's PR",
      description:
        "When daily branches are on, opens (or refreshes) one PR from a repo's newest rainmaker/daily-YYYY-MM-DD branch into its default branch. The PR lists the agent PRs merged into the daily branch and closes their issues when it merges. Fails if nothing has been merged into the daily branch yet.",
      inputSchema: object({ repo: repoProp, branch: { type: "string", description: "A specific daily branch. Omit for the newest." } }, ["repo"]),
      async handler(args) {
        const pr = await engine.openDailyPullRequest(str(args, "repo", { required: true })!, str(args, "branch", { max: 200 }));
        return { pr_number: pr.number, pr_url: pr.html_url, branch: pr.branch, merged_prs: pr.merged };
      },
    },
    {
      name: "cancel_job",
      title: "Cancel a job",
      description: "Stops a queued or running job. The agent is interrupted and no PR is opened.",
      inputSchema: object({ job_id: { type: "integer" }, reason: { type: "string", maxLength: 300 } }, ["job_id"]),
      annotations: { destructiveHint: true },
      async handler(args, ctx) {
        const id = int(args, "job_id", { required: true })!;
        const job = store.getJob(id);
        if (!job) throw new Error(`No job #${id}`);
        if (job.status !== "queued" && job.status !== "running") throw new Error(`Job #${id} already ended (${job.status})`);
        await engine.cancel(id, str(args, "reason", { max: 300 }) ?? `${ctx.caller} cancelled it`);
        return { cancelled: id };
      },
    },
    {
      name: "list_questions",
      title: "List questions waiting for an answer",
      description: "Lists questions running agents have asked and are waiting on. Answer them with answer_question.",
      inputSchema: object({}),
      annotations: { readOnlyHint: true },
      async handler() {
        const timeoutMs = config.settings.questionTimeoutMin * 60_000;
        return {
          questions: questions.pending().map((q) => {
            const job = store.getJob(q.job_id);
            return {
              question_id: q.id,
              question: q.question,
              job_id: q.job_id,
              repo: job?.repo,
              issue: job?.issue_number,
              issue_title: job?.issue_title,
              asked_at: new Date(q.asked_at).toISOString(),
              expires_at: new Date(q.asked_at + timeoutMs).toISOString(),
            };
          }),
        };
      },
    },
    {
      name: "answer_question",
      title: "Answer an agent's question",
      description: "Answers a pending question. The waiting agent receives the answer and continues.",
      inputSchema: object({ question_id: { type: "integer" }, answer: { type: "string", maxLength: 10000 } }, ["question_id", "answer"]),
      async handler(args, ctx) {
        const id = int(args, "question_id", { required: true })!;
        const ok = questions.answer(id, str(args, "answer", { required: true, max: 10000 })!, ctx.caller);
        if (!ok) throw new Error(`Question #${id} isn't waiting for an answer any more`);
        return { answered: id };
      },
    },
    {
      name: "get_stats",
      title: "Get metrics",
      description: "Totals for the last N days (default 30): jobs, success rate, average run time and tokens, overall and per route and repo.",
      inputSchema: object({ days: { type: "integer", minimum: 1, maximum: 365, default: 30 } }),
      annotations: { readOnlyHint: true },
      async handler(args) {
        const days = int(args, "days", { min: 1, max: 365 }) ?? 30;
        const since = Date.now() - days * 86_400_000;
        const total = store.stats(since);
        const finished = total.succeeded + total.failed;
        return {
          days,
          ...total,
          success_rate: finished ? Math.round((total.succeeded / finished) * 1000) / 10 : null,
          by_route: store.statsBy("route", since),
          by_repo: store.statsBy("repo", since),
        };
      },
    },
  ];
}

/** The one tool agents get, served at /mcp/agent with a per-job token. */
export function agentTools(engine: Engine, jobId: number): McpTool[] {
  return [
    {
      name: "ask_human",
      title: "Ask the person who filed the issue",
      description:
        "Ask the person who filed this issue one short, specific question and wait for the answer. Use it only for decisions you can't reasonably make yourself. It may take many minutes, and if nobody answers you'll be told to use your best judgment.",
      inputSchema: object({ question: { type: "string", maxLength: 2000 } }, ["question"]),
      async handler(args) {
        return engine.askHuman(jobId, str(args, "question", { required: true, max: 2000 })!);
      },
    },
  ];
}
