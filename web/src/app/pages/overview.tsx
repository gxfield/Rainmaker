import { useState } from "react";
import {
  RiAddLine,
  RiArrowRightSLine,
  RiCheckDoubleFill,
  RiGitBranchLine,
  RiInboxLine,
  RiPlayCircleFill,
  RiRefreshLine,
  RiRobot2Line,
  RiTerminalBoxLine,
  RiTimerFlashFill,
  RiStackFill,
} from "@remixicon/react";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { StatCards, type Stat } from "@/components/application/dashboard/stat-cards";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { StatusDot } from "@/components/base/badges/status-dot";
import { post, useApi, type Job, type Overview, type Stats } from "../api";
import { ActivityChartCard, Breakdown, UsageChartCard } from "../charts";
import { ago, compact, duration } from "../format";
import { NewTaskModal } from "../new-task";
import { OfficeView } from "../office/office-view";
import { href } from "../router";
import { Shell, type NavCounts } from "../shell";
import { Banner, Card, Code, EmptyState, Skeleton, StatusChip, useAction } from "../ui";
import { CliTable } from "./settings";

export interface PageNav {
  counts: NavCounts;
  version?: string;
  overview?: Overview;
  reloadOverview: () => void;
}

/**
 * The change against the previous window. `points` compares rates in percentage points.
 * The colour says whether the change is good; the arrow says which way it went.
 */
function delta(now: number | null, before: number | null, signed: boolean, upIsGood = true, points = false): Pick<Stat, "delta" | "deltaColor" | "trend"> {
  if (now === null || before === null) return { delta: "–", deltaColor: "neutral", trend: "flat" };
  const change = points ? (now - before) * 100 : before === 0 ? (now === 0 ? 0 : 100) : ((now - before) / before) * 100;
  const rounded = Math.round(change);
  const unit = points ? " pts" : "%";
  if (rounded === 0) return { delta: `0${unit}`, deltaColor: "neutral", trend: "flat" };
  const sign = signed ? (rounded > 0 ? "+" : "−") : "";
  return { delta: `${sign}${Math.abs(rounded)}${unit}`, deltaColor: rounded > 0 === upIsGood ? "lime" : "rose", trend: rounded > 0 ? "up" : "down" };
}

/** `signed` is for the compact phone cards, which have no arrow. */
function statCards(stats: Stats, overview: Overview, signed: boolean): Stat[] {
  const p = stats.previous;
  const caption = `Vs. prior ${stats.days} days`;
  return [
    {
      icon: RiStackFill,
      label: "Jobs",
      value: stats.total.toLocaleString(),
      ...delta(stats.total, p.total, signed),
      tone: "blue",
      caption,
      hint: `Jobs created in the last ${stats.days} days, in every watched repo.`,
    },
    {
      icon: RiCheckDoubleFill,
      label: "Success rate",
      value: stats.success_rate === null ? "–" : `${Math.round(stats.success_rate * 100)}%`,
      ...delta(stats.success_rate, p.success_rate, signed, true, true),
      tone: "emerald",
      caption,
      hint: "Succeeded jobs out of all finished jobs. Cancelled jobs do not count.",
    },
    {
      icon: RiTimerFlashFill,
      label: "Average run",
      value: duration(stats.avg_duration_ms),
      ...delta(stats.avg_duration_ms, p.avg_duration_ms, signed, false),
      tone: "orange",
      caption,
      hint: "Time from start to finish for jobs that finished. A shorter time shows in green.",
    },
    {
      icon: RiPlayCircleFill,
      label: "Running now",
      value: `${overview.running} of ${overview.concurrency}`,
      delta: overview.running ? "busy" : "idle",
      deltaColor: overview.running ? "lime" : "neutral",
      trend: "flat",
      tone: "purple",
      caption: `Polling every ${overview.pollIntervalSec}s`,
      hint: "Jobs running at once, out of the limit set in Settings.",
    },
  ];
}

