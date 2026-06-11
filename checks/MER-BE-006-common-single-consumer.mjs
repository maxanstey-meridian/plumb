#!/usr/bin/env node
// MER-BE-006 — types in Common/ referenced by only one module are secretly owned
// by that module. "Shared locations exist for genuine cross-cutting concerns
// only" / "Common is not a dumping ground." Backend analogue of MER-FE-031.
// Backend roots are discovered by convention: a dir with BOTH Modules/ and
// Common/ children (test-project Common dirs have no Modules sibling).
// Consumers are counted by word-boundary type-name reference from Modules/<X>
// files — collisions with local names overcount consumers, which only makes the
// rule quieter, never noisier. Zero-consumer types are skipped (host/Program/
// tests may be the legitimate consumer).
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

const root = process.argv[2];
const SKIP = new Set(["node_modules", ".git", "obj", "bin"]);

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

const typeRe = /(?:public|internal)\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+|readonly\s+)*(class|interface|record(?:\s+(?:class|struct))?|struct|enum)\s+([A-Za-z_]\w*)/g;

for (const be of backendRoots(root)) {
  // Common type name -> declaring file
  const commonTypes = new Map();
  for (const f of walk(path.join(be, "Common"))) {
    if (!f.endsWith(".cs")) continue;
    const src = fs.readFileSync(f, "utf8");
    const decls = [...src.matchAll(typeRe)].map((m) => ({ kind: m[1], name: m[2] }));
    const hasInterface = decls.some((d) => d.kind === "interface");
    for (const d of decls) {
      if (d.name.endsWith("Exception")) continue;
      if (hasInterface && d.kind !== "interface") continue;
      if (!commonTypes.has(d.name)) commonTypes.set(d.name, f);
    }
  }
  if (!commonTypes.size) continue;
  // type name -> Set<module> referencing it
  const consumers = new Map([...commonTypes.keys()].map((t) => [t, new Set()]));
  const modulesDir = path.join(be, "Modules");
  for (const f of walk(modulesDir)) {
    if (!f.endsWith(".cs")) continue;
    const mod = path.relative(modulesDir, f).split(path.sep)[0];
    const src = fs.readFileSync(f, "utf8");
    for (const t of commonTypes.keys()) {
      if (new RegExp(`\\b${t}\\b`).test(src)) consumers.get(t).add(mod);
    }
  }
  for (const [t, mods] of [...consumers].sort()) {
    if (mods.size !== 1) continue;
    const only = [...mods][0];
    const rel = path.relative(root, commonTypes.get(t));
    console.log(
      `MER-BE-006\twarn\t${rel}:0\tCommon type ${t} is referenced only by module ${only} — secretly owned; move it into Modules/${only}\tbackend-pa-vsa.md#sharedcommon-rule`
    );
  }
}
