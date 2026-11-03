import { LABELS } from "./settings.ts";

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: string[];
  user: string;
  html_url: string;
  /** True for a pull request (GitHub treats PRs as issues too). */
  pull: boolean;
}

export interface PullRequest {
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  html_url: string;
  head: string;
  /** `owner/name` of the repo the head branch lives in (another one for a fork). */
  headRepo: string;
  base: string;
}

/** A PR comment, a review, or an inline review comment, oldest first. */
export interface Feedback {
  user: string;
  body: string;
  created_at: string;
  /** A review's verdict, e.g. `changes_requested`. */
  review?: string;
  /** `path:line` for an inline comment on the diff. */
  where?: string;
}

export interface IssueComment {
  user: string;
  body: string;
  created_at: string;
}

export interface Viewer {
  login: string;
  id: number;
}

export class GitHubError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Fetch = typeof fetch;
type Json = Record<string, any>;

const LABEL_COLORS: Record<string, { color: string; description: string }> = {
  [LABELS.ready]: { color: "0e8a16", description: "Rainmaker: ready for an agent to pick up" },
  [LABELS.working]: { color: "fbca04", description: "Rainmaker: an agent is working on this" },
  [LABELS.done]: { color: "1d76db", description: "Rainmaker: the agent opened a pull request" },
  [LABELS.failed]: { color: "d93f0b", description: "Rainmaker: the agent run failed" },
};

function toIssue(raw: Json): Issue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body ?? null,
    state: raw.state,
    labels: (raw.labels ?? []).map((l: Json | string) => (typeof l === "string" ? l : l.name)),
    user: raw.user?.login ?? "",
    html_url: raw.html_url,
    pull: Boolean(raw.pull_request),
  };
}

/** A small GitHub REST client: only the calls Rainmaker needs, with ETag caching for polls. */
export class GitHub {
  readonly #token: string;
  readonly #fetch: Fetch;
  readonly #api: string;
  readonly #etags = new Map<string, { etag: string; body: unknown }>();

  constructor(token: string, options: { fetch?: Fetch; apiUrl?: string } = {}) {
    this.#token = token;
    this.#fetch = options.fetch ?? fetch;
    this.#api = options.apiUrl ?? "https://api.github.com";
  }

