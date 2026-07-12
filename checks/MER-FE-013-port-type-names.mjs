#!/usr/bin/env node
// MER-FE-013 — frontend ports are capabilities, not service/manager/helper/DTO
// objects. Only exported declarations in frontend ports directories are judged.
// DOC: frontend-pa-vsa.md#ports
import fs from "node:fs";
import path from "node:path";
import { findFeRoots, walkFiles } from "./_lib/fe-graph.mjs";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch { process.stderr.write("MER-FE-013: typescript not installed under plumb — skipping\n"); process.exit(0); }
const root = process.argv[2];
const BAD_NAME = /(?:DataService|Service|Manager|Helper)$|Dto(?:[A-Z]|$)/;

for (const feRoot of findFeRoots(root, Infinity)) {
  const appDir = fs.existsSync(path.join(feRoot, "app")) ? path.join(feRoot, "app") : feRoot;
  for (const file of walkFiles(appDir, /\.ts$/)) {
    if (!/[\\/]ports[\\/]/.test(file) || /[\\/]application[\\/]ports[\\/]/.test(file)) continue;
    const src = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    const laterExports = new Set();
    for (const st of sf.statements) {
      if (!ts.isExportDeclaration(st) || st.moduleSpecifier || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
      for (const element of st.exportClause.elements) laterExports.add((element.propertyName ?? element.name).text);
    }
    for (const st of sf.statements) {
      if ((!ts.isInterfaceDeclaration(st) && !ts.isTypeAliasDeclaration(st)) ||
          (!st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) && !laterExports.has(st.name.text)) || !BAD_NAME.test(st.name.text)) continue;
      const line = sf.getLineAndCharacterOfPosition(st.name.getStart(sf)).line + 1;
      console.log(`MER-FE-013\twarn\t${path.relative(root, file)}:${line}\tfrontend port type ${st.name.text} is role-shaped — name the capability, not a Service/Manager/Helper/DataService/Dto\tfrontend-pa-vsa.md#ports`);
    }
  }
}
