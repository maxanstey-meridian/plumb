#!/usr/bin/env node
// MER-FE-011 — "The exported pair must be named injectX first and provideX second."
// DOC: frontend-pa-vsa.md#provide--inject-pattern
import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
const SKIP = new Set(["node_modules", ".git", ".nuxt", ".output", "dist", "obj", "bin", "generated"]);
function* walk(d) {
  let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(path.join(d, e.name)); }
    else if (e.name.endsWith(".ts")) yield path.join(d, e.name);
  }
}
const re = /export const \[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*useProvideInject/g;
for (const f of walk(root)) {
  const src = fs.readFileSync(f, "utf8");
  let m;
  while ((m = re.exec(src))) {
    const [, a, b] = m;
    if (!/^inject[A-Z]/.test(a) || !/^provide[A-Z]/.test(b)) {
      const line = src.slice(0, m.index).split("\n").length;
      console.log(`MER-FE-011\terror\t${path.relative(root, f)}:${line}\tprovide/inject tuple must be [injectX, provideX] — got [${a}, ${b}]\tfrontend-pa-vsa.md#provide--inject-pattern`);
    }
  }
}
