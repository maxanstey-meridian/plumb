#!/usr/bin/env node
// MER-FE-032 — "Never cross; always Common": no imports from another page's subtree.
// Fix is always promotion to app/shared/. (Amendment 2026-06-10, FABLE_CONTRACT.md §9)
// DOC: frontend-pa-vsa.md#promotion
import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
const SKIP = new Set(["node_modules", ".git", ".nuxt", ".output", "dist", "generated"]);
function* walkDirs(d) {
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (!e.isDirectory() || SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.name === "pages" && path.basename(d) === "app") yield p;
    else yield* walkDirs(p);
  }
}
function* walkFiles(d) {
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walkFiles(p); }
    else if (/\.(ts|vue)$/.test(e.name)) yield p;
  }
}
const importRe = /(?:from\s+|import\s*\(\s*)["']([^"']+)["']/g;
for (const pagesDir of walkDirs(root)) {
  const appDir = path.dirname(pagesDir);
  const appRoot = path.dirname(appDir);
  for (const f of walkFiles(pagesDir)) {
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
