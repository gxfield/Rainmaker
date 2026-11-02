import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { AgentName, Store } from "./db.ts";
import { log, errorMessage } from "./log.ts";
import { run } from "./proc.ts";

export const CLI_PACKAGES: Record<AgentName, { pkg: string; bin: string }> = {
  claude: { pkg: "@anthropic-ai/claude-code", bin: "claude" },
  codex: { pkg: "@openai/codex", bin: "codex" },
};

export interface CliStatus {
  name: AgentName;
  version: string | null;
  previous: string | null;
  latest?: string | null;
  updatedAt: number | null;
}

/**
 * Keeps Claude Code and Codex in an npm prefix on the persistent volume, so
 * they update independently of the Rainmaker image and survive restarts.
 */
export class Clis {
  readonly prefix: string;
  readonly #store: Store;
  #busy = false;

  constructor(dataDir: string, store: Store) {
    this.prefix = join(dataDir, "tools", "npm");
    this.#store = store;
    mkdirSync(this.prefix, { recursive: true });
  }

  get binDir(): string {
    return join(this.prefix, "bin");
  }

  get busy(): boolean {
    return this.#busy;
  }

  binary(name: AgentName): string {
    return join(this.binDir, CLI_PACKAGES[name].bin);
  }

  async installedVersion(name: AgentName): Promise<string | null> {
    const res = await run("npm", ["ls", "-g", "--prefix", this.prefix, "--json", "--depth=0", CLI_PACKAGES[name].pkg], {
      check: false,
    });
    try {
      const data = JSON.parse(res.stdout) as { dependencies?: Record<string, { version?: string }> };
      return data.dependencies?.[CLI_PACKAGES[name].pkg]?.version ?? null;
    } catch {
      return null;
    }
  }

  async latestVersion(name: AgentName): Promise<string | null> {
    const res = await run("npm", ["view", CLI_PACKAGES[name].pkg, "version"], { check: false, timeoutMs: 60_000 });
    return res.code === 0 ? res.stdout.trim() : null;
  }

  status(): CliStatus[] {
    return (Object.keys(CLI_PACKAGES) as AgentName[]).map((name) => {
      const row = this.#store.getCliVersion(name);
      return { name, version: row?.version ?? null, previous: row?.previous ?? null, updatedAt: row?.updated_at ?? null };
    });
  }

  /** Installs any CLI that's missing. Called at startup. */
  async ensureInstalled(): Promise<void> {
    for (const name of Object.keys(CLI_PACKAGES) as AgentName[]) {
      if (existsSync(this.binary(name))) {
        const version = await this.installedVersion(name);
        const row = this.#store.getCliVersion(name);
        if (row?.version !== version) this.#store.setCliVersion(name, version, row?.previous ?? null);
        continue;
      }
      try {
        await this.install(name, "latest");
      } catch (err) {
        log.error(`Installing ${name} failed`, { error: errorMessage(err) });
      }
    }
  }

  /** Installs `version` of a CLI, checks it runs, and rolls back if it doesn't. */
  async install(name: AgentName, version: string): Promise<string | null> {
    if (this.#busy) throw new Error("Another CLI update is already running");
    this.#busy = true;
    const before = await this.installedVersion(name);
    try {
      log.info(`Installing ${name}@${version}`);
      await this.#npmInstall(name, version);
      await run(this.binary(name), ["--version"], { timeoutMs: 60_000 });
      const after = await this.installedVersion(name);
      this.#store.setCliVersion(name, after, after !== before ? before : (this.#store.getCliVersion(name)?.previous ?? null));
      log.info(`${name} is at ${after}`);
      return after;
    } catch (err) {
      if (before) {
        log.warn(`${name}@${version} failed, rolling back to ${before}`, { error: errorMessage(err) });
        await this.#npmInstall(name, before).catch(() => undefined);
      }
      throw err;
    } finally {
      this.#busy = false;
    }
  }

  async update(name: AgentName): Promise<string | null> {
    return this.install(name, "latest");
  }

  async rollback(name: AgentName): Promise<string | null> {
    const previous = this.#store.getCliVersion(name)?.previous;
    if (!previous) throw new Error(`No earlier ${name} version to roll back to`);
    return this.install(name, previous);
  }

  async #npmInstall(name: AgentName, version: string): Promise<void> {
    await run("npm", ["install", "-g", "--prefix", this.prefix, "--no-fund", "--no-audit", `${CLI_PACKAGES[name].pkg}@${version}`], {
      timeoutMs: 10 * 60_000,
    });
  }
}
