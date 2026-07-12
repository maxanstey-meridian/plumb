#!/usr/bin/env node
// MER-FE-021 — components importing implementation composables (use*).
// "Components should normally import injectX from ports/, not concrete
// implementation composables." Warn only when a matching injectX capability
// exists; without one, there is no mechanically provable bypass.
// Encoded exception: the useProvideInject helper itself.
// DOC: frontend-pa-vsa.md#components
import fs from "node:fs";
import path from "node:path";
import { findFeRoots, buildGraph, layerOf, walkFiles } from "./_lib/fe-graph.mjs";

const root = path.resolve(process.argv[2]);
let ts;
try { ({ default: ts } = await import("typescript")); }
catch { process.stderr.write("MER-FE-021: typescript not installed under plumb — skipping\n"); process.exit(0); }

const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};
const typeOnlyEdge = (file, line) => {
  const sf = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const anchor = imports.find((statement) => {
    const start = sf.getLineAndCharacterOfPosition(statement.getStart(sf)).line + 1;
    const end = sf.getLineAndCharacterOfPosition(statement.getEnd()).line + 1;
    return line >= start && line <= end;
  });
  if (!anchor || !ts.isStringLiteral(anchor.moduleSpecifier)) return false;
  const spec = anchor.moduleSpecifier.text;
  const isTypeOnly = (statement) => {
    const clause = statement.importClause;
    if (!clause) return false;
    if (clause.isTypeOnly) return true;
    return !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly);
  };
  return imports.filter((statement) => ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === spec).every(isTypeOnly);
};

function capabilityOf(file) {
  // use-rivet-auth.ts / useRivetAuth.ts -> "RivetAuth"
  const base = path.basename(file).replace(/\.(ts|js|mjs|vue)$/, "");
  if (!/^use[-A-Z]/.test(base)) return null;
  return base
    .replace(/^use-?/, "")
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");
}

function injectCaps(dir) {
  const caps = new Set();
  for (const f of walkFiles(dir, /\.ts$/)) {
    const src = fs.readFileSync(f, "utf8");
    const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
    const laterExports = new Set();
    for (const st of sf.statements) {
      if (!ts.isExportDeclaration(st) || st.moduleSpecifier || !st.exportClause || !ts.isNamedExports(st.exportClause)) continue;
      for (const e of st.exportClause.elements) laterExports.add((e.propertyName ?? e.name).text);
    }
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      const directExport = st.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      for (const d of st.declarationList.declarations) {
        if (!ts.isArrayBindingPattern(d.name) || d.name.elements.length !== 2) continue;
        const names = d.name.elements.map((e) => ts.isBindingElement(e) && ts.isIdentifier(e.name) ? e.name.text : "");
        if (!directExport && !names.every((name) => laterExports.has(name))) continue;
        const init = unwrap(d.initializer);
        if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(unwrap(init.expression)) || unwrap(init.expression).text !== "useProvideInject") continue;
        const match = names[0].match(/^inject([A-Z]\w*)$/);
        if (match && names[1] === `provide${match[1]}`) caps.add(match[1]);
      }
    }
  }
  return caps;
}

for (const feRoot of findFeRoots(root, Infinity)) {
  const g = await buildGraph(feRoot);
  if (!g) continue;
  const sharedCaps = injectCaps(path.join(g.appDir, "shared", "ports"));
  const subtreeCapsCache = new Map();
  for (const { from, to, line } of g.edges) {
    if (layerOf(from, g.appDir) !== "components" || layerOf(to, g.appDir) !== "composables") continue;
    if (typeOnlyEdge(from, line)) continue;
    const cap = capabilityOf(to);
    if (!cap || /^provideinject$/i.test(cap)) continue;
    // ports/ dirs on the path from the component up to app/
    const caps = new Set(sharedCaps);
    let d = path.dirname(from);
    while (d.startsWith(g.appDir)) {
      if (!subtreeCapsCache.has(d)) subtreeCapsCache.set(d, injectCaps(path.join(d, "ports")));
      for (const c of subtreeCapsCache.get(d)) caps.add(c);
      d = path.dirname(d);
    }
    const hit = [...caps].find((c) => cap === c || ["Rivet", "Platform", "Tauri"].some((prefix) => cap === `${prefix}${c}`));
    if (!hit) continue;
    const message = `component imports implementation composable ${path.basename(to)} but a port exists (inject${hit}) — inject the port instead`;
    console.log(
      `MER-FE-021\twarn\t${path.relative(root, from)}:${line}\t${message}\tfrontend-pa-vsa.md#components`
    );
  }
}
