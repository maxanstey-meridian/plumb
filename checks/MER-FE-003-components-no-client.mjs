#!/usr/bin/env node
// MER-FE-003 — "components should not call generated clients directly"
// A client import is the bare workspace contracts-package import (e.g. @golden/contracts) — the
// package NAME is derived from the package.json nearest each detected artifact
// dir (lib/rivet-context.mjs), never hardcoded.
// `import type`-only lines are exempt — a component importing a DTO type is not
// calling a client.
// DOC: rules/frontend/call-the-generated-client-in-the-implementing-composable.md
import fs from "node:fs";
import path from "node:path";
import { createManifestRepositoryView, walkFiles } from "./_lib/fs-scan.mjs";
import { detectRivetContext } from "../lib/rivet-context.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const { contractsPackages } = detectRivetContext(createManifestRepositoryView(root));
const isClientSpec = (spec) => contractsPackages.some((p) => spec === p || spec.startsWith(p + "/"));

// import/export ... from "spec" on one line; `import type { ... }` is exempt
const IMPORT = /^\s*(import|export)\s+(type\s+)?[^'"]*?from\s*["']([^"']+)["']/;

for (const f of walkFiles(path.resolve(root), path.resolve(root), { filter: (name) => /\.(ts|vue)$/.test(name), extraSkipDirs: ["__tests__"] })) {
  if (!/\.(ts|vue)$/.test(f) || /\.(spec|test)\./.test(f)) continue;
  if (!f.split(path.sep).includes("components")) continue;
  const lines = fs.readFileSync(f, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(IMPORT);
    if (!m || m[2] || !isClientSpec(m[3])) continue;
    console.log(`MER-FE-003\terror\t${path.relative(root, f)}:${i + 1}\tcomponents must not import generated Rivet clients — inject a port or move the call to a composable\trules/frontend/call-the-generated-client-in-the-implementing-composable.md`);
  }
}
