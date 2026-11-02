import type { Route, Settings } from "./settings.ts";

export type Resolution =
  | { ok: true; routeName: string; route: Route; skills: string[] }
  | { ok: false; error: string };

const SKILL_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

/**
 * Turns an issue's labels into the agent to run:
 * - `model:<route>` picks a route from settings (at most one; the default route otherwise).
 * - `skill:<name>` asks the agent to use that skill from the repo's own skills folder.
 */
export function resolveLabels(labels: string[], settings: Settings): Resolution {
  const modelLabels: string[] = [];
  const skills: string[] = [];
  for (const raw of labels) {
    const label = raw.trim();
    const lower = label.toLowerCase();
    if (lower.startsWith("model:")) modelLabels.push(lower.slice("model:".length).trim());
    else if (lower.startsWith("skill:")) {
      const name = label.slice("skill:".length).trim();
      if (!SKILL_NAME.test(name)) return { ok: false, error: `\`${label}\` is not a valid skill name.` };
      if (!skills.includes(name)) skills.push(name);
    }
  }
  const available = Object.keys(settings.routes)
    .map((r) => `\`model:${r}\``)
    .join(", ");
  if (modelLabels.length > 1) {
    return { ok: false, error: `Only one model label is allowed, found ${modelLabels.map((m) => `\`model:${m}\``).join(" and ")}.` };
  }
  const routeName = modelLabels[0] ?? settings.defaultRoute;
  const route = settings.routes[routeName];
  if (!route) return { ok: false, error: `\`model:${routeName}\` isn't configured. Available: ${available}.` };
  return { ok: true, routeName, route, skills };
}

export function describeRoute(route: Route): string {
  const agent = route.agent === "claude" ? "Claude Code" : "Codex";
  const parts = [agent];
  if (route.model) parts.push(`model \`${route.model}\``);
  if (route.provider === "openrouter") parts.push("via OpenRouter");
  return parts.join(", ");
}
