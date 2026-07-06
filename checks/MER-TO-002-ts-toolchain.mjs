#!/usr/bin/env node
// MER-TO-002 — TS toolchain sanitation: oxlint + oxfmt configs present and each a
// SUPERSET of the golden base in configs/ (repos may extend, never contradict);
// competing formatter/linter stacks (.prettierrc*, biome.json) are findings.
// Golden superset semantics (contract §11.7): every golden key-path must exist in
// the repo config with the golden value; a golden scalar rule severity matches a
// repo [severity, options] tuple (earned by confer's no-unused-vars shape).
// Self-gates: repo must have a package.json AND .ts/.vue source outside
// node_modules/generated. eslint's Vue-only rule is MER-TO-005's territory.
// DOC: tools.md#linting-and-formatting
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";
import { fileURLToPath } from "node:url";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);
const GOLD = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "configs");

let hasPkg = false, hasTs = false;
const found = { ox: [], fmt: [], competing: [] };
for (const f of walkFiles(root, root, { filter: () => true, depth: 8 })) {
  const b = path.basename(f);
  if (b === "package.json") hasPkg = true;
  if (/\.(ts|vue)$/.test(b) && !b.endsWith(".d.ts")) hasTs = true;
  if (b === ".oxlintrc.json") found.ox.push(f);
  if (b === ".oxfmtrc.json") found.fmt.push(f);
  if (/^\.prettierrc(\..*)?$/.test(b) || b === "biome.json") found.competing.push(f);
}
if (!hasPkg || !hasTs) process.exit(0);

const rel = (f) => path.relative(root, f);
const out = (loc, msg) =>
  console.log(`MER-TO-002\twarn\t${loc}\t${msg}\ttools.md#linting-and-formatting`);

// golden value ⊆ repo value
function covers(golden, actual) {
  if (Array.isArray(golden)) return Array.isArray(actual) && JSON.stringify(golden) === JSON.stringify(actual);
  if (golden && typeof golden === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(golden).every(([k, v]) => k in actual && covers(v, actual[k]));
  }
  // scalar golden: equal, or repo uses the [severity, options] tuple form
  return golden === actual || (Array.isArray(actual) && actual[0] === golden);
}

function missingPaths(golden, actual, prefix = "") {
  const out = [];
  for (const [k, v] of Object.entries(golden)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (!actual || typeof actual !== "object" || !(k in actual)) { out.push(p); continue; }
    if (v && typeof v === "object" && !Array.isArray(v) && actual[k] && typeof actual[k] === "object" && !Array.isArray(actual[k])) {
      out.push(...missingPaths(v, actual[k], p));
    } else if (!covers(v, actual[k])) out.push(p);
  }
  return out;
}

for (const [kind, file, goldFile] of [["oxlint", ".oxlintrc.json", "oxlintrc.json"], ["oxfmt", ".oxfmtrc.json", "oxfmtrc.json"]]) {
  const golden = JSON.parse(fs.readFileSync(path.join(GOLD, goldFile), "utf8"));
  const configs = kind === "oxlint" ? found.ox : found.fmt;
  if (!configs.length) {
    out(`${file}:0`, `no ${file} found — TS repos carry the ${kind} base config (golden: ~/Sites/plumb/configs/${goldFile})`);
    continue;
  }
  for (const c of configs) {
    let cfg;
    try { cfg = JSON.parse(fs.readFileSync(c, "utf8")); }
    catch { out(`${rel(c)}:1`, `unparseable JSON — cannot verify against the golden base`); continue; }
    for (const p of missingPaths(golden, cfg))
      out(`${rel(c)}:1`, `missing or diverging from golden base: "${p}" — repos extend the base, never contradict it`);
  }
}

for (const c of found.competing)
  out(`${rel(c)}:0`, `competing formatter/linter config — the stack is oxlint + oxfmt (eslint only as the Vue layer)`);
