import { useEffect, useState } from "react";
import { RiAddLine, RiGitPullRequestLine } from "@remixicon/react";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { SegmentedControl, SegmentedControlItem } from "@/components/base/segmented-control/segmented-control";
import { SelectItem } from "@/components/base/select/select";
import { Textarea } from "@/components/base/textarea/textarea";
import { post, type IssueRef } from "./api";
import { Code, Modal, SelectField, useToast } from "./ui";

/**
 * Starts work without leaving the dashboard: either a new issue (Rainmaker files it
 * with `agent:ready`) or an issue that already exists.
 */
export function NewTaskModal({
  isOpen,
  onClose,
  repos,
  routes,
  defaultRoute,
  onStarted,
}: {
  isOpen: boolean;
  onClose: () => void;
  repos: string[];
  routes: string[];
  defaultRoute: string;
  onStarted?: () => void;
}) {
  const toast = useToast();
  const [mode, setMode] = useState<"new" | "existing">("new");
  const [repo, setRepo] = useState(repos[0] ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [issue, setIssue] = useState("");
  const [route, setRoute] = useState("");
  const [skills, setSkills] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!repos.includes(repo)) setRepo(repos[0] ?? "");
  }, [repos, repo]);

  const ready = Boolean(repo) && (mode === "new" ? title.trim().length > 0 : /^\d+$/.test(issue.trim()));

  const submit = async () => {
    setBusy(true);
    try {
      const shared = { repo, model: route || undefined, skills: skills.split(/[\s,]+/).filter(Boolean) };
      const { issue: made } =
        mode === "new"
          ? await post<{ issue: IssueRef }>("tasks", { ...shared, title: title.trim(), body })
          : await post<{ issue: IssueRef }>("issues/start", { ...shared, issue_number: Number(issue.trim()) });
      toast.success(
        <span>
          {mode === "new" ? "Filed" : "Queued"}{" "}
          <a className="underline" href={made.html_url} target="_blank" rel="noreferrer">
            {repo}#{made.number}
          </a>
          . It starts in a moment.
        </span>,
      );
      setTitle("");
      setBody("");
      setIssue("");
      onStarted?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="New task"
      wide
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" leadingIcon={mode === "new" ? RiAddLine : RiGitPullRequestLine} disabled={!ready || busy} onClick={submit}>
            {busy ? "Starting…" : mode === "new" ? "File and start" : "Start this issue"}
          </Button>
        </>
      }
    >
      <SegmentedControl
        aria-label="What to start"
        className="self-start"
        selectedKeys={new Set([mode])}
        onSelectionChange={(keys) => {
          const next = [...keys][0];
          if (next) setMode(next as "new" | "existing");
        }}
      >
        <SegmentedControlItem id="new">New issue</SegmentedControlItem>
        <SegmentedControlItem id="existing">Existing issue</SegmentedControlItem>
      </SegmentedControl>

      {repos.length === 0 ? (
        <p className="text-body-regular text-text-secondary">Add a repository in Settings first.</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <SelectField label="Repository" selectedKey={repo} onChange={setRepo}>
              {repos.map((r) => (
                <SelectItem key={r} id={r} textValue={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectField>
            <SelectField
              label="Model"
              selectedKey={route || "__default"}
              onChange={(k) => setRoute(k === "__default" ? "" : k)}
              hint={
                <>
                  Adds a <Code>model:</Code> label. The default is {defaultRoute}.
                </>
              }
            >
              {[
                <SelectItem key="__default" id="__default" textValue={`Default (${defaultRoute})`}>
                  Default ({defaultRoute})
                </SelectItem>,
                ...routes.map((r) => (
                  <SelectItem key={r} id={r} textValue={r}>
                    {r}
                  </SelectItem>
                )),
              ]}
            </SelectField>
          </div>

          {mode === "new" ? (
            <>
              <Input label="Title" placeholder="What should the agent do?" value={title} onChange={setTitle} isRequired autoFocus />
              <Textarea label="Details" placeholder="What should change, and how will you know it worked?" rows={5} value={body} onChange={setBody} hint="Markdown works. The agent reads this as the issue body." />
            </>
          ) : (
            <Input label="Issue number" placeholder="42" inputMode="numeric" value={issue} onChange={setIssue} isRequired autoFocus hint="Rainmaker adds the agent:ready label for you." />
          )}

          <Input label="Skills (optional)" placeholder="frontend, tests" value={skills} onChange={setSkills} hint="Adds a skill: label for each name, separated by commas or spaces." />
        </>
      )}
    </Modal>
  );
}
