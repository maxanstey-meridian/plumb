#!/usr/bin/env node
// MER-BT-020 — TS transport adapters call application; they do not own persistence.
// DOC: backend-pa-vsa.md#non-negotiable-dependency-rules
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walkFiles } from "./_lib/fs-scan.mjs";
import { resolveTsImport } from "./_lib/ts-resolution.mjs";

const rootArg = process.argv[2];
if (!rootArg || !fs.existsSync(rootArg)) process.exit(2);
const root = path.resolve(rootArg);

const DB_PACKAGE = /^(?:@prisma\/|prisma$|typeorm$|knex$|drizzle-orm(?:\/|$)|sequelize$|@mikro-orm\/|pg$|postgres$|mysql2$|mongodb$|mongoose$|redis$|ioredis$|better-sqlite3$|@aws-sdk\/(?:client|lib)-dynamodb$|aws-sdk\/clients\/dynamodb$)/;
const isTransport = (f) => {
  const parts = f.split(path.sep);
  if (parts.some((part) => ["domain", "application", "app", "infrastructure", "infra"].includes(part))) return false;
  return parts.some((part) => ["interface", "interfaces", "http", "controllers"].includes(part)) ||
    /(?:^|[-.])(?:controller|routes?|resolver|endpoint|handler)\.[mc]?ts$/.test(path.basename(f));
};
const classify = (f) => {
  const parts = f.split(path.sep);
  const modules = parts.lastIndexOf("modules");
  const module = modules >= 0 ? parts[modules + 1] : null;
  const layerIndex = parts.findIndex((part) => ["domain", "application", "app", "infrastructure", "infra", "interface", "interfaces", "http", "controllers"].includes(part));
  const owner = modules >= 0 ? parts.slice(0, modules + 2).join(path.sep) : (layerIndex >= 0 ? parts.slice(0, layerIndex).join(path.sep) : null);
  const infrastructure = parts.includes("infrastructure") || parts.includes("infra");
  return { module, owner, infrastructure };
};

for (const f of walkFiles(root, root, { filter: (name) => /\.[mc]?ts$/.test(name), depth: 12 })) {
  if (f.endsWith(".d.ts") || !isTransport(f) || /\.(spec|test)\.[mc]?ts$/.test(f)) continue;
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const references = [];
  const collect = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ node, spec: node.moduleSpecifier.text });
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      references.push({ node, spec: node.moduleReference.expression.text });
      return;
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === "require") || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      references.push({ node, spec: node.arguments[0].text });
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);
  for (const reference of references) {
    const { node, spec } = reference;
    if (!spec.startsWith(".") && DB_PACKAGE.test(spec)) {
      console.log(`MER-BT-020\terror\t${path.relative(root, f)}:${lineOf(node)}\ttransport imports database/ORM package "${spec}" — call an application use case or query instead\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
      continue;
    }
    const target = resolveTsImport(root, f, spec);
    if (!target) continue;
    const to = classify(target);
    if (to.infrastructure) {
      console.log(`MER-BT-020\terror\t${path.relative(root, f)}:${lineOf(node)}\ttransport imports infrastructure — call an application use case or query instead\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
    }
  }
}
