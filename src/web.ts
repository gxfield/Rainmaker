import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { Clis } from "./clis.ts";
import type { AgentName, Job, Store } from "./db.ts";
import type { Engine } from "./engine.ts";
import { errorMessage } from "./log.ts";
import type { Config, Route, Settings } from "./settings.ts";

export interface WebDeps {
  store: Store;
  config: Config;
  engine: Engine;
  clis: Clis;
  version: string;
}

const esc = (value: unknown): string =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function duration(ms: number | null | undefined): string {
  if (ms == null) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function when(ts: number | null | undefined): string {
  return ts ? new Date(ts).toISOString().replace("T", " ").slice(0, 16) : "–";
}

const STYLE = `
:root{--bg:#f7f7f5;--fg:#1c1c1a;--muted:#6b6b66;--card:#fff;--line:#e4e4df;--accent:#2f6fde;--ok:#1f8a4c;--bad:#c2410c;--warn:#a16207}
@media (prefers-color-scheme:dark){:root{--bg:#141413;--fg:#ededea;--muted:#9a9a94;--card:#1d1d1b;--line:#2e2e2b;--accent:#6b9bf0;--ok:#4ade80;--bad:#fb923c;--warn:#facc15}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,sans-serif}
header{display:flex;gap:16px;align-items:center;padding:12px 16px;border-bottom:1px solid var(--line);background:var(--card)}
header b{font-size:16px}header a{color:var(--muted);text-decoration:none}header a:hover{color:var(--fg)}
main{max-width:1100px;margin:0 auto;padding:16px}a{color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:16px;margin-bottom:16px;overflow-x:auto}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
.stat .n{font-size:22px;font-weight:600}.stat .l{color:var(--muted);font-size:12px}
table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line);white-space:nowrap}th{color:var(--muted);font-weight:500;font-size:12px}
.s-succeeded{color:var(--ok)}.s-failed{color:var(--bad)}.s-running{color:var(--accent)}.s-queued,.s-cancelled{color:var(--muted)}
form.inline{display:inline}button{font:inherit;padding:4px 10px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg);cursor:pointer}
button:hover{border-color:var(--accent)}input,textarea,select{font:inherit;width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:var(--fg)}
label{display:block;margin:10px 0 4px;color:var(--muted);font-size:12px}textarea{min-height:90px;font-family:ui-monospace,monospace;font-size:12px}
pre{background:var(--bg);border:1px solid var(--line);border-radius:6px;padding:12px;overflow:auto;max-height:70vh;font-size:12px;white-space:pre-wrap;word-break:break-word}
.flash{padding:8px 12px;border-radius:6px;margin-bottom:16px;border:1px solid var(--line);background:var(--card)}.flash.err{border-color:var(--bad);color:var(--bad)}
.muted{color:var(--muted)}h2{font-size:15px;margin:0 0 12px}code{font-family:ui-monospace,monospace;font-size:12px}
`;

function page(title: string, body: string, flash?: { msg?: string | null; err?: string | null }, refresh?: number): string {
  const note = flash?.err
    ? `<div class="flash err">${esc(flash.err)}</div>`
    : flash?.msg
      ? `<div class="flash">${esc(flash.msg)}</div>`
      : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
${refresh ? `<meta http-equiv="refresh" content="${refresh}">` : ""}<title>${esc(title)} · Rainmaker</title><style>${STYLE}</style></head>
<body><header><b>Rainmaker</b><a href="./">Jobs</a><a href="./settings">Settings</a></header><main>${note}${body}</main></body></html>`;
}

function postButton(action: string, label: string, confirm?: string): string {
  const onsubmit = confirm ? ` onsubmit="return confirm('${esc(confirm)}')"` : "";
  return `<form class="inline" method="post" action="${esc(action)}"${onsubmit}><button>${esc(label)}</button></form>`;
}

function jobRow(job: Job, engine: Engine): string {
  const repoUrl = `https://github.com/${job.repo}`;
  const actions: string[] = [];
  if (job.status === "queued" || job.status === "running") actions.push(postButton(`./jobs/${job.id}/cancel`, "Cancel", "Cancel this job?"));
  else actions.push(postButton(`./jobs/${job.id}/retry`, "Retry"));
  const elapsed = job.started_at ? (job.finished_at ?? Date.now()) - job.started_at : null;
  return `<tr>
<td><a href="./jobs/${job.id}">#${job.id}</a></td>
<td class="s-${job.status}">${esc(job.status)}${engine.isRunning(job.id) ? " ●" : ""}</td>
<td><a href="${esc(repoUrl)}/issues/${job.issue_number}">${esc(job.repo)}#${job.issue_number}</a> <span class="muted">${esc(job.issue_title.slice(0, 50))}</span></td>
<td>${esc(job.route)}</td>
<td>${duration(elapsed)}</td>
<td>${job.pr_url ? `<a href="${esc(job.pr_url)}">PR #${job.pr_number}</a>` : "–"}</td>
<td>${when(job.created_at)}</td>
<td>${actions.join(" ")}</td></tr>`;
}

function home(deps: WebDeps): string {
  const { store, engine, clis, config } = deps;
  const stats = store.stats(Date.now() - 30 * 86_400_000);
  const finished = stats.succeeded + stats.failed;
  const rate = finished ? `${Math.round((stats.succeeded / finished) * 100)}%` : "–";
  const settings = config.settings;
  const setup: string[] = [];
  if (!config.githubToken) setup.push("Add a GitHub token in Settings.");
  if (!settings.repos.length) setup.push("Add at least one repository in Settings.");
  const poll = engine.lastPoll;
  const cliRows = clis
    .status()
    .map(
      (c) => `<tr><td>${c.name === "claude" ? "Claude Code" : "Codex"}</td><td>${esc(c.version ?? "not installed")}</td>
<td class="muted">${esc(c.previous ?? "–")}</td><td>${when(c.updatedAt)}</td>
<td>${postButton(`./clis/${c.name}/update`, "Update")} ${c.previous ? postButton(`./clis/${c.name}/rollback`, `Roll back to ${c.previous}`) : ""}</td></tr>`,
    )
    .join("");
  const jobs = store.listJobs(50);
  return `
${setup.length ? `<div class="flash err">${setup.map(esc).join(" ")}</div>` : ""}
<div class="card"><h2>Last 30 days</h2><div class="grid">
<div class="stat"><div class="n">${stats.total}</div><div class="l">jobs</div></div>
<div class="stat"><div class="n">${rate}</div><div class="l">success rate</div></div>
<div class="stat"><div class="n">${duration(stats.avg_duration_ms)}</div><div class="l">average run</div></div>
<div class="stat"><div class="n">${(stats.input_tokens + stats.output_tokens).toLocaleString("en-US")}</div><div class="l">tokens</div></div>
<div class="stat"><div class="n">${engine.runningCount}/${settings.concurrency}</div><div class="l">running now</div></div>
</div><p class="muted">Watching ${settings.repos.length} repo(s) every ${settings.pollIntervalSec}s. Last poll: ${poll ? when(poll.at) : "not yet"}${poll?.error ? ` <span class="s-failed">(${esc(poll.error)})</span>` : ""}
${postButton("./poll", "Poll now")}</p></div>
<div class="card"><h2>Jobs</h2>${
    jobs.length
      ? `<table><tr><th>Job</th><th>Status</th><th>Issue</th><th>Route</th><th>Time</th><th>PR</th><th>Created (UTC)</th><th></th></tr>${jobs.map((j) => jobRow(j, engine)).join("")}</table>`
      : `<p class="muted">No jobs yet. Add the <code>agent:ready</code> label to an issue in a watched repo.</p>`
  }</div>
<div class="card"><h2>Agent CLIs</h2><table><tr><th>CLI</th><th>Version</th><th>Previous</th><th>Updated (UTC)</th><th></th></tr>${cliRows}</table>
<p class="muted">${settings.autoUpdateHour === null ? "Auto-update is off." : `Auto-updates daily at ${settings.autoUpdateHour}:00 when no job is running.`}${clis.busy ? " An update is running now." : ""}</p></div>`;
}

function jobPage(deps: WebDeps, job: Job): string {
  const { engine } = deps;
  const live = engine.isRunning(job.id);
  let logText = live ? engine.tail(job.id).join("\n") : "";
  if (!live && existsSync(engine.logPath(job.id))) {
    const full = readFileSync(engine.logPath(job.id), "utf8");
    logText = full.length > 400_000 ? `[showing the last 400 KB]\n${full.slice(-400_000)}` : full;
  }
  const rows: [string, string][] = [
    ["Status", `<span class="s-${job.status}">${esc(job.status)}</span>`],
    ["Issue", `<a href="https://github.com/${esc(job.repo)}/issues/${job.issue_number}">${esc(job.repo)}#${job.issue_number}</a> ${esc(job.issue_title)}`],
    ["Agent", `${esc(job.agent)} ${job.model ? `(${esc(job.model)})` : ""} ${job.provider !== "default" ? `via ${esc(job.provider)}` : ""} · route <code>${esc(job.route)}</code>`],
    ["Skills", job.skills.length ? job.skills.map((s) => `<code>${esc(s)}</code>`).join(", ") : "–"],
    ["Branch", job.branch ? `<code>${esc(job.branch)}</code>` : "–"],
    ["Pull request", job.pr_url ? `<a href="${esc(job.pr_url)}">#${job.pr_number}</a>` : "–"],
    ["Started / finished", `${when(job.started_at)} / ${when(job.finished_at)} UTC`],
    ["Usage", `${job.num_turns ?? "–"} turns · ${(job.input_tokens ?? 0).toLocaleString("en-US")} in / ${(job.output_tokens ?? 0).toLocaleString("en-US")} out tokens${job.cost_usd != null ? ` · ~$${job.cost_usd.toFixed(2)} API-equivalent` : ""}`],
    ["CLI version", esc(job.cli_version ?? "–")],
  ];
  if (job.error) rows.push(["Error", `<span class="s-failed">${esc(job.error)}</span>`]);
  const actions =
    job.status === "queued" || job.status === "running"
      ? postButton(`./${job.id}/cancel`, "Cancel job", "Cancel this job?")
      : postButton(`./${job.id}/retry`, "Retry");
  return `<div class="card"><h2>Job #${job.id}</h2><table>${rows.map(([k, v]) => `<tr><th>${k}</th><td style="white-space:normal">${v}</td></tr>`).join("")}</table><p>${actions}</p></div>
${job.summary ? `<div class="card"><h2>Agent summary</h2><pre>${esc(job.summary)}</pre></div>` : ""}
<div class="card"><h2>Log${live ? " (live, refreshes every 5s)" : ""}</h2><pre>${esc(logText || "No output yet.")}</pre></div>`;
}