function RunningCard({ jobs }: { jobs: Job[] }) {
  return (
    <Card title="Running now" icon={RiRobot2Line} className="lg:flex-1">
      {jobs.length === 0 ? (
        <EmptyState icon={RiInboxLine} title="No agents are working">
          Add the <Code>agent:ready</Code> label to an issue, or start a new task.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-2">
          {jobs.map((j) => (
            <li key={j.id}>
              <a
                href={href.job(j.id)}
                className="flex flex-col gap-2 rounded-2lg border border-border-button-default bg-background-primary-default p-3 transition-colors hover:bg-background-primary-hover"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col">
                    <span className="truncate text-body-medium text-text-primary">{j.issue_title}</span>
                    <span className="truncate text-body-2-medium text-text-tertiary">
                      {j.repo}#{j.issue_number} · {j.route}
                    </span>
                  </div>
                  <StatusChip status={j.status} compact />
                </div>
                {j.status === "running" ? (
                  <div className="flex items-center justify-between gap-2">
                    <AgentThinking variant="wave" tone="accent" label={j.agent === "codex" ? "Codex is working" : "Claude is working"} showTimer={false} />
                    <span className="text-body-2-medium text-text-tertiary tabular-nums">{duration(j.duration_ms)}</span>
                  </div>
                ) : (
                  <span className="text-body-2-medium text-text-tertiary">Waiting for a free slot</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RecentJobs({ jobs }: { jobs: Job[] }) {
  return (
    <Card
      title="Recent jobs"
      icon={RiTerminalBoxLine}
      className="lg:flex-[1.4]"
      actions={
        <ButtonLink href={href.jobs} variant="secondary" size="small" trailingIcon={RiArrowRightSLine}>
          All jobs
        </ButtonLink>
      }
    >
      {jobs.length === 0 ? (
        <EmptyState icon={RiInboxLine} title="No jobs yet">
          Jobs show up here when an issue in a watched repo gets the <Code>agent:ready</Code> label.
        </EmptyState>
      ) : (
        <ul className="-mx-2 flex flex-col">
          {jobs.map((j) => (
            <li key={j.id}>
              <a href={href.job(j.id)} className="flex items-center gap-3 rounded-2lg px-2 py-2 transition-colors hover:bg-background-secondary-hover">
                <span className="w-10 shrink-0 text-body-2-medium text-text-tertiary tabular-nums">#{j.id}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-body-medium text-text-primary">{j.issue_title}</span>
                  <span className="truncate text-body-2-medium text-text-tertiary">
                    {j.repo}#{j.issue_number} · {j.route} · {ago(j.created_at)}
                  </span>
                </span>
                <StatusChip status={j.status} compact />
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DailyBranches({ overview, onDone }: { overview: Overview; onDone: () => void }) {
  const { busy, run } = useAction();
  return (
    <Card title="Daily branches" icon={RiGitBranchLine} className="lg:flex-1">
      <p className="text-body-regular text-text-secondary">
        Agent PRs go to today's <Code>{overview.dailyBranch}</Code>, which rolls over at midnight {overview.timeZone === "UTC" ? "UTC" : `in ${overview.timeZone.replace(/_/g, " ")}`} (change it in Settings). When you have merged the ones you want, open one PR from the newest daily branch to the default branch. It lists the merged PRs and closes their issues when it lands.
      </p>
      <ul className="flex flex-col gap-2">
        {overview.repos.map((r) => (
          <li key={r} className="flex flex-wrap items-center justify-between gap-2 rounded-2lg border border-border-button-default bg-background-primary-default px-3 py-2">
            <span className="truncate text-body-medium text-text-primary">{r}</span>
            <Button
              size="small"
              variant="secondary"
              disabled={busy === r}
              onClick={() =>
                run(r, () => post<{ number: number; html_url: string; merged: number }>(`daily/${encodeURIComponent(r)}/open-pr`), (pr) => (
                  <span>
                    Opened{" "}
                    <a className="underline" href={pr.html_url} target="_blank" rel="noreferrer">
                      PR #{pr.number}
                    </a>{" "}
                    with {pr.merged} merged PR{pr.merged === 1 ? "" : "s"}.
                  </span>
                )).then(onDone)
              }
            >
              {busy === r ? "Opening…" : "Open PR to default branch"}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PollStatus({ overview }: { overview: Overview }) {
  const poll = overview.lastPoll;
  return (
    <span className="flex items-center gap-1.5 text-body-2-medium text-text-tertiary">
      <StatusDot color={poll?.error ? "yellow" : poll ? "green" : "indigo"} />
      {poll ? `Polled ${ago(poll.at)}` : "Not polled yet"} · {overview.repos.length} repo{overview.repos.length === 1 ? "" : "s"}
    </span>
  );
}

export function OverviewPage({ nav }: { nav: PageNav }) {
  const overview = nav.overview;
  const stats = useApi<Stats>("stats?days=30", 30_000);
  const jobs = useApi<Job[]>("jobs?limit=60", 5_000);
  const { busy, run } = useAction();
  const [newTask, setNewTask] = useState(false);

  const all = jobs.data ?? [];
  const active = all.filter((j) => j.status === "running" || j.status === "queued");
  const recent = all.slice(0, 7);
  const reload = () => {
    nav.reloadOverview();
    void jobs.reload();
    void stats.reload();
  };

  return (
    <Shell
      route={{ page: "overview" }}
      counts={nav.counts}
      version={nav.version}
      title="Overview"
      actions={
        <>
          {overview && (
            <span className="max-sm:hidden">
              <PollStatus overview={overview} />
            </span>
          )}
          <Button
            variant="secondary"
            leadingIcon={RiRefreshLine}
            disabled={busy === "poll"}
            onClick={() => run("poll", () => post<{ lastPoll: { error: string | null } | null }>("poll"), (r) => (r.lastPoll?.error ? undefined : "Polled GitHub")).then(reload)}
          >
            {busy === "poll" ? "Polling…" : "Poll now"}
          </Button>
          <Button variant="primary" leadingIcon={RiAddLine} onClick={() => setNewTask(true)}>
            New task
          </Button>
        </>
      }
    >
      {overview?.setup.map((s) => (
        <Banner key={s} tone="error">
          {s}{" "}
          <a className="underline" href={href.settings()}>
            Open Settings
          </a>
        </Banner>
      ))}
      {overview?.lastPoll?.error && <Banner tone="error">The last poll failed: {overview.lastPoll.error}</Banner>}
      {overview && overview.questions.length > 0 && (
        <Banner>
          {overview.questions.length === 1 ? "An agent is" : `${overview.questions.length} agents are`} waiting for your answer.{" "}
          <a className="underline" href={href.questions}>
            Answer now
          </a>
        </Banner>
      )}

      <OfficeView jobs={jobs.data} questions={overview?.questions} failed={Boolean(jobs.error) && !jobs.data} />

      {stats.data && overview ? (
        <>
          <StatCards variant="footer" stats={statCards(stats.data, overview, false)} className="max-sm:hidden" />
          <StatCards variant="plain" stats={statCards(stats.data, overview, true)} className="sm:hidden" />
        </>
      ) : (
        <Skeleton className="h-[188px]" />
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        {stats.data ? (
          <>
            <ActivityChartCard data={stats.data.daily} />
            <UsageChartCard data={stats.data.daily} />
          </>
        ) : (
          <>
            <Skeleton className="h-[344px] flex-1" />
            <Skeleton className="h-[344px] flex-1" />
          </>
        )}
      </div>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <RunningCard jobs={active} />
        <RecentJobs jobs={recent} />
      </div>

      {stats.data && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <Breakdown title="By model route" rows={stats.data.by_route} />
          <Breakdown title="By repository" rows={stats.data.by_repo} />
        </div>
      )}

      {overview && (
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
          <Card
            title="Agent CLIs"
            icon={RiTerminalBoxLine}
            className="lg:flex-1"
            actions={
              <ButtonLink href={href.settings("agents")} variant="secondary" size="small" trailingIcon={RiArrowRightSLine}>
                Sign-in help
              </ButtonLink>
            }
          >
            <CliTable overview={overview} onChange={nav.reloadOverview} />
          </Card>
          {overview.dailyBranch && overview.repos.length > 0 && <DailyBranches overview={overview} onDone={reload} />}
        </div>
      )}

      {stats.data && (
        <p className="px-1 text-body-2-medium text-text-tertiary">
          {compact(stats.data.input_tokens + stats.data.output_tokens)} tokens in the last {stats.data.days} days.
        </p>
      )}

      {overview && (
        <NewTaskModal isOpen={newTask} onClose={() => setNewTask(false)} repos={overview.repos} routes={overview.routes} defaultRoute={overview.defaultRoute} onStarted={reload} />
      )}
    </Shell>
  );
}
