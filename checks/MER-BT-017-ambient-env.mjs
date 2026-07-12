#!/usr/bin/env node
// MER-BT-017 — production code reads environment through its configuration owner.
// DOC: backend-pa-vsa.md#typescript--nest
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walkFiles } from "./_lib/fs-scan.mjs";

const rootArg = process.argv[2];
if (!rootArg || !fs.existsSync(rootArg)) process.exit(2);
const root = path.resolve(rootArg);

const isTest = (f) => /\.(spec|test)\.[mc]?ts$/.test(f) || /[\\/](?:__tests__|test|tests)[\\/]/.test(f);
const isConfigOwner = (f) => {
  const rel = path.relative(root, f).split(path.sep).join("/");
  return /^(?:src\/)?(?:config|bootstrap)(?:\/.*|\.[mc]?ts)$/.test(rel);
};

for (const f of walkFiles(root, root, { filter: (name) => /\.[mc]?ts$/.test(name), depth: 12 })) {
  if (f.endsWith(".d.ts") || isTest(f) || isConfigOwner(f)) continue;
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const scopes = new Map([[sf, new Map()]]);
  const isScope = (node) => ts.isSourceFile(node) || ts.isFunctionLike(node) || ts.isBlock(node) || ts.isCatchClause(node);
  const addBinding = (scope, name, kind = "local") => {
    if (ts.isIdentifier(name)) scopes.get(scope).set(name.text, kind);
    else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) if (ts.isBindingElement(element)) addBinding(scope, element.name, kind);
    }
  };
  const collectBindings = (node, scope) => {
    if (ts.isFunctionDeclaration(node) && node.name) addBinding(scope, node.name);
    const childScope = node === sf ? sf : isScope(node) ? node : scope;
    if (childScope !== scope && !scopes.has(childScope)) scopes.set(childScope, new Map());
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name)
      addBinding(childScope, node.name);
    if (ts.isImportDeclaration(node) && node.importClause && ts.isStringLiteral(node.moduleSpecifier)) {
      const kind = ["node:process", "process"].includes(node.moduleSpecifier.text) ? "process" : "local";
      if (node.importClause.name) addBinding(childScope, node.importClause.name, kind);
      if (node.importClause.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) addBinding(childScope, node.importClause.namedBindings.name, kind);
      if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) addBinding(childScope, element.name);
      }
    }
    ts.forEachChild(node, (child) => collectBindings(child, childScope));
  };
  collectBindings(sf, sf);
  const bindingKind = (name, node) => {
    for (let current = node; current; current = current.parent) {
      const binding = scopes.get(current)?.get(name);
      if (binding) return binding;
    }
    return "global";
  };
  const importedEnv = [];
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier) || !["node:process", "process"].includes(st.moduleSpecifier.text)) continue;
    const clause = st.importClause;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) {
        if ((el.propertyName?.text ?? el.name.text) === "env") importedEnv.push({ name: el.name.text, node: st });
      }
    }
  }
  const emitted = new Set();
  const emit = (node, source) => {
    const line = lineOf(node);
    if (emitted.has(line)) return;
    emitted.add(line);
    console.log(`MER-BT-017\twarn\t${path.relative(root, f)}:${line}\tproduction code reads ${source} outside a root configuration owner — bind and validate configuration at the edge\tbackend-pa-vsa.md#typescript--nest`);
  };
  for (const imported of importedEnv) emit(imported.node, `environment imported as ${imported.name} from node:process`);
  const visit = (node) => {
    const processSource = (expression) => {
      if (ts.isIdentifier(expression)) {
        const kind = bindingKind(expression.text, expression);
        return kind === "process" || (kind === "global" && expression.text === "process");
      }
      return ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "globalThis" &&
        bindingKind("globalThis", expression.expression) === "global" && expression.name.text === "process";
    };
    if (ts.isPropertyAccessExpression(node) && processSource(node.expression) && node.name.text === "env")
      emit(node, ts.isIdentifier(node.expression) ? "process.env" : "globalThis.process.env");
    if (ts.isElementAccessExpression(node) && processSource(node.expression) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "env")
      emit(node, ts.isIdentifier(node.expression) ? "process['env']" : "globalThis.process['env']");
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && ["Bun", "Deno"].includes(node.expression.text) &&
        bindingKind(node.expression.text, node.expression) === "global" && node.name.text === "env") emit(node, `${node.expression.text}.env`);
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
