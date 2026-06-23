#!/usr/bin/env node
// MER-FE-021 — components importing implementation composables (use*).
// "Components should normally import injectX from ports/, not concrete
// implementation composables." If a matching injectX capability exists, use it;
// if none exists, model the capability in ports/ and provide it from the root.
// Encoded exception: the useProvideInject helper itself.
// DOC: frontend-pa-vsa.md#components
import fs from "node:fs";
import path from "node:path";
import { findFeRoots, buildGraph, layerOf, walkFiles } from "./_lib/fe-graph.mjs";

const root = process.argv[2];

function capabilityOf(file) {
  // use-rivet-auth.ts / useRivetAuth.ts -> "RivetAuth"
  const base = path.basename(file).replace(/\.(ts|js|mjs|vue)$/, "");
  if (!/^use[-A-Z]/.test(base)) return null;
  return base
    .replace(/^use-?/, "")
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function injectCaps(dir) {
  const caps = new Set();
  for (const f of walkFiles(dir, /\.ts$/)) {
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(/\binject([A-Z]\w*)/g)) caps.add(m[1]);
  }
  return caps;
}

for (const feRoot of findFeRoots(root)) {
  const g = await buildGraph(feRoot);
  if (!g) continue;
  const sharedCaps = injectCaps(path.join(g.appDir, "shared", "ports"));
  const subtreeCapsCache = new Map();
  for (const { from, to, line } of g.edges) {
    if (layerOf(from, g.appDir) !== "components" || layerOf(to, g.appDir) !== "composables") continue;
    const cap = capabilityOf(to);
    if (!cap || /^provideinject$/i.test(cap)) continue;
    // ports/ dirs on the path from the component up to app/
    const caps = new Set(sharedCaps);
    let d = path.dirname(from);
    while (d.startsWith(g.appDir)) {
      if (!subtreeCapsCache.has(d)) subtreeCapsCache.set(d, injectCaps(path.join(d, "ports")));
      for (const c of subtreeCapsCache.get(d)) caps.add(c);
      d = path.dirname(d);
    }
    const hit = [...caps].find((c) => cap === c || cap.endsWith(c));
    const message = hit
      ? `component imports implementation composable ${path.basename(to)} but a port exists (inject${hit}) — inject the port instead`
      : `component imports implementation composable ${path.basename(to)} with no port capability — model the capability in ports/ and provide it from the page root`;
    console.log(
      `MER-FE-021\twarn\t${path.relative(root, from)}:${line}\t${message}\tfrontend-pa-vsa.md#components`
    );
  }
}
