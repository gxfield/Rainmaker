import { randomBytes, timingSafeEqual } from "node:crypto";
import type { SecretBox } from "./crypto.ts";
import type { AgentName, Store } from "./db.ts";
import { validTimeZone } from "./daily.ts";

export type Provider = "default" | "openrouter";

/** What a `model:<name>` label resolves to. */
export interface Route {
  agent: AgentName;
  /** Model passed to the CLI. Omit to use the CLI's own default. */
  model?: string;
  /** "default" uses the CLI's own login (subscription or API key); "openrouter" uses OPENROUTER_API_KEY. */
  provider?: Provider;
}

export interface Settings {
  repos: string[];
  /** GitHub logins allowed to trigger runs by applying the ready label. Empty means only the token's owner. */
  allowedUsers: string[];
  pollIntervalSec: number;
  concurrency: number;
  jobTimeoutMin: number;
  /** How long an agent's ask_human call waits for an answer before it carries on alone. */
  questionTimeoutMin: number;
  retentionDays: number;
  defaultRoute: string;
  routes: Record<string, Route>;
  /** Hour of day (0-23, in timeZone) to auto-update the CLIs, or null to turn it off. */
  autoUpdateHour: number | null;
  /** Open agent PRs against a daily branch (rainmaker/daily-YYYY-MM-DD) instead of the default branch. */
  dailyBranch: boolean;
  /** IANA time zone for the daily branch's date and the auto-update hour. */
  timeZone: string;
}

export const LABELS = {
  ready: "agent:ready",
  working: "agent:working",
  done: "agent:done",
  failed: "agent:failed",
} as const;

export const DEFAULT_SETTINGS: Settings = {
  repos: [],
  allowedUsers: [],
  pollIntervalSec: 60,
  concurrency: 1,
  jobTimeoutMin: 60,
  questionTimeoutMin: 30,
  retentionDays: 30,
  defaultRoute: "sonnet",
  routes: {
    opus: { agent: "claude", model: "opus" },
    sonnet: { agent: "claude", model: "sonnet" },
    haiku: { agent: "claude", model: "haiku" },
    codex: { agent: "codex" },
  },
  autoUpdateHour: 4,
  dailyBranch: false,
  timeZone: "UTC",
};

const SETTINGS_KEY = "settings";
const GITHUB_TOKEN_KEY = "github_token";
const MCP_TOKEN_KEY = "mcp_token";
const REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SECRET_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
/** Names the runner sets itself; a user secret must not override them. */
const RESERVED_SECRET_NAMES = new Set(["HOME", "PATH", "GITHUB_TOKEN", "GH_TOKEN", "APP_SEED", "DATA_DIR"]);

export function validateSettings(input: Partial<Settings>): Settings {
  const merged: Settings = { ...DEFAULT_SETTINGS, ...input };
  const repos = [...new Set(merged.repos.map((r) => r.trim()).filter(Boolean))];
  for (const repo of repos) {
    if (!REPO_PATTERN.test(repo)) throw new Error(`"${repo}" is not in owner/name form`);
  }
  const int = (value: number, name: string, min: number, max: number): number => {
    const n = Math.floor(Number(value));
    if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return n;
  };
  const routes: Record<string, Route> = {};
  for (const [name, route] of Object.entries(merged.routes)) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(name)) throw new Error(`Route name "${name}" may only use letters, digits, ., _ and -`);
    if (route.agent !== "claude" && route.agent !== "codex") throw new Error(`Route "${name}" needs agent "claude" or "codex"`);
    if (route.provider && route.provider !== "default" && route.provider !== "openrouter") {
      throw new Error(`Route "${name}" has unknown provider "${route.provider}"`);
    }
    routes[name.toLowerCase()] = {
      agent: route.agent,
      ...(route.model ? { model: String(route.model) } : {}),
      ...(route.provider && route.provider !== "default" ? { provider: route.provider } : {}),
    };
  }
  const defaultRoute = merged.defaultRoute.trim().toLowerCase();
  if (!routes[defaultRoute]) throw new Error(`Default route "${defaultRoute}" is not one of the routes`);
  const hour = merged.autoUpdateHour;
  const timeZone = String(merged.timeZone ?? "").trim() || "UTC";
  if (!validTimeZone(timeZone)) throw new Error(`"${timeZone}" isn't a time zone. Use a name like America/Los_Angeles or Europe/London.`);
  return {
    repos,
    allowedUsers: [...new Set(merged.allowedUsers.map((u) => u.trim().replace(/^@/, "")).filter(Boolean))],
    pollIntervalSec: int(merged.pollIntervalSec, "Poll interval", 15, 3600),
    concurrency: int(merged.concurrency, "Concurrency", 1, 4),
    jobTimeoutMin: int(merged.jobTimeoutMin, "Job timeout", 5, 600),
    questionTimeoutMin: int(merged.questionTimeoutMin, "Question timeout", 1, 240),
    retentionDays: int(merged.retentionDays, "Retention", 1, 365),
    defaultRoute,
    routes,
    autoUpdateHour: hour === null || (hour as unknown) === "" ? null : int(hour, "Auto-update hour", 0, 23),
    dailyBranch: merged.dailyBranch === true,
    timeZone,
  };
}