  async request<T = any>(method: string, path: string, body?: unknown, opts: { cache?: boolean } = {}): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.#api}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.#token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "rainmaker",
    };
    const cached = opts.cache ? this.#etags.get(url) : undefined;
    if (cached) headers["If-None-Match"] = cached.etag;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await this.#fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 304 && cached) return cached.body as T;
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : undefined;
    if (!res.ok) throw new GitHubError(res.status, `GitHub ${method} ${path} failed (${res.status}): ${data?.message ?? text}`);
    const etag = res.headers.get("etag");
    if (opts.cache && etag) this.#etags.set(url, { etag, body: data });
    return data as T;
  }

  async viewer(): Promise<Viewer> {
    const me = await this.request<Json>("GET", "/user");
    return { login: me.login, id: me.id };
  }

  async defaultBranch(repo: string): Promise<string> {
    const data = await this.request<Json>("GET", `/repos/${repo}`);
    return data.default_branch;
  }

  /** Open issues and PRs carrying `label`. Uses ETags so unchanged polls don't count against the rate limit. */
  async issuesWithLabel(repo: string, label: string): Promise<Issue[]> {
    const q = new URLSearchParams({ state: "open", labels: label, per_page: "50", sort: "created", direction: "asc" });
    const data = await this.request<Json[]>("GET", `/repos/${repo}/issues?${q}`, undefined, { cache: true });
    return data.map(toIssue);
  }

  async pull(repo: string, number: number): Promise<PullRequest> {
    const p = await this.request<Json>("GET", `/repos/${repo}/pulls/${number}`);
    return {
      number: p.number,
      title: p.title ?? "",
      body: p.body ?? null,
      state: p.state,
      html_url: p.html_url,
      head: p.head?.ref ?? "",
      headRepo: p.head?.repo?.full_name ?? "",
      base: p.base?.ref ?? "",
    };
  }

  /** Everything said on a PR: conversation comments, review verdicts and inline comments, oldest first. */
  async feedback(repo: string, number: number): Promise<Feedback[]> {
    const [comments, reviews, inline] = await Promise.all([
      this.request<Json[]>("GET", `/repos/${repo}/issues/${number}/comments?per_page=100`),
      this.request<Json[]>("GET", `/repos/${repo}/pulls/${number}/reviews?per_page=100`),
      this.request<Json[]>("GET", `/repos/${repo}/pulls/${number}/comments?per_page=100`),
    ]);
    const items: Feedback[] = [
      ...comments.map((c) => ({ user: c.user?.login ?? "", body: c.body ?? "", created_at: c.created_at })),
      ...reviews
        .filter((r) => r.state !== "PENDING" && (r.body?.trim() || r.state === "CHANGES_REQUESTED"))
        .map((r) => ({ user: r.user?.login ?? "", body: r.body ?? "", created_at: r.submitted_at, review: String(r.state).toLowerCase() })),
      ...inline.map((c) => ({
        user: c.user?.login ?? "",
        body: c.body ?? "",
        created_at: c.created_at,
        where: `${c.path}${(c.line ?? c.original_line) ? `:${c.line ?? c.original_line}` : ""}`,
      })),
    ];
    return items.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  }

  async issue(repo: string, number: number): Promise<Issue> {
    return toIssue(await this.request<Json>("GET", `/repos/${repo}/issues/${number}`));
  }

  async comments(repo: string, number: number, limit = 30, since?: Date): Promise<IssueComment[]> {
    const q = new URLSearchParams({ per_page: "100" });
    if (since) q.set("since", since.toISOString());
    const data = await this.request<Json[]>("GET", `/repos/${repo}/issues/${number}/comments?${q}`);
    return data.slice(-limit).map((c) => ({ user: c.user?.login ?? "", body: c.body ?? "", created_at: c.created_at }));
  }

  /** Login of whoever most recently applied `label` to the issue, or undefined if unknown. */
  async labelActor(repo: string, number: number, label: string): Promise<string | undefined> {
    let actor: string | undefined;
    for (let page = 1; page <= 10; page++) {
      const events = await this.request<Json[]>("GET", `/repos/${repo}/issues/${number}/events?per_page=100&page=${page}`);
      for (const e of events) {
        if (e.event === "labeled" && e.label?.name?.toLowerCase() === label.toLowerCase()) actor = e.actor?.login;
      }
      if (events.length < 100) break;
    }
    return actor;
  }

  async createIssue(repo: string, issue: { title: string; body: string; labels: string[] }): Promise<Issue> {
    return toIssue(await this.request<Json>("POST", `/repos/${repo}/issues`, issue));
  }

  async addLabels(repo: string, number: number, labels: string[]): Promise<void> {
    await this.request("POST", `/repos/${repo}/issues/${number}/labels`, { labels });
  }

  async removeLabel(repo: string, number: number, label: string): Promise<void> {
    try {
      await this.request("DELETE", `/repos/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`);
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 404)) throw err;
    }
  }

  /** Swaps every Rainmaker state label on the issue for `to`. */
  async setStateLabel(repo: string, number: number, to: string): Promise<void> {
    for (const label of Object.values(LABELS)) if (label !== to) await this.removeLabel(repo, number, label);
    await this.addLabels(repo, number, [to]);
  }

  /** Creates the four state labels in the repo if they're missing. */
  async ensureLabels(repo: string): Promise<void> {
    for (const [name, meta] of Object.entries(LABEL_COLORS)) {
      try {
        await this.request("POST", `/repos/${repo}/labels`, { name, ...meta });
      } catch (err) {
        if (!(err instanceof GitHubError && err.status === 422)) throw err; // 422: already exists
      }
    }
  }

  async comment(repo: string, number: number, body: string): Promise<void> {
    await this.request("POST", `/repos/${repo}/issues/${number}/comments`, { body });
  }

  /**
   * Opens a PR. If one is already open for the same branch (a retry, or a daily PR opened again),
   * it's updated in place: new title and description, and moved to `base` if it targets another branch.
   */
  async openPullRequest(
    repo: string,
    pr: { title: string; head: string; base: string; body: string },
  ): Promise<{ number: number; html_url: string }> {
    try {
      const data = await this.request<Json>("POST", `/repos/${repo}/pulls`, pr);
      return { number: data.number, html_url: data.html_url };
    } catch (err) {
      if (!(err instanceof GitHubError && err.status === 422)) throw err;
      const owner = repo.split("/")[0];
      const existing = await this.request<Json[]>("GET", `/repos/${repo}/pulls?state=open&head=${owner}:${encodeURIComponent(pr.head)}`);
      const first = existing[0];
      if (!first) throw err;
      const update: Json = { title: pr.title, body: pr.body };
      if (first.base?.ref && first.base.ref !== pr.base) update.base = pr.base;
      await this.request("PATCH", `/repos/${repo}/pulls/${first.number}`, update);
      return { number: first.number, html_url: first.html_url };
    }
  }

  /** Branch names starting with `prefix`. */
  async branchesWithPrefix(repo: string, prefix: string): Promise<string[]> {
    const refs = await this.request<Json[]>("GET", `/repos/${repo}/git/matching-refs/heads/${prefix}`);
    return refs.map((r) => String(r.ref).replace(/^refs\/heads\//, ""));
  }

  /** How many commits `head` has that `base` doesn't. */
  async aheadBy(repo: string, base: string, head: string): Promise<number> {
    const data = await this.request<Json>("GET", `/repos/${repo}/compare/${base}...${head}`);
    return Number(data.ahead_by ?? 0);
  }

  /** PRs merged into `base` (most recent 100). */
  async mergedPulls(repo: string, base: string): Promise<{ number: number; title: string; head: string; body: string }[]> {
    const q = new URLSearchParams({ state: "closed", base, per_page: "100" });
    const data = await this.request<Json[]>("GET", `/repos/${repo}/pulls?${q}`);
    return data
      .filter((p) => p.merged_at)
      .map((p) => ({ number: p.number, title: p.title ?? "", head: p.head?.ref ?? "", body: p.body ?? "" }));
  }
}
