import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { report, under } from "./helpers.mjs";

const generatedRef = "tools.md#generated-code";
const nuxtRef = "tools.md#typescript--vue--nuxt";
const sourceExtensions = [".js", ".mjs", ".cjs", ".ts", ".mts", ".cts"];
const vitestExtensions = [".ts", ".js", ".mjs", ".mts", ".cts"];

function relative(from, to) {
  const fromParts = from ? from.split("/") : [];
  const toParts = to ? to.split("/") : [];
  while (fromParts.length && toParts.length && fromParts[0] === toParts[0]) {
    fromParts.shift();
    toParts.shift();
  }
  return [...fromParts.map(() => ".."), ...toParts].join("/");
}

function normalize(directory, specifier) {
  const parts = [...(directory ? directory.split("/") : []), ...specifier.split("/")];
  const normalized = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!normalized.length) return null;
      normalized.pop();
    } else normalized.push(part);
  }
  return normalized.join("/");
}

function resolveLocalImport(context, from, specifier, extensions, indexes) {
  if (!specifier.startsWith(".")) return null;
  const target = normalize(from.directory, specifier);
  if (target === null) return null;
  const candidates = [target, ...extensions.map((extension) => target + extension)];
  if (indexes) candidates.push(...extensions.map((extension) => `${target}/index${extension}`));
  for (const candidate of candidates) {
    const file = context.file(candidate);
    if (file) return file;
  }
  return null;
}

