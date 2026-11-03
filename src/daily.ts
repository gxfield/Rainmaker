/**
 * Daily staging branches. When they're on, each day's agent PRs target
 * `rainmaker/daily-YYYY-MM-DD` instead of the default branch, so you can review and
 * merge them there (repos can skip CI for those PRs), then open one PR to the default branch.
 */

export const DAILY_PREFIX = "rainmaker/daily-";

/** The calendar date and hour in `timeZone`. */
export function zonedNow(now: Date, timeZone: string): { date: string; hour: number } {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" });
  for (const p of format.formatToParts(now)) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function validTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export function dailyBranchName(now: Date, timeZone: string): string {
  return `${DAILY_PREFIX}${zonedNow(now, timeZone).date}`;
}

/**
 * The daily branch a new job should use. Normally today's (in the configured time zone), but if
 * a branch dated later already exists, keep using it: that happens right after the time zone is
 * changed to one behind the old one (say UTC to America/Los_Angeles in the evening), and going
 * back to an older date would leave two "today" branches with PRs split between them.
 */
export function pickDailyBranch(today: string, existing: string[]): string {
  const newest = existing
    .filter((b) => /^rainmaker\/daily-\d{4}-\d{2}-\d{2}$/.test(b))
    .sort()
    .at(-1);
  return newest && newest > today ? newest : today;
}

export interface MergedPull {
  number: number;
  title: string;
  head: string;
  body: string;
}

/** The issue a merged PR closes: Rainmaker's own branch name, or a closing keyword in its body. */
export function issueOfPull(pull: MergedPull): number | undefined {
  const branch = /^rainmaker\/issue-(\d+)$/.exec(pull.head);
  if (branch) return Number(branch[1]);
  const keyword = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/i.exec(pull.body);
  return keyword ? Number(keyword[1]) : undefined;
}

/**
 * Body for the PR from a daily branch to the default branch. Closing keywords only work
 * on the default branch, so the issues the day's PRs fixed are closed from here.
 */
export function dailyPrBody(branch: string, defaultBranch: string, pulls: MergedPull[]): string {
  const sorted = [...pulls].sort((a, b) => a.number - b.number);
  const issues = [...new Set(sorted.map(issueOfPull).filter((n): n is number => n !== undefined))];
  const lines = [
    `Everything merged into \`${branch}\`, ready to go to \`${defaultBranch}\`.`,
    "",
    sorted.length ? "Merged into the daily branch:" : "_No pull requests were merged into the daily branch; it has direct commits only._",
    ...sorted.map((p) => {
      const issue = issueOfPull(p);
      return `- #${p.number} ${p.title}${issue ? ` (issue #${issue})` : ""}`;
    }),
  ];
  if (issues.length) lines.push("", ...issues.map((n) => `Closes #${n}`));
  lines.push("", "---", "Opened by Rainmaker.");
  return lines.join("\n");
}
