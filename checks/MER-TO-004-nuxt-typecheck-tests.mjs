#!/usr/bin/env node
// MER-TO-004 — Nuxt TypeScript packages typecheck with vue-tsc; packages that
// contain tests use Vitest with happy-dom. The two concerns emit independently.
// DOC: tools.md#typescript--vue--nuxt
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch { process.stderr.write("MER-TO-004: typescript not installed under plumb — skipping\n"); process.exit(0); }
const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);
const files = [...walkFiles(root, root, { filter: () => true })];
const nuxtDirs = new Set(files.filter((f) => /^nuxt\.config\.(ts|js|mjs)$/.test(path.basename(f))).map(path.dirname));
const rel = (f) => path.relative(root, f).split(path.sep).join("/");
const emit = (loc, msg) => console.log(`MER-TO-004\twarn\t${loc}\t${msg}\ttools.md#typescript--vue--nuxt`);
const nameOf = (node) => ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;
const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};
const resolveObject = (expression, declarations) => {
  const node = unwrap(expression);
  if (ts.isObjectLiteralExpression(node)) return node;
  if (ts.isCallExpression(node) && node.arguments.length) return resolveObject(node.arguments[0], declarations);
  if (ts.isIdentifier(node) && declarations.has(node.text)) return resolveObject(declarations.get(node.text), declarations);
  return null;
};
const property = (object, name) => object?.properties.find((item) => ts.isPropertyAssignment(item) && nameOf(item.name) === name);
const resolveLocalImport = (from, specifier) => {
  if (!specifier.startsWith(".")) return null;
  const target = path.resolve(path.dirname(from), specifier);
  for (const candidate of [target, ...[".ts", ".js", ".mjs", ".mts", ".cts"].map((extension) => target + extension)]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
};
const happyDomState = (file, seen = new Set()) => {
  if (seen.has(file)) return null;
  seen.add(file);
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const declarations = new Map();
  const imports = new Map();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.name && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.set(statement.importClause.name.text, statement.moduleSpecifier.text);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations)
      if (ts.isIdentifier(declaration.name) && declaration.initializer) declarations.set(declaration.name.text, declaration.initializer);
  }
  const exported = sf.statements.find(ts.isExportAssignment);
  if (!exported) return false;
  const exportedValue = unwrap(exported.expression);
  if (ts.isIdentifier(exportedValue) && imports.has(exportedValue.text)) {
    const imported = resolveLocalImport(file, imports.get(exportedValue.text));
    return imported ? happyDomState(imported, seen) : null;
  }
  const config = resolveObject(exported.expression, declarations);
  if (!config) return null;
  const test = property(config, "test");
  const testObject = test ? resolveObject(test.initializer, declarations) : null;
  if (!testObject) return false;
  const environment = property(testObject, "environment");
  const value = environment ? unwrap(environment.initializer) : null;
  return !!value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) && value.text === "happy-dom";
};

for (const dir of nuxtDirs) {
  const packageFile = path.join(dir, "package.json");
  if (!fs.existsSync(packageFile)) continue;
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(packageFile, "utf8")); }
  catch { continue; }
  const typecheck = Object.values(pkg.scripts ?? {}).find((script) =>
    typeof script === "string" && /(?:\bvue-tsc\b|\b(?:nuxi|nuxt)\s+typecheck\b)/.test(script));
  if (!typecheck)
    emit(`${rel(packageFile)}:1`, "Nuxt TypeScript package needs a script using vue-tsc or Nuxt typecheck");

  const tests = files.filter((f) => f.startsWith(dir + path.sep) && /\.(?:spec|test)\.(?:ts|tsx|js|jsx)$/.test(f));
  if (!tests.length) continue;
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const vitestScript = Object.values(pkg.scripts ?? {}).some((v) => typeof v === "string" && /\bvitest\b/.test(v));
  const explicitVitestConfigs = files.filter((f) => f.startsWith(dir + path.sep) && /^vitest\.config\.(?:ts|js|mjs)$/.test(path.basename(f)));
  const viteConfigs = files.filter((f) => f.startsWith(dir + path.sep) && /^vite\.config\.(?:ts|js|mjs)$/.test(path.basename(f)));
  const vitestConfigs = explicitVitestConfigs.length ? explicitVitestConfigs : viteConfigs;
  const states = vitestConfigs.map((file) => happyDomState(file));
  const environmentAccepted = states.length > 0 && states.every((state) => state === true);
  if (!(deps.vitest && deps["happy-dom"] && vitestScript && environmentAccepted))
    emit(`${rel(packageFile)}:1`, "Nuxt tests need Vitest, happy-dom, a vitest script, and test.environment set to happy-dom");
}
