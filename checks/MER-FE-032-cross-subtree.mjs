#!/usr/bin/env node
// MER-FE-032 — no deep imports from another page's local subtree.
// DOC: frontend-pa-vsa.md#promotion
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walkDirs, walkFiles } from "./_lib/fs-scan.mjs";
const root = process.argv[2];
const containers = [...walkDirs(root, root, {
  filter: (name, p) => (name === "pages" || name === "layouts") &&
    (path.dirname(p) === path.resolve(root) || path.basename(path.dirname(p)) === "app"),
})];
const subtreeOf = (container, file) => path.relative(container, file).split(path.sep)[0].replace(/\.(vue|ts)$/, "");
const importsIn = (file, source, lineOffset = 0) => {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const imports = [];
  const add = (node, literal) => imports.push({
    spec: literal.text,
    line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 + lineOffset,
  });
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
      add(node, node.moduleSpecifier);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]))
      add(node, node.arguments[0]);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return imports;
};

for (const container of containers) {
  const sourceDir = path.dirname(container);
  const appRoot = path.basename(sourceDir) === "app" ? path.dirname(sourceDir) : sourceDir;
  for (const f of walkFiles(root, container, { filter: (name) => /\.(ts|vue)$/.test(name) })) {
    const ownSubtree = subtreeOf(container, f);
    const src = fs.readFileSync(f, "utf8");
    const imports = f.endsWith(".vue") ? [...src.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].flatMap((match) => {
      const body = match[1];
      const bodyStart = match.index + match[0].indexOf(body);
      const lineOffset = (src.slice(0, bodyStart).match(/\n/g) || []).length;
      return importsIn(f, body, lineOffset);
    }) : importsIn(f, src);
    for (const imported of imports) {
      const spec = imported.spec;
      let resolved = null;
      if (spec.startsWith(".")) resolved = path.resolve(path.dirname(f), spec);
      else if (spec.startsWith("~/") || spec.startsWith("@/")) resolved = path.join(sourceDir, spec.slice(2));
      else if (spec.startsWith("~~/") || spec.startsWith("@@/")) resolved = path.join(appRoot, spec.slice(3));
      const targetContainer = resolved && containers.find((candidate) => resolved.startsWith(candidate + path.sep));
      if (!targetContainer) continue;
      const target = subtreeOf(targetContainer, resolved);
      if ((targetContainer !== container || target !== ownSubtree) && target !== "") {
        console.log(`MER-FE-032\terror\t${path.relative(root, f)}:${imported.line}\t${path.basename(container)} subtree ${ownSubtree} deep-imports ${target} — move generic code to app/shared, preserve product ownership in app/features, or expose a public feature contract\tfrontend-pa-vsa.md#promotion`);
      }
    }
  }
}
