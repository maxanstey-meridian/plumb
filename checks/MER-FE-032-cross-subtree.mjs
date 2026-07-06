#!/usr/bin/env node
// MER-FE-032 — "Never cross; always Common": no imports from another page's subtree.
// Fix is always promotion to app/shared/. (Amendment 2026-06-10, FABLE_CONTRACT.md §9)
// DOC: frontend-pa-vsa.md#promotion
import fs from "node:fs";
import path from "node:path";
import { walkDirs, walkFiles } from "./_lib/fs-scan.mjs";
const root = process.argv[2];
const importRe = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
for (const pagesDir of walkDirs(root, root, { filter: (name, p) => name === "pages" && path.basename(path.dirname(p)) === "app" })) {
  const appDir = path.dirname(pagesDir);
  const appRoot = path.dirname(appDir);
  for (const f of walkFiles(root, pagesDir, { filter: (name) => /\.(ts|vue)$/.test(name) })) {
    const relToPages = path.relative(pagesDir, f);
    const ownSubtree = relToPages.includes(path.sep)
      ? relToPages.split(path.sep)[0]
      : relToPages.replace(/\.(vue|ts)$/, "");
    const src = fs.readFileSync(f, "utf8");
    let m;
    while ((m = importRe.exec(src))) {
      const spec = m[1];
      let resolved = null;
      if (spec.startsWith(".")) resolved = path.resolve(path.dirname(f), spec);
      else if (spec.startsWith("~/") || spec.startsWith("@/")) resolved = path.join(appDir, spec.slice(2));
      else if (spec.startsWith("~~/") || spec.startsWith("@@/")) resolved = path.join(appRoot, spec.slice(3));
      if (!resolved || !resolved.startsWith(pagesDir + path.sep)) continue;
      const target = path.relative(pagesDir, resolved).split(path.sep)[0].replace(/\.(vue|ts)$/, "");
      if (target !== ownSubtree && target !== "") {
        const line = src.slice(0, m.index).split("\n").length;
        console.log(`MER-FE-032\terror\t${path.relative(root, f)}:${line}\tnever cross page subtrees (${ownSubtree} → ${target}) — promote the shared code to app/shared/\tfrontend-pa-vsa.md#promotion`);
      }
    }
  }
}
