#!/usr/bin/env node
// MER-BT-010/011/012 — TS backend layer + module-boundary rules (contract §11.8;
// .NET parity for BE-001..005). One pass, three IDs:
//   BT-010 (error): domain/ imports only its own module's domain/; known backend
//                   framework packages in domain are also findings.
//   BT-011 (error): application|app must not import infrastructure|infra.
//   BT-012 (error): never cross; always common — modules/<X> must not import
//                   modules/<Y>; modules/common is the sanctioned shared location.
// Only RELATIVE import specifiers are resolved — non-relative specs are external
// packages or workspace aliases plumb cannot resolve without per-repo config
// (§5 zero-config), so they are skipped for precision. Known framework names are
// the one non-relative class checked (BT-010's framework list).
// DOC: backend-pa-vsa.md#non-negotiable-dependency-rules
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const SKIP = new Set(["node_modules", ".git", ".nuxt", ".output", "dist", "build", "generated", "obj", "bin", ".turbo", "coverage"]);
const LAYER_NAMES = new Map([
  ["domain", "domain"],
  ["application", "application"], ["app", "application"],
  ["infrastructure", "infrastructure"], ["infra", "infrastructure"],
  ["interface", "interface"], ["interfaces", "interface"],
]);
const DOMAIN_BANNED_PKGS = /^(@nestjs\/|express$|fastify$|vue$|typed-inject$|inversify$|@vueuse\/|prisma$|@prisma\/|typeorm$|knex$)/;

function* walk(d, depth = 12) {
  if (depth < 0) return;
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(p, depth - 1); }
    else yield p;
  }
}

// classify a path into { module, layer } from its segments.
// module = segment after a lowercase "modules" dir (null when no modules tree);
// layer = first recognized layer segment after the module (or anywhere, for
// single-module repos like rivet-ts's src/{domain,application,infrastructure}).
function classify(p) {
  const segs = p.split(path.sep);
  let module = null, layer = null;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === "modules" && i + 1 < segs.length) module = segs[i + 1];
    else if (LAYER_NAMES.has(segs[i]) && (module !== null || segs.includes("src"))) {
      if (layer === null) layer = LAYER_NAMES.get(segs[i]);
    }
  }
  return { module, layer };
}

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s[^;'"]*?from\s*["']([^"']+)["']|(?:^|\n)\s*import\s*["']([^"']+)["']|require\(\s*["']([^"']+)["']\s*\)/g;

const findings = [];
for (const f of walk(root)) {
  if (!/\.(ts|mts|cts)$/.test(f) || f.endsWith(".d.ts")) continue;
  if (/\.(spec|test)\.[mc]?ts$/.test(f) || /__tests__/.test(f)) continue;
  const from = classify(f);
  if (!from.layer && !from.module) continue;
  const rel = path.relative(root, f);
  const src = fs.readFileSync(f, "utf8");
  const lineAt = (idx) => src.slice(0, idx).split("\n").length;

  for (const m of src.matchAll(IMPORT_RE)) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    const line = lineAt(m.index);

    if (!spec.startsWith(".")) {
      if (from.layer === "domain" && DOMAIN_BANNED_PKGS.test(spec))
        findings.push(`MER-BT-010\terror\t${rel}:${line}\tdomain imports framework package "${spec}" — domain depends on nothing outside itself\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
      continue;
    }

    let target = path.resolve(path.dirname(f), spec);
    const to = classify(target);

    // §7 exception (calibration 2026-06-10, glyphantics game.module.ts): Nest
    // module classes (*.module.ts) ARE the composition root — importing sibling
    // modules there is framework wiring, not a boundary leak.
    const isCompositionFile = /\.module\.[mc]?ts$/.test(f);
    if (!isCompositionFile && from.module && to.module && from.module !== to.module && to.module !== "common" && from.module !== "common")
      findings.push(`MER-BT-012\terror\t${rel}:${line}\tmodule ${from.module} must not import module ${to.module} — never cross; always common (modules/common)\tbackend-pa-vsa.md#across-modules`);
    else if (from.layer === "domain" && to.layer && to.layer !== "domain")
      findings.push(`MER-BT-010\terror\t${rel}:${line}\tdomain must not import ${to.layer} — domain depends on nothing outside itself\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
    else if (from.layer === "application" && to.layer === "infrastructure")
      findings.push(`MER-BT-011\terror\t${rel}:${line}\tapplication must not import infrastructure — depend on the port, let DI wire the adapter\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
  }
}
for (const l of findings) console.log(l);
