import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Clis } from "./clis.ts";
import { SecretBox } from "./crypto.ts";
import { Store } from "./db.ts";
import { Engine } from "./engine.ts";
import { errorMessage, log } from "./log.ts";
import { Config } from "./settings.ts";
import { Toolchains } from "./toolchain.ts";
import { createWebServer } from "./web.ts";
import { Workspace } from "./workspace.ts";

const dataDir = process.env.DATA_DIR ?? "/data";
const port = Number(process.env.PORT ?? 3000);
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

mkdirSync(dataDir, { recursive: true });
mkdirSync(join(dataDir, "home"), { recursive: true });

const store = new Store(join(dataDir, "rainmaker.db"));
const config = new Config(store, SecretBox.fromEnvironment(dataDir));
const clis = new Clis(dataDir, store);
const toolchains = new Toolchains(dataDir);
const workspace = new Workspace(dataDir, () => {
  const token = config.githubToken;
  if (!token) throw new Error("No GitHub token is set");
  return token;
});
const engine = new Engine({ dataDir, store, config, clis, toolchains, workspace });
const server = createWebServer({ store, config, engine, clis, version: pkg.version });

const timers: NodeJS.Timeout[] = [];

/** Runs `fn`, then schedules the next run `delayMs()` later, so changed settings apply on the next round. */
function loop(name: string, delayMs: () => number, fn: () => Promise<void>): void {
  const go = async () => {
    try {
      await fn();
    } catch (err) {
      log.error(`${name} failed`, { error: errorMessage(err) });
    }
    if (!engine.stopped) timers.push(setTimeout(go, delayMs()));
  };
  void go();
}

let lastAutoUpdateDay = "";
async function maintenance(): Promise<void> {
  await engine.prune();
  const hour = config.settings.autoUpdateHour;
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  if (hour !== null && now.getHours() === hour && lastAutoUpdateDay !== today && engine.runningCount === 0) {
    lastAutoUpdateDay = today;
    for (const name of ["claude", "codex"] as const) {
      try {
        const latest = await clis.latestVersion(name);
        const current = clis.status().find((c) => c.name === name)?.version;
        if (latest && latest !== current) await clis.update(name);
      } catch (err) {
        log.warn(`Auto-update of ${name} failed`, { error: errorMessage(err) });
      }
    }
  }
}

async function start(): Promise<void> {
  server.listen(port, () => log.info(`Rainmaker ${pkg.version} listening on :${port}`, { dataDir }));
  await engine.recover();
  await clis.ensureInstalled();
  loop("poll", () => config.settings.pollIntervalSec * 1000, async () => {
    await engine.poll();
    engine.tick();
  });
  timers.push(setInterval(() => engine.tick(), 5_000));
  loop("maintenance", () => 10 * 60_000, maintenance);
}

async function shutdown(signal: string): Promise<void> {
  log.info(`Received ${signal}, shutting down`);
  for (const t of timers) clearTimeout(t);
  await engine.stop();
  server.close();
  store.close();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

start().catch((err) => {
  log.error("Startup failed", { error: errorMessage(err) });
  process.exit(1);
});
