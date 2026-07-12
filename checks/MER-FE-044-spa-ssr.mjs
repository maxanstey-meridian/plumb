#!/usr/bin/env node
// MER-FE-044 — Meridian Nuxt frontends are SPAs and explicitly set ssr: false.
// DOC: frontend-pa-vsa.md#purpose
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch { process.stderr.write("MER-FE-044: typescript not installed under plumb — skipping\n"); process.exit(0); }
const root = process.argv[2];

const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};
const objectFromExport = (expression, declarations) => {
  const value = unwrap(expression);
  if (ts.isObjectLiteralExpression(value)) return value;
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "defineNuxtConfig" && value.arguments.length)
    return ts.isObjectLiteralExpression(unwrap(value.arguments[0])) ? unwrap(value.arguments[0]) : null;
  if (ts.isIdentifier(value) && declarations.has(value.text)) return objectFromExport(declarations.get(value.text), declarations);
  return null;
};

for (const file of walkFiles(root, root, { filter: (name) => /^nuxt\.config\.(ts|js|mjs)$/.test(name) })) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  for (const statement of sf.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.initializer) declarations.set(declaration.name.text, declaration.initializer);
  }
  const exported = sf.statements.find(ts.isExportAssignment);
  const config = exported ? objectFromExport(exported.expression, declarations) : null;
  const accepted = config?.properties.some((property) => {
    if (!ts.isPropertyAssignment(property)) return false;
    const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : "";
    return name === "ssr" && unwrap(property.initializer).kind === ts.SyntaxKind.FalseKeyword;
  });
  if (!accepted) console.log(`MER-FE-044\twarn\t${path.relative(root, file)}:1\tNuxt SPA config must explicitly set ssr: false\tfrontend-pa-vsa.md#purpose`);
}
