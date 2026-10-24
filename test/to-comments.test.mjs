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

test("TO-015 flags exactly the comment-only lines past the width in bad, as info", () => {
  const reported = findings(path.join(HOME, "fixtures", RULE, "bad"));
  assert.deepEqual([...new Set(reported.map((finding) => finding.severity))], ["info"]);
  assert.deepEqual(reported.map((finding) => finding.location).sort(), [
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

test("TO-015 leaves good alone: wrapped, unbreakable, trailing, generated, code and configured-width lines", () => {
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

test("MER-TO-015 reads .editorconfig keys case-insensitively", () => {
  const root = repo({
    ".editorconfig": "ROOT = true\n\n[*.cs]\nMax_Line_Length = 80\n",
    "api/Note.cs": `${"// a few short words ".repeat(5).trimEnd()}\npublic static class Note;\n`,
  });
  assert.deepEqual(findings(root).map((finding) => finding.location), ["api/Note.cs:1"]);
});

// A TypeScript file whose only comment line is `length` characters of short words.
const typescript = (length) => `// ${"word ".repeat(length).slice(0, length - 4)}.\nexport const wide = 1;\n`;
const widths = (reported) => reported.map((finding) => `${finding.location} ${finding.message.match(/past the (\d+)-character/)[1]}`);

test("TO-015 reads the nearest oxfmt config's top-level printWidth when no override matches the file", () => {
  const root = repo({
    ".oxfmtrc.json": `{ "printWidth": 100 }\n`,
    "src/wide/.oxfmtrc.json": `{ "overrides": [{ "files": ["*.md"], "options": { "printWidth": 80 } }], "printWidth": 120 }\n`,
    "src/wide/fits.ts": typescript(110),
    "src/wide/over.ts": typescript(125),
  });
  assert.deepEqual(widths(findings(root)), ["src/wide/over.ts:1 120"]);
});

test("TO-015 applies the last CSharpier YAML override that matches the file over the top-level printWidth", () => {
  const root = repo({
    "api/.csharpierrc.yaml": "printWidth: 120\noverrides:\n  - files: \"*.cst\"\n    printWidth: 90\n  - files: \"*.cs\"\n    formatter: csharp\n    printWidth: 80\n",
    "api/Report.cs": csharp(90),
  });
  assert.deepEqual(widths(findings(root)), ["api/Report.cs:3 80"]);
});

test("TO-015 keeps the CSharpier top-level printWidth when no override matches the file", () => {
  const root = repo({
    "api/.csharpierrc.yaml": "overrides:\n  - files: \"Legacy/*.cs\"\n    formatter: csharp\n    printWidth: 80\nprintWidth: 120\n",
    "api/Report.cs": csharp(110),
    "api/Wide.cs": csharp(125),
  });
  assert.deepEqual(widths(findings(root)), ["api/Wide.cs:3 120"]);
});

test("TO-015 matches a path .editorconfig section relative to its directory, ** crossing directories", () => {
  const root = repo({
    ".editorconfig": "root = true\n\n[*.cs]\nmax_line_length = 120\n\n[src/Legacy/**.cs]\nmax_line_length = 80\n",
    "src/Legacy/Deep/Old.cs": csharp(90),
    "src/Current/New.cs": csharp(110),
    "lib/src/Legacy/Elsewhere.cs": csharp(110),
  });
  assert.deepEqual(widths(findings(root)), ["src/Legacy/Deep/Old.cs:3 80"]);
});

test("TO-015 matches a brace-list .editorconfig section and skips one that lists no .cs", () => {
  const root = repo({
    ".editorconfig": "root = true\n\n[*.{cs,csx}]\nmax_line_length = 120\n\n[*.{json,yml}]\nmax_line_length = 80\n",
    "api/Report.cs": csharp(110),
    "api/Wide.cs": csharp(125),
  });
  assert.deepEqual(widths(findings(root)), ["api/Wide.cs:3 120"]);
});

test("TO-015 layers every matching oxfmt override over the top level, honouring excludeFiles", () => {
  const root = repo({
    ".oxfmtrc.json": JSON.stringify({ printWidth: 120, overrides: [
      { files: ["legacy/**"], excludeFiles: ["*.spec.ts"], options: { printWidth: 80 } },
      { files: ["legacy/keep.ts"], options: { semi: false } },
      { files: ["/legacy/never.ts"], options: { printWidth: 60 } },
    ] }),
    "src/fits.ts": typescript(110),
    "legacy/old.ts": typescript(90),
    "legacy/old.spec.ts": typescript(90),
    "legacy/keep.ts": typescript(90),
    "legacy/never.ts": typescript(70),
  });
  assert.deepEqual(widths(findings(root)).sort(), ["legacy/keep.ts:1 80", "legacy/old.ts:1 80"]);
});

test("TO-015 reads a one-item brace set as its item in a CSharpier override and an .editorconfig section", () => {
  const root = repo({
    "a/.csharpierrc.yaml": "overrides:\n  - files: \"*.{cs}\"\n    printWidth: 80\n",
    "a/Report.cs": csharp(90),
    ".editorconfig": "root = true\n\n[*.{cs}]\nmax_line_length = 120\n\n[V{1..3}.cs]\nmax_line_length = 80\n",
    "b/Report.cs": csharp(110),
    "b/V2.cs": csharp(90),
    "b/V4.cs": csharp(90),
  });
  assert.deepEqual(widths(findings(root)).sort(), ["a/Report.cs:3 80", "b/V2.cs:3 80"]);
});

test("TO-015 lets ** right inside a brace set match zero or more directories", () => {
  const root = repo({
    ".editorconfig": "root = true\n\n[*.cs]\nmax_line_length = 120\n\n[{**/Legacy/*.cs,x}]\nmax_line_length = 80\n",
    "Legacy/Old.cs": csharp(90),
    "src/Legacy/Old.cs": csharp(90),
    "src/New.cs": csharp(110),
  });
  assert.deepEqual(widths(findings(root)).sort(), ["Legacy/Old.cs:3 80", "src/Legacy/Old.cs:3 80"]);
});

test("TO-015 lets ** after a comma in a brace set match zero or more directories", () => {
  const root = repo({
    ".editorconfig": "root = true\n\n[*.cs]\nmax_line_length = 120\n\n[{x,**/Legacy/*.cs}]\nmax_line_length = 80\n",
    "Legacy/Old.cs": csharp(90),
    "src/Legacy/Old.cs": csharp(90),
    "src/New.cs": csharp(110),
  });
  assert.deepEqual(widths(findings(root)).sort(), ["Legacy/Old.cs:3 80", "src/Legacy/Old.cs:3 80"]);
});

test("TO-015 anchors an oxfmt override glob with a leading ./ at the config's directory", () => {
  const root = repo({
    "pkg/.oxfmtrc.json": JSON.stringify({ printWidth: 120, overrides: [{ files: ["./a.ts"], options: { printWidth: 80 } }] }),
    "pkg/a.ts": typescript(90),
    "pkg/sub/a.ts": typescript(90),
  });
  assert.deepEqual(widths(findings(root)), ["pkg/a.ts:1 80"]);
});

test("TO-015 takes the width from the last of several matching oxfmt overrides that set it", () => {
  const root = repo({
    ".oxfmtrc.json": JSON.stringify({ overrides: [
      { files: ["*.ts"], options: { printWidth: 80 } },
      { files: ["src/**"], options: { printWidth: 70 } },
    ] }),
    "src/a.ts": typescript(75),
  });
  assert.deepEqual(widths(findings(root)), ["src/a.ts:1 70"]);
});

// oxfmt 0.62 reads `**` inside a segment as `*` and `{1..3}` as the literal text `1..3`.
test("TO-015 reads an oxfmt ** inside a segment as * and a {n..m} range as literal text", () => {
  const root = repo({
    ".oxfmtrc.json": JSON.stringify({ printWidth: 120, overrides: [
      { files: ["src/**.ts"], options: { printWidth: 80 } },
      { files: ["V{1..3}.ts"], options: { printWidth: 80 } },
    ] }),
    "src/a.ts": typescript(90),
    "src/b/a.ts": typescript(90),
    "V1.ts": typescript(90),
    "V2.ts": typescript(90),
  });
  assert.deepEqual(widths(findings(root)), ["src/a.ts:1 80"]);
});

test("TO-015 trims the spaces inside an .editorconfig section header", () => {
  const root = repo({ ".editorconfig": "root = true\n\n[ *.cs ]\nmax_line_length = 120\n", "Report.cs": csharp(110), "Wide.cs": csharp(125) });
  assert.deepEqual(widths(findings(root)), ["Wide.cs:3 120"]);
});

test("TO-015 reads a JSON CSharpier config's keys case-insensitively", () => {
  const root = repo({
    "api/.csharpierrc.json": `{ "PrintWidth": 120, "Overrides": [{ "Files": "Legacy/*.cs", "PrintWidth": 80 }] }\n`,
    "api/Report.cs": csharp(110),
    "api/Legacy/Old.cs": csharp(90),
  });
  assert.deepEqual(widths(findings(root)), ["api/Legacy/Old.cs:3 80"]);
});

test("TO-015 gives a matching CSharpier override without printWidth the default width", () => {
  const root = repo({ "api/.csharpierrc.yaml": "printWidth: 120\noverrides:\n  - files: \"*.cs\"\n    formatter: csharp\n", "api/Report.cs": csharp(110) });
  assert.deepEqual(widths(findings(root)), ["api/Report.cs:3 100"]);
});

test("TO-015 anchors a CSharpier override or .editorconfig section glob with a leading / at its directory", () => {
  const root = repo({
    "api/.csharpierrc.yaml": "overrides:\n  - files: \"/Report.cs\"\n    printWidth: 80\n",
    "api/Report.cs": csharp(90),
    "api/sub/Report.cs": csharp(90),
    ".editorconfig": "root = true\n\n[/Top.cs]\nmax_line_length = 80\n",
    "Top.cs": csharp(90),
    "lib/Top.cs": csharp(90),
  });
  assert.deepEqual(widths(findings(root)).sort(), ["Top.cs:3 80", "api/Report.cs:3 80"]);
});

test("TO-015 stops the .editorconfig search at a child marked root", () => {
  const root = repo({ ".editorconfig": "[*.cs]\nmax_line_length = 80\n", "api/.editorconfig": "root = true\n\n[*.md]\nmax_line_length = 120\n", "api/Report.cs": csharp(105) });
  assert.deepEqual(widths(findings(root)), ["api/Report.cs:3 100"]);
});

test("TO-015 falls through a child .editorconfig with no matching section to its parent", () => {
  const root = repo({ ".editorconfig": "root = true\n\n[*.cs]\nmax_line_length = 120\n", "api/.editorconfig": "[*.md]\nmax_line_length = 80\n", "api/Report.cs": csharp(110), "api/Wide.cs": csharp(125) });
  assert.deepEqual(widths(findings(root)), ["api/Wide.cs:3 120"]);
});
