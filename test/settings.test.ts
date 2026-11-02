import { test } from "node:test";
import assert from "node:assert/strict";
import { SecretBox, maskSecrets } from "../src/crypto.ts";
import { Store } from "../src/db.ts";
import { Config, DEFAULT_SETTINGS, validateSecretName, validateSettings } from "../src/settings.ts";

const box = () => new SecretBox(Buffer.alloc(32, 7));

test("validates and normalizes settings", () => {
  const s = validateSettings({ repos: [" gxfield/game ", "gxfield/game", "gxfield/web"], allowedUsers: ["@gxfield"] });
  assert.deepEqual(s.repos, ["gxfield/game", "gxfield/web"]);
  assert.deepEqual(s.allowedUsers, ["gxfield"]);
  assert.throws(() => validateSettings({ repos: ["not a repo"] }), /owner\/name/);
  assert.throws(() => validateSettings({ concurrency: 9 }), /Concurrency/);
  assert.throws(() => validateSettings({ defaultRoute: "nope" }), /Default route/);
  assert.throws(() => validateSettings({ routes: { x: { agent: "gemini" as never } }, defaultRoute: "x" }), /agent/);
});

test("secret names are env-var shaped and can't shadow runner variables", () => {
  assert.equal(validateSecretName(" OPENROUTER_API_KEY "), "OPENROUTER_API_KEY");
  assert.throws(() => validateSecretName("lower"), /capital/);
  assert.throws(() => validateSecretName("PATH"), /set by Rainmaker/);
});

test("secrets round-trip encrypted and are masked", () => {
  const store = new Store(":memory:");
  const config = new Config(store, box());
  config.putSecret("OPENROUTER_API_KEY", "sk-or-very-secret");
  config.setGithubToken("github_pat_abcdef");
  const sealed = store.getSealedSecrets()[0]!.sealed;
  assert.ok(!sealed.includes("very-secret"));
  assert.deepEqual(config.secretEnv(), { OPENROUTER_API_KEY: "sk-or-very-secret" });
  assert.equal(config.githubToken, "github_pat_abcdef");
  const masked = maskSecrets("key=sk-or-very-secret token=github_pat_abcdef", config.sensitiveValues());
  assert.equal(masked, "key=•••••• token=••••••");
});

test("a secret sealed with another key is skipped, not fatal", () => {
  const store = new Store(":memory:");
  new Config(store, new SecretBox(Buffer.alloc(32, 1))).putSecret("A_KEY", "value-one");
  assert.deepEqual(new Config(store, box()).secretEnv(), {});
});

test("settings persist and fall back to defaults", () => {
  const store = new Store(":memory:");
  const config = new Config(store, box());
  assert.deepEqual(config.settings, DEFAULT_SETTINGS);
  config.saveSettings({ ...DEFAULT_SETTINGS, repos: ["a/b"], autoUpdateHour: null });
  assert.deepEqual(config.settings.repos, ["a/b"]);
  assert.equal(config.settings.autoUpdateHour, null);
});