function settingsPage(deps: WebDeps): string {
  const { config } = deps;
  const s = config.settings;
  const secrets = config.secretNames();
  const routeOptions = Object.keys(s.routes)
    .map((r) => `<option ${r === s.defaultRoute ? "selected" : ""}>${esc(r)}</option>`)
    .join("");
  return `
<form method="post" action="./settings" class="card"><h2>GitHub</h2>
<label>Token (fine-grained, with Contents, Issues and Pull requests read/write on your repos). ${config.githubToken ? "A token is saved; leave blank to keep it." : "No token saved yet."}</label>
<input type="password" name="githubToken" autocomplete="off" placeholder="github_pat_…">
<label>Repositories to watch, one per line (owner/name)</label><textarea name="repos">${esc(s.repos.join("\n"))}</textarea>
<label>Who may trigger runs by adding <code>agent:ready</code> (GitHub logins, one per line). Empty means only the token's owner.</label>
<textarea name="allowedUsers" style="min-height:50px">${esc(s.allowedUsers.join("\n"))}</textarea>
<h2 style="margin-top:20px">Runs</h2><div class="grid">
<div><label>Poll every (seconds)</label><input name="pollIntervalSec" type="number" min="15" value="${s.pollIntervalSec}"></div>
<div><label>Jobs at once</label><input name="concurrency" type="number" min="1" max="4" value="${s.concurrency}"></div>
<div><label>Job timeout (minutes)</label><input name="jobTimeoutMin" type="number" min="5" value="${s.jobTimeoutMin}"></div>
<div><label>Keep history (days)</label><input name="retentionDays" type="number" min="1" value="${s.retentionDays}"></div>
<div><label>Auto-update CLIs at hour (blank = off)</label><input name="autoUpdateHour" type="number" min="0" max="23" value="${s.autoUpdateHour ?? ""}"></div>
<div><label>Default route (no <code>model:</code> label)</label><select name="defaultRoute">${routeOptions}</select></div>
</div>
<label>Routes: what each <code>model:&lt;name&gt;</code> label runs. <code>agent</code> is claude or codex; <code>model</code> is passed to the CLI; <code>provider</code> "openrouter" uses the OPENROUTER_API_KEY secret.</label>
<textarea name="routes" style="min-height:160px">${esc(JSON.stringify(s.routes, null, 2))}</textarea>
<p><button>Save settings</button></p></form>

<div class="card"><h2>Secrets</h2>
<p class="muted">Encrypted with this Umbrel's app key, never shown again, passed to every agent run as environment variables, and masked in logs and GitHub comments.</p>
${
  secrets.length
    ? `<table><tr><th>Name</th><th>Updated (UTC)</th><th></th></tr>${secrets
        .map((x) => `<tr><td><code>${esc(x.name)}</code></td><td>${when(x.updated_at)}</td><td>${postButton(`./secrets/${encodeURIComponent(x.name)}/delete`, "Delete", `Delete ${x.name}?`)}</td></tr>`)
        .join("")}</table>`
    : `<p class="muted">No secrets yet.</p>`
}
<form method="post" action="./secrets"><div class="grid">
<div><label>Name</label><input name="name" placeholder="OPENROUTER_API_KEY" autocomplete="off"></div>
<div><label>Value</label><input name="value" type="password" autocomplete="off"></div></div>
<p><button>Add or replace secret</button></p></form></div>

<div class="card"><h2>Signing in to Claude and Codex</h2>
<p>Open a terminal for this app (umbrelOS Settings, Advanced settings, Terminal, then choose Rainmaker) and run:</p>
<pre>claude setup-token        # sign in with your Claude subscription; save the printed token as the CLAUDE_CODE_OAUTH_TOKEN secret
codex login --device-auth # sign in with your ChatGPT plan; the login is kept on the app's volume</pre>
<p class="muted">For OpenRouter, add an <code>OPENROUTER_API_KEY</code> secret and a route with <code>"provider": "openrouter"</code>.</p></div>`;
}

