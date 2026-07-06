#!/usr/bin/env node
// MER-BT-001 — TS ports are abstract classes used as DI tokens: every exported
// class in a port file is `abstract`, carries a `private constructor()`, and has
// only abstract methods — no fields, no non-abstract methods, no statics.
// "Treat these ports as runtime DI keys with interface semantics, not as OO base
// classes." Port file := anything under a lowercase application/ports/ dir, or
// *.port.ts anywhere (naming is dir-based per FABLE_CONTRACT.md §9.1; the suffix
// is the escape hatch for a port outside a ports dir). The lowercase path keeps
// C#'s Application/Ports out of scope. Type/interface exports alongside are fine.
// AST-tier: TS compiler API; missing typescript degrades per contract §4.
// DOC: backend-pa-vsa.md#typescript--nest-port-convention
import fs from "node:fs";
import path from "node:path";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch {
  process.stderr.write("MER-BT-001: typescript not installed under plumb — skipping (pnpm install in ~/Sites/plumb)\n");
  process.exit(0);
}

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

let walkFiles;
try {
  ({ walkFiles } = await import("./_lib/fs-scan.mjs"));
} catch {
  const SKIP = new Set(["node_modules", ".git", ".nuxt", ".output", "dist", "build", "obj", "bin"]);
  walkFiles = function* (rootDir, startDir = rootDir, { filter = () => true, extraSkipDirs = [] } = {}) {
    function* rec(dir) {
      let es;
      try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of es) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP.has(e.name) && !extraSkipDirs.includes(e.name)) yield* rec(p);
        } else if (filter(e.name, p)) yield p;
      }
    }
    yield* rec(startDir);
  };
}

const isPortFile = (f) =>
  (f.includes(`application${path.sep}ports${path.sep}`) || f.endsWith(".port.ts")) &&
  !f.endsWith(".d.ts") && !/\.(spec|test)\.ts$/.test(f) && !/__tests__/.test(f);

function emit(file, line, msg) {
  console.log(`MER-BT-001\terror\t${path.relative(root, file)}:${line}\t${msg}\tbackend-pa-vsa.md#typescript--nest-port-convention`);
}

for (const f of walkFiles(root, root, { filter: (name) => name.endsWith(".ts") })) {
  if (!isPortFile(f)) continue;
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  for (const st of sf.statements) {
    if (!ts.isClassDeclaration(st)) continue;
    const mods = ts.getCombinedModifierFlags(st);
    if (!(mods & ts.ModifierFlags.Export)) continue;
    const name = st.name?.text ?? "(anonymous)";
    if (!(mods & ts.ModifierFlags.Abstract)) {
      emit(f, lineOf(st), `port class ${name} must be abstract — ports are DI tokens with interface semantics`);
      continue;
    }
    let ctor = null;
    for (const m of st.members) {
      if (ts.isConstructorDeclaration(m)) { ctor = m; continue; }
      const mf = ts.getCombinedModifierFlags(m);
      if (mf & ts.ModifierFlags.Static) { emit(f, lineOf(m), `port class ${name} may not have static members`); continue; }
      if (ts.isPropertyDeclaration(m)) { emit(f, lineOf(m), `port class ${name} may not declare fields — ports are stateless`); continue; }
      if (ts.isMethodDeclaration(m) && !(mf & ts.ModifierFlags.Abstract)) {
        emit(f, lineOf(m), `port class ${name} may only declare abstract methods — no implementation in a port`);
      }
    }
    if (!ctor) emit(f, lineOf(st), `port class ${name} needs a private constructor() so it cannot be instantiated or extended as a base type`);
    else if (!(ts.getCombinedModifierFlags(ctor) & ts.ModifierFlags.Private))
      emit(f, lineOf(ctor), `port class ${name}'s constructor must be private`);
    else if (ctor.parameters.length || (ctor.body && ctor.body.statements.length))
      emit(f, lineOf(ctor), `port class ${name}'s private constructor must be empty — no factory logic in a port`);
  }
}
