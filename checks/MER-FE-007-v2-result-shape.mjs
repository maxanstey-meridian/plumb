#!/usr/bin/env node
// MER-FE-007 — Rivet v2 result handling: an awaited contracts-client
// .GET/.POST/... call returns openapi-fetch's { data, error, response } and
// NEVER throws on HTTP errors. Discarding the error channel silently maps HTTP
// failures to undefined data. Flags (contract §11.9, v8):
//   (a) destructuring that binds `data` but not `error`:
//       const { data } = await client.GET("/x")
//   (b) direct .data access on the awaited call expression:
//       (await client.GET("/x")).data
// Compliant: capture the result and test error !== undefined or an explicit
// response status. Never narrow on payload truthiness: false/zero/empty/null may
// be valid. Deliberately not flagged (below the §7 precision bar):
// general "must handle error" flow analysis, and .then()-chaining (style, not
// doctrine — .catch is a legitimate transport guard).
// v2-pinned: runs only under variant v2 or both. MER-FE-006 is the v1 analogue.
// Client names come from imports of the repo's detected contracts package(s) —
// derived from the workspace, never hardcoded.
// DOC: rivet.md#frontend-result-handling
import fs from "node:fs";
import path from "node:path";
import { findFeRoots, walkFiles } from "./_lib/fe-graph.mjs";
import { detectRivetVariant } from "./_lib/rivet-variant.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const det = detectRivetVariant(root);
const variant = process.env.PLUMB_RIVET_VARIANT || det.variant;
if (variant !== "v2" && variant !== "both") process.exit(0);

let ts;
try { ({ default: ts } = await import("typescript")); }
catch {
  process.stderr.write("MER-FE-007: typescript not installed under plumb — skipping (pnpm install in ~/Sites/plumb)\n");
  process.exit(0);
}

const isClientSpec = (spec) =>
  det.contractsPackages.some((p) => spec === p || spec.startsWith(p + "/")) ||
  /contracts\/(src\/)?(index|client)?$/.test(spec);
const VERB = /\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s*\(/;

function scan(file, code, lineOffset) {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const clientNames = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !isClientSpec(st.moduleSpecifier.text ?? "")) continue;
    const c = st.importClause;
    if (!c || c.isTypeOnly) continue;
    if (c.name) clientNames.add(c.name.text);
    if (c.namedBindings) {
      if (ts.isNamespaceImport(c.namedBindings)) clientNames.add(c.namedBindings.name.text);
      else for (const e of c.namedBindings.elements) if (!e.isTypeOnly) clientNames.add(e.name.text);
    }
  }
  if (!clientNames.size) return;
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1 + lineOffset;
  const leftmost = (e) => {
    while (ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) ||
           ts.isCallExpression(e) || ts.isNonNullExpression(e) || ts.isAwaitExpression(e) ||
           ts.isParenthesizedExpression(e)) e = e.expression;
    return ts.isIdentifier(e) ? e.text : null;
  };
  const isAwaitedClientCall = (e) =>
    ts.isAwaitExpression(e) && ts.isCallExpression(e.expression) &&
    clientNames.has(leftmost(e.expression)) && VERB.test(e.expression.getText(sf));
  const report = (node, what) =>
    console.log(`MER-FE-007\twarn\t${path.relative(root, file)}:${lineOf(node)}\t${what} — openapi-fetch never throws on HTTP errors; capture the result and handle { data, error }\trivet.md#frontend-result-handling`);
  const visit = (node) => {
    // (a) const { data } = await client.GET(...)  — data bound, error not
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name) &&
        isAwaitedClientCall(node.initializer)) {
      const bound = new Set(node.name.elements.map((el) =>
        (el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null)));
      if (bound.has("data") && !bound.has("error")) report(node, "destructured data without error from a v2 client call");
    }
    // (b) (await client.GET(...)).data
    if (ts.isPropertyAccessExpression(node) && node.name.text === "data" &&
        ts.isParenthesizedExpression(node.expression) && isAwaitedClientCall(node.expression.expression)) {
      report(node, "direct .data access on an awaited v2 client call");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}

for (const feRoot of findFeRoots(root)) {
  const appDir = fs.existsSync(path.join(feRoot, "app")) ? path.join(feRoot, "app") : feRoot;
  for (const f of walkFiles(appDir, /\.(ts|vue)$/)) {
    if (/\.(spec|test)\.ts$/.test(f) || /__tests__/.test(f) || f.endsWith(".d.ts")) continue;
    const src = fs.readFileSync(f, "utf8");
    if (f.endsWith(".vue")) {
      const m = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      if (!m) continue;
      const offset = src.slice(0, m.index + m[0].indexOf(m[1])).split("\n").length - 1;
      scan(f, m[1], offset);
    } else scan(f, src, 0);
  }
}
