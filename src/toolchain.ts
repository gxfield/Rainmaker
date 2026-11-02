import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { log, errorMessage } from "./log.ts";
import { run } from "./proc.ts";

export interface Toolchain {
  /** Directories to put first on PATH for the agent. */
  path: string[];
  env: Record<string, string>;
  /** Lines for the agent prompt describing what's available. */
  notes: string[];
}

const MISE_FILES = [".tool-versions", ".mise.toml", "mise.toml", ".nvmrc", ".node-version", ".python-version"];

/** Reads the Godot version a project targets from `config/features`, e.g. "4.7". */
export function godotVersionFromProject(projectGodot: string): string | undefined {
  const line = projectGodot.split("\n").find((l) => l.trim().startsWith("config/features"));
  const match = line?.match(/"(\d+\.\d+(?:\.\d+)?)"/);
  return match?.[1];
}

/**
 * project.godot only records major.minor ("4.7"), but repos pin a patch release in CI.
 * Picks the newest stable patch of that minor from the engine's tags ("4.7" -> "4.7.2").
 * An exact version ("4.3.1") is kept as is.
 */
export function newestGodotPatch(version: string, tagRefs: string[]): string {
  if (version.split(".").length >= 3) return version;
  let best: { name: string; patch: number } | undefined;
  for (const ref of tagRefs) {
    const m = /refs\/tags\/(\d+\.\d+)(?:\.(\d+))?-stable$/.exec(ref.trim());
    if (!m || m[1] !== version) continue;
    const patch = Number(m[2] ?? 0);
    if (!best || patch > best.patch) best = { name: m[2] ? `${m[1]}.${m[2]}` : m[1]!, patch };
  }
  return best?.name ?? version;
}

export function godotUsesDotnet(projectGodot: string): boolean {
  return /config\/features=.*"C#"/.test(projectGodot) || /^\[dotnet\]/m.test(projectGodot);
}

/** Finds project.godot at the repo root or one or two folders down. */
export function findGodotProject(root: string, depth = 2): string | undefined {
  const direct = join(root, "project.godot");
  if (existsSync(direct)) return direct;
  if (depth === 0) return undefined;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const found = findGodotProject(join(root, entry.name), depth - 1);
    if (found) return found;
  }
  return undefined;
}

/**
 * Installs what a repo needs, on demand, into the persistent tools folder:
 * runtimes from version files via mise, and the exact Godot build a project targets.
 */
export class Toolchains {
  readonly #toolsDir: string;

  constructor(dataDir: string) {
    this.#toolsDir = join(dataDir, "tools");
    mkdirSync(this.#toolsDir, { recursive: true });
  }

  get miseEnv(): Record<string, string> {
    return {
      MISE_DATA_DIR: join(this.#toolsDir, "mise"),
      MISE_CACHE_DIR: join(this.#toolsDir, "mise-cache"),
      MISE_YES: "1",
      MISE_IDIOMATIC_VERSION_FILE_ENABLE_TOOLS: "node,python",
    };
  }

  async prepare(worktree: string, jobBinDir: string, baseEnv: NodeJS.ProcessEnv): Promise<Toolchain> {
    const result: Toolchain = { path: [], env: { ...this.miseEnv }, notes: [] };
    mkdirSync(jobBinDir, { recursive: true });
    result.path.push(jobBinDir);

    if (MISE_FILES.some((f) => existsSync(join(worktree, f)))) {
      const env = { ...baseEnv, ...result.env };
      try {
        await run("mise", ["trust", "--yes", worktree], { cwd: worktree, env, check: false });
        await run("mise", ["install"], { cwd: worktree, env, timeoutMs: 20 * 60_000 });
        result.path.push(join(this.#toolsDir, "mise", "shims"));
        result.notes.push("Runtimes from the repo's version files are installed with mise and are on PATH.");
      } catch (err) {
        log.warn("mise install failed", { worktree, error: errorMessage(err) });
        result.notes.push(`Installing runtimes from the repo's version files failed: ${errorMessage(err)}`);
      }
    }

    const project = findGodotProject(worktree);
    if (project) {
      const text = readFileSync(project, "utf8");
      const version = godotVersionFromProject(text);
      if (godotUsesDotnet(text)) {
        result.notes.push("This is a Godot C# project, which Rainmaker doesn't support yet. Godot is not on PATH.");
      } else if (version) {
        try {
          const exact = await this.resolveGodotVersion(version);
          const binary = await this.ensureGodot(exact);
          const link = join(jobBinDir, "godot");
          rmSync(link, { force: true });
          symlinkSync(binary, link);
          result.notes.push(
            `Godot ${exact} is on PATH as \`godot\`. For imports, script checks and tests use \`godot --headless\`, for example \`godot --headless --path <project dir> --import\` once, then \`--check-only --script <file>\` or the project's test runner (GUT or gdUnit4) if it has one.`,
            "`--headless` draws nothing. To render (screenshots), use the virtual display and software OpenGL: `xvfb-run -a godot --rendering-driver opengl3 ...`. It's slower than a GPU but the pixels are real. Export templates aren't preinstalled; if the repo's instructions download them, they go under your HOME and are kept for later runs.",
          );
        } catch (err) {
          log.warn("Godot download failed", { version, error: errorMessage(err) });
          result.notes.push(`Godot ${version} could not be installed: ${errorMessage(err)}`);
        }
      }
    }
    return result;
  }

  readonly #godotVersions = new Map<string, { exact: string; at: number }>();

  /** The newest stable patch for a project's Godot version, cached for a few hours. Falls back to the version as given. */
  async resolveGodotVersion(version: string): Promise<string> {
    const cached = this.#godotVersions.get(version);
    if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.exact;
    let exact = version;
    try {
      const { stdout } = await run("git", ["ls-remote", "--tags", "https://github.com/godotengine/godot", `${version}*-stable`], {
        timeoutMs: 60_000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });
      exact = newestGodotPatch(version, stdout.split("\n"));
    } catch (err) {
      log.warn("Couldn't list Godot releases, using the project's version as is", { version, error: errorMessage(err) });
    }
    this.#godotVersions.set(version, { exact, at: Date.now() });
    return exact;
  }

  /** Downloads the official Linux x86_64 Godot build for `version` once and returns its path. */
  async ensureGodot(version: string): Promise<string> {
    const dir = join(this.#toolsDir, "godot", version);
    const binary = join(dir, "godot");
    if (existsSync(binary)) return binary;
    mkdirSync(dir, { recursive: true });
    const tag = `${version}-stable`;
    const name = `Godot_v${tag}_linux.x86_64`;
    const url = `https://github.com/godotengine/godot/releases/download/${tag}/${name}.zip`;
    const zip = join(dir, "godot.zip");
    log.info("Downloading Godot", { version, url });
    await run("curl", ["-fsSL", "--retry", "3", "-o", zip, url], { timeoutMs: 15 * 60_000 });
    await run("unzip", ["-o", "-q", zip, "-d", dir]);
    rmSync(zip, { force: true });
    renameSync(join(dir, name), binary);
    chmodSync(binary, 0o755);
    return binary;
  }
}
