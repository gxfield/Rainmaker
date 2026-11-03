import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  RiChatSmile2Line,
  RiDiscussLine,
  RiCloseCircleLine,
  RiCoinsLine,
  RiErrorWarningLine,
  RiExternalLinkLine,
  RiFileTextLine,
  RiGitPullRequestLine,
  RiInformationLine,
  RiQuestionAnswerLine,
  RiRepeatLine,
  RiTerminalBoxLine,
  RiTimerLine,
  RiTokenSwapLine,
  RiLoopLeftLine,
} from "@remixicon/react";
import { AgentThinking } from "@/components/application/agent-thinking/agent-thinking";
import { Chip } from "@/components/base/badges/chip";
import { Button, ButtonLink } from "@/components/base/buttons/button";
import { SelectItem } from "@/components/base/select/select";
import { Switch } from "@/components/base/switch/switch";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { post, useApi, type Job, type JobDetail, type Question } from "../api";
import { ago, compact, dateTime, duration, githubIssue, money } from "../format";
import { href } from "../router";
import { Shell } from "../shell";
import { Banner, Card, Code, ConfirmButton, CopyButton, EmptyState, Facts, Modal, SelectField, Skeleton, StatusChip, useAction } from "../ui";
import type { PageNav } from "./overview";
import { AnswerForm } from "./questions";

function Tile({ icon: Icon, label, value }: { icon: typeof RiTimerLine; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-2lg bg-background-inner-default p-3 shadow-card">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-2lg bg-stat-card-icon-background">
        <Icon className="size-5 text-foreground-icon-primary" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-body-2-medium text-text-tertiary">{label}</span>
        <span className="truncate text-headline-medium text-text-primary tabular-nums">{value}</span>
      </span>
    </div>
  );
}

/** The agent's output: a terminal surface that follows new lines while the job runs. */
function LogView({ job }: { job: JobDetail }) {
  const ref = useRef<HTMLPreElement>(null);
  const [follow, setFollow] = useState(true);
  const [wrap, setWrap] = useState(true);
  const live = job.status === "running";
  const text = job.log.text || (job.status === "queued" ? "Waiting for a free slot…" : "No output yet.");

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && follow) el.scrollTop = el.scrollHeight;
  }, [text, follow]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          {live ? <AgentThinking variant="spin" tone="accent" label="Streaming" showTimer={false} /> : <span className="text-body-medium text-text-secondary">{job.log.truncated ? "Showing the last 400 KB" : "Full log"}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <Switch size="sm" isSelected={follow} onChange={setFollow}>
            Follow
          </Switch>
          <Switch size="sm" isSelected={wrap} onChange={setWrap}>
            Wrap lines
          </Switch>
          <CopyButton text={job.log.text} label="Copy log" size="xs" />
        </div>
      </div>
      <pre
        ref={ref}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (!atBottom && follow && live) setFollow(false);
        }}
        className={`rm-terminal max-h-[60dvh] min-h-[240px] overflow-auto rounded-2xl p-4 text-[12.5px] leading-relaxed ${wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}`}
      >
        {text}
      </pre>
    </div>
  );
}

