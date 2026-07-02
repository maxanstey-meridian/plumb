#!/usr/bin/env node
// MER-BE-007 — Common/Ports must not expose module-owned domain types. Shared
// ports own their signatures; module domain models stay inside their module.
// DOC: backend-pa-vsa.md#sharedcommon-rule
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const SKIP = new Set(["node_modules", ".git", "obj", "bin"]);
const typeRe = /(?:public|internal)\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+|readonly\s+)*(class|interface|record(?:\s+(?:class|struct))?|struct|enum)\s+([A-Za-z_]\w*)/g;

function* walk(d) {
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(p); }
    else yield p;
  }
}

function* backendRoots(d) {
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  const names = new Set(es.filter((e) => e.isDirectory()).map((e) => e.name));
  if (names.has("Modules") && names.has("Common")) { yield d; return; }
  for (const e of es) if (e.isDirectory() && !SKIP.has(e.name)) yield* backendRoots(path.join(d, e.name));
}

function declarations(src) {
  return new Set([...src.matchAll(typeRe)].map((m) => m[2]));
}

for (const be of backendRoots(root)) {
  const domainTypes = new Map();
  const modulesDir = path.join(be, "Modules");
  for (const f of walk(modulesDir)) {
    if (!f.endsWith(".cs")) continue;
    const relModule = path.relative(modulesDir, f).split(path.sep);
    if (relModule[1] !== "Domain") continue;
    const src = fs.readFileSync(f, "utf8");
    for (const typeName of declarations(src)) {
      if (!domainTypes.has(typeName)) domainTypes.set(typeName, { module: relModule[0], file: f });
    }
  }

  const portsDir = path.join(be, "Common", "Ports");
  if (!fs.existsSync(portsDir)) continue;
  for (const f of walk(portsDir)) {
    if (!f.endsWith(".cs")) continue;
    const src = fs.readFileSync(f, "utf8");
    const localTypes = declarations(src);
    const lines = src.split(/\r?\n/);
    for (const [typeName] of [...domainTypes].sort()) {
      if (localTypes.has(typeName)) continue;
      const re = new RegExp(`\\b${typeName}\\b`);
      const lineIndex = lines.findIndex((line) => re.test(line));
      if (lineIndex === -1) continue;
      const rel = path.relative(root, f);
      console.log(
        `MER-BE-007\terror\t${rel}:${lineIndex + 1}\tCommon port exposes module-owned domain type ${typeName} — inline a port DTO, move a truly shared value type to Common, or split the port\tbackend-pa-vsa.md#sharedcommon-rule`
      );
    }
  }
}