function globRegex(pattern) {
  let source = "";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*" && pattern[index + 2] === "/") {
      source += "(?:.*/)?";
      index += 2;
    } else if (char === "*" && pattern[index + 1] === "*") {
      source += ".*";
      index++;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[\\^$+?.()|{}\[\]]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

function covers(pattern, target) {
  if (typeof pattern !== "string" || pattern.startsWith("!")) return false;
  const normalized = pattern.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").replace(/\/$/, "/**");
  const candidate = target.replace(/\\/g, "/").replace(/^\.\//, "");
  try {
    const expression = globRegex(normalized);
    return expression.test(candidate) || expression.test(`${candidate}/__generated_file__`);
  } catch {
    return false;
  }
}

function nearestAncestor(directory, candidates) {
  return candidates
    .filter((candidate) => !candidate.directory || directory.startsWith(`${candidate.directory}/`))
    .sort((a, b) => b.directory.length - a.directory.length)[0];
}

function propertyName(ts, node) {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;
}

function unwrap(ts, expression) {
  let node = expression;
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) {
    node = node.expression;
  }
  return node;
}

async function eslintIgnorePatterns(context, ts, file, exportName = "default", seen = new Set()) {
  const key = `${file.path}#${exportName}`;
  if (seen.has(key)) return [];
  seen.add(key);
  const source = await context.typescript.source(file);
  if (!source) return [];
  const patterns = [];
  const declarations = new Map();
  const imports = new Map();
  const globalIgnoreHelpers = new Set();
  const eslintConfigNamespaces = new Set();
  let exported = null;
  for (const statement of source.sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.importClause) {
      const specifier = statement.moduleSpecifier.text;
      if (statement.importClause.name) imports.set(statement.importClause.name.text, { specifier, name: "default" });
      if (statement.importClause.namedBindings && ts.isNamedImports(statement.importClause.namedBindings)) {
        for (const element of statement.importClause.namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          imports.set(element.name.text, { specifier, name: importedName });
          if (specifier === "eslint/config" && importedName === "globalIgnores") globalIgnoreHelpers.add(element.name.text);
        }
      }
      if (specifier === "eslint/config" && statement.importClause.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings)) {
        eslintConfigNamespaces.add(statement.importClause.namedBindings.name.text);
      }
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && declaration.initializer) declarations.set(declaration.name.text, declaration.initializer);
      }
    }
    if (exportName === "default" && ts.isExportAssignment(statement) && !statement.isExportEquals) exported = statement.expression;
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const element of statement.exportClause.elements) {
        if (element.name.text !== exportName) continue;
        const localName = element.propertyName?.text ?? element.name.text;
        if (statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)) {
          const imported = resolveLocalImport(context, file, statement.moduleSpecifier.text, sourceExtensions, true);
          if (imported) patterns.push(...await eslintIgnorePatterns(context, ts, imported, localName, seen));
        } else if (declarations.has(localName)) exported = declarations.get(localName);
      }
    }
  }
  if (exportName !== "default" && declarations.has(exportName)) exported = declarations.get(exportName);

  const evaluatingStrings = new Set();
  const stringValues = (expression) => {
    const node = unwrap(ts, expression);
    if (!node || evaluatingStrings.has(node)) return [];
    evaluatingStrings.add(node);
    let values = [];
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) values = [node.text];
    else if (ts.isArrayLiteralExpression(node)) {
      values = node.elements.flatMap((element) => stringValues(ts.isSpreadElement(element) ? element.expression : element));
    } else if (ts.isIdentifier(node) && declarations.has(node.text)) values = stringValues(declarations.get(node.text));
    evaluatingStrings.delete(node);
    return values;
  };
  const collecting = new Set();
  const collect = async (expression) => {
    const node = unwrap(ts, expression);
    if (!node || collecting.has(node)) return;
    collecting.add(node);
    if (ts.isIdentifier(node)) {
      if (declarations.has(node.text)) await collect(declarations.get(node.text));
      else if (imports.has(node.text)) {
        const binding = imports.get(node.text);
        const imported = resolveLocalImport(context, file, binding.specifier, sourceExtensions, true);
        if (imported) patterns.push(...await eslintIgnorePatterns(context, ts, imported, binding.name, seen));
      }
    } else if (ts.isArrayLiteralExpression(node)) {
      for (const element of node.elements) await collect(ts.isSpreadElement(element) ? element.expression : element);
    } else if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (ts.isPropertyAssignment(property) && propertyName(ts, property.name) === "ignores") {
          patterns.push(...stringValues(property.initializer));
        } else if (ts.isSpreadAssignment(property)) await collect(property.expression);
      }
    } else if (ts.isCallExpression(node)) {
      const helper = ts.isIdentifier(node.expression) && globalIgnoreHelpers.has(node.expression.text);
      const namespacedHelper = ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.expression) &&
        eslintConfigNamespaces.has(node.expression.expression.text) && node.expression.name.text === "globalIgnores";
      if (helper || namespacedHelper) {
        for (const argument of node.arguments) patterns.push(...stringValues(argument));
      } else {
        for (const argument of node.arguments) await collect(argument);
      }
    } else if (ts.isConditionalExpression(node)) {
      await collect(node.whenTrue);
      await collect(node.whenFalse);
    }
    collecting.delete(node);
  };
  await collect(exported);
  return patterns;
}

function resolveObject(ts, expression, declarations, resolving = new Set()) {
  const node = unwrap(ts, expression);
  if (!node || resolving.has(node)) return null;
  resolving.add(node);
  let object = null;
  if (ts.isObjectLiteralExpression(node)) object = node;
  else if (ts.isCallExpression(node) && node.arguments.length) object = resolveObject(ts, node.arguments[0], declarations, resolving);
  else if (ts.isIdentifier(node) && declarations.has(node.text)) object = resolveObject(ts, declarations.get(node.text), declarations, resolving);
  resolving.delete(node);
  return object;
}

function objectProperty(ts, object, name) {
  return object?.properties.find((item) => ts.isPropertyAssignment(item) && propertyName(ts, item.name) === name);
}

async function happyDomState(context, ts, file, seen = new Set()) {
  if (seen.has(file.path)) return null;
  seen.add(file.path);
  const source = await context.typescript.source(file);
  if (!source) return null;
  const declarations = new Map();
  const imports = new Map();
  for (const statement of source.sourceFile.statements) {
    if (ts.isImportDeclaration(statement) && statement.importClause?.name && ts.isStringLiteral(statement.moduleSpecifier)) {
      imports.set(statement.importClause.name.text, statement.moduleSpecifier.text);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) declarations.set(declaration.name.text, declaration.initializer);
    }
  }
  const exported = source.sourceFile.statements.find(ts.isExportAssignment);
  if (!exported) return false;
  const exportedValue = unwrap(ts, exported.expression);
  if (ts.isIdentifier(exportedValue) && imports.has(exportedValue.text)) {
    const imported = resolveLocalImport(context, file, imports.get(exportedValue.text), vitestExtensions, false);
    return imported ? happyDomState(context, ts, imported, seen) : null;
  }
  const config = resolveObject(ts, exported.expression, declarations);
  if (!config) return null;
  const test = objectProperty(ts, config, "test");
  const testObject = test ? resolveObject(ts, test.initializer, declarations) : null;
  if (!testObject) return false;
  const environment = objectProperty(ts, testObject, "environment");
  const value = environment ? unwrap(ts, environment.initializer) : null;
  return !!value && (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) && value.text === "happy-dom";
}

export const toTypeScriptRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TO-003", source: "in-process/to-typescript.mjs" }),
    requirements: [Capability.TYPESCRIPT],
    async analyze(context) {
      const ts = await context.typescript.runtime();
      if (!ts) return;
      const generated = new Set(context.rivet?.v2Dirs ?? []);
      for (const file of context.files) {
        const segments = file.directory ? file.directory.split("/") : [];
        for (let index = 0; index < segments.length; index++) {
          if (/^(?:generated|gen|openapi-generated)$/i.test(segments[index])) generated.add(segments.slice(0, index + 1).join("/"));
        }
      }
      if (!generated.size) return;
      const oxFiles = context.files.filter((file) => file.name === ".oxlintrc.json");
      const eslintFiles = context.files.filter((file) => /^eslint\.config\.(?:js|mjs|cjs|ts)$/.test(file.name));
      for (const directory of generated) {
        const ox = nearestAncestor(directory, oxFiles);
        let oxPatterns = [];
        if (ox) {
          const parsed = ox.json();
          if (parsed.ok && Array.isArray(parsed.value.ignorePatterns)) {
            oxPatterns = parsed.value.ignorePatterns.filter((value) => typeof value === "string");
          }
        }
        const oxTarget = ox ? relative(ox.directory, directory) : directory;
        if (!oxPatterns.some((pattern) => covers(pattern, oxTarget))) {
          report(context, "warn", ox?.path ?? ".oxlintrc.json", 1, `${directory} is generated but is not covered by oxlint ignorePatterns`, generatedRef);
        }

        const eslint = nearestAncestor(directory, eslintFiles);
        if (!eslint) continue;
        const eslintTarget = relative(eslint.directory, directory);
        const patterns = await eslintIgnorePatterns(context, ts, eslint);
        if (!patterns.some((pattern) => covers(pattern, eslintTarget))) {
          report(context, "warn", eslint.path, 1, `${directory} is generated but is not covered by this eslint config's ignores`, generatedRef);
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TO-004", source: "in-process/to-typescript.mjs" }),
    requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
    async analyze(context) {
      const ts = await context.typescript.runtime();
      if (!ts) return;
      for (const root of context.frontendRoots.all()) {
        const packagePath = root.path ? `${root.path}/package.json` : "package.json";
        const packageFile = context.file(packagePath);
        if (!packageFile) continue;
        const parsed = packageFile.json();
        if (!parsed.ok) continue;
        const pkg = parsed.value;
        const typecheck = Object.values(pkg.scripts ?? {}).find((script) =>
          typeof script === "string" && /(?:\bvue-tsc\b|\b(?:nuxi|nuxt)\s+typecheck\b)/.test(script));
        if (!typecheck) {
          report(context, "warn", packageFile.path, 1, "Nuxt TypeScript package needs a script using vue-tsc or Nuxt typecheck", nuxtRef);
        }

        const files = context.files.filter((file) => under(file.path, root.path));
        const tests = files.filter((file) => /\.(?:spec|test)\.(?:ts|tsx|js|jsx)$/.test(file.name));
        if (!tests.length) continue;
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const vitestScript = Object.values(pkg.scripts ?? {}).some((script) => typeof script === "string" && /\bvitest\b/.test(script));
        const explicitVitestConfigs = files.filter((file) => /^vitest\.config\.(?:ts|js|mjs)$/.test(file.name));
        const viteConfigs = files.filter((file) => /^vite\.config\.(?:ts|js|mjs)$/.test(file.name));
        const vitestConfigs = explicitVitestConfigs.length ? explicitVitestConfigs : viteConfigs;
        const states = [];
        for (const file of vitestConfigs) states.push(await happyDomState(context, ts, file));
        const environmentAccepted = states.length > 0 && states.every((state) => state === true);
        if (!(deps.vitest && deps["happy-dom"] && vitestScript && environmentAccepted)) {
          report(context, "warn", packageFile.path, 1, "Nuxt tests need Vitest, happy-dom, a vitest script, and test.environment set to happy-dom", nuxtRef);
        }
      }
    },
  }),
]);
