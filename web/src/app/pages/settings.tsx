import { useEffect, useMemo, useState } from "react";
import {
  RiArrowGoBackLine,
  RiCodeSSlashLine,
  RiDeleteBin6Line,
  RiDownloadCloud2Line,
  RiGithubLine,
  RiKey2Line,
  RiPaletteLine,
  RiPlugLine,
  RiRefreshLine,
  RiRobot2Line,
  RiSave3Line,
  RiSettings4Line,
  RiShieldKeyholeLine,
  RiGitBranchLine,
} from "@remixicon/react";
import { Chip } from "@/components/base/badges/chip";
import { Button } from "@/components/base/buttons/button";
import { Input } from "@/components/base/input/input";
import { SelectItem } from "@/components/base/select/select";
import { SwitchCard } from "@/components/base/switch/switch-card";
import { Tab, TabList, TabPanel, Tabs } from "@/components/base/tabs/tabs";
import { Textarea } from "@/components/base/textarea/textarea";
import { api, post, useApi, type CliStatus, type Overview, type Route, type Settings, type SettingsView } from "../api";
import { dateTime } from "../format";
import { href, navigate } from "../router";
import { Shell } from "../shell";
import { ThemeGallery } from "../theme";
import { Banner, Card, Code, ConfirmButton, CopyButton, EmptyState, SelectField, Skeleton, useAction } from "../ui";
import type { PageNav } from "./overview";

const TABS = [
  { id: "general", label: "General", icon: RiSettings4Line },
  { id: "routes", label: "Model routes", icon: RiCodeSSlashLine },
  { id: "secrets", label: "Secrets", icon: RiKey2Line },
  { id: "hermes", label: "Hermes and MCP", icon: RiPlugLine },
  { id: "agents", label: "Agent CLIs", icon: RiRobot2Line },
  { id: "appearance", label: "Appearance", icon: RiPaletteLine },
] as const;

const lines = (v: string) => v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

/* ----------------------------------------------------------------- general */

interface GeneralForm {
  githubToken: string;
  repos: string;
  allowedUsers: string;
  pollIntervalSec: string;
  concurrency: string;
  jobTimeoutMin: string;
  questionTimeoutMin: string;
  retentionDays: string;
  autoUpdateHour: string;
  timeZone: string;
  defaultRoute: string;
  dailyBranch: boolean;
}

function toForm(s: Settings): GeneralForm {
  return {
    githubToken: "",
    repos: s.repos.join("\n"),
    allowedUsers: s.allowedUsers.join("\n"),
    pollIntervalSec: String(s.pollIntervalSec),
    concurrency: String(s.concurrency),
    jobTimeoutMin: String(s.jobTimeoutMin),
    questionTimeoutMin: String(s.questionTimeoutMin),
    retentionDays: String(s.retentionDays),
    autoUpdateHour: s.autoUpdateHour === null ? "" : String(s.autoUpdateHour),
    timeZone: s.timeZone,
    defaultRoute: s.defaultRoute,
    dailyBranch: s.dailyBranch,
  };
}

function SaveBar({ dirty, busy, onSave, onReset }: { dirty: boolean; busy: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 flex items-center justify-end gap-2 rounded-2xl border border-border-button-default bg-background-primary-default/90 px-3 py-2.5 shadow-lg backdrop-blur">
      <span className="me-auto text-body-2-medium text-text-tertiary">{dirty ? "You have unsaved changes" : "All changes saved"}</span>
      <Button variant="secondary" size="small" disabled={!dirty || busy} onClick={onReset}>
        Discard
      </Button>
      <Button variant="primary" size="small" leadingIcon={RiSave3Line} disabled={!dirty || busy} onClick={onSave}>
        {busy ? "Saving…" : "Save settings"}
      </Button>
    </div>
  );
}

