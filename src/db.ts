import { DatabaseSync } from "node:sqlite";

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type AgentName = "claude" | "codex";

export interface Job {
  id: number;
  repo: string;
  issue_number: number;
  issue_title: string;
  status: JobStatus;
  route: string;
  agent: AgentName;
  model: string | null;
  provider: string;
  skills: string[];
  branch: string | null;
  pr_url: string | null;
  pr_number: number | null;
  summary: string | null;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cached_tokens: number | null;
  cost_usd: number | null;
  num_turns: number | null;
  cli_version: string | null;
}

export interface NewJob {
  repo: string;
  issue_number: number;
  issue_title: string;
  route: string;
  agent: AgentName;
  model: string | null;
  provider: string;
  skills: string[];
}

export interface JobResultFields {
  branch?: string | null;
  pr_url?: string | null;
  pr_number?: number | null;
  summary?: string | null;
  error?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cached_tokens?: number | null;
  cost_usd?: number | null;
  num_turns?: number | null;
  cli_version?: string | null;
}

export type QuestionStatus = "pending" | "answered" | "expired";

export interface Question {
  id: number;
  job_id: number;
  question: string;
  status: QuestionStatus;
  answer: string | null;
  answered_by: string | null;
  asked_at: number;
  answered_at: number | null;
}

export interface GroupStats {
  key: string;
  total: number;
  succeeded: number;
  failed: number;
  avg_duration_ms: number | null;
  tokens: number;
  cost_usd: number;
}

