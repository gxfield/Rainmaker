import { test } from "node:test";
import assert from "node:assert/strict";
import { describeRoute, resolveLabels } from "../src/labels.ts";
import { DEFAULT_SETTINGS } from "../src/settings.ts";

test("uses the default route when there is no model label", () => {
  const r = resolveLabels(["agent:ready", "bug"], DEFAULT_SETTINGS);
  assert.ok(r.ok);
  assert.equal(r.routeName, "sonnet");
  assert.deepEqual(r.skills, []);
});

test("picks the route from a model label, case-insensitively", () => {
  const r = resolveLabels(["Model:Codex"], DEFAULT_SETTINGS);
  assert.ok(r.ok);
  assert.equal(r.route.agent, "codex");
});

test("collects skill labels and keeps their case", () => {
  const r = resolveLabels(["skill:godot-ui", "skill:Release_Notes", "skill:godot-ui"], DEFAULT_SETTINGS);
  assert.ok(r.ok);
  assert.deepEqual(r.skills, ["godot-ui", "Release_Notes"]);
});

test("rejects unknown and duplicate model labels", () => {
  const unknown = resolveLabels(["model:gpt-9"], DEFAULT_SETTINGS);
  assert.equal(unknown.ok, false);
  assert.match(!unknown.ok ? unknown.error : "", /isn't configured.*model:opus/);
  const two = resolveLabels(["model:opus", "model:codex"], DEFAULT_SETTINGS);
  assert.equal(two.ok, false);
});

test("rejects skill names that could escape the skills folder", () => {
  assert.equal(resolveLabels(["skill:../etc"], DEFAULT_SETTINGS).ok, false);
});

test("describes routes for humans", () => {
  assert.equal(describeRoute({ agent: "claude", model: "opus" }), "Claude Code, model `opus`");
  assert.equal(describeRoute({ agent: "codex", provider: "openrouter" }), "Codex, via OpenRouter");
});
