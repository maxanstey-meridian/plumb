#!/usr/bin/env node
// MER-BT-002 — "Concrete adapters should `implement` the port, not `extend` it."
// A class whose `extends` target was imported from a /ports/ path (or a *.port
// module) is treating a DI token as an OO base class. AST-tier: TS compiler API;
// missing typescript degrades per contract §4.
// DOC: backend-pa-vsa.md#typescript--nest-port-convention
import fs from "node:fs";
import path from "node:path";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch {
  process.stderr.write("MER-BT-002: typescript not installed under plumb — skipping (pnpm install in ~/Sites/plumb)\n");
  process.exit(0);
}

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const SKIP = new Set(["node_modules", ".git", ".nuxt", ".output", "dist", "build", "generated", "obj", "bin"]);
function* walk(d) {
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(p); }
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) yield p;
  }
}

const PORT_SPEC = /\/ports\/|\.port(\.js|\.ts)?$/;

for (const f of walk(root)) {
  if (/\.(spec|test)\.ts$/.test(f) || /__tests__/.test(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  if (!src.includes("extends") || !PORT_SPEC.test(src)) continue;
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
  const portNames = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !PORT_SPEC.test(st.moduleSpecifier.text ?? "")) continue;
    const c = st.importClause;
    if (!c) continue;
    if (c.name) portNames.add(c.name.text);
    if (c.namedBindings && ts.isNamedImports(c.namedBindings))
      for (const e of c.namedBindings.elements) portNames.add(e.name.text);
  }
  if (!portNames.size) continue;
  const visit = (node) => {
    if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.heritageClauses) {
      for (const h of node.heritageClauses) {
        if (h.token !== ts.SyntaxKind.ExtendsKeyword) continue;
        for (const t of h.types) {
          const base = t.expression.getText(sf);
          if (portNames.has(base)) {
            const line = sf.getLineAndCharacterOfPosition(t.getStart(sf)).line + 1;
            console.log(`MER-BT-002\terror\t${path.relative(root, f)}:${line}\tadapters implement ports, never extend them — change "extends ${base}" to "implements ${base}"\tbackend-pa-vsa.md#typescript--nest-port-convention`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
