#!/usr/bin/env node
// MER-FE-008 — v2 generated-contract repos construct openapi-fetch only inside
// the contracts package facade, never directly from Nuxt app/UI source.
// DOC: rivet.md#typescript-client-package
import fs from "node:fs";
import path from "node:path";
import { findFeRoots, walkFiles } from "./_lib/fe-graph.mjs";
import { detectRivetVariant } from "./_lib/rivet-variant.mjs";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch { process.stderr.write("MER-FE-008: typescript not installed under plumb — skipping\n"); process.exit(0); }
const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);
const det = detectRivetVariant(root);
const variant = process.env.PLUMB_RIVET_VARIANT || det.variant;
if (variant !== "v2" && variant !== "both") process.exit(0);

const owners = det.v2Dirs.map((dir) => {
  for (let d = dir; d.startsWith(path.resolve(root)); d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, "package.json"))) return d;
    if (d === path.resolve(root)) break;
  }
  return dir;
});
const leftmost = (node) => {
  while (node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ||
    ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return ts.isIdentifier(node) ? node.text : null;
};
const scan = (file, source, lineOffset = 0) => {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const bindings = new Set();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "openapi-fetch") continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    if (clause.name) bindings.add(clause.name.text);
    if (clause.namedBindings) {
      if (ts.isNamespaceImport(clause.namedBindings)) bindings.add(clause.namedBindings.name.text);
      else for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) bindings.add(element.name.text);
    }
  }
  if (!bindings.size) return;
  const visit = (node) => {
    if (ts.isCallExpression(node) && bindings.has(leftmost(node.expression))) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 + lineOffset;
      console.log(`MER-FE-008\terror\t${path.relative(root, file)}:${line}\topenapi-fetch client construction belongs in the generated contracts package facade, not app/UI source\trivet.md#typescript-client-package`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
};

for (const feRoot of findFeRoots(root, Infinity)) {
  const appDir = fs.existsSync(path.join(feRoot, "app")) ? path.join(feRoot, "app") : feRoot;
  for (const file of walkFiles(appDir, /\.(ts|js|mjs|vue)$/)) {
    if (owners.some((owner) => path.resolve(file).startsWith(owner + path.sep))) continue;
    const src = fs.readFileSync(file, "utf8");
    if (!file.endsWith(".vue")) { scan(file, src); continue; }
    const script = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
    if (!script) continue;
    const offset = src.slice(0, script.index + script[0].indexOf(script[1])).split("\n").length - 1;
    scan(file, script[1], offset);
  }
}
