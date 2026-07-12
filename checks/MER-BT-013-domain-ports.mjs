#!/usr/bin/env node
// MER-BT-013 — repository ports belong to application, never domain.
// DOC: backend-pa-vsa.md#non-negotiable-dependency-rules
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walkFiles } from "./_lib/fs-scan.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const isTest = (f) => /\.(spec|test)\.[mc]?ts$/.test(f) || f.includes(`${path.sep}__tests__${path.sep}`);
const inDomain = (f) => f.split(path.sep).includes("domain");
const inDomainPorts = (f) => /[\\/]domain[\\/]ports[\\/]/.test(f);

for (const f of walkFiles(root, root, { filter: (name) => /\.[mc]?ts$/.test(name), depth: 12 })) {
  if (f.endsWith(".d.ts") || isTest(f) || !inDomain(f)) continue;
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  for (const node of sf.statements) {
    if (!ts.isClassDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) continue;
    const name = node.name?.text;
    if (!name || (!name.endsWith("Repository") && !inDomainPorts(f))) continue;
    console.log(`MER-BT-013\terror\t${path.relative(root, f)}:${lineOf(node)}\tdomain declaration ${name} is a port — repository and port contracts belong to application\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
  }
}
