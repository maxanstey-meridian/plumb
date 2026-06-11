#!/usr/bin/env node
// MER-FE-006 — result handling for generated Rivet clients is `{ unwrap: false }`
// plus `.isOk()` / `.isNotFound()` narrowing — status codes as values. Fork settled
// 2026-06-10 (FABLE_REVIEW.md): flag try/catch wrapped around a generated-client
// call (casebridge's unwrap-and-throw + RivetError style is the backlog).
// AST-tier: TS compiler API (plumb's own node_modules, contract §2.3); .vue script
// blocks extracted by regex with line-offset correction (TS does not parse SFCs).
// Missing typescript degrades per contract §4: stderr diagnostic, exit 0.
// Encoded exception (calibration 2026-06-10, speechscribe use-access-groups.ts et
// al, 20 hits): calls that already pass `unwrap: false` are compliant — try/catch
// around them is transport/network-error handling, not the unwrap-and-throw style.
// Only calls WITHOUT unwrap: false inside a try block are findings.
// Encoded exception (same calibration, use-rivet-auth.ts loginUrl()): only AWAITED
// calls are findings — sync client helpers (URL builders) return no result to
// narrow, so try/catch around them is not the unwrap-and-throw style.
// v1-pinned (contract §5 v8): `unwrap: false` is unsatisfiable under Rivet v2's
// openapi-fetch facade (it never throws on HTTP errors) — suppressed under pure
// v2; runs under v1/both/none. Bare @scope/contracts package imports count as
// client imports only under confirmed v1 (under none, a pre-generation v2
// checkout would otherwise get v1 advice). MER-FE-007 is the v2 analogue.
// DOC: rivet.md#frontend-result-handling
import fs from "node:fs";
import path from "node:path";
import { findFeRoots, walkFiles } from "./_lib/fe-graph.mjs";
import { rivetVariant } from "./_lib/rivet-variant.mjs";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch {
  process.stderr.write("MER-FE-006: typescript not installed under plumb — skipping (pnpm install in ~/.meridian/plumb)\n");
  process.exit(0);
}

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const variant = rivetVariant(root);
if (variant === "v2") process.exit(0);
const CLIENT_SPEC = variant === "v1"
  ? /(generated\/(rivet\/)?client|contracts\/client|@[\w.-]+\/contracts)/
  : /(generated\/(rivet\/)?client|contracts\/client)/;

function scan(file, code, lineOffset) {
  const sf = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const clientNames = new Set();
  for (const st of sf.statements) {
    if (!ts.isImportDeclaration(st) || !CLIENT_SPEC.test(st.moduleSpecifier.text ?? "")) continue;
    const c = st.importClause;
    if (!c) continue;
    if (c.name) clientNames.add(c.name.text);
    if (c.namedBindings) {
      if (ts.isNamespaceImport(c.namedBindings)) clientNames.add(c.namedBindings.name.text);
      else for (const e of c.namedBindings.elements) clientNames.add(e.name.text);
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
  const visit = (node, inTry) => {
    if (ts.isTryStatement(node)) {
      ts.forEachChild(node.tryBlock, (c) => visit(c, true));
      if (node.catchClause) visit(node.catchClause, false);
      if (node.finallyBlock) visit(node.finallyBlock, false);
      return;
    }
    if (inTry && ts.isCallExpression(node) && ts.isAwaitExpression(node.parent) &&
        clientNames.has(leftmost(node.expression)) &&
        !/unwrap\s*:\s*false/.test(node.getText(sf))) {
      console.log(`MER-FE-006\twarn\t${path.relative(root, file)}:${lineOf(node)}\tdo not try/catch generated client calls — pass { unwrap: false } and narrow on .isOk()\trivet.md#frontend-result-handling`);
    }
    ts.forEachChild(node, (c) => visit(c, inTry));
  };
  ts.forEachChild(sf, (c) => visit(c, false));
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
