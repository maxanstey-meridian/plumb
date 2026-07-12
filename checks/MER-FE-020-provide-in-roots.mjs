#!/usr/bin/env node
// MER-FE-020 — provideX belongs only in Nuxt shells: app.vue, layouts, and page
// route files. Components/composables never establish local DI scopes.
// DOC: frontend-pa-vsa.md#nuxt-shells-as-composition-roots
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walkFiles } from "./_lib/fs-scan.mjs";

const rootArg = process.argv[2];
if (!rootArg || !fs.existsSync(rootArg)) process.exit(2);
const root = path.resolve(rootArg);
const LOCAL_DIRS = new Set(["components", "composables", "logic", "ports", "adapters"]);

function isShell(file) {
  const parts = path.relative(root, file).split(path.sep);
  if (parts.at(-1) === "app.vue") return true;
  const layouts = parts.lastIndexOf("layouts");
  if (layouts >= 0 && parts.length === layouts + 2 && file.endsWith(".vue")) return true;
  const pages = parts.lastIndexOf("pages");
  return pages >= 0 && file.endsWith(".vue") && !parts.slice(pages + 1, -1).some((part) => LOCAL_DIRS.has(part));
}

function findCalls(file, source, lineOffset = 0) {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const aliases = new Set();
  const namespaces = new Set();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      for (const element of bindings.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        if (!element.isTypeOnly && /^provide[A-Z][A-Za-z0-9]*$/.test(imported) && imported !== "provideLocal") aliases.add(element.name.text);
      }
    } else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
  }
  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const direct = ts.isIdentifier(callee) &&
        ((/^provide[A-Z][A-Za-z0-9]*$/.test(callee.text) && callee.text !== "provideLocal") || aliases.has(callee.text));
      const namespaced = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) &&
        /^provide[A-Z][A-Za-z0-9]*$/.test(callee.name.text) && callee.name.text !== "provideLocal";
      if (direct || namespaced) {
      const line = sf.getLineAndCharacterOfPosition(node.expression.getStart(sf)).line + 1 + lineOffset;
      console.log(`MER-FE-020\terror\t${path.relative(root, file)}:${line}\tprovideX is shell wiring — move it to app.vue, a layout, or a page; use props/events for local collaboration\tfrontend-pa-vsa.md#nuxt-shells-as-composition-roots`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

for (const file of walkFiles(root, root, { filter: (name) => /\.(?:ts|vue)$/.test(name) })) {
  if (isShell(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  if (file.endsWith(".ts")) {
    findCalls(file, source);
    continue;
  }
  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1];
    const bodyStart = match.index + match[0].indexOf(body);
    const lineOffset = (source.slice(0, bodyStart).match(/\n/g) || []).length;
    findCalls(file, body, lineOffset);
  }
}
