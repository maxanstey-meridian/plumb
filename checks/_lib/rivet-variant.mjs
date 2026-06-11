// _lib/rivet-variant.mjs — Rivet variant detection (FABLE_CONTRACT.md §5, v8).
// Not a check; the runner skips _-prefixed entries (§4).
//
// Rivet v2 replaced the generated TS client (generated/{client/,types/,rivet.ts})
// with generated/openapi.json + openapi-typescript schema.d.ts + a hand-written
// openapi-fetch facade. Artifact fingerprints are the PRIMARY signal:
//   v1 — a generated/ (or generated/rivet/) dir containing rivet.ts, client/ or types/
//   v2 — any dir containing BOTH openapi.json and schema.d.ts
// Variant is per repo: "v1" | "v2" | "both" | "none".
//
// The runner exports the result as PLUMB_RIVET_VARIANT (like PLUMB_CI); checks
// invoked directly (harness, ad-hoc) call detectRivetVariant themselves when the
// env var is absent. Also executable: `node rivet-variant.mjs <root>` prints the
// variant (for bash checks).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SKIP = new Set(["node_modules", ".git", ".nuxt", ".output", "dist", "build", "obj", "bin"]);

function* walkDirs(d, depth = 14) {
  if (depth < 0) return;
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  yield [d, es];
  for (const e of es) {
    if (e.isDirectory() && !SKIP.has(e.name)) yield* walkDirs(path.join(d, e.name), depth - 1);
  }
}

// Walk up from an artifact dir to the nearest package.json with a "name" —
// that name is the contracts package's import specifier (e.g. @golden/contracts).
// Derived from the repo, never hardcoded (contract §5).
function packageNameAbove(dir, stopAt) {
  for (let d = dir; d.startsWith(stopAt); d = path.dirname(d)) {
    const pj = path.join(d, "package.json");
    if (fs.existsSync(pj)) {
      try {
        const name = JSON.parse(fs.readFileSync(pj, "utf8")).name;
        if (name) return name;
      } catch {}
      return null;
    }
    if (d === stopAt) break;
  }
  return null;
}

export function detectRivetVariant(root) {
  root = path.resolve(root);
  const v1Dirs = [], v2Dirs = [], contractsPackages = new Set();
  for (const [d, es] of walkDirs(root)) {
    const names = new Set(es.map((e) => e.name));
    const base = path.basename(d);
    const isGen = base === "generated" || /generated[\/\\]rivet$/.test(d);
    if (isGen && (names.has("rivet.ts") || (names.has("client") && es.find((e) => e.name === "client")?.isDirectory()) || (names.has("types") && es.find((e) => e.name === "types")?.isDirectory()))) {
      v1Dirs.push(d);
    }
    if (names.has("openapi.json") && names.has("schema.d.ts")) v2Dirs.push(d);
  }
  for (const d of [...v1Dirs, ...v2Dirs]) {
    const name = packageNameAbove(d, root);
    if (name) contractsPackages.add(name);
  }
  const variant = v1Dirs.length && v2Dirs.length ? "both" : v1Dirs.length ? "v1" : v2Dirs.length ? "v2" : "none";
  return { variant, v1Dirs, v2Dirs, contractsPackages: [...contractsPackages] };
}

// env-var-or-compute, the shape checks use (mirrors PLUMB_CI self-gating)
export function rivetVariant(root) {
  const v = process.env.PLUMB_RIVET_VARIANT;
  return v === "v1" || v === "v2" || v === "both" || v === "none" ? v : detectRivetVariant(root).variant;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(detectRivetVariant(process.argv[2] || ".").variant);
}
