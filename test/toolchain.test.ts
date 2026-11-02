import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findGodotProject, godotUsesDotnet, godotVersionFromProject } from "../src/toolchain.ts";

const project = `config_version=5

[application]

config/name="Umbrel Game"
config/features=PackedStringArray("4.7", "Forward Plus")
`;

test("reads the Godot version from project.godot", () => {
  assert.equal(godotVersionFromProject(project), "4.7");
  assert.equal(godotVersionFromProject('config/features=PackedStringArray("4.3.1", "GL Compatibility")'), "4.3.1");
  assert.equal(godotVersionFromProject("config/name=\"x\""), undefined);
});

test("detects Godot C# projects", () => {
  assert.equal(godotUsesDotnet(project), false);
  assert.equal(godotUsesDotnet('config/features=PackedStringArray("4.7", "C#", "Forward Plus")'), true);
  assert.equal(godotUsesDotnet(`${project}\n[dotnet]\nproject/assembly_name="Game"\n`), true);
});

test("finds project.godot in a subfolder", () => {
  const root = mkdtempSync(join(tmpdir(), "rm-godot-"));
  mkdirSync(join(root, "game"));
  writeFileSync(join(root, "game", "project.godot"), project);
  assert.equal(findGodotProject(root), join(root, "game", "project.godot"));
  assert.equal(findGodotProject(mkdtempSync(join(tmpdir(), "rm-empty-"))), undefined);
});
