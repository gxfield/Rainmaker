import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../src/prompt.ts";

test("prompt carries the issue, discussion, skills and toolchain notes", () => {
  const prompt = buildPrompt({
    repo: "gxfield/game",
    issue: { number: 12, title: "Fix HUD overlap", body: "The score overlaps the timer.", state: "open", labels: [], user: "gxfield", html_url: "", pull: false },
    comments: [{ user: "gxfield", body: "Only on 720p.", created_at: "" }],
    branch: "rainmaker/issue-12",
    base: "main",
    skills: [{ name: "godot-ui", path: ".claude/skills/godot-ui/SKILL.md" }],
    toolchainNotes: ["Godot 4.7 is on PATH as `godot`."],
  });
  assert.match(prompt, /issue #12 in gxfield\/game: "Fix HUD overlap"/);
  assert.match(prompt, /The score overlaps the timer\./);
  assert.match(prompt, /<comment author="gxfield">\nOnly on 720p\./);
  assert.match(prompt, /`godot-ui` \(`\.claude\/skills\/godot-ui\/SKILL\.md`\)/);
  assert.match(prompt, /Godot 4\.7 is on PATH/);
  assert.match(prompt, /Do not push/);
  assert.match(prompt, /xvfb-run -a/);
  assert.match(prompt, /https:\/\/github\.com\/gxfield\/game\/blob\/<commit sha>\/<path>\?raw=true/);
});