async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 1_000_000) throw new Error("Request too large");
  }
  return new URLSearchParams(body);
}

function lines(value: string | null): string[] {
  return (value ?? "").split(/[\n,]/).map((v) => v.trim()).filter(Boolean);
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

function send(res: ServerResponse, status: number, body: string, type = "text/html; charset=utf-8"): void {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", "X-Frame-Options": "SAMEORIGIN" });
  res.end(body);
}

function redirect(res: ServerResponse, to: string, flash?: { msg?: string; err?: string }): void {
  const q = new URLSearchParams();
  if (flash?.msg) q.set("msg", flash.msg);
  if (flash?.err) q.set("err", flash.err);
  res.writeHead(303, { Location: q.size ? `${to}?${q}` : to });
  res.end();
}

function json(res: ServerResponse, data: unknown, status = 200): void {
  send(res, status, JSON.stringify(data, null, 2), "application/json");
}

export function createWebServer(deps: WebDeps): Server {
  const { store, config, engine, clis } = deps;

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname.replace(/\/+$/, "") || "/";
    const flash = { msg: url.searchParams.get("msg"), err: url.searchParams.get("err") };
    try {
      if (req.method === "GET") {
        if (path === "/healthz") return json(res, { ok: true, version: deps.version });
        if (path === "/") return send(res, 200, page("Jobs", home(deps), flash, engine.runningCount ? 10 : undefined));
        if (path === "/settings") return send(res, 200, page("Settings", settingsPage(deps), flash));
        const jobMatch = /^\/jobs\/(\d+)$/.exec(path);
        if (jobMatch) {
          const job = store.getJob(Number(jobMatch[1]));
          if (!job) return send(res, 404, page("Not found", "<p>No such job.</p>"));
          return send(res, 200, page(`Job #${job.id}`, jobPage(deps, job), flash, engine.isRunning(job.id) ? 5 : undefined));
        }
        if (path === "/api/status") {
          return json(res, {
            version: deps.version,
            running: engine.runningCount,
            lastPoll: engine.lastPoll,
            clis: clis.status(),
            stats30d: store.stats(Date.now() - 30 * 86_400_000),
          });
        }
        if (path === "/api/jobs") return json(res, store.listJobs(Number(url.searchParams.get("limit") ?? 50)));
        const apiJob = /^\/api\/jobs\/(\d+)$/.exec(path);
        if (apiJob) {
          const job = store.getJob(Number(apiJob[1]));
          return job ? json(res, { ...job, tail: engine.tail(job.id) }) : json(res, { error: "not found" }, 404);
        }
        return send(res, 404, page("Not found", "<p>Not found.</p>"));
      }

      if (req.method === "POST") {
        if (!sameOrigin(req)) return send(res, 403, "Cross-origin request refused", "text/plain");
        const form = await readForm(req);

        if (path === "/settings") {
          try {
            const token = form.get("githubToken")?.trim();
            const current = config.settings;
            const hour = form.get("autoUpdateHour")?.trim();
            const next: Settings = {
              ...current,
              repos: lines(form.get("repos")),
              allowedUsers: lines(form.get("allowedUsers")),
              pollIntervalSec: Number(form.get("pollIntervalSec")),
              concurrency: Number(form.get("concurrency")),
              jobTimeoutMin: Number(form.get("jobTimeoutMin")),
              retentionDays: Number(form.get("retentionDays")),
              autoUpdateHour: hour ? Number(hour) : null,
              defaultRoute: form.get("defaultRoute") ?? current.defaultRoute,
              routes: JSON.parse(form.get("routes") || "{}") as Record<string, Route>,
            };
            config.saveSettings(next);
            if (token) config.setGithubToken(token);
            return redirect(res, "./settings", { msg: "Settings saved." });
          } catch (err) {
            return redirect(res, "./settings", { err: errorMessage(err) });
          }
        }
        if (path === "/secrets") {
          try {
            config.putSecret(form.get("name") ?? "", form.get("value") ?? "");
            return redirect(res, "./settings", { msg: "Secret saved." });
          } catch (err) {
            return redirect(res, "./settings", { err: errorMessage(err) });
          }
        }
        const secretDelete = /^\/secrets\/([^/]+)\/delete$/.exec(path);
        if (secretDelete) {
          config.deleteSecret(decodeURIComponent(secretDelete[1]!));
          return redirect(res, "../../settings", { msg: "Secret deleted." });
        }
        if (path === "/poll") {
          await engine.poll();
          engine.tick();
          return redirect(res, "./", { msg: engine.lastPoll?.error ? `Poll finished with errors: ${engine.lastPoll.error}` : "Poll finished." });
        }
        const jobAction = /^\/jobs\/(\d+)\/(cancel|retry)$/.exec(path);
        if (jobAction) {
          const id = Number(jobAction[1]);
          try {
            if (jobAction[2] === "cancel") {
              await engine.cancel(id, "it was cancelled from the Rainmaker dashboard");
              return redirect(res, `../${id}`, { msg: "Cancelling." });
            }
            const job = await engine.retry(id);
            engine.tick();
            return redirect(res, `../${job.id}`, { msg: `Queued as job #${job.id}.` });
          } catch (err) {
            return redirect(res, `../${id}`, { err: errorMessage(err) });
          }
        }
        const cliAction = /^\/clis\/(claude|codex)\/(update|rollback)$/.exec(path);
        if (cliAction) {
          const name = cliAction[1] as AgentName;
          if (engine.runningCount) return redirect(res, "../../", { err: "Wait for running jobs to finish before updating." });
          try {
            const version = cliAction[2] === "update" ? await clis.update(name) : await clis.rollback(name);
            return redirect(res, "../../", { msg: `${name} is now at ${version}.` });
          } catch (err) {
            return redirect(res, "../../", { err: errorMessage(err) });
          }
        }
      }
      send(res, 404, "Not found", "text/plain");
    } catch (err) {
      send(res, 500, page("Error", `<div class="flash err">${esc(errorMessage(err))}</div>`));
    }
  });
}
