#!/usr/bin/env node
// MER-RV-026 — supported-Rivet-version tripwire (contract §11.9, v8).
// The RV pack declares what its rules were written against; this check compares
// that self-declaration with what the repo declares (Rivet.Attributes
// PackageReference in *.csproj, rivet-ts in package.json dependency blocks) and
// with the artifact fingerprint (checks/_lib/rivet-variant.mjs). Emits:
//   (a) info — declared version NEWER than the supported max: findings may be stale.
//   (b) warn — artifact-fingerprint generation and a declared version's
//       generation disagree (e.g. v2 artifacts + v1-era Rivet.Attributes —
//       golden's state until the package bump).
// Unparseable version specs (*, file:, workspace:, link:, ranges) are unknown —
// no finding, per §7 precision.
// CONTRACT POLICY: SUPPORTED_RIVET MUST be bumped — with a FABLE_CONTRACT.md
// amendment — whenever RV/FE rules are revised for a new Rivet release. A stale
// constant makes this tripwire lie.
// DOC: rivet.md#generated-output
import fs from "node:fs";
import path from "node:path";
import { detectRivetVariant } from "./_lib/rivet-variant.mjs";

// Generation cutoff: Rivet.Attributes >= 0.35.0 / rivet-ts >= 0.11.0 declare the
// v2 generation (the v2 branches sit at 0.34.3/0.10.0 pre-release; bumping past
// the cutoff is the release act). Supported max = the newest release line the
// current RV/FE rules were written against.
const SUPPORTED_RIVET = {
  dotnetMax: [0, 35], // rules support Rivet.Attributes <= 0.35.x
  tsMax: [0, 11], // rules support rivet-ts <= 0.11.x
  v2DotnetMin: [0, 35, 0],
  v2TsMin: [0, 11, 0],
};

const root = path.resolve(process.argv[2] || "");
if (!root || !fs.existsSync(root)) process.exit(2);

const SKIP = new Set(["node_modules", ".git", ".nuxt", ".output", "dist", "build", "obj", "bin"]);
function* walk(d, depth = 14) {
  if (depth < 0) return;
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(p, depth - 1); }
    else yield p;
  }
}

const parseVer = (s) => {
  const m = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec((s || "").trim().replace(/^[\^~]/, ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
};
const cmp = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};
const gen = (v, v2Min) => (cmp(v, v2Min) >= 0 ? "v2" : "v1");

// declared versions: [{ file, line, raw, ver, kind: "dotnet"|"ts" }]
const declared = [];
for (const f of walk(root)) {
  const b = path.basename(f);
  if (b.endsWith(".csproj")) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/Include="Rivet\.Attributes"[^>]*Version="([^"]+)"/);
      if (m) declared.push({ file: f, line: i + 1, raw: m[1], ver: parseVer(m[1]), kind: "dotnet" });
    }
  } else if (b === "package.json") {
    try {
      const pj = JSON.parse(fs.readFileSync(f, "utf8"));
      for (const block of ["dependencies", "devDependencies"]) {
        const raw = pj[block]?.["rivet-ts"];
        if (raw) declared.push({ file: f, line: 0, raw, ver: parseVer(raw), kind: "ts" });
      }
    } catch {}
  }
}

const variant = detectRivetVariant(root).variant;
const ref = "rivet.md#generated-output";
for (const d of declared) {
  if (!d.ver) continue; // unknown spec (*, file:, workspace:) — no finding
  const rel = `${path.relative(root, d.file)}:${d.line}`;
  const max = d.kind === "dotnet" ? SUPPORTED_RIVET.dotnetMax : SUPPORTED_RIVET.tsMax;
  const v2Min = d.kind === "dotnet" ? SUPPORTED_RIVET.v2DotnetMin : SUPPORTED_RIVET.v2TsMin;
  const name = d.kind === "dotnet" ? "Rivet.Attributes" : "rivet-ts";
  if (cmp(d.ver, [...max, Infinity]) > 0) {
    console.log(`MER-RV-026\tinfo\t${rel}\tRV pack written against ${name} <= ${max.join(".")}.x; repo declares ${d.raw} — findings may be stale; revise the RV/FE rules and bump SUPPORTED_RIVET\t${ref}`);
  }
  const dGen = gen(d.ver, v2Min);
  if ((variant === "v1" || variant === "v2") && dGen !== variant) {
    console.log(`MER-RV-026\twarn\t${rel}\tgenerated artifacts are Rivet ${variant} but ${name} ${d.raw} is ${dGen}-generation — regenerate or bump the package so artifacts and declared version agree\t${ref}`);
  }
}