export interface StatsRow {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  avg_duration_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS secrets (
  name TEXT PRIMARY KEY,
  sealed TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  repo TEXT NOT NULL,
  issue_number INTEGER NOT NULL,
  issue_title TEXT NOT NULL,
  status TEXT NOT NULL,
  route TEXT NOT NULL,
  agent TEXT NOT NULL,
  model TEXT,
  provider TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  branch TEXT,
  pr_url TEXT,
  pr_number INTEGER,
  summary TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_tokens INTEGER,
  cost_usd REAL,
  num_turns INTEGER,
  cli_version TEXT
);
CREATE INDEX IF NOT EXISTS jobs_created_at ON jobs(created_at);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status);
CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  question TEXT NOT NULL,
  status TEXT NOT NULL,
  answer TEXT,
  answered_by TEXT,
  asked_at INTEGER NOT NULL,
  answered_at INTEGER
);
CREATE INDEX IF NOT EXISTS questions_status ON questions(status);
CREATE TABLE IF NOT EXISTS cli_versions (
  name TEXT PRIMARY KEY,
  version TEXT,
  previous TEXT,
  updated_at INTEGER NOT NULL
);
`;

type Row = Record<string, unknown>;

function toJob(row: Row): Job {
  return { ...(row as unknown as Job), skills: JSON.parse(String(row.skills ?? "[]")) as string[] };
}

export class Store {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  // settings
  getSetting(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as Row | undefined;
    return row ? String(row.value) : undefined;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  // secrets (values are sealed by the caller)
  listSecretNames(): { name: string; updated_at: number }[] {
    return this.db.prepare("SELECT name, updated_at FROM secrets ORDER BY name").all() as unknown as {
      name: string;
      updated_at: number;
    }[];
  }

  getSealedSecrets(): { name: string; sealed: string }[] {
    return this.db.prepare("SELECT name, sealed FROM secrets").all() as unknown as { name: string; sealed: string }[];
  }

  putSecret(name: string, sealed: string): void {
    this.db
      .prepare(
        "INSERT INTO secrets (name, sealed, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET sealed = excluded.sealed, updated_at = excluded.updated_at",
      )
      .run(name, sealed, Date.now());
  }

  deleteSecret(name: string): void {
    this.db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
  }

  // jobs
  createJob(job: NewJob): Job {
    const result = this.db
      .prepare(
        `INSERT INTO jobs (repo, issue_number, issue_title, status, route, agent, model, provider, skills, created_at)
         VALUES (?, ?, ?, 'queued', ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        job.repo,
        job.issue_number,
        job.issue_title,
        job.route,
        job.agent,
        job.model,
        job.provider,
        JSON.stringify(job.skills),
        Date.now(),
      );
    return this.getJob(Number(result.lastInsertRowid))!;
  }

  getJob(id: number): Job | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? toJob(row) : undefined;
  }

  listJobs(limit = 50): Job[] {
    return (this.db.prepare("SELECT * FROM jobs ORDER BY id DESC LIMIT ?").all(limit) as Row[]).map(toJob);
  }

  /** The fields the daily charts need, for jobs created since `sinceMs`. */
  jobsSince(sinceMs: number): Pick<Job, "created_at" | "status" | "input_tokens" | "output_tokens" | "cost_usd">[] {
    return this.db
      .prepare("SELECT created_at, status, input_tokens, output_tokens, cost_usd FROM jobs WHERE created_at >= ? ORDER BY id")
      .all(sinceMs) as unknown as Pick<Job, "created_at" | "status" | "input_tokens" | "output_tokens" | "cost_usd">[];
  }

  jobsWithStatus(...statuses: JobStatus[]): Job[] {
    const marks = statuses.map(() => "?").join(",");
    return (this.db.prepare(`SELECT * FROM jobs WHERE status IN (${marks}) ORDER BY id`).all(...statuses) as Row[]).map(
      toJob,
    );
  }

  activeJobFor(repo: string, issueNumber: number): Job | undefined {
    const row = this.db
      .prepare("SELECT * FROM jobs WHERE repo = ? AND issue_number = ? AND status IN ('queued','running') LIMIT 1")
      .get(repo, issueNumber) as Row | undefined;
    return row ? toJob(row) : undefined;
  }

  nextQueued(): Job | undefined {
    const row = this.db.prepare("SELECT * FROM jobs WHERE status = 'queued' ORDER BY id LIMIT 1").get() as
      | Row
      | undefined;
    return row ? toJob(row) : undefined;
  }

  markRunning(id: number): void {
    this.db.prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?").run(Date.now(), id);
  }

  finishJob(id: number, status: Exclude<JobStatus, "queued" | "running">, fields: JobResultFields = {}): void {
    const keys = Object.keys(fields) as (keyof JobResultFields)[];
    const sets = ["status = ?", "finished_at = ?", ...keys.map((k) => `${k} = ?`)];
    const values = [status, Date.now(), ...keys.map((k) => fields[k] ?? null)];
    this.db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  updateJob(id: number, fields: JobResultFields): void {
    const keys = Object.keys(fields) as (keyof JobResultFields)[];
    if (!keys.length) return;
    this.db
      .prepare(`UPDATE jobs SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`)
      .run(...keys.map((k) => fields[k] ?? null), id);
  }

  requeue(id: number): void {
    this.db
      .prepare(
        "UPDATE jobs SET status = 'queued', started_at = NULL, finished_at = NULL, error = NULL WHERE id = ?",
      )
      .run(id);
  }

  /** Totals for jobs created in [sinceMs, untilMs). */
  stats(sinceMs: number, untilMs = Number.MAX_SAFE_INTEGER): StatsRow {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(status = 'succeeded') AS succeeded,
                SUM(status = 'failed') AS failed,
                SUM(status = 'cancelled') AS cancelled,
                AVG(CASE WHEN finished_at IS NOT NULL AND started_at IS NOT NULL THEN finished_at - started_at END) AS avg_duration_ms,
                COALESCE(SUM(input_tokens), 0) AS input_tokens,
                COALESCE(SUM(output_tokens), 0) AS output_tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM jobs WHERE created_at >= ? AND created_at < ?`,
      )
      .get(sinceMs, untilMs) as Row;
    return {
      total: Number(row.total ?? 0),
      succeeded: Number(row.succeeded ?? 0),
      failed: Number(row.failed ?? 0),
      cancelled: Number(row.cancelled ?? 0),
      avg_duration_ms: row.avg_duration_ms == null ? null : Number(row.avg_duration_ms),
      input_tokens: Number(row.input_tokens),
      output_tokens: Number(row.output_tokens),
      cost_usd: Number(row.cost_usd),
    };
  }

  /** Per-route or per-repo totals since `sinceMs`. */
  statsBy(field: "route" | "repo" | "agent", sinceMs: number): GroupStats[] {
    const rows = this.db
      .prepare(
        `SELECT ${field} AS key, COUNT(*) AS total,
                SUM(status = 'succeeded') AS succeeded,
                SUM(status = 'failed') AS failed,
                AVG(CASE WHEN finished_at IS NOT NULL AND started_at IS NOT NULL THEN finished_at - started_at END) AS avg_duration_ms,
                COALESCE(SUM(input_tokens), 0) + COALESCE(SUM(output_tokens), 0) AS tokens,
                COALESCE(SUM(cost_usd), 0) AS cost_usd
         FROM jobs WHERE created_at >= ? GROUP BY ${field} ORDER BY total DESC`,
      )
      .all(sinceMs) as Row[];
    return rows.map((r) => ({
      key: String(r.key),
      total: Number(r.total),
      succeeded: Number(r.succeeded ?? 0),
      failed: Number(r.failed ?? 0),
      avg_duration_ms: r.avg_duration_ms == null ? null : Number(r.avg_duration_ms),
      tokens: Number(r.tokens),
      cost_usd: Number(r.cost_usd),
    }));
  }

  // questions
  createQuestion(jobId: number, question: string): Question {
    const result = this.db
      .prepare("INSERT INTO questions (job_id, question, status, asked_at) VALUES (?, ?, 'pending', ?)")
      .run(jobId, question, Date.now());
    return this.getQuestion(Number(result.lastInsertRowid))!;
  }

  getQuestion(id: number): Question | undefined {
    return this.db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as Question | undefined;
  }

  questionsFor(jobId: number): Question[] {
    return this.db.prepare("SELECT * FROM questions WHERE job_id = ? ORDER BY id").all(jobId) as unknown as Question[];
  }

  pendingQuestions(): Question[] {
    return this.db.prepare("SELECT * FROM questions WHERE status = 'pending' ORDER BY id").all() as unknown as Question[];
  }

  closeQuestion(id: number, status: Exclude<QuestionStatus, "pending">, answer: string | null, by: string | null): boolean {
    const res = this.db
      .prepare("UPDATE questions SET status = ?, answer = ?, answered_by = ?, answered_at = ? WHERE id = ? AND status = 'pending'")
      .run(status, answer, by, Date.now(), id);
    return Number(res.changes) > 0;
  }

  /** Deletes finished jobs created before `beforeMs` and returns their ids. */
  pruneJobs(beforeMs: number): number[] {
    const rows = this.db
      .prepare("SELECT id FROM jobs WHERE created_at < ? AND status NOT IN ('queued','running')")
      .all(beforeMs) as Row[];
    this.db.prepare("DELETE FROM jobs WHERE created_at < ? AND status NOT IN ('queued','running')").run(beforeMs);
    this.db.prepare("DELETE FROM questions WHERE job_id NOT IN (SELECT id FROM jobs)").run();
    return rows.map((r) => Number(r.id));
  }

  // CLI versions
  getCliVersion(name: string): { version: string | null; previous: string | null; updated_at: number } | undefined {
    return this.db.prepare("SELECT version, previous, updated_at FROM cli_versions WHERE name = ?").get(name) as
      | { version: string | null; previous: string | null; updated_at: number }
      | undefined;
  }

  setCliVersion(name: string, version: string | null, previous: string | null): void {
    this.db
      .prepare(
        `INSERT INTO cli_versions (name, version, previous, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET version = excluded.version, previous = excluded.previous, updated_at = excluded.updated_at`,
      )
      .run(name, version, previous, Date.now());
  }
}
