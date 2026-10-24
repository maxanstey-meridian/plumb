#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RULE = "MER-TO-015";

const cleanup = [];
process.on("exit", () => { for (const directory of cleanup) fs.rmSync(directory, { recursive: true, force: true }); });

function findings(root) {
  const out = spawnSync(path.join(HOME, "plumb"), [root, "--rule", RULE, "--json", "--ci"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  assert.ok([0, 1].includes(out.status), `${RULE} exited ${out.status}: ${out.stderr}`);
  return JSON.parse(out.stdout || "[]");
}

function repo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-to015-"));
  cleanup.push(root);
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

// A C# file whose only comment line is `length` characters of short words, so rewrapping can fix it.
const csharp = (length) => `namespace App;\n\n// ${"word ".repeat(length).slice(0, length - 4)}.\npublic static class Report;\n`;

test("TO-015 flags exactly the comment-only lines past the width in bad", () => {
  const locations = findings(path.join(HOME, "fixtures", RULE, "bad")).map((finding) => finding.location).sort();
  assert.deepEqual(locations, [
    "api/Answers.cs:5",
    "api/Answers.cs:8",
    "src/Answer.vue:2",
    "src/Answer.vue:7",
    "src/answer.ts:1",
    "src/answer.ts:12",
    "src/answer.ts:16",
    "src/answer.ts:5",
    "src/answer.ts:9",
  ]);
});

test("TO-015 leaves good alone: wrapped, unbreakable, trailing, generated and configured-width comments", () => {
  assert.deepEqual(findings(path.join(HOME, "fixtures", RULE, "good")), []);
});

test("TO-015 applies .editorconfig sections in file order, a repeated header overriding what came between", () => {
  const root = repo({
    ".editorconfig": "root = true\n\n[*.cs]\nindent_style = space\n\n[*]\nmax_line_length = 80\n\n[*.cs]\nmax_line_length = 120\n",
    "api/Report.cs": csharp(110),
    "api/Wide.cs": csharp(125),
  });
  const reported = findings(root);
  assert.deepEqual(reported.map((finding) => finding.location), ["api/Wide.cs:3"]);
  assert.match(reported[0].message, /past the 120-character line width/);
});

test("TO-015 ignores a max_line_length that isn't a positive integer and keeps the default width", () => {
  const root = repo({
    ".editorconfig": "root = true\n\n[*]\nmax_line_length = 120\n",
    "api/.editorconfig": "[*.cs]\nmax_line_length = 0\n",
    "api/Report.cs": csharp(110),
  });
  const reported = findings(root);
  assert.deepEqual(reported.map((finding) => finding.location), ["api/Report.cs:3"]);
  assert.match(reported[0].message, /past the 100-character line width/);
});
