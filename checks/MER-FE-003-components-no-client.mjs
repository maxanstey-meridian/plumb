#!/usr/bin/env node
// MER-FE-003 — "components should not call generated clients directly"
// Variant-neutral (contract §5 v8): carries specifier patterns for BOTH Rivet
// generations. v1: path-shaped specs (generated/rivet/client, */contracts/client).
// v2: the bare workspace contracts-package import (e.g. @golden/contracts) — the
// package NAME is derived from the package.json nearest each detected artifact
// dir (checks/_lib/rivet-variant.mjs), never hardcoded.
// `import type`-only lines are exempt — a component importing a DTO type is not
// calling a client.
// DOC: frontend-pa-vsa.md#components
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";
import { detectRivetVariant } from "./_lib/rivet-variant.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const { contractsPackages } = detectRivetVariant(root);
const V1_SPEC = /(generated\/rivet\/client|contracts\/client)/;
const isClientSpec = (spec) =>
  V1_SPEC.test(spec) || contractsPackages.some((p) => spec === p || spec.startsWith(p + "/"));

// import/export ... from "spec" on one line; `import type { ... }` is exempt
const IMPORT = /^\s*(import|export)\s+(type\s+)?[^'"]*?from\s*["']([^"']+)["']/;

for (const f of walkFiles(path.resolve(root), path.resolve(root), { filter: (name) => /\.(ts|vue)$/.test(name), extraSkipDirs: ["__tests__"] })) {
  if (!/\.(ts|vue)$/.test(f) || /\.(spec|test)\./.test(f)) continue;
  if (!f.split(path.sep).includes("components")) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(IMPORT);
    if (!m || m[2] || !isClientSpec(m[3])) continue;
    console.log(`MER-FE-003\terror\t${path.relative(root, f)}:${i + 1}\tcomponents must not import generated Rivet clients — inject a port or move the call to a composable\tfrontend-pa-vsa.md#components`);
  }
}
