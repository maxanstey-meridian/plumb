#!/usr/bin/env node
// MER-TO-003 — each generated tree is ignored by the nearest applicable oxlint
// and eslint flat config. Ignore values are parsed structurally, never from text.
// DOC: tools.md#generated-code
import fs from "node:fs";
import path from "node:path";
import { walkDirs, walkFiles } from "./_lib/fs-scan.mjs";
import { detectRivetVariant } from "./_lib/rivet-variant.mjs";

let ts;
try { ({ default: ts } = await import("typescript")); }
catch { process.stderr.write("MER-TO-003: typescript not installed under plumb — skipping\n"); process.exit(0); }
const arg = process.argv[2];
if (!arg || !fs.existsSync(arg)) process.exit(2);
const root = path.resolve(arg);
const generated = new Set(detectRivetVariant(root).v2Dirs.map((dir) => path.resolve(dir)));
for (const dir of walkDirs(root, root, { filter: (name) => /^(generated|gen|openapi-generated)$/i.test(name) })) generated.add(path.resolve(dir));
if (!generated.size) process.exit(0);

const rel = (file) => path.relative(root, file).split(path.sep).join("/");
const out = (file, message) => console.log(`MER-TO-003\twarn\t${file}\t${message}\ttools.md#generated-code`);
const ancestors = (file, candidates) => candidates
  .filter((candidate) => file.startsWith(path.dirname(candidate) + path.sep))
  .sort((a, b) => path.dirname(b).length - path.dirname(a).length);
const globRegex = (pattern) => {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];
    if (char === "*" && pattern[i + 1] === "*" && pattern[i + 2] === "/") { source += "(?:.*/)?"; i += 2; }
    else if (char === "*" && pattern[i + 1] === "*") { source += ".*"; i++; }
    else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
};
const covers = (pattern, target) => {
  if (typeof pattern !== "string" || pattern.startsWith("!")) return false;
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/$/, "/**");
  const candidate = target.replace(/\\/g, "/").replace(/^\.\//, "");
  try {
    const re = globRegex(normalized);
    return re.test(candidate) || re.test(`${candidate}/__generated_file__`);
  } catch { return false; }
};
const propertyName = (node) => ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;
const unwrap = (node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};
const resolveLocalImport = (from, specifier) => {
  if (!specifier.startsWith(".")) return null;
  const target = path.resolve(path.dirname(from), specifier);
  const extensions = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"];
  for (const candidate of [target, ...extensions.map((extension) => target + extension),
    ...extensions.map((extension) => path.join(target, `index${extension}`))]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
};
const eslintIgnorePatterns = (file, exportName = "default", seen = new Set()) => {
  const key = `${file}#${exportName}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const src = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
  const patterns = [];
  const declarations = new Map();
  const imports = new Map();
  const globalIgnoreHelpers = new Set();
  const eslintConfigNamespaces = new Set();
  let exported = null;
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.importClause) {
      const specifier = statement.moduleSpecifier.text;
      if (statement.importClause.name) imports.set(statement.importClause.name.text, { specifier, name: "default" });
      if (statement.importClause.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
        for (const element of statement.importClause.namedBindings.elements) {
          imports.set(element.name.text, { specifier, name: element.propertyName?.text ?? element.name.text });
          if (specifier === "eslint/config" && (element.propertyName?.text ?? element.name.text) === "globalIgnores")
            globalIgnoreHelpers.add(element.name.text);
        }
      }
      if (specifier === "eslint/config" && statement.importClause.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings))
        eslintConfigNamespaces.add(statement.importClause.namedBindings.name.text);
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer) declarations.set(declaration.name.text, declaration.initializer);
    }
    if (exportName === "default" && ts.isExportAssignment(statement) && !statement.isExportEquals) exported = statement.expression;
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== exportName) continue;
        const localName = element.propertyName?.text ?? element.name.text;
        if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          const imported = resolveLocalImport(file, statement.moduleSpecifier.text);
          if (imported) patterns.push(...eslintIgnorePatterns(imported, localName, seen));
        } else if (declarations.has(localName)) exported = declarations.get(localName);
      }
    }
  }
  if (exportName !== "default" && declarations.has(exportName)) exported = declarations.get(exportName);

  const stringValues = (expression) => {
    const node = unwrap(expression);
    if (!node) return [];
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
    if (ts.isArrayLiteralExpression(node)) return node.elements.flatMap((element) =>
      ts.isSpreadElement(element) ? stringValues(element.expression) : stringValues(element));
    if (ts.isIdentifier(node) && declarations.has(node.text)) return stringValues(declarations.get(node.text));
    return [];
  };
  const collect = (expression) => {
    const node = unwrap(expression);
    if (!node) return;
    if (ts.isIdentifier(node)) {
      if (declarations.has(node.text)) collect(declarations.get(node.text));
      else if (imports.has(node.text)) {
        const importedBinding = imports.get(node.text);
        const imported = resolveLocalImport(file, importedBinding.specifier);
        if (imported) patterns.push(...eslintIgnorePatterns(imported, importedBinding.name, seen));
      }
      return;
    }
    if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) collect(ts.isSpreadElement(element) ? element.expression : element);
      return;
    }
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && propertyName(property.name) === "ignores")
          patterns.push(...stringValues(property.initializer));
        else if (ts.isSpreadAssignment(property)) collect(property.expression);
      }
      return;
    }
    if (ts.isCallExpression(node)) {
      const helper = ts.isIdentifier(node.expression) && globalIgnoreHelpers.has(node.expression.text);
      const namespacedHelper = ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
        eslintConfigNamespaces.has(node.expression.expression.text) && node.expression.name.text === "globalIgnores";
      if (helper || namespacedHelper) {
        for (const argument of node.arguments) patterns.push(...stringValues(argument));
        return;
      }
      for (const argument of node.arguments) collect(argument);
      return;
    }
    if (ts.isConditionalExpression(node)) {
      collect(node.whenTrue);
      collect(node.whenFalse);
    }
  };
  collect(exported);
  return patterns;
};

const oxFiles = [...walkFiles(root, root, { filter: (name) => name === ".oxlintrc.json" })].map((file) => path.resolve(file));
const eslintFiles = [...walkFiles(root, root, { filter: (name) => /^eslint\.config\.(?:js|mjs|cjs|ts)$/.test(name) })].map((file) => path.resolve(file));
for (const dir of generated) {
  const target = rel(dir);
  const ox = ancestors(dir, oxFiles)[0];
  let oxPatterns = [];
  if (ox) {
    try {
      const parsed = JSON.parse(fs.readFileSync(ox, "utf8"));
      if (Array.isArray(parsed.ignorePatterns)) oxPatterns = parsed.ignorePatterns.filter((value) => typeof value === "string");
    } catch {}
  }
  const oxTarget = ox ? path.relative(path.dirname(ox), dir).split(path.sep).join("/") : target;
  if (!oxPatterns.some((pattern) => covers(pattern, oxTarget)))
    out(`${ox ? rel(ox) : ".oxlintrc.json"}:1`, `${target} is generated but is not covered by oxlint ignorePatterns`);

  const eslint = ancestors(dir, eslintFiles)[0];
  if (!eslint) continue;
  const eslintTarget = path.relative(path.dirname(eslint), dir).split(path.sep).join("/");
  if (!eslintIgnorePatterns(eslint).some((pattern) => covers(pattern, eslintTarget)))
    out(`${rel(eslint)}:1`, `${target} is generated but is not covered by this eslint config's ignores`);
}
