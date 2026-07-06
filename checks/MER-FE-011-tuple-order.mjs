#!/usr/bin/env node
// MER-FE-011 — "The exported pair must be named injectX first and provideX second."
// DOC: frontend-pa-vsa.md#provide--inject-pattern
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";
const root = process.argv[2];
const re = /export const \[\s*(\w+)\s*,\s*(\w+)\s*\]\s*=\s*useProvideInject/g;
for (const f of walkFiles(root, root, { filter: (name) => name.endsWith(".ts") })) {
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
