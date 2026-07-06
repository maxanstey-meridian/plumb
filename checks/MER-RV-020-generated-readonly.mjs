#!/usr/bin/env node
// MER-RV-020 — generated output is read-only (contract §11.9 v8 extension:
// variant-aware, replaces the v1-only .sh).
//   v1 dirs: every non-.d.ts .ts file carries the generated header (compiled
//            artifacts build/dist/*.d.ts excluded — calibration 2026-06-10).
//   v2 dirs: the artifact dir contains ONLY openapi.json, api.contract.json +
//            schema.d.ts (the hand-written facade lives in src/, golden's exemplar
//            shape) and schema.d.ts carries the openapi-typescript header. Any other file
//            inside a v2 artifact dir is a hand-written file in generated
//            output — the same sin the v1 header rule catches.
// DOC: coding-philosophy.md#generated-code
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { walkFiles } from "./_lib/fs-scan.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { detectRivetVariant } = await import(path.join(HERE, "_lib", "rivet-variant.mjs"));

const root = path.resolve(process.argv[2] || "");
if (!root || !fs.existsSync(root)) process.exit(2);

const out = (loc, msg) =>
  console.log(`MER-RV-020\terror\t${loc}:1\t${msg}\tcoding-philosophy.md#generated-code`);
const rel = (f) => path.relative(root, f);
const hasGenHeader = (f) => {
  try {
    return /generated|do not edit/i.test(fs.readFileSync(f, "utf8").split("\n").slice(0, 5).join("\n"));
  } catch { return false; }
};

const { v1Dirs, v2Dirs } = detectRivetVariant(root);

for (const g of v1Dirs) {
  for (const f of walkFiles(g, g, { filter: () => true })) {
    if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue;
    if (/[\/\\](build|dist)[\/\\]/.test(f)) continue;
    if (!hasGenHeader(f))
      out(rel(f), "hand-written or header-stripped file inside generated output — generated dirs are read-only");
  }
}

const V2_EXPECTED = new Set(["openapi.json", "schema.d.ts", "api.contract.json"]);
for (const g of v2Dirs) {
  for (const f of walkFiles(g, g, { filter: () => true })) {
    const b = path.basename(f);
    if (!V2_EXPECTED.has(b)) {
      out(rel(f), "hand-written file inside the v2 artifact dir — only openapi.json, api.contract.json + schema.d.ts belong here; the facade lives in src/");
    } else if (b === "schema.d.ts" && !hasGenHeader(f)) {
      out(rel(f), "schema.d.ts is missing its openapi-typescript header — generated artifacts are read-only, regenerate via the repo's task");
    }
  }
}
