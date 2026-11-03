import { useCallback, useEffect, useRef, useState } from "react";

/** Types mirror src/api.ts on the server. */

export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface Job {
  id: number;
  repo: string;
  issue_number: number;
  issue_title: string;
  status: JobStatus;
  route: string;
  agent: "claude" | "codex";
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
  running: boolean;
  duration_ms: number | null;
}

export interface Question {
  id: number;
  job_id: number;
  question: string;
  status: "pending" | "answered" | "expired";
  answer: string | null;
  answered_by: string | null;
  asked_at: number;
  answered_at: number | null;
}

export interface PendingQuestion extends Question {
  expires_at: number;
  job: { id: number; repo: string; issue_number: number; issue_title: string } | null;
}

export interface JobDetail extends Job {
  log: { text: string; truncated: boolean };
  questions: Question[];
}

export interface CliStatus {
  name: "claude" | "codex";
  version: string | null;
  previous: string | null;
  updatedAt: number | null;
}

export interface Overview {
  version: string;
  setup: string[];
  running: number;
  concurrency: number;
  lastPoll: { at: number; error: string | null } | null;
  pollIntervalSec: number;
  repos: string[];
  routes: string[];
  defaultRoute: string;
  dailyBranch: string | null;
  timeZone: string;
  autoUpdateHour: number | null;
  clis: CliStatus[];
  cliBusy: boolean;
  questions: PendingQuestion[];
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

export interface DayStats {
  date: string;
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  tokens: number;
  cost_usd: number;
}

export interface Totals {
  total: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  avg_duration_ms: number | null;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  success_rate: number | null;
}

export interface Stats extends Totals {
  days: number;
  /** The same-length window just before this one. */
  previous: Totals;
  by_route: GroupStats[];
  by_repo: GroupStats[];
  daily: DayStats[];
}

export interface Route {
  agent: "claude" | "codex";
  model?: string;
  provider?: "openrouter";
}

export interface Settings {
  repos: string[];
  allowedUsers: string[];
  pollIntervalSec: number;
  concurrency: number;
  jobTimeoutMin: number;
  questionTimeoutMin: number;
  retentionDays: number;
  autoUpdateHour: number | null;
  dailyBranch: boolean;
  timeZone: string;
  defaultRoute: string;
  routes: Record<string, Route>;
}

export interface SettingsView {
  settings: Settings;
  githubTokenSet: boolean;
  secrets: { name: string; updated_at: number }[];
  mcp: { url: string; token: string };
}

/** API paths are relative, so the dashboard works under any path prefix. */
export async function api<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`api/${path}`, {
    method: init.method ?? "GET",
    headers: init.body === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: "POST", body });

export interface IssueRef {
  number: number;
  title: string;
  html_url: string;
}

/**
 * Loads `path` and reloads it every `everyMs` (when given) while the tab is visible.
 * `reload()` fetches again right away, e.g. after an action.
 */
export function useApi<T>(path: string | null, everyMs?: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    if (!path) return;
    const mine = ++seq.current;
    try {
      const next = await api<T>(path);
      if (mine === seq.current) {
        setData(next);
        setError(null);
      }
    } catch (err) {
      if (mine === seq.current) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    setLoading(true);
    void reload();
    if (!everyMs) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void reload();
    }, everyMs);
    return () => window.clearInterval(timer);
  }, [reload, everyMs]);

  return { data, error, loading, reload };
}
