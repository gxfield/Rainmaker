# Rainmaker

A lightweight Umbrel app that turns labeled GitHub issues into pull requests by running Claude Code or Codex.

Add `agent:ready` to an issue. Rainmaker picks it up, runs the agent in a fresh worktree, pushes a branch, opens a pull request that closes the issue, and moves the label to `agent:done` (or `agent:failed`, with the reason in a comment).

## How it works

```
agent:ready ──► agent:working ──► agent:done    (PR opened, comment on the issue)
                              └─► agent:failed  (comment with the error and last log lines)
```

1. Every poll interval (default 60s), Rainmaker lists open issues labeled `agent:ready` in the repos you watch. Polls use ETags, so quiet repos don't use up your GitHub rate limit.
2. It checks who applied the label. Only you (the token's owner) or users you list can trigger a run. Anyone else's label is removed with a comment.
3. It reads the issue's other labels to choose the agent, model and skills (see below), then queues a job.
4. The job gets its own git worktree on branch `rainmaker/issue-<n>` from the default branch. Runtimes from the repo's version files are installed with mise, and Godot projects get the exact Godot build from `project.godot`.
5. Claude Code (`claude -p`, stream-json) or Codex (`codex exec --json`) runs headless with the issue, its discussion, and instructions to commit but not push.
6. Rainmaker commits anything left uncommitted, pushes the branch, opens the PR with the agent's summary, and records tokens, cost, turns and duration.

Closing the issue or removing `agent:working` cancels the job. Retrying from the dashboard (or re-adding `agent:ready`) starts over on the same branch, so the PR updates in place.

## Labels

| Label | Effect |
| --- | --- |
| `agent:ready` | Start a run. You add this one. |
| `model:<route>` | Choose the agent and model. Defaults: `model:opus`, `model:sonnet`, `model:haiku`, `model:codex`. Without one, the default route (Sonnet) is used. |
| `skill:<name>` | Tell the agent to follow a skill from the repo, found at `.claude/skills/<name>/SKILL.md` (or `.agents/skills`, `.codex/skills`). The job fails fast if the skill isn't there. |
| `agent:working`, `agent:done`, `agent:failed` | Set by Rainmaker. Created in each repo automatically. |

Routes are edited in Settings as JSON. Each one maps a label to an agent, an optional model, and an optional provider:

```json
{
  "opus":   { "agent": "claude", "model": "opus" },
  "sonnet": { "agent": "claude", "model": "sonnet" },
  "codex":  { "agent": "codex" },
  "qwen":   { "agent": "claude", "model": "qwen/qwen3-coder", "provider": "openrouter" }
}
```

For OpenRouter routes, `model` is the exact model ID from openrouter.ai (always `vendor/name`), and `agent` is still `claude` or `codex`: it picks which CLI drives the model. Claude Code reaches OpenRouter through its Anthropic-compatible endpoint, and Rainmaker points Claude Code's background model at the same ID. Pick a model that supports tool calling.

## Agent instructions, skills and MCP

Rainmaker adds no global configuration. Everything comes from the repo, the same way it would on your laptop: `CLAUDE.md`, `AGENTS.md`, `.claude/skills/`, `.claude/settings.json` and `.mcp.json` are all picked up because the agent runs inside the repo.

## Secrets

Settings has a small secrets list. Values are encrypted with a key derived from Umbrel's per-app `APP_SEED`, never shown again, passed to every agent run as environment variables, and masked in logs, PR descriptions and comments. The GitHub token is stored the same way but is never given to the agent; Rainmaker does all the pushing itself.

Useful secrets:

- `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token`, to use your Claude subscription.
- `OPENROUTER_API_KEY`, for routes with `"provider": "openrouter"`.
- Anything a repo's MCP servers or tests need.

## Install on Umbrel

1. In umbrelOS, open the App Store, choose Community App Stores, and add `https://github.com/gxfield/Rainmaker`.
2. Install Rainmaker from the new store and open it.
3. In Settings, paste a fine-grained GitHub token with **Contents**, **Issues** and **Pull requests** set to read and write on the repos you want to watch, and list those repos.
4. Sign in the agents from a terminal for the app (umbrelOS Settings, Advanced settings, Terminal, then Rainmaker):
   ```sh
   claude setup-token          # then save the printed token as the CLAUDE_CODE_OAUTH_TOKEN secret
   codex login --device-auth   # the login is kept on the app's volume
   ```

The image is published to `ghcr.io/gxfield/rainmaker` by the workflow in `.github/workflows/image.yml`. Every push to `main` tags it `latest` and with the `version` from `package.json`, which is the tag `gxfield-rainmaker/docker-compose.yml` pins. To release, bump the version in `package.json`, `gxfield-rainmaker/umbrel-app.yml` and the compose image tag together.

## Updating Claude Code and Codex

The CLIs aren't baked into the image. They live in an npm prefix on the app's volume (`/data/tools/npm`), so:

- The dashboard shows each CLI's version with **Update** and **Roll back** buttons.
- Rainmaker auto-updates them once a day at the hour you choose (default 4:00), only when no job is running.
- An update that fails to start (`--version` fails) is rolled back automatically.

Updating Rainmaker itself is a normal Umbrel app update and doesn't touch the CLIs or their logins.

## Data on the volume

```
/data/rainmaker.db   settings, encrypted secrets, job history and metrics (SQLite)
/data/home           HOME for the agents (Claude and Codex logins live here)
/data/tools          the CLIs, mise runtimes and Godot builds
/data/repos          one bare clone per repo
/data/work           per-job worktrees, removed when the job ends
/data/logs           one log per job
```

Jobs and logs older than the retention window (default 30 days) are deleted automatically.

## Security notes

- The container is the sandbox. Claude Code runs with `bypassPermissions` and Codex with `--dangerously-bypass-approvals-and-sandbox`, so treat anything a run can reach as exposed to the agent.
- The issue body and comments are prompt input. Only comments from allowed users are included, and only allowed users can start a run, but read an issue from someone else before labeling it.
- Agents get a minimal environment: your secrets, PATH and HOME. Umbrel's `APP_SEED` and the GitHub token are not passed in.

## Development

Needs Node 22.18 or later (TypeScript runs directly with type stripping, no build step).

```sh
npm install
npm run dev      # data in ./.data, UI on http://localhost:3000
npm run check    # typecheck and tests
```

## Roadmap

1. **Core runner** (this release): polling, labels, headless runs, PRs, secrets, CLI updates, minimal UI.
2. **MCP server for Hermes**: list, create, retry and cancel tasks, read output, and answer agent questions.
3. **Dashboard**: live terminal view and fuller 30-day metrics by model and repo.
4. **Hardening**: budgets, opt-in visual checks (Godot screenshots, Playwright), and app store polish.
