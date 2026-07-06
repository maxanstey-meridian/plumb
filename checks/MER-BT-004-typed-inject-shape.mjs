#!/usr/bin/env node
// MER-BT-004 — typed-inject classes carry `public static inject = [...] as const`
// and constructor-promote their injected deps as `private readonly`.
// Self-gated: only runs when some package.json in the repo declares typed-inject —
// other DI containers (inversify, Nest) have their own idioms and are not findings.
// Mechanical slice: where `static inject` exists, the `as const` assertion and the
// parameter promotion are checkable; whether a class SHOULD be injectable is not.
// AST-tier: TS compiler API; missing typescript degrades per contract §4.
// DOC: backend-pa-vsa.md#typescript--nest
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch {
  process.stderr.write("MER-BT-004: typescript not installed under plumb — skipping (pnpm install in ~/Sites/plumb)\n");
  process.exit(0);
}

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

let typedInject = false;
for (const pkg of walkFiles(root, root, { filter: (name) => name === "package.json" })) {
  try { if (fs.readFileSync(pkg, "utf8").includes('"typed-inject"')) { typedInject = true; break; } } catch {}
}
if (!typedInject) process.exit(0);

for (const f of walkFiles(root, root, { filter: (name) => name.endsWith(".ts") })) {
  if (f.endsWith(".d.ts") || /\.(spec|test)\.ts$/.test(f) || /__tests__/.test(f)) continue;
  const src = fs.readFileSync(f, "utf8");
  if (!src.includes("static inject")) continue;
  const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const visit = (node) => {
    if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? "(anonymous)";
      const injectProp = node.members.find((m) =>
        ts.isPropertyDeclaration(m) && (ts.getCombinedModifierFlags(m) & ts.ModifierFlags.Static) &&
        ts.isIdentifier(m.name) && m.name.text === "inject");
      if (injectProp) {
        const init = injectProp.initializer;
        const isAsConst = init && ts.isAsExpression(init) && init.type.getText(sf) === "const";
        if (!isAsConst)
          console.log(`MER-BT-004\twarn\t${path.relative(root, f)}:${lineOf(injectProp)}\t${name}.inject must be declared "as const" so typed-inject can type-check the tokens\tbackend-pa-vsa.md#typescript--nest`);
        const ctor = node.members.find(ts.isConstructorDeclaration);
        for (const p of ctor?.parameters ?? []) {
          const mf = ts.getCombinedModifierFlags(p);
          if (!(mf & ts.ModifierFlags.Private) || !(mf & ts.ModifierFlags.Readonly))
            console.log(`MER-BT-004\twarn\t${path.relative(root, f)}:${lineOf(p)}\tinjected dependency "${p.name.getText(sf)}" in ${name} must be constructor-promoted private readonly\tbackend-pa-vsa.md#typescript--nest`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
