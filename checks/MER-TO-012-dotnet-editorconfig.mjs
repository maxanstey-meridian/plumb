#!/usr/bin/env node
// MER-TO-012 — .editorconfig is the .NET style/analyzer authority: csproj repos
// carry one containing every golden section/key=value (configs/editorconfig.dotnet
// — the canonical file, byte-identical in casebridge api + speechscribe when
// crowned 2026-06-10), and analyzers are enabled (EnforceCodeStyleInBuild or
// AnalysisLevel in a csproj or Directory.Build.props). Repos may add lines;
// golden lines must be present with golden values.
// DOC: tools.md#formatting-and-analyzers
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);
const GOLD = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "configs", "editorconfig.dotnet");

const SKIP = new Set(["node_modules", ".git", "obj", "bin", ".nuxt", "dist", ".output"]);
function* walk(d, depth = 8) {
  if (depth < 0) return;
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(p, depth - 1); }
    else yield p;
  }
}

const csprojs = [], editorconfigs = [], propsAndProjects = [];
for (const f of walk(root)) {
  const b = path.basename(f);
  if (b.endsWith(".csproj") || b === "Directory.Build.props") propsAndProjects.push(f);
  if (b.endsWith(".csproj")) csprojs.push(f);
  if (b === ".editorconfig") editorconfigs.push(f);
}
if (!csprojs.length) process.exit(0);

const out = (loc, msg) =>
  console.log(`MER-TO-012\twarn\t${loc}\t${msg}\ttools.md#formatting-and-analyzers`);

// section -> Map(key -> value), comments and blanks dropped
function parseIni(src) {
  const sections = new Map();
  let cur = "";
  sections.set(cur, new Map());
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const sec = line.match(/^\[(.+)\]$/);
    if (sec) { cur = sec[1]; if (!sections.has(cur)) sections.set(cur, new Map()); continue; }
    const eq = line.indexOf("=");
    if (eq > 0) sections.get(cur).set(line.slice(0, eq).trim(), line.slice(eq + 1).trim());
  }
  return sections;
}

const golden = parseIni(fs.readFileSync(GOLD, "utf8"));

// §7 exception (calibration 2026-06-10, reel): a repo value that only TIGHTENS the
// golden severity is compliant — error > warning > suggestion > silent/none.
// Handles both pure severities ("warning") and suffixed values ("file_scoped:warning").
const RANK = { error: 3, warning: 2, suggestion: 1, silent: 0, none: 0 };
function tightens(repoVal, goldVal) {
  const split = (v) => {
    if (v in RANK) return ["", v];
    const m = v.match(/^(.*):(error|warning|suggestion|silent|none)$/);
    return m ? [m[1], m[2]] : null;
  };
  const r = split(repoVal), g = split(goldVal);
  return r && g && r[0] === g[0] && RANK[r[1]] >= RANK[g[1]];
}

if (!editorconfigs.length) {
  out(".editorconfig:0", "no .editorconfig in a .NET repo — it is the style/analyzer authority (golden: ~/.meridian/plumb/configs/editorconfig.dotnet)");
} else {
  // the .editorconfig nearest the csproj tree must satisfy the golden; check each
  // found file and report the best (fewest gaps) to avoid duplicate noise
  let best = null;
  for (const ec of editorconfigs) {
    const repo = parseIni(fs.readFileSync(ec, "utf8"));
    const gaps = [];
    for (const [sec, kvs] of golden) {
      const repoSec = repo.get(sec);
      for (const [k, v] of kvs) {
        if (!repoSec || !repoSec.has(k)) gaps.push(`[${sec}] ${k}`);
        else if (repoSec.get(k) !== v && !tightens(repoSec.get(k), v)) gaps.push(`[${sec}] ${k} = ${repoSec.get(k)} (golden: ${v})`);
      }
    }
    if (!best || gaps.length < best.gaps.length) best = { ec, gaps };
  }
  for (const g of best.gaps.slice(0, 20))
    out(`${path.relative(root, best.ec)}:1`, `missing or diverging from the golden .editorconfig: ${g}`);
  if (best.gaps.length > 20)
    out(`${path.relative(root, best.ec)}:1`, `…and ${best.gaps.length - 20} more golden .editorconfig lines missing`);
}

const analyzersOn = propsAndProjects.some((f) => {
  try { return /EnforceCodeStyleInBuild|AnalysisLevel/.test(fs.readFileSync(f, "utf8")); } catch { return false; }
});
if (!analyzersOn)
  out(`${path.relative(root, csprojs[0])}:1`, "analyzers not enabled — set EnforceCodeStyleInBuild (or AnalysisLevel) in the csproj or Directory.Build.props");
