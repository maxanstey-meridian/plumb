#!/usr/bin/env node
// MER-BT-016 — time is an explicit input to domain/application behavior.
// DOC: backend-pa-vsa.md#non-negotiable-dependency-rules
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walkFiles } from "./_lib/fs-scan.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const layer = (f) => f.split(path.sep).includes("domain") ? "domain" : (/[\\/](?:application|app)[\\/]/.test(f) ? "application" : null);
const isTest = (f) => /\.(spec|test)\.[mc]?ts$/.test(f) || /[\\/]__tests__[\\/]/.test(f);
const binds = (binding, name) => {
  if (ts.isIdentifier(binding)) return binding.text === name;
  if (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
    return binding.elements.some((element) => ts.isBindingElement(element) && binds(element.name, name));
  }
  return false;
};
const statementBinds = (statement, name) => {
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some((declaration) => binds(declaration.name, name));
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return statement.name.text === name;
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause?.name?.text === name) return true;
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return clause.namedBindings.name.text === name;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) return clause.namedBindings.elements.some((element) => element.name.text === name);
  }
  return false;
};
const isShadowed = (name, node) => {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if ((ts.isBlock(scope) || ts.isSourceFile(scope)) && scope.statements.some((statement) => statementBinds(statement, name))) return true;
    if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) => binds(parameter.name, name))) return true;
    if (ts.isCatchClause(scope) && scope.variableDeclaration && binds(scope.variableDeclaration.name, name)) return true;
  }
  return false;
};

for (const f of walkFiles(root, root, { filter: (name) => /\.[mc]?ts$/.test(name), depth: 12 })) {
  const owner = layer(f);
  if (!owner || f.endsWith(".d.ts") || isTest(f)) continue;
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const visit = (node) => {
    const callee = (ts.isCallExpression(node) || ts.isNewExpression(node)) ? node.expression.getText(sf) : "";
    const args = (ts.isCallExpression(node) || ts.isNewExpression(node)) ? node.arguments : undefined;
    const bareDate = !isShadowed("Date", node);
    const bareTemporal = !isShadowed("Temporal", node);
    const globalObject = !isShadowed("globalThis", node);
    const dateNow = ts.isCallExpression(node) && ((bareDate && callee === "Date.now") || (globalObject && callee === "globalThis.Date.now"));
    const newDate = ts.isNewExpression(node) && ((bareDate && callee === "Date") || (globalObject && callee === "globalThis.Date")) && (args?.length ?? 0) === 0;
    const dateCall = ts.isCallExpression(node) && ((bareDate && callee === "Date") || (globalObject && callee === "globalThis.Date"));
    const temporalNow = ts.isCallExpression(node) && ((bareTemporal && callee.startsWith("Temporal.Now.")) || (globalObject && callee.startsWith("globalThis.Temporal.Now.")));
    if (dateNow || newDate || dateCall || temporalNow) {
      const expression = node.getText(sf);
      console.log(`MER-BT-016\t${owner === "domain" ? "error" : "warn"}\t${path.relative(root, f)}:${lineOf(node)}\t${owner} reads ambient time via ${expression} — pass the instant or a clock dependency explicitly\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
