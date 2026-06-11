#!/usr/bin/env node
// MER-FE-004 — layer import ordering: logic ← ports ← adapters ← composables ← pages.
// "logic imports nothing framework; ports import only types + the provide/inject
// helper; adapters import only logic/ports; components never import adapters."
// Graph built by dependency-cruiser + .vue extraction (_lib/fe-graph.mjs).
// Encoded exception: ports may import the useProvideInject helper even when it
// lives under composables/ (that IS the doctrine's wiring helper).
// DOC: frontend-pa-vsa.md#dependency-rule
import path from "node:path";
import { findFeRoots, buildGraph, layerOf } from "./_lib/fe-graph.mjs";

const root = process.argv[2];
const FORBIDDEN = {
  logic: new Set(["ports", "adapters", "composables", "components"]),
  ports: new Set(["adapters", "composables", "components"]),
  adapters: new Set(["composables", "components"]),
  components: new Set(["adapters"]),
};
const HELPER = /use-?provide-?inject/i;

for (const feRoot of findFeRoots(root)) {
  const g = await buildGraph(feRoot);
  if (!g) continue;
  for (const { from, to, line } of g.edges) {
    const fl = layerOf(from, g.appDir);
    const tl = layerOf(to, g.appDir);
    if (!fl || !tl || !FORBIDDEN[fl]?.has(tl)) continue;
    if (fl === "ports" && HELPER.test(path.basename(to))) continue;
    console.log(
      `MER-FE-004\terror\t${path.relative(root, from)}:${line}\t${fl}/ must not import from ${tl}/ (${path.relative(g.appDir, to)}) — layer order is logic ← ports ← adapters ← composables ← pages\tfrontend-pa-vsa.md#dependency-rule`
    );
  }
}
