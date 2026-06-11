#!/usr/bin/env node
// MER-RV-024 — generated Rivet output is stale relative to its *Contract.cs
// sources: re-run the repo's own generation task and diff against the
// checked-in output. CI-tier (contract §5): self-gates on PLUMB_CI=1 because
// it invokes the repo's toolchain (dotnet build + rivet) — never runs in the
// default local pass. The convention is the repo's own Taskfile: the task
// whose command matches `rivet ... --output <dir>` is the generator, and the
// resolved output path comes from `task --dry`. No Taskfile/no rivet task →
// no convention → silence. The output dir is snapshotted before regeneration
// and restored byte-for-byte afterward, so the working tree is never changed.
// DOC: rivet.md#practical-rules
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.env.PLUMB_CI !== "1") process.exit(0);

const root = path.resolve(process.argv[2]);
const taskfile = ["Taskfile.yml", "Taskfile.yaml"].map((n) => path.join(root, n)).find((p) => fs.existsSync(p));
if (!taskfile) process.exit(0);

// find the task whose commands mention rivet with an --output — minimal
// indentation scan, not a YAML parser (task names sit two spaces under tasks:)
const lines = fs.readFileSync(taskfile, "utf8").split("\n");
let inTasks = false, current = null, genTask = null;
for (const l of lines) {
  if (/^tasks:\s*$/.test(l)) { inTasks = true; continue; }
  if (inTasks && /^\S/.test(l)) inTasks = false;
  if (!inTasks) continue;
  const m = l.match(/^  ([\w.:-]+):\s*$/);
  if (m) current = m[1];
  else if (current && /\brivet\b/.test(l) && /--output\b/.test(l)) { genTask = current; break; }
}
if (!genTask) process.exit(0);

if (spawnSync("task", ["--version"], { encoding: "utf8" }).error) {
  process.stderr.write("MER-RV-024: task (go-task) not on PATH — skipping\n");
  process.exit(0);
}

const dry = spawnSync("task", ["--dry", genTask], { cwd: root, encoding: "utf8" });
const om = `${dry.stdout || ""}\n${dry.stderr || ""}`.match(/--output\s+(\S+)/);
if (!om) { process.stderr.write(`MER-RV-024: could not resolve --output for task ${genTask} — skipping\n`); process.exit(0); }
const outDir = path.resolve(root, om[1]);
const outRel = path.relative(root, outDir);
if (!fs.existsSync(outDir)) { process.stderr.write(`MER-RV-024: output dir ${outRel} does not exist — skipping\n`); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-rv024-"));
const snap = path.join(tmp, "snapshot");
fs.cpSync(outDir, snap, { recursive: true });
try {
  const gen = spawnSync("task", [genTask], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  if (gen.status !== 0) {
    process.stderr.write(`MER-RV-024: task ${genTask} failed (${gen.status}) — skipping\n${(gen.stderr || "").slice(-500)}\n`);
  } else {
    const diff = spawnSync("diff", ["-rq", snap, outDir], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
    if (diff.status === 1) {
      const n = (diff.stdout || "").split("\n").filter(Boolean).length;
      console.log(
        `MER-RV-024\tinfo\t${outRel}:0\tgenerated Rivet output is stale (${n} file(s) differ after re-running task ${genTask}) — regenerate and commit\trivet.md#practical-rules`
      );
    }
  }
} finally {
  // restore the checked-in state byte-for-byte, whatever regeneration did
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.cpSync(snap, outDir, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });
}
