#!/usr/bin/env node
// MER-FE-010 — port files contain ONLY type/interface definitions plus the
// useProvideInject tuple export. No value imports (except the helper), no
// function/class declarations, no fetch calls, no other statements.
// "Port files contain only the type and the injection helper."
// AST-tier (v3b): uses the TypeScript compiler API (already installed under
// plumb for dependency-cruiser, contract §2.3/§4) — import classification and
// statement shapes need real parsing, not regex. Missing typescript degrades
// per contract §4: stderr diagnostic, exit 0.
// Encoded exceptions (calibration 2026-06-10, speechscribe shared/ports/desktop.ts):
// - `declare`-modified statements (ambient module augmentation, declare const)
//   are type-level, not executable.
// - `const injectX = (...) => ...` hand-written injection helpers are allowed:
//   when the capability is wired through a Nuxt plugin instead of provide/inject,
//   the inject function IS the injection helper doctrine permits a port to hold.
// - paths matching /application/ports/ are skipped (calibration 2026-06-10,
//   confer): that is the BE-TS port convention (backend-pa-vsa §TS — abstract
//   classes, MER-BT-001's territory), which an FE root walk reaches when
//   nuxt.config sits at a workspace root.
// DOC: frontend-pa-vsa.md#ports
import fs from "node:fs";
import path from "node:path";
import { findFeRoots, walkFiles } from "./_lib/fe-graph.mjs";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch {
  process.stderr.write("MER-FE-010: typescript not installed under plumb — skipping (pnpm install in ~/Sites/plumb)\n");
  process.exit(0);
}

const root = process.argv[2];
const HELPER = /use-?provide-?inject/i;

function emit(file, line, msg) {
  console.log(`MER-FE-010\terror\t${path.relative(root, file)}:${line}\t${msg}\tfrontend-pa-vsa.md#ports`);
}

for (const feRoot of findFeRoots(root)) {
  const appDir = fs.existsSync(path.join(feRoot, "app")) ? path.join(feRoot, "app") : feRoot;
  for (const f of walkFiles(appDir, /\.ts$/)) {
    if (!/\/ports\//.test(f) || /\/application\/ports\//.test(f) || f.endsWith(".d.ts") || /\.(spec|test)\.ts$/.test(f) || /__tests__/.test(f)) continue;
    const src = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
    const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    for (const st of sf.statements) {
      if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) continue;
      if (ts.canHaveModifiers(st) && ts.getCombinedModifierFlags(st) & ts.ModifierFlags.Ambient) continue;
      if (ts.isImportDeclaration(st)) {
        const clause = st.importClause;
        const spec = st.moduleSpecifier.text ?? "";
        if (!clause) { emit(f, lineOf(st), `port files may not contain side-effect imports (import "${spec}")`); continue; }
        if (clause.isTypeOnly) continue;
        const named = clause.namedBindings;
        const allTypeOnly = named && ts.isNamedImports(named) && !clause.name &&
          named.elements.every((e) => e.isTypeOnly);
        if (allTypeOnly) continue;
        if (HELPER.test(spec)) continue; // the one allowed value import
        emit(f, lineOf(st), `port files may import only types and the useProvideInject helper — value import from "${spec}"`);
        continue;
      }
      if (ts.isExportDeclaration(st)) {
        if (st.isTypeOnly) continue;
        emit(f, lineOf(st), "port files may not re-export values — export types only");
        continue;
      }
      if (ts.isVariableStatement(st)) {
        const decls = st.declarationList.declarations;
        const isTuple = decls.length === 1 && decls[0].initializer &&
          ts.isCallExpression(decls[0].initializer) &&
          HELPER.test(decls[0].initializer.expression.getText(sf));
        if (isTuple) continue;
        const isInjectHelper = decls.every((d) =>
          ts.isIdentifier(d.name) && /^inject[A-Z]/.test(d.name.text) && d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)));
        if (isInjectHelper) continue;
        emit(f, lineOf(st), "the only value a port file may declare is the [injectX, provideX] = useProvideInject tuple");
        continue;
      }
      emit(f, lineOf(st), "port files contain only type definitions and the provide/inject tuple — no functions, classes, or executable statements");
    }
  }
}