export function validateSecretName(name: string): string {
  const trimmed = name.trim();
  if (!SECRET_NAME_PATTERN.test(trimmed)) throw new Error("Secret names use capital letters, digits and _, like OPENROUTER_API_KEY");
  if (RESERVED_SECRET_NAMES.has(trimmed)) throw new Error(`${trimmed} is set by Rainmaker and can't be a secret`);
  return trimmed;
}

/** Single-line keys that terminals and web pages like to wrap. Any whitespace in them is a copy-paste artifact. */
const TOKEN_SECRET_NAMES = new Set(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "OPENROUTER_API_KEY", "OPENAI_API_KEY", "CODEX_API_KEY"]);

/** Cleans up a pasted secret value and catches the common wrong-token mistakes. */
export function cleanSecretValue(name: string, value: string): string {
  const cleaned = TOKEN_SECRET_NAMES.has(name) ? value.replace(/\s+/g, "") : value.trim();
  if (!cleaned) throw new Error("Secret value is empty");
  if (name === "CLAUDE_CODE_OAUTH_TOKEN" && !cleaned.startsWith("sk-ant-oat")) {
    throw new Error(
      "CLAUDE_CODE_OAUTH_TOKEN should be the token that claude setup-token prints at the very end, starting with sk-ant-oat. The code the browser shows during sign-in is not the token.",
    );
  }
  return cleaned;
}

/** Settings, the GitHub token, and the encrypted secrets passed to every run. */
export class Config {
  readonly #store: Store;
  readonly #box: SecretBox;

  constructor(store: Store, box: SecretBox) {
    this.#store = store;
    this.#box = box;
  }

  get settings(): Settings {
    const raw = this.#store.getSetting(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    try {
      return validateSettings(JSON.parse(raw) as Partial<Settings>);
    } catch {
      return structuredClone(DEFAULT_SETTINGS);
    }
  }

  saveSettings(input: Partial<Settings>): Settings {
    const valid = validateSettings(input);
    this.#store.setSetting(SETTINGS_KEY, JSON.stringify(valid));
    return valid;
  }

  get githubToken(): string | undefined {
    const sealed = this.#store.getSetting(GITHUB_TOKEN_KEY);
    return sealed ? this.#box.decrypt(sealed) : undefined;
  }

  setGithubToken(token: string): void {
    this.#store.setSetting(GITHUB_TOKEN_KEY, this.#box.encrypt(token.trim()));
  }

  /** The bearer token Hermes and other MCP clients use. Created on first use. */
  get mcpToken(): string {
    const sealed = this.#store.getSetting(MCP_TOKEN_KEY);
    if (sealed) return this.#box.decrypt(sealed);
    return this.rotateMcpToken();
  }

  rotateMcpToken(): string {
    const token = `rm_${randomBytes(24).toString("base64url")}`;
    this.#store.setSetting(MCP_TOKEN_KEY, this.#box.encrypt(token));
    return token;
  }

  checkMcpToken(candidate: string): boolean {
    const expected = Buffer.from(this.mcpToken);
    const given = Buffer.from(candidate);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  secretNames(): { name: string; updated_at: number }[] {
    return this.#store.listSecretNames();
  }

  putSecret(name: string, value: string): void {
    const key = validateSecretName(name);
    this.#store.putSecret(key, this.#box.encrypt(cleanSecretValue(key, value)));
  }

  deleteSecret(name: string): void {
    this.#store.deleteSecret(name);
  }

  /** Decrypted secrets, for the environment of agent runs. */
  secretEnv(): Record<string, string> {
    const env: Record<string, string> = {};
    for (const { name, sealed } of this.#store.getSealedSecrets()) {
      try {
        env[name] = this.#box.decrypt(sealed);
      } catch {
        // A secret sealed with another key (e.g. APP_SEED changed) is skipped rather than crashing runs.
      }
    }
    return env;
  }

  /** Every value that must never appear in logs, comments, or the dashboard. */
  sensitiveValues(): string[] {
    const values = Object.values(this.secretEnv());
    const token = this.githubToken;
    if (token) values.push(token);
    const mcp = this.#store.getSetting(MCP_TOKEN_KEY);
    if (mcp) values.push(this.#box.decrypt(mcp));
    return values;
  }
}
