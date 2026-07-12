#!/usr/bin/env node
// MER-FE-030 — migration shims are suspect; curated public feature entry points
// are legal and require contextual review.
// DOC: frontend-pa-vsa.md#promotion
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walkFiles } from "./_lib/fs-scan.mjs";

const rootArg = process.argv[2];
if (!rootArg || !fs.existsSync(rootArg)) process.exit(2);
const root = path.resolve(rootArg);
const exportedEntryPoints = new Map();

const packageEntries = (packageFile) => {
  if (exportedEntryPoints.has(packageFile)) return exportedEntryPoints.get(packageFile);
  const entries = new Set();
  try {
    const collect = (value) => {
      if (typeof value === "string") entries.add(value.replace(/^\.\//, ""));
      else if (value && typeof value === "object") Object.values(value).forEach(collect);
    };
    collect(JSON.parse(fs.readFileSync(packageFile, "utf8")).exports);
  } catch {}
  exportedEntryPoints.set(packageFile, entries);
  return entries;
};

const isPackageEntryPoint = (file) => {
  for (let dir = path.dirname(file); dir.startsWith(root); dir = path.dirname(dir)) {
    const packageFile = path.join(dir, "package.json");
    if (fs.existsSync(packageFile)) {
      const relative = path.relative(dir, file).split(path.sep).join("/");
      return packageEntries(packageFile).has(relative);
    }
    if (dir === root) break;
  }
  return false;
};

const isExempt = (file, source) => {
  const parts = path.relative(root, file).split(path.sep);
  if (parts.some((part) => /^(?:generated|gen|\.nuxt)$/i.test(part))) return true;
  if (/(?:@generated|auto-generated|generated[^\n]*do not edit)/i.test(source.slice(0, 500))) return true;
  if (isPackageEntryPoint(file)) return true;
  return parts.some((part, index) =>
    part === "app" &&
    parts[index + 1] === "features" &&
    Boolean(parts[index + 2]) &&
    parts[index + 3] === "index.ts" &&
    index + 4 === parts.length
  );
};

function findReExports(file, source, lineOffset = 0) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
  for (const statement of sf.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) continue;
    const line = sf.getLineAndCharacterOfPosition(statement.getStart(sf)).line + 1 + lineOffset;
    console.log(`MER-FE-030\twarn\t${path.relative(root, file)}:${line}\tre-export found — delete migration shims; keep only a deliberate curated public feature entry point\tfrontend-pa-vsa.md#promotion`);
  }
}

for (const file of walkFiles(root, root, { filter: (name) => /\.(?:ts|tsx|vue)$/.test(name) })) {
  const source = fs.readFileSync(file, "utf8");
  if (isExempt(file, source)) continue;
  if (!file.endsWith(".vue")) {
    findReExports(file, source);
    continue;
  }
  for (const match of source.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    const body = match[1];
    const bodyStart = match.index + match[0].indexOf(body);
    const lineOffset = (source.slice(0, bodyStart).match(/\n/g) || []).length;
    findReExports(file, body, lineOffset);
  }
}