function QuestionsList({ questions, onAnswered }: { questions: Question[]; onAnswered: () => void }) {
  if (!questions.length) {
    return (
      <EmptyState icon={RiQuestionAnswerLine} title="No questions">
        The agent did not ask anything during this job.
      </EmptyState>
    );
  }
  return (
    <ul className="flex flex-col gap-3">
      {questions.map((q) => (
        <li key={q.id} className="flex flex-col gap-2 rounded-2xl border border-border-button-default bg-background-primary-default p-4">
          <div className="flex items-start gap-2.5">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-500 text-white">
              <RiChatSmile2Line className="size-4" aria-hidden />
            </span>
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-body-2-medium text-text-tertiary">
                Question #{q.id} · {ago(q.asked_at)}
              </span>
              <p className="whitespace-pre-wrap text-body-medium text-text-primary">{q.question}</p>
            </div>
          </div>
          {q.status === "pending" ? (
            <AnswerForm id={q.id} onAnswered={onAnswered} />
          ) : (
            <div className="ms-9 rounded-2lg bg-background-secondary-default px-3 py-2">
              <span className="text-body-2-medium text-text-tertiary">{q.status === "answered" ? `Answered by ${q.answered_by ?? "someone"} ${ago(q.answered_at)}` : "No answer in time"}</span>
              {q.answer && <p className="whitespace-pre-wrap text-body-medium text-text-primary">{q.answer}</p>}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * Labels the job's PR with agent:ready and model:<route>, so a follow-up job works on the
 * PR's branch and reads the comments and reviews on it.
 */
function RetryWithComments({ job, routes, onDone }: { job: Job; routes: string[]; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [route, setRoute] = useState(job.route);
  const { busy, run } = useAction();
  const options = routes.includes(job.route) ? routes : [job.route, ...routes];
  const start = () =>
    run("follow-up", () => post<{ pr: number; url: string }>(`jobs/${job.id}/retry-comments`, { model: route }), (r) => `Labeled PR #${r.pr} for a follow-up job. It shows up in Jobs in a few seconds.`).then((r) => {
      if (!r) return;
      setOpen(false);
      onDone();
    });
  return (
    <>
      <Button variant="secondary" leadingIcon={RiDiscussLine} onClick={() => setOpen(true)}>
        Retry and read comments
      </Button>
      <Modal
        isOpen={open}
        onClose={() => busy === null && setOpen(false)}
        title="Retry and read comments"
        footer={
          <>
            <Button type="button" variant="secondary" disabled={busy !== null} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="button" variant="primary" leadingIcon={RiDiscussLine} disabled={busy !== null} onClick={() => void start()}>
              {busy ? "Labeling…" : "Start follow-up"}
            </Button>
          </>
        }
      >
        <p className="text-body-regular text-text-secondary">
          A new job starts from PR #{job.pr_number}'s branch. It reads the comments, reviews and inline comments on the PR, pushes more commits to it, and posts its summary as a PR comment.
        </p>
        <SelectField label="Model" selectedKey={route} onChange={setRoute} hint={<>Rainmaker adds <Code>agent:ready</Code> and <Code>model:{route}</Code> to the PR.</>}>
          {options.map((r) => (
            <SelectItem key={r} id={r} textValue={r}>
              {r}
            </SelectItem>
          ))}
        </SelectField>
        <p className="text-body-2-medium text-text-tertiary">Plain Retry starts over from the issue instead.</p>
      </Modal>
    </>
  );
}

function details(job: Job): [string, React.ReactNode][] {
  const rows: [string, React.ReactNode][] = [
    [
      "Issue",
      <a key="i" className="underline-offset-2 hover:underline" href={githubIssue(job.repo, job.issue_number)} target="_blank" rel="noreferrer">
        {job.repo}#{job.issue_number}
      </a>,
    ],
    ["Route", <Code key="r">{job.route}</Code>],
    ["Agent", `${job.agent === "codex" ? "Codex" : "Claude Code"}${job.model ? ` (${job.model})` : ""}${job.provider !== "default" ? ` via ${job.provider}` : ""}`],
    [
      "Skills",
      job.skills.length ? (
        <span key="s" className="flex flex-wrap gap-1.5">
          {job.skills.map((s) => (
            <Chip key={s} variant="subtle" color="gray">
              {s}
            </Chip>
          ))}
        </span>
      ) : (
        "–"
      ),
    ],
    ["Branch", job.branch ? <Code key="b">{job.branch}</Code> : "–"],
    [
      "Pull request",
      job.pr_url ? (
        <a key="p" className="underline-offset-2 hover:underline" href={job.pr_url} target="_blank" rel="noreferrer">
          #{job.pr_number}
        </a>
      ) : (
        "–"
      ),
    ],
    ["Created", dateTime(job.created_at)],
    ["Started", dateTime(job.started_at)],
    ["Finished", dateTime(job.finished_at)],
    ["Turns", job.num_turns ?? "–"],
    ["Tokens in / out", `${(job.input_tokens ?? 0).toLocaleString()} / ${(job.output_tokens ?? 0).toLocaleString()}${job.cached_tokens ? ` (${job.cached_tokens.toLocaleString()} cached)` : ""}`],
    ["CLI version", job.cli_version ?? "–"],
  ];
  return rows;
}

export function JobPage({ nav, id }: { nav: PageNav; id: number }) {
  const [every, setEvery] = useState<number | undefined>(3_000);
  const q = useApi<JobDetail>(`jobs/${id}`, every);
  const job = q.data;
  const { busy, run } = useAction();
  const active = job?.status === "running" || job?.status === "queued";
  const [tab, setTab] = useState<string | null>(null);

  useEffect(() => {
    if (job) setEvery(active ? 3_000 : undefined);
  }, [job, active]);

  const pending = job?.questions.filter((x) => x.status === "pending") ?? [];
  const selected = tab ?? (job && !active && job.summary ? "summary" : "log");
  const title = job ? job.issue_title : q.error ? "Job not found" : `Job #${id}`;

  return (
    <Shell
      route={{ page: "job", id }}
      counts={nav.counts}
      version={nav.version}
      title={title}
      crumbs={[{ label: "Jobs", to: href.jobs }]}
      actions={
        job && (
          <>
            <ButtonLink href={githubIssue(job.repo, job.issue_number)} target="_blank" rel="noreferrer" variant="secondary" leadingIcon={RiExternalLinkLine}>
              Issue
            </ButtonLink>
            {job.pr_url && (
              <ButtonLink href={job.pr_url} target="_blank" rel="noreferrer" variant="secondary" leadingIcon={RiGitPullRequestLine}>
                PR #{job.pr_number}
              </ButtonLink>
            )}
            {active ? (
              <ConfirmButton
                label="Cancel job"
                icon={RiCloseCircleLine}
                title="Cancel this job?"
                message="The agent stops now. Its branch keeps any commits it already pushed."
                confirmLabel="Cancel job"
                danger
                onConfirm={() => run("cancel", () => post(`jobs/${job.id}/cancel`), () => "Job cancelled").then(q.reload)}
              />
            ) : (
              <>
                {job.pr_number && <RetryWithComments job={job} routes={nav.overview?.routes ?? []} onDone={() => nav.reloadOverview()} />}
                <Button variant="primary" leadingIcon={RiRepeatLine} disabled={busy === "retry"} onClick={() => run("retry", () => post<Job>(`jobs/${job.id}/retry`), (j) => `Queued again as job #${j.id}`).then(() => void q.reload())}>
                  {busy === "retry" ? "Queuing…" : "Retry"}
                </Button>
              </>
            )}
          </>
        )
      }
    >
      {q.error && !job && (
        <EmptyState icon={RiErrorWarningLine} title="This job could not be loaded">
          {q.error}. <a className="underline" href={href.jobs}>Back to jobs</a>
        </EmptyState>
      )}
      {!job && !q.error && <Skeleton className="h-[220px]" />}

      {job && (
        <>
          <section className="flex flex-col gap-4 rounded-2xl bg-background-secondary-default p-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusChip status={job.status} />
              <Chip variant="subtle" color="gray">
                Job #{job.id}
              </Chip>
              <Chip variant="subtle" color="gray">
                {job.repo}#{job.issue_number}
              </Chip>
              <Chip variant="subtle" color="purple">
                {job.route}
              </Chip>
              {job.skills.map((s) => (
                <Chip key={s} variant="subtle" color="cyan">
                  skill:{s}
                </Chip>
              ))}
              <span className="ms-auto text-body-2-medium text-text-tertiary">Created {ago(job.created_at)}</span>
            </div>
            {job.status === "running" && <AgentThinking variant="stars" tone="primary" label={`${job.agent === "codex" ? "Codex" : "Claude"} is working on it`} showTimer={false} />}
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Tile icon={RiTimerLine} label="Time" value={duration(job.duration_ms)} />
              <Tile icon={RiLoopLeftLine} label="Turns" value={job.num_turns?.toString() ?? "–"} />
              <Tile icon={RiTokenSwapLine} label="Tokens" value={job.input_tokens || job.output_tokens ? compact((job.input_tokens ?? 0) + (job.output_tokens ?? 0)) : "–"} />
              <Tile icon={RiCoinsLine} label="API-equivalent cost" value={job.cost_usd != null ? money(job.cost_usd) : "–"} />
            </div>
          </section>

          {job.error && <Banner tone="error">{job.error}</Banner>}

          {pending.map((p) => (
            <Card key={p.id} title="The agent is waiting for your answer" icon={RiQuestionAnswerLine}>
              <p className="whitespace-pre-wrap text-body-medium text-text-primary">{p.question}</p>
              <AnswerForm id={p.id} onAnswered={q.reload} />
            </Card>
          ))}

          <section className="rounded-2xl bg-background-secondary-default p-4">
            <Tabs selectedKey={selected} onSelectionChange={(k) => setTab(String(k))}>
              <div className="-mx-4 overflow-x-auto px-4">
                <TabList aria-label="Job sections">
                  <Tab id="log" icon={RiTerminalBoxLine}>
                    Log
                  </Tab>
                  <Tab id="summary" icon={RiFileTextLine}>
                    Summary
                  </Tab>
                  <Tab id="details" icon={RiInformationLine}>
                    Details
                  </Tab>
                  <Tab id="questions" icon={RiQuestionAnswerLine} count={job.questions.length || undefined}>
                    Questions
                  </Tab>
                </TabList>
              </div>
              <TabPanel id="log">
                <LogView job={job} />
              </TabPanel>
              <TabPanel id="summary">
                {job.summary ? (
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-end">
                      <CopyButton text={job.summary} label="Copy summary" size="xs" />
                    </div>
                    <div className="whitespace-pre-wrap rounded-2xl border border-border-button-default bg-background-primary-default p-4 text-body-regular text-text-primary">{job.summary}</div>
                  </div>
                ) : (
                  <EmptyState icon={RiFileTextLine} title="No summary yet">
                    The agent writes a summary when it finishes. It is also posted on the issue.
                  </EmptyState>
                )}
              </TabPanel>
              <TabPanel id="details">
                <Facts items={details(job)} />
              </TabPanel>
              <TabPanel id="questions">
                <QuestionsList questions={job.questions} onAnswered={q.reload} />
              </TabPanel>
            </Tabs>
          </section>
        </>
      )}
    </Shell>
  );
}
