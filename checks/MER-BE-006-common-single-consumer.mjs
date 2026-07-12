#!/usr/bin/env node
// MER-BE-006 — one-module consumption is an ownership-review heuristic, not
// proof: host infrastructure, base errors, and shared kernels may be valid.
// Backend roots are discovered by convention: a dir with BOTH Modules/ and
// Common/ children (test-project Common dirs have no Modules sibling).
// Consumers are counted by word-boundary type-name reference from Modules/<X>
// files, then propagated through Common contract references. This lets an enum,
// nested record, or collection element inherit the modules consuming its
// enclosing contract. Name collisions overcount consumers, which only makes
// the rule quieter, never noisier. Zero-consumer types are skipped (host/
// Program/tests may be the legitimate consumer).
// Encoded exceptions (calibration 2026-06-10, both baseline repos):
// - In a file that declares an interface, only the interfaces are candidates.
//   Signature DTOs returned by a port are received via `var` in consumers, so
//   their names systematically undercount (IRecordingCatalog's
//   DeletedRecordingAssets etc.) — the interface name is the reliable signal,
//   because injecting the port requires naming it.
// - Types ending in `Exception` are exempt: doctrine explicitly lists "base
//   error types" as a legitimate Common use, and exception families live
//   together (DomainException.cs).
// DOC: backend-pa-vsa.md#sharedcommon-rule
import fs from "node:fs";
import path from "node:path";
import { walkDirs, walkFiles } from "./_lib/fs-scan.mjs";

const root = process.argv[2];

function* backendRoots(d) {
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  const names = new Set(es.filter((e) => e.isDirectory()).map((e) => e.name));
  if (names.has("Modules") && names.has("Common")) yield d;
  for (const be of walkDirs(d, d, { filter: () => true })) {
    try { es = fs.readdirSync(be, { withFileTypes: true }); } catch { continue; }
    const names = new Set(es.filter((e) => e.isDirectory()).map((e) => e.name));
    if (names.has("Modules") && names.has("Common")) yield be;
  }
}

const typeRe = /(?:public|internal)\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+|readonly\s+)*(class|interface|record(?:\s+(?:class|struct))?|struct|enum)\s+([A-Za-z_]\w*)/g;

function maskCSharp(source) {
  const masked = [...source];
  const blank = (start, end) => {
    for (let i = start; i < end; i++) if (masked[i] !== "\n" && masked[i] !== "\r") masked[i] = " ";
  };
  for (let i = 0; i < source.length;) {
    if (source.startsWith("//", i)) {
      const end = source.indexOf("\n", i + 2);
      blank(i, end < 0 ? source.length : end);
      i = end < 0 ? source.length : end;
    } else if (source.startsWith("/*", i)) {
      const close = source.indexOf("*/", i + 2);
      const end = close < 0 ? source.length : close + 2;
      blank(i, end);
      i = end;
    } else if (source.startsWith('"""', i)) {
      const close = source.indexOf('"""', i + 3);
      const end = close < 0 ? source.length : close + 3;
      blank(i, end);
      i = end;
    } else if (source[i] === '"' || source.startsWith('@"', i) || source.startsWith('$@"', i) || source.startsWith('@$"', i)) {
      const verbatim = source.startsWith('@"', i) || source.startsWith('$@"', i) || source.startsWith('@$"', i);
      let end = i + (source.startsWith('$@"', i) || source.startsWith('@$"', i) ? 3 : source.startsWith('@"', i) ? 2 : 1);
      while (end < source.length) {
        if (source[end] === '"') {
          if (verbatim && source[end + 1] === '"') { end += 2; continue; }
          end++;
          break;
        }
        if (!verbatim && source[end] === "\\") end++;
        end++;
      }
      blank(i, end);
      i = end;
    } else if (source[i] === "'") {
      let end = i + 1;
      while (end < source.length) {
        if (source[end] === "\\") end++;
        else if (source[end] === "'") { end++; break; }
        end++;
      }
      blank(i, end);
      i = end;
    } else {
      i++;
    }
  }
  return masked.join("");
}

function declarationEnd(masked, start) {
  const open = masked.slice(start).search(/[{};]/);
  if (open < 0) return masked.length;
  const delimiter = start + open;
  if (masked[delimiter] !== "{") return delimiter + 1;
  let depth = 1;
  for (let i = delimiter + 1; i < masked.length; i++) {
    if (masked[i] === "{") depth++;
    else if (masked[i] === "}" && --depth === 0) return i + 1;
  }
  return masked.length;
}

for (const be of backendRoots(root)) {
  // Common type name -> declaring file
  const commonTypes = new Map();
  // Common type name -> source from its declaration through the next declaration
  const declarations = new Map();
  for (const f of walkFiles(be, path.join(be, "Common"), { filter: () => true })) {
    if (!f.endsWith(".cs")) continue;
    const src = fs.readFileSync(f, "utf8");
    const masked = maskCSharp(src);
    const matches = [...masked.matchAll(typeRe)];
    const decls = matches.map((m) => ({ kind: m[1], name: m[2] }));
    const hasInterface = decls.some((d) => d.kind === "interface");
    for (const [i, d] of decls.entries()) {
      if (!declarations.has(d.name)) {
        declarations.set(d.name, src.slice(matches[i].index, declarationEnd(masked, matches[i].index)));
      }
      if (d.name.endsWith("Exception")) continue;
      if (hasInterface && d.kind !== "interface") continue;
      if (!commonTypes.has(d.name)) commonTypes.set(d.name, f);
    }
  }
  if (!commonTypes.size) continue;
  // type name -> Set<module> referencing it
  const consumers = new Map([...commonTypes.keys()].map((t) => [t, new Set()]));
  const modulesDir = path.join(be, "Modules");
  for (const f of walkFiles(be, modulesDir, { filter: () => true })) {
    if (!f.endsWith(".cs")) continue;
    const mod = path.relative(modulesDir, f).split(path.sep)[0];
    const src = fs.readFileSync(f, "utf8");
    for (const t of commonTypes.keys()) {
      if (new RegExp(`\\b${t}\\b`).test(src)) consumers.get(t).add(mod);
    }
  }
  // A module consuming a Common contract also consumes every Common type in
  // that contract's shape. Repeat to cover chains such as page -> row -> enum.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [owner, declaration] of declarations) {
      const ownerConsumers = consumers.get(owner);
      if (!ownerConsumers?.size) continue;
      for (const [referenced, referencedConsumers] of consumers) {
        if (referenced === owner || !new RegExp(`\\b${referenced}\\b`).test(declaration)) continue;
        for (const mod of ownerConsumers) {
          if (referencedConsumers.has(mod)) continue;
          referencedConsumers.add(mod);
          changed = true;
        }
      }
    }
  }
  for (const [t, mods] of [...consumers].sort()) {
    if (mods.size !== 1) continue;
    const only = [...mods][0];
    const rel = path.relative(root, commonTypes.get(t));
    console.log(
      `MER-BE-006\tinfo\t${rel}:0\tCommon type ${t} is referenced only by module ${only} — review ownership; move it only if ${only} truly owns it\tbackend-pa-vsa.md#sharedcommon-rule`
    );
  }
}
