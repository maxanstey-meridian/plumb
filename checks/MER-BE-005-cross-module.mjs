#!/usr/bin/env node
// MER-BE-003/004/005 — sibling internals do not escape their owner module.
// PRODUCES: MER-BE-003, MER-BE-004, MER-BE-005
// Published module APIs live in Modules/<Feature>/Contracts; consumer-required
// ports stay with the consumer; Common is reserved for a shared kernel.
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
  if (names.has("Modules")) yield d;
  for (const be of walkDirs(d, d, { filter: () => true })) {
    let es;
    try { es = fs.readdirSync(be, { withFileTypes: true }); } catch { continue; }
    const names = new Set(es.filter((e) => e.isDirectory()).map((e) => e.name));
    if (names.has("Modules")) yield be;
  }
}

function ownerModule(be, file) {
  const parts = path.relative(be, file).split(path.sep);
  return parts[0] === "Modules" && parts[1] ? parts[1] : null;
}

function ownerLayer(be, file) {
  const parts = path.relative(be, file).split(path.sep);
  return parts[0] === "Modules" && parts[2] ? parts[2] : null;
}

function isCommonFile(be, file) {
  return path.relative(be, file).split(path.sep)[0] === "Common";
}

function findingId(segment) {
  if (segment === "Domain") return "MER-BE-003";
  if (segment === "Infrastructure") return "MER-BE-004";
  return "MER-BE-005";
}

function message(id, owner, target, hit, layer) {
  if (hit.segment === "Contracts") {
    return `module ${owner} ${layer || "shared code"} must not use ${target}.Contracts — published contracts are for Application and integration consumers`;
  }
  if (id === "MER-BE-003") {
    return `module ${owner} must not use ${target}.Domain — consume a published contract or define a required port`;
  }
  if (id === "MER-BE-004") {
    return `module ${owner} must not use ${target}.Infrastructure — bridge modules at the composition edge`;
  }
  return `module ${owner} must not use ${target}.Application internals — publish a contract under ${target}.Contracts or define a consumer-owned required port`;
}

function maskNonCode(source) {
  const chars = [...source];
  const mask = (i) => { if (chars[i] !== "\n" && chars[i] !== "\r") chars[i] = " "; };
  let state = "code";
  let rawQuotes = 0;

  for (let i = 0; i < chars.length; i++) {
    if (state === "line") {
      if (chars[i] === "\n") state = "code";
      else mask(i);
      continue;
    }
    if (state === "block") {
      if (chars[i] === "*" && chars[i + 1] === "/") { mask(i); mask(++i); state = "code"; }
      else mask(i);
      continue;
    }
    if (state === "string") {
      if (chars[i] === "\\") { mask(i); if (i + 1 < chars.length) mask(++i); }
      else if (chars[i] === '"') { mask(i); state = "code"; }
      else mask(i);
      continue;
    }
    if (state === "verbatim") {
      if (chars[i] === '"' && chars[i + 1] === '"') { mask(i); mask(++i); }
      else if (chars[i] === '"') { mask(i); state = "code"; }
      else mask(i);
      continue;
    }
    if (state === "char") {
      if (chars[i] === "\\") { mask(i); if (i + 1 < chars.length) mask(++i); }
      else if (chars[i] === "'") { mask(i); state = "code"; }
      else mask(i);
      continue;
    }
    if (state === "raw") {
      if (chars[i] === '"') {
        let count = 1;
        while (chars[i + count] === '"') count++;
        for (let j = 0; j < count; j++) mask(i + j);
        if (count >= rawQuotes) state = "code";
        i += count - 1;
      } else mask(i);
      continue;
    }

    if (chars[i] === "/" && chars[i + 1] === "/") { mask(i); mask(++i); state = "line"; }
    else if (chars[i] === "/" && chars[i + 1] === "*") { mask(i); mask(++i); state = "block"; }
    else if (chars[i] === '"') {
      let count = 1;
      while (chars[i + count] === '"') count++;
      if (count >= 3) {
        rawQuotes = count;
        for (let j = 0; j < count; j++) mask(i + j);
        i += count - 1;
        state = "raw";
      } else {
        mask(i);
        state = chars[i - 1] === "@" ? "verbatim" : "string";
      }
    } else if (chars[i] === "'") { mask(i); state = "char"; }
  }
  return chars.join("");
}

function scanLine(line) {
  const hits = [];
  const usingMatch = line.match(/^\s*(global\s+)?using\s+(?:static\s+)?(?:[A-Za-z_]\w*\s*=\s*)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\.Modules\.([A-Za-z_]\w*)\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*))/);
  if (usingMatch) return [{ target: usingMatch[3], segment: usingMatch[4].split(".")[0], nsTail: usingMatch[4], kind: "using", global: Boolean(usingMatch[1]) }];

  const fqnRe = /\bModules\.([A-Za-z_]\w*)\.(Domain|Infrastructure|Application(?:\.Ports)?|Contracts)(?:\b|\.)/g;
  for (const m of line.matchAll(fqnRe)) hits.push({ target: m[1], segment: m[2].split(".")[0], nsTail: m[2], kind: "fqn", global: false });
  return hits;
}

function shouldFlag(hit, owner, layer, common) {
  if (hit.segment === "Contracts") {
    if (common) return true;
    return Boolean(owner && owner !== hit.target && layer === "Domain");
  }
  if (owner) return owner !== hit.target;
  if (common) return true;
  if (hit.global) return true;
  return false;
}

for (const be of backendRoots(root)) {
  const seen = new Set();
  for (const f of walkFiles(be, be, { filter: () => true })) {
    if (!f.endsWith(".cs")) continue;
    const owner = ownerModule(be, f);
    const layer = ownerLayer(be, f);
    const common = isCommonFile(be, f);
    const src = maskNonCode(fs.readFileSync(f, "utf8")).split(/\r?\n/);
    for (let i = 0; i < src.length; i++) {
      for (const hit of scanLine(src[i])) {
        if (!shouldFlag(hit, owner, layer, common)) continue;
        const id = findingId(hit.segment);
        const rel = path.relative(root, f);
        const key = `${id}\t${rel}\t${i + 1}\t${hit.target}\t${hit.segment}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`${id}\terror\t${rel}:${i + 1}\t${message(id, owner || "outside module", hit.target, hit, layer)}\tbackend-pa-vsa.md#across-modules`);
      }
    }
  }
}
