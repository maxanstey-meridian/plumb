#!/usr/bin/env node
// MER-BT-014 — shared/common ports must not expose a module-owned domain type.
// DOC: backend-pa-vsa.md#across-modules
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walkFiles } from "./_lib/fs-scan.mjs";
import { resolveTsImport } from "./_lib/ts-resolution.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const isSharedPort = (f) => /[\\/](?:common|shared)[\\/](?:application[\\/])?ports[\\/]/.test(f);
const moduleDomain = (f) => /[\\/]modules[\\/](?!common[\\/]|shared[\\/])[^\\/]+[\\/]domain(?:[\\/]|$)/.test(f);
const isExported = (node) => Boolean(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export);
const isAbstract = (node) => Boolean(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Abstract);

function surfaceNodes(node) {
  if (ts.isTypeAliasDeclaration(node)) return [node.type];
  if (ts.isInterfaceDeclaration(node)) return [...(node.typeParameters ?? []), ...(node.heritageClauses ?? []), ...node.members];
  if (ts.isFunctionDeclaration(node)) return [
    ...(node.typeParameters ?? []),
    ...node.parameters.flatMap((parameter) => parameter.type ? [parameter.type] : []),
    ...(node.type ? [node.type] : []),
  ];
  if (ts.isVariableDeclaration(node)) {
    const callable = node.type && ts.isFunctionTypeNode(node.type) ? node.type :
      node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer : null;
    if (!callable) return [];
    return [
      ...(callable.typeParameters ?? []),
      ...callable.parameters.flatMap((parameter) => parameter.type ? [parameter.type] : []),
      ...(callable.type ? [callable.type] : []),
    ];
  }
  if (!ts.isClassDeclaration(node) || !isAbstract(node)) return [];
  const nodes = [...(node.typeParameters ?? []), ...(node.heritageClauses ?? [])];
  for (const member of node.members) {
    if (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private) continue;
    if (ts.isPropertyDeclaration(member)) {
      if (member.type) nodes.push(member.type);
      continue;
    }
    if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member) || ts.isConstructorDeclaration(member)) {
      nodes.push(...(member.typeParameters ?? []));
      for (const parameter of member.parameters) if (parameter.type) nodes.push(parameter.type);
      if (member.type) nodes.push(member.type);
    }
  }
  return nodes;
}

function referencedTaint(nodes, tainted, file) {
  const used = new Set();
  const visit = (node) => {
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
      const target = resolveTsImport(root, file, node.argument.literal.text);
      if (target && moduleDomain(target)) {
        used.add(node.getText());
        return;
      }
    }
    if (ts.isIdentifier(node) && tainted.has(node.text)) used.add(node.text);
    ts.forEachChild(node, visit);
  };
  for (const node of nodes) visit(node);
  return used;
}

for (const f of walkFiles(root, root, { filter: (name) => /\.[mc]?ts$/.test(name), depth: 12 })) {
  if (f.endsWith(".d.ts") || !isSharedPort(f)) continue;
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  const tainted = new Set();
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) && !ts.isExportDeclaration(st)) continue;
    const spec = st.moduleSpecifier && ts.isStringLiteral(st.moduleSpecifier) ? st.moduleSpecifier.text : null;
    const target = spec && resolveTsImport(root, f, spec);
    if (!target || !moduleDomain(target)) continue;
    if (ts.isExportDeclaration(st)) {
      console.log(`MER-BT-014\terror\t${path.relative(root, f)}:${lineOf(st)}\tshared port re-exports module-owned domain types — publish a module contract instead\tbackend-pa-vsa.md#across-modules`);
      continue;
    }
    const clause = st.importClause;
    if (clause?.name) tainted.add(clause.name.text);
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const el of clause.namedBindings.elements) tainted.add(el.name.text);
    }
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) tainted.add(clause.namedBindings.name.text);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const st of sf.statements) {
      if ((!ts.isTypeAliasDeclaration(st) && !ts.isInterfaceDeclaration(st)) || tainted.has(st.name.text)) continue;
      if (referencedTaint(surfaceNodes(st), tainted, f).size) {
        tainted.add(st.name.text);
        changed = true;
      }
    }
  }

  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) && !st.moduleSpecifier && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) {
        const local = el.propertyName?.text ?? el.name.text;
        if (tainted.has(local)) console.log(`MER-BT-014\terror\t${path.relative(root, f)}:${lineOf(st)}\tshared port exports module-owned domain alias ${local} — use a shared or published contract\tbackend-pa-vsa.md#across-modules`);
      }
      continue;
    }
    if (!isExported(st)) continue;
    const surfaces = ts.isVariableStatement(st) ? st.declarationList.declarations :
      ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st) || ts.isFunctionDeclaration(st) || (ts.isClassDeclaration(st) && isAbstract(st)) ? [st] : [];
    for (const surface of surfaces) {
      const used = referencedTaint(surfaceNodes(surface), tainted, f);
      for (const name of used) {
        console.log(`MER-BT-014\terror\t${path.relative(root, f)}:${lineOf(surface)}\tshared port signature exposes module-owned domain type ${name} — use a shared or published contract\tbackend-pa-vsa.md#across-modules`);
      }
    }
  }
}
