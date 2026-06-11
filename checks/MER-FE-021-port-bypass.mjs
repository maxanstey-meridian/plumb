#!/usr/bin/env node
// MER-FE-021 — components importing implementation composables (use*) WHEN a port
// for the same capability exists in the page subtree's ports/ or app/shared/ports.
// "Components should normally import injectX from ports/, not concrete
// implementation composables." The qualifier is required — component-local
// composables with no port are legitimate, so we only flag when the composable
// name ends with an existing injectX capability (useRivetAuth vs injectAuth).
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
    if (hit) {
      console.log(
        `MER-FE-021\twarn\t${path.relative(root, from)}:${line}\tcomponent imports implementation composable ${path.basename(to)} but a port exists (inject${hit}) — inject the port instead\tfrontend-pa-vsa.md#components`
      );
    }
  }
}
