#!/usr/bin/env node
// MER-BE-003/004/005 — "Never cross; always Common" (FABLE_CONTRACT.md §9):
// module-owned namespaces must not escape the owner module. Cross-module ports
// live in Common/Ports only; sibling Application/Ports are module-local.
// DOC: backend-pa-vsa.md#across-modules
import fs from "node:fs";
import path from "node:path";
import { walkDirs, walkFiles } from "./_lib/fs-scan.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

function* backendRoots(d) {
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  const names = new Set(es.filter((e) => e.isDirectory()).map((e) => e.name));
  if (names.has("Modules") && names.has("Common")) yield d;
  for (const be of walkDirs(d, d, { filter: () => true })) {
    let es;
    try { es = fs.readdirSync(be, { withFileTypes: true }); } catch { continue; }
    const names = new Set(es.filter((e) => e.isDirectory()).map((e) => e.name));
    if (names.has("Modules") && names.has("Common")) yield be;
  }
}

function ownerModule(be, file) {
  const parts = path.relative(be, file).split(path.sep);
  return parts[0] === "Modules" && parts[1] ? parts[1] : null;
}

function isCommonFile(be, file) {
  return path.relative(be, file).split(path.sep)[0] === "Common";
}

function findingId(segment) {
  if (segment === "Domain") return "MER-BE-003";
  if (segment === "Infrastructure") return "MER-BE-004";
  return "MER-BE-005";
}

function message(id, owner, target) {
  if (id === "MER-BE-003") {
    return `module ${owner} must not use ${target}.Domain — never cross; always Common`;
  }
  if (id === "MER-BE-004") {
    return `module ${owner} must not use ${target}.Infrastructure — never cross; always Common`;
  }
  return `module-local Application/Ports escaped owner module — move cross-module port to Common/Ports or keep usage inside the owner module`;
}

function scanLine(line) {
  const hits = [];
  const usingMatch = line.match(/^\s*(global\s+)?using\s+(?:static\s+)?(?:[A-Za-z_]\w*\s*=\s*)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\.Modules\.([A-Za-z_]\w*)\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*))/);
  if (usingMatch) return [{ target: usingMatch[3], segment: usingMatch[4].split(".")[0], nsTail: usingMatch[4], kind: "using", global: Boolean(usingMatch[1]) }];

  const fqnRe = /\bModules\.([A-Za-z_]\w*)\.(Domain|Infrastructure|Application(?:\.Ports)?)(?:\b|\.)/g;
  for (const m of line.matchAll(fqnRe)) hits.push({ target: m[1], segment: m[2].split(".")[0], nsTail: m[2], kind: "fqn", global: false });
  return hits;
}

function shouldFlag(hit, owner, common) {
  if (owner) return owner !== hit.target;
  if (hit.global) return true;
  if (common && hit.kind === "using" && hit.nsTail.startsWith("Application.Ports")) return true;
  if (hit.kind === "fqn" && hit.nsTail === "Application.Ports") return true;
  return false;
}

for (const be of backendRoots(root)) {
  const seen = new Set();
  for (const f of walkFiles(be, be, { filter: () => true })) {
    if (!f.endsWith(".cs")) continue;
    const owner = ownerModule(be, f);
    const common = isCommonFile(be, f);
    const src = fs.readFileSync(f, "utf8").split(/\r?\n/);
    for (let i = 0; i < src.length; i++) {
      for (const hit of scanLine(src[i])) {
        if (!shouldFlag(hit, owner, common)) continue;
        const id = findingId(hit.segment);
        const rel = path.relative(root, f);
        const key = `${id}\t${rel}\t${i + 1}\t${hit.target}\t${hit.segment}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`${id}\terror\t${rel}:${i + 1}\t${message(id, owner || "outside module", hit.target)}\tbackend-pa-vsa.md#across-modules`);
      }
    }
  }
}
