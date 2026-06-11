#!/usr/bin/env node
// MER-FE-031 — items in app/shared/ must have consumers in ≥2 composition-root
// subtrees; single-consumer shared code was promoted prematurely.
// MER-FE-022 — same signal for app/shared/composables/: a composable consumed by
// exactly one root belongs at that composition root, not in shared/.
// One analysis pass, two sibling IDs (FABLE_CONTRACT.md §4).
// Encoded exceptions: zero-consumer shared files are NOT flagged — Nuxt
// auto-imports mean "no import statement" does not prove "no consumer". The
// useProvideInject helper is exempt: it is doctrine infrastructure, not a
// prematurely promoted capability (earned by fixtures/MER-FE-004/good).
// DOC: frontend-pa-vsa.md#promotion · coding-philosophy.md#local-before-shared
import path from "node:path";
import { findFeRoots, buildGraph, subtreeOf } from "./_lib/fe-graph.mjs";

const root = process.argv[2];

for (const feRoot of findFeRoots(root)) {
  const g = await buildGraph(feRoot);
  if (!g) continue;
  const shared = path.join(g.appDir, "shared") + path.sep;
  const consumers = new Map(); // shared file -> Set<subtree key>
  for (const { from, to } of g.edges) {
    if (!to.startsWith(shared) || from.startsWith(shared)) continue;
    if (!consumers.has(to)) consumers.set(to, new Set());
    consumers.get(to).add(subtreeOf(from, g.appDir));
  }
  for (const [file, keys] of [...consumers].sort()) {
    if (keys.size !== 1 || /use-?provide-?inject/i.test(path.basename(file))) continue;
    const only = [...keys][0];
    const rel = path.relative(root, file);
    if (file.startsWith(path.join(g.appDir, "shared", "composables") + path.sep)) {
      console.log(
        `MER-FE-022\twarn\t${rel}:0\tshared composable is consumed only by ${only} — composables live at their composition root; move it into that subtree\tfrontend-pa-vsa.md#promotion`
      );
    } else {
      console.log(
        `MER-FE-031\twarn\t${rel}:0\tonly one subtree (${only}) consumes this shared item — promoted prematurely; move it local to ${only}\tfrontend-pa-vsa.md#promotion`
      );
    }
  }
}
