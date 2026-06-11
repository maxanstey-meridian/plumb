#!/usr/bin/env node
// MER-RV-025 — generated Rivet output is a workspace package (packages/contracts),
// not an in-app dir. Fork settled 2026-06-10: the package boundary makes
// read-only structural. v8 extension (contract §11.9): variant-aware — v2
// artifact dirs (openapi.json + schema.d.ts) are held to the same placement
// rule via the shared fingerprints, not path-name luck. One repo-level finding
// per offending dir.
// DOC: rivet.md#generated-output
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { detectRivetVariant } = await import(path.join(HERE, "_lib", "rivet-variant.mjs"));

const root = path.resolve(process.argv[2] || "");
if (!root || !fs.existsSync(root)) process.exit(2);

const { v1Dirs, v2Dirs } = detectRivetVariant(root);
for (const g of [...v1Dirs, ...v2Dirs]) {
  const r = path.relative(root, g);
  if (r.split(path.sep).includes("packages")) continue;
  console.log(`MER-RV-025\twarn\t${r}:0\tgenerated output lives in a workspace packages/contracts package, not inside the app — the package boundary makes read-only structural\trivet.md#generated-output`);
}
