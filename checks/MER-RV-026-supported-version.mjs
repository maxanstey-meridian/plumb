#!/usr/bin/env node
// MER-RV-026 — Rivet v1 detector. Rivet v2 (Rivet.Attributes >= 0.35.0 / rivet-ts >= 0.11.0)
// generates an openapi.json + openapi-typescript schema; v1 generated a bespoke TS client.
// A repo still declaring a v1-era Rivet should migrate to the v2 (openapi-typescript)
// generation. Anything at or above the v2 floor is supported — minor bumps within v2 are
// never a finding. Declared versions read from Rivet.Attributes (*.csproj) and rivet-ts
// (package.json dependency blocks); unparseable specs (*, file:, workspace:, ranges) are
// unknown and produce no finding (§7 precision).
// CONTRACT: §11.9 — redefined (was a supported-version ceiling + artifact-mismatch
// tripwire; now a single v1-usage detector keyed to the v2 generation floor).
// DOC: rivet.md#generated-output
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";

// The v1/v2 generation boundary: v2 starts here. Anything below is v1-era → migrate.
const V2_MIN = { dotnet: [0, 35, 0], ts: [0, 11, 0] };

const root = path.resolve(process.argv[2] || "");
if (!root || !fs.existsSync(root)) process.exit(2);

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
const isV1 = (ver, floor) => ver && cmp(ver, floor) < 0;
const ref = "rivet.md#generated-output";

for (const f of walkFiles(root, root, { filter: () => true, depth: 14 })) {
  const b = path.basename(f);
  if (b.endsWith(".csproj")) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/Include="Rivet\.Attributes"[^>]*Version="([^"]+)"/);
      if (m && isV1(parseVer(m[1]), V2_MIN.dotnet)) {
        console.log(`MER-RV-026\twarn\t${path.relative(root, f)}:${i + 1}\tRivet.Attributes ${m[1]} is v1 — migrate to the Rivet v2 generation (>= 0.35.0, openapi-typescript)\t${ref}`);
      }
    }
  } else if (b === "package.json") {
    let pj;
    try { pj = JSON.parse(fs.readFileSync(f, "utf8")); } catch { continue; }
    for (const block of ["dependencies", "devDependencies"]) {
      const raw = pj[block]?.["rivet-ts"];
      if (raw && isV1(parseVer(raw), V2_MIN.ts)) {
        console.log(`MER-RV-026\twarn\t${path.relative(root, f)}:0\trivet-ts ${raw} is v1 — migrate to the Rivet v2 generation (>= 0.11.0, openapi-typescript)\t${ref}`);
      }
    }
  }
}