function GeneralTab({ view, onSaved }: { view: SettingsView; onSaved: (v: SettingsView) => void }) {
  const initial = useMemo(() => toForm(view.settings), [view.settings]);
  const [form, setForm] = useState(initial);
  const { busy, run } = useAction();
  useEffect(() => setForm(initial), [initial]);
  const set = <K extends keyof GeneralForm>(key: K) => (value: GeneralForm[K]) => setForm((f) => ({ ...f, [key]: value }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);

  const save = () =>
    run(
      "save",
      () =>
        api<SettingsView>("settings", {
          method: "PUT",
          body: {
            ...form,
            githubToken: form.githubToken || undefined,
            repos: lines(form.repos),
            allowedUsers: lines(form.allowedUsers),
            autoUpdateHour: form.autoUpdateHour === "" ? null : form.autoUpdateHour,
          },
        }),
      () => "Settings saved",
    ).then((v) => v && onSaved(v));

  const routes = Object.keys(view.settings.routes);

  return (
    <div className="flex flex-col gap-4">
      <Card title="GitHub" icon={RiGithubLine}>
        <Input
          label="Token"
          type="password"
          autoComplete="off"
          placeholder={view.githubTokenSet ? "A token is saved. Leave blank to keep it." : "github_pat_…"}
          value={form.githubToken}
          onChange={set("githubToken")}
          hint="A fine-grained token with Contents, Issues and Pull requests read and write on your repos."
        />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Textarea label="Repositories to watch" placeholder="owner/name" rows={4} value={form.repos} onChange={set("repos")} hint="One per line, as owner/name." />
          <Textarea
            label="Who may start runs"
            placeholder="github-login"
            rows={4}
            value={form.allowedUsers}
            onChange={set("allowedUsers")}
            hint="GitHub logins that may add agent:ready, one per line. Empty means only the token's owner."
          />
        </div>
      </Card>

      <Card title="Runs" icon={RiRobot2Line}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Input label="Poll every (seconds)" type="number" inputMode="numeric" value={form.pollIntervalSec} onChange={set("pollIntervalSec")} />
          <Input label="Jobs at once" type="number" inputMode="numeric" value={form.concurrency} onChange={set("concurrency")} hint="1 to 4" />
          <Input label="Job timeout (minutes)" type="number" inputMode="numeric" value={form.jobTimeoutMin} onChange={set("jobTimeoutMin")} />
          <Input label="Wait for answers (minutes)" type="number" inputMode="numeric" value={form.questionTimeoutMin} onChange={set("questionTimeoutMin")} />
          <Input label="Keep history (days)" type="number" inputMode="numeric" value={form.retentionDays} onChange={set("retentionDays")} />
          <Input label="Auto-update CLIs at hour" type="number" inputMode="numeric" placeholder="Off" value={form.autoUpdateHour} onChange={set("autoUpdateHour")} hint="0 to 23. Leave blank to turn it off." />
          <Input label="Time zone" placeholder="America/Los_Angeles" value={form.timeZone} onChange={set("timeZone")} hint="For the update hour and daily branch dates." />
          <SelectField label="Default route" selectedKey={form.defaultRoute} onChange={set("defaultRoute")} hint={<>Used when an issue has no <Code>model:</Code> label.</>}>
            {routes.map((r) => (
              <SelectItem key={r} id={r} textValue={r}>
                {r}
              </SelectItem>
            ))}
          </SelectField>
        </div>
        <SwitchCard
          icon={RiGitBranchLine}
          title="Stage agent PRs on a daily branch"
          description={
            <>
              PRs target <Code>rainmaker/daily-YYYY-MM-DD</Code>, made from the default branch. Merge them there, then open one PR to the default branch from the overview or Hermes. To skip CI on the daily PRs, limit the repo's pull_request trigger to the default branch.
            </>
          }
          isSelected={form.dailyBranch}
          onChange={set("dailyBranch")}
        />
      </Card>

      <SaveBar dirty={dirty} busy={busy === "save"} onSave={() => void save()} onReset={() => setForm(initial)} />
    </div>
  );
}

/* ------------------------------------------------------------------ routes */

function parseRoutes(text: string): { routes?: Record<string, Route>; error?: string } {
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Routes must be a JSON object." };
    for (const [name, r] of Object.entries(value as Record<string, Route>)) {
      if (!r || (r.agent !== "claude" && r.agent !== "codex")) return { error: `Route "${name}" needs "agent": "claude" or "codex".` };
    }
    return { routes: value as Record<string, Route> };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

function RoutesTab({ view, onSaved }: { view: SettingsView; onSaved: (v: SettingsView) => void }) {
  const initial = useMemo(() => JSON.stringify(view.settings.routes, null, 2), [view.settings.routes]);
  const [text, setText] = useState(initial);
  const { busy, run } = useAction();
  useEffect(() => setText(initial), [initial]);
  const parsed = parseRoutes(text);
  const dirty = text !== initial;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <Card title="Routes" icon={RiCodeSSlashLine} className="lg:flex-[1.2]">
          <p className="text-body-regular text-text-secondary">
            Each <Code>model:&lt;name&gt;</Code> label runs its route. <Code>agent</Code> is claude or codex. <Code>model</Code> is passed to the CLI. <Code>provider</Code> "openrouter" uses the OPENROUTER_API_KEY secret.
          </p>
          <Textarea aria-label="Routes JSON" rows={16} value={text} onChange={setText} fieldClassName="font-mono" inputClassName="font-mono text-[13px]" spellCheck="false" />
          {parsed.error && <Banner tone="error">{parsed.error}</Banner>}
        </Card>
        <Card title="Preview" className="lg:flex-1">
          {parsed.routes ? (
            <ul className="flex flex-col gap-2">
              {Object.entries(parsed.routes).map(([name, r]) => (
                <li key={name} className="flex flex-wrap items-center gap-2 rounded-2lg border border-border-button-default bg-background-primary-default px-3 py-2">
                  <Code>model:{name}</Code>
                  {name === view.settings.defaultRoute && (
                    <Chip variant="caption" color="blue">
                      default
                    </Chip>
                  )}
                  <span className="ms-auto flex flex-wrap items-center gap-1.5">
                    <Chip variant="subtle" color={r.agent === "codex" ? "lime" : "orange"}>
                      {r.agent === "codex" ? "Codex" : "Claude Code"}
                    </Chip>
                    {r.model && (
                      <Chip variant="subtle" color="gray">
                        {r.model}
                      </Chip>
                    )}
                    {r.provider && (
                      <Chip variant="subtle" color="purple">
                        {r.provider}
                      </Chip>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-regular text-text-tertiary">Fix the JSON to see the routes.</p>
          )}
        </Card>
      </div>
      <SaveBar
        dirty={dirty}
        busy={busy === "save"}
        onReset={() => setText(initial)}
        onSave={() =>
          parsed.routes &&
          void run("save", () => api<SettingsView>("settings", { method: "PUT", body: { routes: parsed.routes } }), () => "Routes saved").then((v) => v && onSaved(v))
        }
      />
    </div>
  );
}

/* ----------------------------------------------------------------- secrets */

function SecretsTab({ view, onSaved }: { view: SettingsView; onSaved: (v: SettingsView) => void }) {
  const [name, setName] = useState("");
  const [value, setValue] = useState("");
  const { busy, run } = useAction();

  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <Card title="Saved secrets" icon={RiShieldKeyholeLine} className="lg:flex-[1.3]">
        <p className="text-body-regular text-text-secondary">Encrypted with this Umbrel's app key and never shown again. Every agent run gets them as environment variables, masked in logs and GitHub comments.</p>
        {view.secrets.length === 0 ? (
          <EmptyState icon={RiKey2Line} title="No secrets yet">
            Add <Code>CLAUDE_CODE_OAUTH_TOKEN</Code> to sign Claude Code in, or <Code>OPENROUTER_API_KEY</Code> for OpenRouter routes.
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-2">
            {view.secrets.map((s) => (
              <li key={s.name} className="flex items-center gap-3 rounded-2lg border border-border-button-default bg-background-primary-default px-3 py-2">
                <RiKey2Line className="size-5 shrink-0 text-foreground-icon-secondary" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-mono text-body-medium text-text-primary">{s.name}</span>
                  <span className="text-body-2-medium text-text-tertiary">Updated {dateTime(s.updated_at)}</span>
                </span>
                <ConfirmButton
                  label="Delete"
                  size="small"
                  variant="secondary"
                  icon={RiDeleteBin6Line}
                  title={`Delete ${s.name}?`}
                  message="Agent runs stop getting this value. You cannot get it back from Rainmaker."
                  confirmLabel="Delete secret"
                  danger
                  onConfirm={() => run(s.name, () => api<SettingsView>(`secrets/${encodeURIComponent(s.name)}`, { method: "DELETE" }), () => `Deleted ${s.name}`).then((v) => v && onSaved(v))}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Add or replace a secret" icon={RiKey2Line} className="lg:flex-1">
        <Input label="Name" placeholder="OPENROUTER_API_KEY" autoComplete="off" value={name} onChange={(v) => setName(v.toUpperCase().replace(/[^A-Z0-9_]/g, "_"))} hint="Capital letters, digits and underscores." />
        <Input label="Value" type="password" autoComplete="off" value={value} onChange={setValue} />
        <div className="flex justify-end">
          <Button
            variant="primary"
            leadingIcon={RiSave3Line}
            disabled={!name || !value || busy === "add"}
            onClick={() =>
              void run("add", () => post<SettingsView>("secrets", { name, value }), () => `Saved ${name}`).then((v) => {
                if (!v) return;
                setName("");
                setValue("");
                onSaved(v);
              })
            }
          >
            {busy === "add" ? "Saving…" : "Save secret"}
          </Button>
        </div>
        {name && view.secrets.some((s) => s.name === name) && <p className="text-body-2-medium text-text-tertiary">This replaces the saved value of {name}.</p>}
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ hermes */

function HermesTab({ view, onSaved }: { view: SettingsView; onSaved: (v: SettingsView) => void }) {
  const { run } = useAction();
  const yaml = `mcp_servers:\n  rainmaker:\n    url: ${view.mcp.url}\n    headers:\n      Authorization: Bearer ${view.mcp.token}`;
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <Card title="MCP server" icon={RiPlugLine} className="lg:flex-1">
        <p className="text-body-regular text-text-secondary">Apps on this Umbrel, such as Hermes, can reach Rainmaker directly. They use this bearer token.</p>
        <div className="flex items-end gap-2">
          <Input label="URL from another Umbrel app" value={view.mcp.url} isReadOnly className="flex-1" inputClassName="font-mono" />
          <CopyButton text={view.mcp.url} size="medium" />
        </div>
        <div className="flex items-end gap-2">
          <Input label="Bearer token" value={view.mcp.token} isReadOnly className="flex-1" inputClassName="font-mono" />
          <CopyButton text={view.mcp.token} size="medium" />
        </div>
        <div className="flex justify-start">
          <ConfirmButton
            label="Regenerate token"
            icon={RiRefreshLine}
            title="Regenerate the MCP token?"
            message="Hermes and other MCP clients stop working until you give them the new token."
            confirmLabel="Regenerate"
            danger
            onConfirm={() => run("rotate", () => post<SettingsView>("mcp-token/rotate"), () => "New token ready. Update Hermes with it.").then((v) => v && onSaved(v))}
          />
        </div>
      </Card>
      <Card title="Hermes config.yaml" icon={RiCodeSSlashLine} className="lg:flex-1" actions={<CopyButton text={yaml} size="xs" />}>
        <pre className="rm-terminal overflow-x-auto rounded-2xl p-4 text-[12.5px] leading-relaxed">{yaml}</pre>
        <p className="text-body-2-medium text-text-tertiary">Hermes can then list jobs, start tasks, answer questions, retry jobs and open daily PRs.</p>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ agents */

export function CliTable({ overview, onChange }: { overview: Pick<Overview, "clis" | "cliBusy" | "autoUpdateHour" | "running">; onChange: () => void }) {
  const { busy, run } = useAction();
  const blocked = overview.cliBusy || overview.running > 0;
  const act = (c: CliStatus, what: "update" | "rollback") =>
    run(`${c.name}:${what}`, () => post<{ version: string | null }>(`clis/${c.name}/${what}`), (r) => `${c.name === "claude" ? "Claude Code" : "Codex"} is now ${r.version ?? "not installed"}`).then(onChange);
  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-2">
        {overview.clis.map((c) => (
          <li key={c.name} className="flex flex-wrap items-center gap-3 rounded-2lg border border-border-button-default bg-background-primary-default px-3 py-2.5">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body-medium text-text-primary">{c.name === "claude" ? "Claude Code" : "Codex"}</span>
              <span className="truncate text-body-2-medium text-text-tertiary">
                {c.version ?? "Not installed"}
                {c.previous ? ` · was ${c.previous}` : ""}
                {c.updatedAt ? ` · updated ${dateTime(c.updatedAt)}` : ""}
              </span>
            </span>
            <span className="flex flex-wrap gap-2">
              {c.previous && (
                <Button size="small" variant="secondary" leadingIcon={RiArrowGoBackLine} disabled={blocked || busy !== null} onClick={() => void act(c, "rollback")}>
                  Roll back
                </Button>
              )}
              <Button size="small" variant="secondary" leadingIcon={RiDownloadCloud2Line} disabled={blocked || busy !== null} onClick={() => void act(c, "update")}>
                {busy === `${c.name}:update` ? "Updating…" : "Update"}
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-body-2-medium text-text-tertiary">
        {overview.autoUpdateHour === null ? "Auto-update is off." : `Auto-updates daily at ${overview.autoUpdateHour}:00 when no job is running.`}
        {overview.cliBusy ? " An update is running now." : overview.running ? " Updates wait until running jobs finish." : ""}
      </p>
    </div>
  );
}

function AgentsTab({ overview, onChange }: { overview?: Overview; onChange: () => void }) {
  const signIn = `claude setup-token        # sign in with your Claude subscription
codex login --device-auth # sign in with your ChatGPT plan`;
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
      <Card title="Versions" icon={RiRobot2Line} className="lg:flex-1">
        {overview ? <CliTable overview={overview} onChange={onChange} /> : <Skeleton className="h-28" />}
      </Card>
      <Card title="Signing in to Claude and Codex" icon={RiShieldKeyholeLine} className="lg:flex-1" actions={<CopyButton text={signIn} size="xs" />}>
        <ol className="flex list-decimal flex-col gap-1.5 ps-5 text-body-regular text-text-secondary">
          <li>Open umbrelOS Settings, then Advanced settings, then Terminal.</li>
          <li>Choose Rainmaker and run the command for your agent.</li>
          <li>
            For Claude, save the token it prints (<Code>sk-ant-oat01-…</Code>) as the <Code>CLAUDE_CODE_OAUTH_TOKEN</Code> secret.
          </li>
          <li>For Codex, nothing else is needed. The login stays on the app's volume.</li>
        </ol>
        <pre className="rm-terminal overflow-x-auto rounded-2xl p-4 text-[12.5px] leading-relaxed">{signIn}</pre>
        <p className="text-body-2-medium text-text-tertiary">
          For OpenRouter, add an <Code>OPENROUTER_API_KEY</Code> secret and a route with <Code>"provider": "openrouter"</Code>.{" "}
          <a className="underline" href={href.settings("secrets")}>
            Open Secrets
          </a>
        </p>
      </Card>
    </div>
  );
}

/* -------------------------------------------------------------------- page */

export function SettingsPage({ nav, tab }: { nav: PageNav; tab: string }) {
  const q = useApi<SettingsView>("settings");
  const [view, setView] = useState<SettingsView | undefined>(undefined);
  useEffect(() => {
    if (q.data) setView(q.data);
  }, [q.data]);
  const selected = TABS.some((t) => t.id === tab) ? tab : "general";
  const saved = (v: SettingsView) => {
    setView(v);
    nav.reloadOverview();
  };

  return (
    <Shell route={{ page: "settings", tab: selected }} counts={nav.counts} version={nav.version} title="Settings">
      {q.error && <Banner tone="error">{q.error}</Banner>}
      <Tabs selectedKey={selected} onSelectionChange={(k) => navigate(href.settings(String(k)))}>
        <div className="-mx-3 overflow-x-auto px-3">
          <TabList aria-label="Settings sections">
            {TABS.map((t) => (
              <Tab key={t.id} id={t.id} icon={t.icon}>
                {t.label}
              </Tab>
            ))}
          </TabList>
        </div>
        {TABS.map((t) => (
          <TabPanel key={t.id} id={t.id}>
            {t.id === "appearance" ? (
              <Card title="Theme" icon={RiPaletteLine}>
                <p className="text-body-regular text-text-secondary">Your choice is saved in this browser only.</p>
                <ThemeGallery />
              </Card>
            ) : t.id === "agents" ? (
              <AgentsTab overview={nav.overview} onChange={nav.reloadOverview} />
            ) : !view ? (
              <Skeleton className="h-[420px]" />
            ) : t.id === "general" ? (
              <GeneralTab view={view} onSaved={saved} />
            ) : t.id === "routes" ? (
              <RoutesTab view={view} onSaved={saved} />
            ) : t.id === "secrets" ? (
              <SecretsTab view={view} onSaved={saved} />
            ) : (
              <HermesTab view={view} onSaved={saved} />
            )}
          </TabPanel>
        ))}
      </Tabs>
    </Shell>
  );
}
