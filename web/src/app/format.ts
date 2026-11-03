export function duration(ms: number | null | undefined): string {
  if (ms == null) return "–";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function ago(ts: number | null | undefined): string {
  if (!ts) return "–";
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : new Date(ts).toLocaleDateString();
}

export function dateTime(ts: number | null | undefined): string {
  if (!ts) return "–";
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function compact(n: number): string {
  return n.toLocaleString("en-US", { notation: n >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 });
}

export function money(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const githubIssue = (repo: string, n: number) => `https://github.com/${repo}/issues/${n}`;
