import { useEffect, useState } from "react";
import { RiChatCheckLine, RiSendPlane2Fill, RiTimeLine } from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Textarea } from "@/components/base/textarea/textarea";
import { post, useApi, type PendingQuestion } from "../api";
import { ago } from "../format";
import { href } from "../router";
import { Shell } from "../shell";
import { EmptyState, Skeleton, useAction } from "../ui";
import type { PageNav } from "./overview";

function minutesLeft(expires: number): string {
  const m = Math.max(0, Math.round((expires - Date.now()) / 60_000));
  return m === 0 ? "less than a minute left" : `${m} min left`;
}

/** The reply box under a question. Ctrl or Cmd + Enter sends it. */
export function AnswerForm({ id, onAnswered }: { id: number; onAnswered: () => void }) {
  const [answer, setAnswer] = useState("");
  const { busy, run } = useAction();
  const send = () =>
    answer.trim() &&
    run("answer", () => post(`questions/${id}/answer`, { answer }), () => "Answer sent. The agent carries on.").then((ok) => {
      if (ok) {
        setAnswer("");
        onAnswered();
      }
    });
  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void send();
        }
      }}
    >
      <Textarea aria-label="Your answer" placeholder="Your answer" rows={3} autoResize maxRows={10} value={answer} onChange={setAnswer} />
      <div className="flex items-center justify-end gap-3">
        <span className="hidden text-body-2-medium text-text-tertiary sm:inline">Ctrl + Enter to send</span>
        <Button size="small" variant="primary" leadingIcon={RiSendPlane2Fill} disabled={!answer.trim() || busy === "answer"} onClick={() => void send()}>
          {busy === "answer" ? "Sending…" : "Send answer"}
        </Button>
      </div>
    </div>
  );
}

export function QuestionsPage({ nav }: { nav: PageNav }) {
  const q = useApi<PendingQuestion[]>("questions", 5_000);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(t);
  }, []);
  const list = q.data ?? [];

  return (
    <Shell route={{ page: "questions" }} counts={nav.counts} version={nav.version} title="Questions">
      <p className="px-1 text-body-regular text-text-secondary">
        Agents ask here when they need a decision. Hermes can answer too. If nobody answers in time, the agent uses its best judgement and says so in its summary.
      </p>
      {q.loading && !q.data ? (
        <Skeleton className="h-40" />
      ) : list.length === 0 ? (
        <EmptyState icon={RiChatCheckLine} title="Nothing is waiting for you">
          New questions show up here and on the overview.
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-4">
          {list.map((item) => (
            <li key={item.id} className="flex flex-col gap-3 rounded-2xl bg-background-secondary-default p-4">
              <div className="flex flex-wrap items-center gap-2">
                {item.job ? (
                  <a href={href.job(item.job.id)} className="min-w-0 truncate text-headline-medium text-text-primary hover:underline">
                    {item.job.issue_title}
                  </a>
                ) : (
                  <span className="text-headline-medium text-text-primary">Job #{item.job_id}</span>
                )}
                {item.job && (
                  <Chip variant="subtle" color="gray">
                    {item.job.repo}#{item.job.issue_number}
                  </Chip>
                )}
                <span className="ms-auto flex items-center gap-1 text-body-2-medium text-text-tertiary">
                  <RiTimeLine className="size-4" aria-hidden />
                  Asked {ago(item.asked_at)} · {minutesLeft(item.expires_at)}
                </span>
              </div>
              <p className="whitespace-pre-wrap rounded-2lg bg-background-inner-default p-3 text-body-medium text-text-primary shadow-card">{item.question}</p>
              <AnswerForm
                id={item.id}
                onAnswered={() => {
                  void q.reload();
                  nav.reloadOverview();
                }}
              />
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}
