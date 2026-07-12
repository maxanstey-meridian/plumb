#!/usr/bin/env node
// MER-FE-040 — a useX composable file exports the matching useX function.
// Utility files in composables/ that do not use the useX filename convention are
// intentionally ignored.
// DOC: frontend-pa-vsa.md#composables
import fs from "node:fs";
import path from "node:path";
import { findFeRoots, walkFiles } from "./_lib/fe-graph.mjs";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch { process.stderr.write("MER-FE-040: typescript not installed under plumb — skipping\n"); process.exit(0); }
const root = process.argv[2];
const expectedName = (base) => base.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};

for (const feRoot of findFeRoots(root, Infinity)) {
  const appDir = fs.existsSync(path.join(feRoot, "app")) ? path.join(feRoot, "app") : feRoot;
  for (const file of walkFiles(appDir, /\.(ts|js)$/)) {
    if (!/[\\/]composables[\\/]/.test(file)) continue;
    const base = path.basename(file).replace(/\.(ts|js)$/, "");
    if (!/^use(?:-|[A-Z])/.test(base)) continue;
    const expected = expectedName(base);
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const matchingExportLocals = new Set();
    const defaultExports = new Set();
    for (const st of sf.statements) {
      if (ts.isExportAssignment(st) && !st.isExportEquals && ts.isIdentifier(unwrap(st.expression))) {
        defaultExports.add(unwrap(st.expression).text);
      }
      if (!ts.isExportDeclaration(st) || st.moduleSpecifier || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
      for (const e of st.exportClause.elements) {
        if (e.name.text === expected) matchingExportLocals.add((e.propertyName ?? e.name).text);
      }
    }
    const matches = sf.statements.some((st) => {
      const directExport = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (ts.isFunctionDeclaration(st)) return st.name && (directExport && st.name.text === expected || matchingExportLocals.has(st.name.text) || defaultExports.has(st.name.text));
      return ts.isVariableStatement(st) && st.declarationList.declarations.some((d) =>
        ts.isIdentifier(d.name) && (directExport && d.name.text === expected || matchingExportLocals.has(d.name.text) || defaultExports.has(d.name.text)) && d.initializer &&
        (ts.isArrowFunction(unwrap(d.initializer)) || ts.isFunctionExpression(unwrap(d.initializer))));
    });
    if (!matches) console.log(`MER-FE-040\twarn\t${path.relative(root, file)}:1\t${base} composable file must export a matching ${expected} function\tfrontend-pa-vsa.md#composables`);
  }
}
