#!/usr/bin/env node
// MER-FE-011 — provide/inject tuples are exported, invoke useProvideInject, and
// are ordered [injectX, provideX] with the same X suffix.
// DOC: frontend-pa-vsa.md#provide--inject-pattern
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";
const root = process.argv[2];

let ts;
try { ({ default: ts } = await import("typescript")); }
catch {
  process.stderr.write("MER-FE-011: typescript not installed under plumb — skipping (pnpm install in ~/Sites/plumb)\n");
  process.exit(0);
}

const emit = (file, line, message) =>
  console.log(`MER-FE-011\terror\t${path.relative(root, file)}:${line}\t${message}\tfrontend-pa-vsa.md#provide--inject-pattern`);
const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};

for (const f of walkFiles(root, root, { filter: (name) => name.endsWith(".ts") })) {
  if (!/[\\/]ports[\\/]/.test(f) || f.endsWith(".d.ts")) continue;
  const src = fs.readFileSync(f, "utf8");
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const laterExports = new Set();
  for (const st of sf.statements) {
    if (!ts.isExportDeclaration(st) || st.moduleSpecifier || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
    for (const e of st.exportClause.elements) laterExports.add((e.propertyName ?? e.name).text);
  }
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isArrayBindingPattern(d.name)) continue;
      const names = d.name.elements.map((e) => ts.isBindingElement(e) && ts.isIdentifier(e.name) ? e.name.text : "");
      const looksLikeTuple = names.some((n) => /^(inject|provide)[A-Z]/.test(n)) ||
        (d.initializer && /\buseProvideInject\b/.test(d.initializer.getText(sf)));
      if (!looksLikeTuple) continue;
      const issues = [];
      if (names.length !== 2) issues.push(`tuple must contain exactly two elements — got ${names.length}`);
      const exported = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || names.every((name) => laterExports.has(name));
      if (!exported) issues.push("tuple must be exported");
      const init = unwrap(d.initializer);
      const call = init && ts.isCallExpression(init) ? init : null;
      const callee = call ? unwrap(call.expression) : null;
      if (!callee || !ts.isIdentifier(callee) || callee.text !== "useProvideInject") issues.push("tuple must invoke useProvideInject");
      if (names.length === 2) {
        const inject = names[0].match(/^inject([A-Z]\w*)$/);
        const provide = names[1].match(/^provide([A-Z]\w*)$/);
        if (!inject || !provide) issues.push(`tuple must be ordered [injectX, provideX] — got [${names.join(", ")}]`);
        else if (inject[1] !== provide[1]) issues.push(`inject/provide suffixes must match — got ${inject[1]} and ${provide[1]}`);
      }
      if (issues.length) emit(f, lineOf(d), issues.join("; "));
    }
  }
}
