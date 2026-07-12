#!/usr/bin/env node
// MER-BT-015 — domain/application receive explicit dependencies; they do not locate them.
// DOC: backend-pa-vsa.md#non-negotiable-dependency-rules
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walkFiles } from "./_lib/fs-scan.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const inLayer = (f) => /[\\/](?:domain|application|app)[\\/]/.test(f);
const isComposition = (f) => /(?:^|[\\/])(?:main|bootstrap|composition-root)\.[mc]?ts$/.test(f);
const isTest = (f) => /\.(spec|test)\.[mc]?ts$/.test(f) || /[\\/]__tests__[\\/]/.test(f);

for (const f of walkFiles(root, root, { filter: (name) => /\.[mc]?ts$/.test(name), depth: 12 })) {
  if (f.endsWith(".d.ts") || !inLayer(f) || isComposition(f) || isTest(f)) continue;
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const emitted = new Set();
  const emit = (node, detail) => {
    const line = lineOf(node);
    if (emitted.has(line)) return;
    emitted.add(line);
    console.log(`MER-BT-015\terror\t${path.relative(root, f)}:${line}\t${detail} — inject the required dependency explicitly\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
  };
  const locatorTypes = new Set();
  const locatorValues = new Set();
  const locatorFactories = new Set();
  const packageExports = new Map([
    ["inversify", { types: new Set(["Container"]), values: new Set(), factories: new Set() }],
    ["tsyringe", { types: new Set(), values: new Set(["container"]), factories: new Set() }],
    ["typedi", { types: new Set(["Container"]), values: new Set(["Container"]), factories: new Set() }],
    ["awilix", { types: new Set(), values: new Set(), factories: new Set(["createContainer"]) }],
    ["typed-inject", { types: new Set(), values: new Set(), factories: new Set(["createInjector"]) }],
  ]);

  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamespaceImport(named)) {
      const namespace = named.name.text;
      if (spec === "@nestjs/core") locatorTypes.add(`${namespace}.ModuleRef`);
      const known = packageExports.get(spec);
      for (const name of known?.types ?? []) locatorTypes.add(`${namespace}.${name}`);
      for (const name of known?.values ?? []) locatorValues.add(`${namespace}.${name}`);
      for (const name of known?.factories ?? []) locatorFactories.add(`${namespace}.${name}`);
      continue;
    }
    if (!named || !ts.isNamedImports(named)) continue;
    for (const el of named.elements) {
      const imported = el.propertyName?.text ?? el.name.text;
      const local = el.name.text;
      if (spec === "@nestjs/core" && imported === "ModuleRef") {
        locatorTypes.add(local);
        emit(st, "ModuleRef is a service locator inside domain/application");
        continue;
      }
      const known = packageExports.get(spec);
      if (known?.types.has(imported)) locatorTypes.add(local);
      if (known?.values.has(imported)) locatorValues.add(local);
      if (known?.factories.has(imported)) locatorFactories.add(local);
    }
  }

  const bindingName = (name) => ts.isIdentifier(name) ? name.text : null;
  const collectBindings = (node) => {
    if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.type && locatorTypes.has(node.type.getText(sf))) {
      const name = bindingName(node.name);
      if (name) {
        locatorValues.add(name);
        if (ts.isParameter(node) && ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Public | ts.ModifierFlags.Protected)) locatorValues.add(`this.${name}`);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const name = bindingName(node.name);
       if (name && ts.isCallExpression(node.initializer) && locatorFactories.has(node.initializer.expression.getText(sf))) locatorValues.add(name);
       if (name && ts.isNewExpression(node.initializer) && locatorTypes.has(node.initializer.expression.getText(sf))) locatorValues.add(name);
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(sf);

  let changed = true;
  while (changed) {
    changed = false;
    const collectAliases = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && locatorValues.has(node.initializer.getText(sf)) && !locatorValues.has(node.name.text)) {
        locatorValues.add(node.name.text);
        changed = true;
      }
      ts.forEachChild(node, collectAliases);
    };
    collectAliases(sf);
  }

  const visitCalls = (node) => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression.expression;
      const owner = receiver.getText(sf);
      const method = node.expression.name.text;
      const knownReceiver = locatorValues.has(owner) ||
        (ts.isNewExpression(receiver) && locatorTypes.has(receiver.expression.getText(sf))) ||
        (ts.isCallExpression(receiver) && locatorFactories.has(receiver.expression.getText(sf)));
      if (knownReceiver && /^(?:get|resolve|create)$/.test(method)) emit(node, `${owner}.${method} performs service location inside domain/application`);
    }
    ts.forEachChild(node, visitCalls);
  };
  visitCalls(sf);
}
