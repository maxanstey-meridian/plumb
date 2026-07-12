#!/usr/bin/env node
// MER-FE-014 — useProvideInject must bind the injected value, guard a missing
// value with a throw, then return the narrowed T after the guard.
// DOC: frontend-pa-vsa.md#provide--inject-pattern
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch { process.stderr.write("MER-FE-014: typescript not installed under plumb — skipping\n"); process.exit(0); }
const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};
const hasThrow = (node) => {
  let found = false;
  const visit = (child) => {
    if (ts.isThrowStatement(child)) found = true;
    else if (child !== node && (ts.isArrowFunction(child) || ts.isFunctionExpression(child) || ts.isFunctionDeclaration(child))) return;
    else ts.forEachChild(child, visit);
  };
  visit(node);
  return found;
};
const isBinding = (node, binding) => ts.isIdentifier(unwrap(node)) && unwrap(node).text === binding;
const isMissingValue = (node) => {
  const value = unwrap(node);
  return (ts.isIdentifier(value) && value.text === "undefined") || value.kind === ts.SyntaxKind.NullKeyword;
};
const testsMissing = (node, binding) => {
  const expression = unwrap(node);
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken)
    return isBinding(expression.operand, binding);
  if (!ts.isBinaryExpression(expression)) return false;
  if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    return testsMissing(expression.left, binding) && testsMissing(expression.right, binding);
  if (![ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken].includes(expression.operatorToken.kind)) return false;
  return (isBinding(expression.left, binding) && isMissingValue(expression.right)) ||
    (isMissingValue(expression.left) && isBinding(expression.right, binding));
};
const isT = (node) => node && ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === "T";
const validInjectFunction = (node) => {
  if (!node?.body || !ts.isBlock(node.body) || !isT(node.type)) return false;
  const statements = node.body.statements;
  for (let bindIndex = 0; bindIndex < statements.length; bindIndex++) {
    const statement = statements[bindIndex];
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
      const init = unwrap(declaration.initializer);
      if (!ts.isCallExpression(init)) continue;
      const callee = unwrap(init.expression);
      if (!ts.isIdentifier(callee) || (callee.text !== "inject" && callee.text !== "injectLocal")) continue;
      const binding = declaration.name.text;
      const guardIndex = statements.findIndex((candidate, index) => index > bindIndex && ts.isIfStatement(candidate) &&
        testsMissing(candidate.expression, binding) && hasThrow(candidate.thenStatement));
      if (guardIndex < 0) continue;
      const returned = statements.some((candidate, index) => index > guardIndex && ts.isReturnStatement(candidate) &&
        ts.isIdentifier(unwrap(candidate.expression)) && unwrap(candidate.expression).text === binding);
      if (returned) return true;
    }
  }
  return false;
};
const returnedInjectFunction = (helper) => {
  if (!helper?.body || !ts.isBlock(helper.body)) return null;
  const functions = new Map();
  for (const statement of helper.body.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, statement);
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const initializer = unwrap(declaration.initializer);
      if (ts.isIdentifier(declaration.name) && initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
        functions.set(declaration.name.text, initializer);
      }
    }
  }
  for (const statement of helper.body.statements) {
    if (!ts.isReturnStatement(statement)) continue;
    const tuple = unwrap(statement.expression);
    if (!tuple || !ts.isArrayLiteralExpression(tuple) || tuple.elements.length === 0) continue;
    const injectFunction = unwrap(tuple.elements[0]);
    if (ts.isArrowFunction(injectFunction) || ts.isFunctionExpression(injectFunction)) return injectFunction;
    if (ts.isIdentifier(injectFunction)) return functions.get(injectFunction.text) ?? null;
  }
  return null;
};

for (const file of walkFiles(root, root, { filter: (name) => /^use-?provide-?inject\.(ts|js)$/i.test(name) })) {
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  let helper = null;
  for (const statement of sf.statements) {
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === "useProvideInject") helper = statement;
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.name.text === "useProvideInject") helper = unwrap(declaration.initializer);
      }
    }
  }
  if (!helper) continue;
  const valid = validInjectFunction(returnedInjectFunction(helper));
  if (!valid) console.log(`MER-FE-014\twarn\t${path.relative(root, file)}:1\tuseProvideInject must throw when injection is missing and return a non-null T after that guard\tfrontend-pa-vsa.md#provide--inject-pattern`);
}
