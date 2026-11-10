import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { isNuxtConfig } from "../engine/frontend-analysis.mjs";
import { isGenerated, isTestScript, report } from "./helpers.mjs";
import { parseTemplateExpression, templateExpressions } from "./vue-template.mjs";

const source = "in-process/fe-typescript.mjs";
const docErrorChannel = "rules/rivet/branch-on-the-error-channel-not-on-data.md";
const docClientPackage = "rules/rivet/import-the-client-and-types-from-the-contracts-package.md";
const docPortFile = "rules/frontend/keep-a-port-file-to-its-type-and-pair.md";
const docPortNaming = "rules/coding/name-ports-for-capabilities-and-adapters-for-implementations.md";
const docProvideInject = "rules/frontend/create-port-pairs-with-the-typed-helper.md";
const docPortShape = "rules/frontend/shape-a-port-around-operations-not-dtos.md";
const docCompositionRoots = "rules/frontend/provide-capabilities-only-in-composition-roots.md";
const docOwningFile = "rules/coding/import-from-the-file-that-owns-the-code.md";
const docPageLocal = "rules/frontend/never-import-another-pages-local-code.md";
const docFileNaming = "rules/frontend/name-a-composable-file-after-its-function.md";
const docSinglePageApps = "rules/frontend/build-frontends-as-single-page-apps.md";
const under = (file, directory) => !directory || file === directory || file.startsWith(`${directory}/`);
const parentOf = (value) => value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
const baseOf = (value) => value.slice(value.lastIndexOf("/") + 1);
const join = (...parts) => {
  const output = [];
  for (const part of parts.join("/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (output.length && output.at(-1) !== "..") output.pop();
      else output.push("..");
    }
    else output.push(part);
  }
  return output.join("/");
};
const appFiles = (context, root) => context.files.filter((file) => under(file.path, root.appPath));
// Test source (by the shared frontend definition, relative to the file's frontend root) or a declaration file.
const testOrDeclaration = (context, file) =>
  isTestScript(context, file) || file.path.endsWith(".d.ts");
const hasExport = (ts, statement) => statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);

const unwrap = (ts, node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};

const leftmostCallOwner = (ts, expression) => {
  let node = expression;
  while (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ||
    ts.isCallExpression(node) || ts.isNonNullExpression(node) || ts.isAwaitExpression(node) ||
    ts.isParenthesizedExpression(node)) node = node.expression;
  return ts.isIdentifier(node) ? node.text : null;
};

async function representations(context, file, vue = "all") {
  if (!file.path.endsWith(".vue")) {
    const representation = await context.typescript.source(file);
    return representation ? [representation] : [];
  }
  const blocks = vue === "first" ? [context.typescript.vueScript(file)].filter(Boolean) : context.typescript.vueScripts(file);
  return (await Promise.all(blocks.map((block) => context.typescript.vueSource(block)))).filter(Boolean);
}

function packageOwner(context, directory) {
  let current = directory;
  for (;;) {
    if (context.file(current ? `${current}/package.json` : "package.json")) return current;
    if (!current) return directory;
    current = parentOf(current);
  }
}

function laterExports(ts, sourceFile) {
  const exports = new Set();
  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    for (const element of statement.exportClause.elements) exports.add((element.propertyName ?? element.name).text);
  }
  return exports;
}

const fe007 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-007", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    if (!context.rivet.artifactDirs.length) return;
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const isClientSpec = (specifier) => context.rivet.contractsPackages.some((name) => specifier === name || specifier.startsWith(`${name}/`)) ||
      /contracts\/(src\/)?(index|client)?$/.test(specifier);
    const verb = /\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s*\(/;
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of appFiles(context, root)) {
        if (!/\.(?:ts|vue)$/.test(file.path) || testOrDeclaration(context, file)) continue;
        for (const representation of await representations(context, file, "first")) {
          const clientNames = new Set();
          for (const statement of representation.sourceFile.statements) {
            if (!ts.isImportDeclaration(statement) || !isClientSpec(statement.moduleSpecifier.text ?? "")) continue;
            const clause = statement.importClause;
            if (!clause || clause.isTypeOnly) continue;
            if (clause.name) clientNames.add(clause.name.text);
            if (clause.namedBindings) {
              if (ts.isNamespaceImport(clause.namedBindings)) clientNames.add(clause.namedBindings.name.text);
              else for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) clientNames.add(element.name.text);
            }
          }
          if (!clientNames.size) continue;
          const awaitedClientCall = (node) => ts.isAwaitExpression(node) && ts.isCallExpression(node.expression) &&
            clientNames.has(leftmostCallOwner(ts, node.expression)) && verb.test(node.expression.getText(representation.sourceFile));
          const emit = (node, what) => report(context, "warn", file.path, representation.lineOf(node),
            `${what} — openapi-fetch never throws on HTTP errors; capture the result and handle { data, error }`, docErrorChannel);
          const visit = (node) => {
            if (ts.isVariableDeclaration(node) && node.initializer && ts.isObjectBindingPattern(node.name) && awaitedClientCall(node.initializer)) {
              const bound = new Set(node.name.elements.map((element) => element.propertyName && ts.isIdentifier(element.propertyName)
                ? element.propertyName.text : ts.isIdentifier(element.name) ? element.name.text : null));
              if (bound.has("data") && !bound.has("error")) emit(node, "destructured data without error from a v2 client call");
            }
            if (ts.isPropertyAccessExpression(node) && node.name.text === "data" && ts.isParenthesizedExpression(node.expression) &&
                awaitedClientCall(node.expression.expression)) emit(node, "direct .data access on an awaited v2 client call");
            ts.forEachChild(node, visit);
          };
          visit(representation.sourceFile);
        }
      }
    }
  },
});

const fe008 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-008", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    if (!context.rivet.artifactDirs.length) return;
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const owners = context.rivet.artifactDirs.map((directory) => packageOwner(context, directory));
    const owned = (file) => owners.some((owner) => owner ? file.path.startsWith(`${owner}/`) : Boolean(file.path));
    const callOwner = (node) => {
      while (node && (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node) ||
        ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
      return ts.isIdentifier(node) ? node.text : null;
    };
    for (const root of context.frontendRoots.all()) {
      for (const file of appFiles(context, root)) {
        if (!/\.(?:ts|js|mjs|vue)$/.test(file.path) || owned(file)) continue;
        for (const representation of await representations(context, file, "first")) {
          const bindings = new Set();
          for (const statement of representation.sourceFile.statements) {
            if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== "openapi-fetch") continue;
            const clause = statement.importClause;
            if (!clause || clause.isTypeOnly) continue;
            if (clause.name) bindings.add(clause.name.text);
            if (clause.namedBindings) {
              if (ts.isNamespaceImport(clause.namedBindings)) bindings.add(clause.namedBindings.name.text);
              else for (const element of clause.namedBindings.elements) if (!element.isTypeOnly) bindings.add(element.name.text);
            }
          }
          if (!bindings.size) continue;
          const visit = (node) => {
            if (ts.isCallExpression(node) && bindings.has(callOwner(node.expression))) {
              report(context, "error", file.path, representation.lineOf(node), "openapi-fetch client construction belongs in the generated contracts package facade, not app/UI source", docClientPackage);
            }
            ts.forEachChild(node, visit);
          };
          visit(representation.sourceFile);
        }
      }
    }
  },
});

const fe010 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-010", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const helper = /use-?provide-?inject/i;
    const emit = (file, representation, node, message) => report(context, "error", file.path, representation.lineOf(node), message, docPortFile);
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of appFiles(context, root)) {
        if (!file.path.endsWith(".ts") || !/(^|\/)ports\//.test(file.path) || /(^|\/)application\/ports\//.test(file.path) || testOrDeclaration(context, file)) continue;
        const representation = await context.typescript.source(file);
        if (!representation) continue;
        for (const statement of representation.sourceFile.statements) {
          if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) continue;
          if (ts.canHaveModifiers(statement) && ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Ambient) continue;
          if (ts.isImportDeclaration(statement)) {
            const clause = statement.importClause;
            const specifier = statement.moduleSpecifier.text ?? "";
            if (!clause) { emit(file, representation, statement, `port files may not contain side-effect imports (import "${specifier}")`); continue; }
            if (clause.isTypeOnly) continue;
            const named = clause.namedBindings;
            if (named && ts.isNamedImports(named) && !clause.name && named.elements.every((element) => element.isTypeOnly)) continue;
            if (helper.test(specifier)) continue;
            emit(file, representation, statement, `port files may import only types and the useProvideInject helper — value import from "${specifier}"`);
            continue;
          }
          if (ts.isExportDeclaration(statement)) {
            if (statement.isTypeOnly) continue;
            emit(file, representation, statement, "port files may not re-export values — export types only");
            continue;
          }
          if (ts.isVariableStatement(statement)) {
            const declarations = statement.declarationList.declarations;
            const tuple = declarations.length === 1 && declarations[0].initializer && ts.isCallExpression(declarations[0].initializer) &&
              helper.test(declarations[0].initializer.expression.getText(representation.sourceFile));
            if (tuple) continue;
            const injectHelper = declarations.every((declaration) => ts.isIdentifier(declaration.name) && /^inject[A-Z]/.test(declaration.name.text) &&
              declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer)));
            if (injectHelper) continue;
            emit(file, representation, statement, "the only value a port file may declare is the [injectX, provideX] = useProvideInject tuple");
            continue;
          }
          emit(file, representation, statement, "port files contain only type definitions and the provide/inject tuple — no functions, classes, or executable statements");
        }
      }
    }
  },
});

const fe011 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-011", source }),
  requirements: [Capability.TYPESCRIPT],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    for (const file of context.files) {
      if (!file.path.endsWith(".ts") || !file.path.split("/").includes("ports") || file.path.endsWith(".d.ts")) continue;
      const representation = await context.typescript.source(file);
      if (!representation) continue;
      const exports = laterExports(ts, representation.sourceFile);
      for (const statement of representation.sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isArrayBindingPattern(declaration.name)) continue;
          const names = declaration.name.elements.map((element) => ts.isBindingElement(element) && ts.isIdentifier(element.name) ? element.name.text : "");
          if (!names.some((name) => /^(inject|provide)[A-Z]/.test(name)) &&
              !(declaration.initializer && /\buseProvideInject\b/.test(declaration.initializer.getText(representation.sourceFile)))) continue;
          const issues = [];
          if (names.length !== 2) issues.push(`tuple must contain exactly two elements — got ${names.length}`);
          if (!hasExport(ts, statement) && !names.every((name) => exports.has(name))) issues.push("tuple must be exported");
          const init = unwrap(ts, declaration.initializer);
          const call = init && ts.isCallExpression(init) ? init : null;
          const callee = call ? unwrap(ts, call.expression) : null;
          if (!callee || !ts.isIdentifier(callee) || callee.text !== "useProvideInject") issues.push("tuple must invoke useProvideInject");
          if (names.length === 2) {
            const inject = names[0].match(/^inject([A-Z]\w*)$/);
            const provide = names[1].match(/^provide([A-Z]\w*)$/);
            if (!inject || !provide) issues.push(`tuple must be ordered [injectX, provideX] — got [${names.join(", ")}]`);
            else if (inject[1] !== provide[1]) issues.push(`inject/provide suffixes must match — got ${inject[1]} and ${provide[1]}`);
          }
          if (issues.length) report(context, "error", file.path, representation.lineOf(declaration), issues.join("; "), docProvideInject);
        }
      }
    }
  },
});

const fe013 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-013", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const badName = /(?:DataService|Service|Manager|Helper)$|Dto(?:[A-Z]|$)/;
    for (const root of context.frontendRoots.all()) {
      for (const file of appFiles(context, root)) {
        if (!file.path.endsWith(".ts") || !file.path.split("/").includes("ports") || /(^|\/)application\/ports\//.test(file.path)) continue;
        const representation = await context.typescript.source(file);
        if (!representation) continue;
        const exports = laterExports(ts, representation.sourceFile);
        for (const statement of representation.sourceFile.statements) {
          if ((!ts.isInterfaceDeclaration(statement) && !ts.isTypeAliasDeclaration(statement)) ||
              (!hasExport(ts, statement) && !exports.has(statement.name.text)) || !badName.test(statement.name.text)) continue;
          report(context, "warn", file.path, representation.lineOf(statement.name),
            `frontend port type ${statement.name.text} is role-shaped — name the capability, not a Service/Manager/Helper/DataService/Dto`, docPortNaming);
        }
      }
    }
  },
});

const fe014 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-014", source }),
  requirements: [Capability.TYPESCRIPT],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const hasThrow = (node) => {
      let found = false;
      const visit = (child) => {
        if (ts.isThrowStatement(child)) found = true;
        else if (child !== node && (ts.isArrowFunction(child) || ts.isFunctionExpression(child) || ts.isFunctionDeclaration(child))) return;
        else ts.forEachChild(child, visit);
      };
      visit(node);
      return found;
    };
    const isBinding = (node, binding) => ts.isIdentifier(unwrap(ts, node)) && unwrap(ts, node).text === binding;
    const isMissingValue = (node) => {
      const value = unwrap(ts, node);
      return (ts.isIdentifier(value) && value.text === "undefined") || value.kind === ts.SyntaxKind.NullKeyword;
    };
    const testsMissing = (node, binding) => {
      const expression = unwrap(ts, node);
      if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) return isBinding(expression.operand, binding);
      if (!ts.isBinaryExpression(expression)) return false;
      if (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken) return testsMissing(expression.left, binding) && testsMissing(expression.right, binding);
      if (![ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.EqualsEqualsEqualsToken].includes(expression.operatorToken.kind)) return false;
      return (isBinding(expression.left, binding) && isMissingValue(expression.right)) ||
        (isMissingValue(expression.left) && isBinding(expression.right, binding));
    };
    const validInjectFunction = (node) => {
      if (!node?.body || !ts.isBlock(node.body) || !node.type || !ts.isTypeReferenceNode(node.type) ||
          !ts.isIdentifier(node.type.typeName) || node.type.typeName.text !== "T") return false;
      const statements = node.body.statements;
      for (let bindIndex = 0; bindIndex < statements.length; bindIndex++) {
        const statement = statements[bindIndex];
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          if (!ts.isIdentifier(declaration.name) || !declaration.initializer) continue;
          const init = unwrap(ts, declaration.initializer);
          if (!ts.isCallExpression(init)) continue;
          const callee = unwrap(ts, init.expression);
          if (!ts.isIdentifier(callee) || (callee.text !== "inject" && callee.text !== "injectLocal")) continue;
          const binding = declaration.name.text;
          const guardIndex = statements.findIndex((candidate, index) => index > bindIndex && ts.isIfStatement(candidate) &&
            testsMissing(candidate.expression, binding) && hasThrow(candidate.thenStatement));
          if (guardIndex < 0) continue;
          if (statements.some((candidate, index) => index > guardIndex && ts.isReturnStatement(candidate) &&
              ts.isIdentifier(unwrap(ts, candidate.expression)) && unwrap(ts, candidate.expression).text === binding)) return true;
        }
      }
      return false;
    };
    const returnedInjectFunction = (helper) => {
      if (!helper?.body || !ts.isBlock(helper.body)) return null;
      const functions = new Map();
      for (const statement of helper.body.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name) functions.set(statement.name.text, statement);
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
          const initializer = unwrap(ts, declaration.initializer);
          if (ts.isIdentifier(declaration.name) && initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))) {
            functions.set(declaration.name.text, initializer);
          }
        }
      }
      for (const statement of helper.body.statements) {
        if (!ts.isReturnStatement(statement)) continue;
        const tuple = unwrap(ts, statement.expression);
        if (!tuple || !ts.isArrayLiteralExpression(tuple) || !tuple.elements.length) continue;
        const injectFunction = unwrap(ts, tuple.elements[0]);
        if (ts.isArrowFunction(injectFunction) || ts.isFunctionExpression(injectFunction)) return injectFunction;
        if (ts.isIdentifier(injectFunction)) return functions.get(injectFunction.text) ?? null;
      }
      return null;
    };
    for (const file of context.files) {
      if (!/^use-?provide-?inject\.(?:ts|js)$/i.test(file.name)) continue;
      const representation = await context.typescript.source(file);
      if (!representation) continue;
      let helper = null;
      for (const statement of representation.sourceFile.statements) {
        if (ts.isFunctionDeclaration(statement) && statement.name?.text === "useProvideInject") helper = statement;
        if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.name.text === "useProvideInject") helper = unwrap(ts, declaration.initializer);
        }
      }
      if (helper && !validInjectFunction(returnedInjectFunction(helper))) report(context, "warn", file.path, 1,
        "useProvideInject must throw when injection is missing and return a non-null T after that guard", docProvideInject);
    }
  },
});

const fe015 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-015", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const clients = new Map();
    for (const file of context.files) {
      if (!file.path.endsWith(".ts") || !file.path.split("/").includes("generated")) continue;
      const text = file.text();
      if (!/Generated by Rivet/i.test(text)) continue;
      const names = new Set([...text.matchAll(/^export (?:async )?function (\w+)/gm)].map((match) => match[1]));
      if (names.size) clients.set(file, names);
    }
    if (!clients.size) return;
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of appFiles(context, root)) {
        if (!file.path.endsWith(".ts") || !/(^|\/)ports\//.test(file.path) || testOrDeclaration(context, file)) continue;
        const representation = await context.typescript.source(file);
        if (!representation) continue;
        for (const statement of representation.sourceFile.statements) {
          if (!ts.isInterfaceDeclaration(statement)) continue;
          const methods = statement.members.filter((member) => ts.isMethodSignature(member) ||
            (ts.isPropertySignature(member) && member.type && ts.isFunctionTypeNode(member.type)))
            .map((member) => member.name?.getText(representation.sourceFile)).filter(Boolean);
          if (methods.length < 2) continue;
          for (const [client, names] of clients) {
            if (!methods.every((method) => names.has(method))) continue;
            report(context, "info", file.path, representation.lineOf(statement),
              `port ${statement.name.text} mirrors generated client ${client.path} one-for-one (${methods.join(", ")}) — a fake API abstraction; shape the port around what the page needs`, docPortShape);
            break;
          }
        }
      }
    }
  },
});

const fe020 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-020", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const localDirectories = new Set(["components", "composables", "logic", "ports", "adapters"]);
    const shell = (file) => {
      const parts = file.path.split("/");
      if (parts.at(-1) === "app.vue") return true;
      const layouts = parts.lastIndexOf("layouts");
      if (layouts >= 0 && parts.length === layouts + 2 && file.path.endsWith(".vue")) return true;
      const pages = parts.lastIndexOf("pages");
      return pages >= 0 && file.path.endsWith(".vue") && !parts.slice(pages + 1, -1).some((part) => localDirectories.has(part));
    };
    for (const file of context.files) {
      // Test harnesses legitimately provide capabilities to mount a component in isolation.
      if (!/\.(?:ts|vue)$/.test(file.path) || shell(file) || testOrDeclaration(context, file)) continue;
      for (const representation of await representations(context, file)) {
        const aliases = new Set();
        const namespaces = new Set();
        for (const statement of representation.sourceFile.statements) {
          if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly) continue;
          const bindings = statement.importClause?.namedBindings;
          if (bindings && ts.isNamedImports(bindings)) for (const element of bindings.elements) {
            const imported = element.propertyName?.text ?? element.name.text;
            if (!element.isTypeOnly && /^provide[A-Z][A-Za-z0-9]*$/.test(imported) && imported !== "provideLocal") aliases.add(element.name.text);
          }
          else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
        }
        const visit = (node) => {
          if (ts.isCallExpression(node)) {
            const callee = node.expression;
            const direct = ts.isIdentifier(callee) && ((/^provide[A-Z][A-Za-z0-9]*$/.test(callee.text) && callee.text !== "provideLocal") || aliases.has(callee.text));
            const namespaced = ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression) && namespaces.has(callee.expression.text) &&
              /^provide[A-Z][A-Za-z0-9]*$/.test(callee.name.text) && callee.name.text !== "provideLocal";
            if (direct || namespaced) report(context, "error", file.path, representation.lineOf(node.expression),
              "provideX is shell wiring — move it to app.vue, a layout, or a page; use props/events for local collaboration", docCompositionRoots);
          }
          ts.forEachChild(node, visit);
        };
        visit(representation.sourceFile);
      }
    }
  },
});

const fe030 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-030", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const packageEntries = new Map();
    const entriesFor = (packageFile) => {
      if (packageEntries.has(packageFile.path)) return packageEntries.get(packageFile.path);
      const entries = new Set();
      try {
        const collect = (value) => {
          if (typeof value === "string") entries.add(value.replace(/^\.\//, ""));
          else if (value && typeof value === "object") Object.values(value).forEach(collect);
        };
        collect(JSON.parse(packageFile.text()).exports);
      } catch {}
      packageEntries.set(packageFile.path, entries);
      return entries;
    };
    const packageEntry = (file) => {
      let directory = file.directory;
      for (;;) {
        const packageFile = context.file(directory ? `${directory}/package.json` : "package.json");
        if (packageFile) return entriesFor(packageFile).has(directory ? file.path.slice(directory.length + 1) : file.path);
        if (!directory) return false;
        directory = parentOf(directory);
      }
    };
    // Test support barrels (tests/support/index.ts) are test code, judged by testing doctrine.
    const exempt = (file) => {
      if (isGenerated(file) || isTestScript(context, file)) return true;
      const parts = file.path.split("/");
      if (packageEntry(file)) return true;
      return parts.some((part, index) => part === "app" && parts[index + 1] === "features" && Boolean(parts[index + 2]) &&
        parts[index + 3] === "index.ts" && index + 4 === parts.length);
    };
    for (const file of context.files) {
      if (!/\.(?:ts|tsx|vue)$/.test(file.path) || exempt(file)) continue;
      for (const representation of await representations(context, file)) {
        for (const statement of representation.sourceFile.statements) {
          if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) report(context, "warn", file.path, representation.lineOf(statement),
            "re-export found — delete migration shims; keep only a deliberate curated public feature entry point", docOwningFile);
        }
      }
    }
  },
});

const fe032 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-032", source }),
  requirements: [Capability.TYPESCRIPT],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const containers = new Set();
    for (const file of context.files) {
      const parts = file.path.split("/");
      for (let index = 0; index < parts.length - 1; index++) {
        if ((parts[index] === "pages" || parts[index] === "layouts") && (index === 0 || parts[index - 1] === "app")) {
          const parent = parts.slice(0, index).join("/");
          if (!parent || baseOf(parent) === "app") containers.add(parts.slice(0, index + 1).join("/"));
        }
      }
    }
    const orderedContainers = [...containers].sort();
    const subtreeOf = (container, file) => file.slice(container.length + 1).split("/")[0].replace(/\.(vue|ts)$/, "");
    for (const container of orderedContainers) {
      const sourceDirectory = parentOf(container);
      const appRoot = baseOf(sourceDirectory) === "app" ? parentOf(sourceDirectory) : sourceDirectory;
      for (const file of context.files) {
        if (!under(file.path, container) || !/\.(?:ts|vue)$/.test(file.path)) continue;
        const ownSubtree = subtreeOf(container, file.path);
        for (const representation of await representations(context, file)) {
          const imports = [];
          const visit = (node) => {
            if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
              imports.push({ specifier: node.moduleSpecifier.text, line: representation.lineOf(node) });
            } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
              imports.push({ specifier: node.arguments[0].text, line: representation.lineOf(node) });
            }
            ts.forEachChild(node, visit);
          };
          visit(representation.sourceFile);
          for (const imported of imports) {
            const specifier = imported.specifier;
            let resolved = null;
            if (specifier.startsWith(".")) resolved = join(file.directory, specifier);
            else if (specifier.startsWith("~/") || specifier.startsWith("@/")) resolved = join(sourceDirectory, specifier.slice(2));
            else if (specifier.startsWith("~~/") || specifier.startsWith("@@/")) resolved = join(appRoot, specifier.slice(3));
            const targetContainer = resolved && orderedContainers.find((candidate) => resolved.startsWith(`${candidate}/`));
            if (!targetContainer) continue;
            const target = subtreeOf(targetContainer, resolved);
            if ((targetContainer !== container || target !== ownSubtree) && target !== "") report(context, "error", file.path, imported.line,
              `${baseOf(container)} subtree ${ownSubtree} deep-imports ${target} — move generic code to app/shared, preserve product ownership in app/features, or expose a public feature contract`, docPageLocal);
          }
        }
      }
    }
  },
});

const fe040 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-040", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    for (const root of context.frontendRoots.all()) {
      for (const file of appFiles(context, root)) {
        if (!/\.(?:ts|js)$/.test(file.path) || !file.path.split("/").includes("composables")) continue;
        const base = file.name.replace(/\.(ts|js)$/, "");
        if (!/^use(?:-|[A-Z])/.test(base)) continue;
        const expected = base.replace(/-([a-z0-9])/g, (_, character) => character.toUpperCase());
        const representation = await context.typescript.source(file);
        if (!representation) continue;
        const matchingExportLocals = new Set();
        const defaultExports = new Set();
        for (const statement of representation.sourceFile.statements) {
          if (ts.isExportAssignment(statement) && !statement.isExportEquals && ts.isIdentifier(unwrap(ts, statement.expression))) {
            defaultExports.add(unwrap(ts, statement.expression).text);
          }
          if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
          for (const element of statement.exportClause.elements) if (element.name.text === expected) {
            matchingExportLocals.add((element.propertyName ?? element.name).text);
          }
        }
        const matches = representation.sourceFile.statements.some((statement) => {
          const direct = hasExport(ts, statement);
          if (ts.isFunctionDeclaration(statement)) return statement.name &&
            (direct && statement.name.text === expected || matchingExportLocals.has(statement.name.text) || defaultExports.has(statement.name.text));
          return ts.isVariableStatement(statement) && statement.declarationList.declarations.some((declaration) =>
            ts.isIdentifier(declaration.name) && (direct && declaration.name.text === expected || matchingExportLocals.has(declaration.name.text) || defaultExports.has(declaration.name.text)) &&
            declaration.initializer && (ts.isArrowFunction(unwrap(ts, declaration.initializer)) || ts.isFunctionExpression(unwrap(ts, declaration.initializer))));
        });
        if (!matches) report(context, "warn", file.path, 1, `${base} composable file must export a matching ${expected} function`, docFileNaming);
      }
    }
  },
});

const fe044 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-044", source }),
  requirements: [Capability.TYPESCRIPT],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const objectFromExport = (expression, declarations) => {
      const value = unwrap(ts, expression);
      if (ts.isObjectLiteralExpression(value)) return value;
      if (ts.isCallExpression(value) && ts.isIdentifier(value.expression) && value.expression.text === "defineNuxtConfig" && value.arguments.length) {
        const argument = unwrap(ts, value.arguments[0]);
        return ts.isObjectLiteralExpression(argument) ? argument : null;
      }
      if (ts.isIdentifier(value) && declarations.has(value.text)) return objectFromExport(declarations.get(value.text), declarations);
      return null;
    };
    for (const file of context.files) {
      if (!isNuxtConfig(file.name)) continue;
      const representation = await context.typescript.source(file);
      if (!representation) continue;
      const declarations = new Map();
      for (const statement of representation.sourceFile.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name) && declaration.initializer) {
          declarations.set(declaration.name.text, declaration.initializer);
        }
      }
      const exported = representation.sourceFile.statements.find(ts.isExportAssignment);
      const config = exported ? objectFromExport(exported.expression, declarations) : null;
      const accepted = config?.properties.some((property) => {
        if (!ts.isPropertyAssignment(property)) return false;
        const name = ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : "";
        return name === "ssr" && unwrap(ts, property.initializer).kind === ts.SyntaxKind.FalseKeyword;
      });
      if (!accepted) report(context, "warn", file.path, 1, "Nuxt SPA config must explicitly set ssr: false", docSinglePageApps);
    }
  },
});

// MER-FE-046: a port pair whose inject is called in app code while its provide is called nowhere in app code
// (error: the inject throws at runtime), and the reverse (warn: nothing consumes what is provided).
//
// This is a whole-repository static check of whether each side is used at all. It does not prove that a provider
// is an ancestor of the injector at runtime, so a pass is not proof of correct wiring: a pair provided in one page
// and injected in another passes here and still throws.
//
// The pair's two names come from the destructuring, not from the inject/provide naming convention. A side is used by
// any reference to its name outside an import or export specifier: a call, a value alias (`const p = provideX`), a
// call in a template expression. The rule abstains wherever it can't prove a side unused. A reference is traced to its
// pair through imports, renamed imports, namespace imports (`import * as` and `export * as`), default exports,
// destructured dynamic imports, and re-exports (renamed or `export *`), across relative specifiers and Nuxt's ~, @,
// ~~, and @@ aliases. A namespace or a dynamic import used as a value uses everything its module exports. A name the
// rule can't trace falls back to matching pairs by the name they are declared or exported under anywhere in the
// repository: a reference with no import and no local declaration (a Nuxt auto-import), or an import from a specifier
// it can't resolve (a workspace package or a tsconfig path).
//
// Modules are resolved by hand, not with context.typescript.resolve: an unbuilt Nuxt app's tsconfig extends
// .nuxt/tsconfig.json, which doesn't exist, so that resolver degrades the run, and Nuxt's aliases are all this needs.
//
// Calls in test sources count for neither side: a provide that only tests call leaves the app's pages unprovided.
// A pair outside every Nuxt app (a component library or a layer) is a warning rather than an error: its host
// application may provide it.
const fe046 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-046", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const extensions = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".vue"];
    const modules = new Map();
    const pairs = [];
    const dynamicImport = (node) => {
      let call = unwrap(ts, node);
      if (call && ts.isAwaitExpression(call)) call = unwrap(ts, call.expression);
      return call && ts.isCallExpression(call) && call.expression.kind === ts.SyntaxKind.ImportKeyword &&
        call.arguments.length === 1 && ts.isStringLiteralLike(call.arguments[0]) ? call : null;
    };
    for (const file of context.files) {
      if (!extensions.some((extension) => file.path.endsWith(extension)) || /\.d\.[mc]?ts$/.test(file.path) || isGenerated(file)) continue;
      // `refs` holds every reference to a name outside an import or export specifier; `dynamic` the dynamic imports
      // whose result isn't destructured or bound to a name.
      const module = {
        file, test: isTestScript(context, file), imports: new Map(), declared: new Set(), exports: new Map(),
        exportedLocals: new Set(), stars: [], pairs: [], refs: [], dynamic: [], bare: new Map(),
      };
      const candidates = [];
      const bound = (name, into) => {
        if (ts.isIdentifier(name)) into.push(name.text);
        else for (const element of name.elements) if (ts.isBindingElement(element)) bound(element.name, into);
        return into;
      };
      // Walks one parsed expression or script, a Vue template expression included.
      const scan = (sourceFile, lineOf) => {
        const handled = new Set();
        const visit = (node) => {
          if (ts.isTypeNode(node)) {
            // A class's `extends` expression is a value wrapped in a type node; every other type node names no use.
            if (ts.isExpressionWithTypeArguments(node) && ts.isHeritageClause(node.parent) &&
              node.parent.token === ts.SyntaxKind.ExtendsKeyword && ts.isClassLike(node.parent.parent)) visit(node.expression);
            return;
          }
          if (ts.isImportDeclaration(node)) {
            const clause = node.importClause;
            if (!clause || clause.isTypeOnly || !ts.isStringLiteral(node.moduleSpecifier)) return;
            const specifier = node.moduleSpecifier.text;
            if (clause.name) module.imports.set(clause.name.text, { specifier, name: "default" });
            const bindings = clause.namedBindings;
            if (bindings && ts.isNamespaceImport(bindings)) module.imports.set(bindings.name.text, { specifier, name: "*" });
            else if (bindings) for (const element of bindings.elements) {
              if (!element.isTypeOnly) module.imports.set(element.name.text, { specifier, name: (element.propertyName ?? element.name).text });
            }
            return;
          }
          if (ts.isExportDeclaration(node)) {
            if (node.isTypeOnly) return;
            const specifier = node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) ? node.moduleSpecifier.text : null;
            if (!node.exportClause) { if (specifier) module.stars.push(specifier); }
            else if (ts.isNamespaceExport(node.exportClause)) { if (specifier) module.exports.set(node.exportClause.name.text, { specifier, name: "*" }); }
            else if (ts.isNamedExports(node.exportClause)) for (const element of node.exportClause.elements) {
              if (element.isTypeOnly) continue;
              const name = (element.propertyName ?? element.name).text;
              module.exports.set(element.name.text, specifier ? { specifier, name } : { local: name });
            }
            return;
          }
          if (ts.isExportAssignment(node) && !node.isExportEquals && ts.isIdentifier(unwrap(ts, node.expression))) {
            module.exports.set("default", { local: unwrap(ts, node.expression).text });
            return;
          }
          if (ts.isVariableDeclaration(node)) {
            for (const name of bound(node.name, [])) module.declared.add(name);
            const elements = ts.isArrayBindingPattern(node.name) ? node.name.elements : [];
            const initializer = unwrap(ts, node.initializer);
            const callee = initializer && ts.isCallExpression(initializer) ? unwrap(ts, initializer.expression) : null;
            if (callee && elements.length === 2 && elements.every((element) => ts.isBindingElement(element) && !element.dotDotDotToken && ts.isIdentifier(element.name))) {
              candidates.push({
                callee: ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : "",
                direct: !ts.isIdentifier(callee),
                pair: { file, test: module.test, inject: elements[0].name.text, provide: elements[1].name.text, line: lineOf(node), calls: { inject: [], provide: [] }, testCalls: { inject: [], provide: [] } },
              });
            }
            // `const { provideX } = await import("./x")` imports provideX; `const x = await import("./x")` is a namespace.
            const imported = dynamicImport(node.initializer);
            if (imported) {
              const specifier = imported.arguments[0].text;
              const keys = ts.isObjectBindingPattern(node.name) ? node.name.elements.map((element) => ({ element, key: element.propertyName ?? element.name })) : [];
              if (ts.isIdentifier(node.name)) {
                module.imports.set(node.name.text, { specifier, name: "*" });
                handled.add(imported);
              }
              else if (keys.length && keys.every(({ element, key }) => !element.dotDotDotToken && ts.isIdentifier(element.name) && (ts.isIdentifier(key) || ts.isStringLiteral(key)))) {
                for (const { element, key } of keys) module.imports.set(element.name.text, { specifier, name: key.text });
                handled.add(imported);
              }
            }
          }
          else if (ts.isParameter(node)) for (const name of bound(node.name, [])) module.declared.add(name);
          else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) && node.name) module.declared.add(node.name.text);
          if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && !handled.has(node) &&
            node.arguments.length === 1 && ts.isStringLiteralLike(node.arguments[0])) {
            module.dynamic.push({ specifier: node.arguments[0].text, line: lineOf(node) });
          }
          if (ts.isIdentifier(node)) {
            const parent = node.parent;
            // A declaration's name or a property's key names nothing that is used here; a shorthand property is a use.
            if ((parent.name === node && !ts.isShorthandPropertyAssignment(parent)) || parent.propertyName === node) return;
            const member = ts.isPropertyAccessExpression(parent) && parent.expression === node ? parent.name.text
              : ts.isElementAccessExpression(parent) && parent.expression === node && ts.isStringLiteralLike(parent.argumentExpression) ? parent.argumentExpression.text
              : null;
            module.refs.push(member === null ? { name: node.text, line: lineOf(node) } : { object: node.text, name: member, line: lineOf(node) });
            return;
          }
          ts.forEachChild(node, visit);
        };
        visit(sourceFile);
      };
      for (const representation of await representations(context, file)) {
        for (const statement of representation.sourceFile.statements) {
          if (!hasExport(ts, statement)) continue;
          if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
            for (const name of bound(declaration.name, [])) module.exportedLocals.add(name);
          }
          else if (ts.isFunctionDeclaration(statement) && statement.name) module.exportedLocals.add(statement.name.text);
        }
        scan(representation.sourceFile, (node) => representation.lineOf(node));
      }
      if (file.path.endsWith(".vue")) for (const expression of templateExpressions(context, file)) {
        const parsed = parseTemplateExpression(ts, expression);
        scan(parsed.sourceFile, parsed.lineOf);
      }
      // The helper by its own name, by the name it was imported as, or through a namespace.
      for (const candidate of candidates) {
        const helperName = candidate.direct ? candidate.callee : module.imports.get(candidate.callee)?.name ?? candidate.callee;
        if (helperName === "useProvideInject") { module.pairs.push(candidate.pair); pairs.push(candidate.pair); }
      }
      modules.set(file.path, module);
    }
    if (!pairs.length) return;

    const resolveModule = (file, specifier) => {
      let base = null;
      if (specifier.startsWith(".")) base = join(file.directory, specifier);
      else {
        const root = context.frontendRoots.owner(file);
        if (root && /^[~@]\//.test(specifier)) base = join(root.appPath, specifier.slice(2));
        else if (root && /^(?:~~|@@)\//.test(specifier)) base = join(root.path, specifier.slice(3));
      }
      if (!base) return null;
      const bases = /\.[mc]?js$/.test(base) ? [base, base.replace(/\.([mc]?)js$/, ".$1ts")] : [base];
      for (const candidate of [...bases, ...extensions.map((extension) => base + extension), ...extensions.map((extension) => `${base}/index${extension}`)]) {
        if (modules.has(candidate)) return modules.get(candidate);
      }
      return null;
    };
    // Pairs matched by a name they are declared under, plus (filled in below) the other names an in-repo module exports
    // them under, so a rename inside a workspace package is followed without resolving its specifier.
    const aliases = new Map();
    const byName = (name) => [
      ...pairs.flatMap((pair) => pair.inject === name ? [{ pair, role: "inject" }] : pair.provide === name ? [{ pair, role: "provide" }] : []),
      ...aliases.get(name) ?? [],
    ];
    const resolveImport = (module, specifier, name, seen) => {
      if (name === "*") return [];
      const target = resolveModule(module.file, specifier);
      return target ? resolveExport(target, name, seen) : byName(name);
    };
    const resolveLocal = (module, name, seen) => {
      const pair = module.pairs.find((candidate) => candidate.inject === name || candidate.provide === name);
      if (pair) return [{ pair, role: pair.inject === name ? "inject" : "provide" }];
      const imported = module.imports.get(name);
      return imported ? resolveImport(module, imported.specifier, imported.name, seen) : [];
    };
    const resolveExport = (module, name, seen) => {
      const key = `${module.file.path}\0${name}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const exported = module.exports.get(name);
      if (exported?.specifier) return resolveImport(module, exported.specifier, exported.name, seen);
      const local = exported?.local ?? (module.exportedLocals.has(name) ? name : null);
      if (local) return resolveLocal(module, local, seen);
      // `export *` leaves out the default export.
      return name === "default" ? [] : module.stars.flatMap((specifier) => resolveImport(module, specifier, name, seen));
    };
    for (const module of modules.values()) {
      for (const name of new Set([...module.exports.keys(), ...module.exportedLocals])) {
        if (name === "default") continue;
        for (const hit of resolveExport(module, name, new Set())) {
          if (hit.pair[hit.role] !== name) aliases.set(name, [...aliases.get(name) ?? [], hit]);
        }
      }
    }
    // `member` of whatever `imported` brings in: a namespace import reaches its module's exports directly, and a
    // named import may be a namespace the module re-exports (`export * as ns from`).
    const resolveMember = (module, imported, member, seen) => {
      if (imported.name === "*") return resolveImport(module, imported.specifier, member, seen);
      const target = resolveModule(module.file, imported.specifier);
      return target ? resolveExportMember(target, imported.name, member, seen) : byName(member);
    };
    const resolveExportMember = (module, name, member, seen) => {
      const key = `${module.file.path}\0${name}\0${member}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const exported = module.exports.get(name);
      if (exported?.specifier) return resolveMember(module, exported, member, seen);
      const local = exported?.local ?? (module.exportedLocals.has(name) ? name : null);
      if (local) {
        const imported = module.imports.get(local);
        return imported ? resolveMember(module, imported, member, seen) : [];
      }
      return name === "default" ? [] : module.stars.flatMap((specifier) => resolveMember(module, { specifier, name }, member, seen));
    };
    // Every pair side a module exports, for a namespace or a dynamic import read as a value.
    const everything = (module, seen) => {
      if (seen.has(module)) return [];
      seen.add(module);
      return [
        ...[...new Set([...module.exports.keys(), ...module.exportedLocals])].flatMap((name) => resolveExport(module, name, new Set())),
        ...module.stars.flatMap((specifier) => {
          const target = resolveModule(module.file, specifier);
          return target ? everything(target, seen) : [];
        }),
      ];
    };
    const resolveBare = (module, name) => {
      if (!module.bare.has(name)) {
        const hits = module.imports.has(name) || module.declared.has(name) ? resolveLocal(module, name, new Set()) : byName(name);
        const imported = module.imports.get(name);
        const target = imported?.name === "*" ? resolveModule(module.file, imported.specifier) : null;
        module.bare.set(name, target ? [...hits, ...everything(target, new Set())] : hits);
      }
      return module.bare.get(name);
    };
    const resolveReference = (module, reference) => {
      if (!reference.object) return resolveBare(module, reference.name);
      const imported = module.imports.get(reference.object);
      const viaImport = imported ? resolveMember(module, imported, reference.name, new Set()) : [];
      // A namespace used only to reach a member isn't itself passed on as a value.
      return imported?.name === "*" ? viaImport : [...viaImport, ...resolveBare(module, reference.object)];
    };
    for (const module of modules.values()) {
      const record = (hits, line) => {
        for (const hit of hits) (module.test ? hit.pair.testCalls : hit.pair.calls)[hit.role].push({ path: module.file.path, line });
      };
      for (const reference of module.refs) record(resolveReference(module, reference), reference.line);
      for (const dynamic of module.dynamic) {
        const target = resolveModule(module.file, dynamic.specifier);
        if (target) record(everything(target, new Set()), dynamic.line);
      }
    }
    const first = (sites) => {
      const site = [...sites].sort((left, right) => left.path.localeCompare(right.path) || left.line - right.line)[0];
      return `${site.path}:${site.line}`;
    };
    for (const pair of pairs) {
      if (pair.test) continue;
      const missing = (role, name) => pair.testCalls[role].length
        ? `${name} is called only in test sources (${first(pair.testCalls[role])})`
        : `${name} is called nowhere`;
      if (pair.calls.inject.length && !pair.calls.provide.length) {
        // A pair no Nuxt app owns (a component library or a layer) leaves its provide to the host application.
        const hosted = context.frontendRoots.owner(pair.file) !== null;
        report(context, hosted ? "error" : "warn", pair.file.path, pair.line,
          `${pair.inject} is called (${first(pair.calls.inject)}) but ${missing("provide", pair.provide)} — ${hosted
            ? "the inject throws at runtime; provide the capability in app.vue, a layout, or a page"
            : "no Nuxt app in this repository provides it, so the inject throws at runtime unless the host application does"}`,
          docCompositionRoots);
      }
      else if (pair.calls.provide.length && !pair.calls.inject.length) report(context, "warn", pair.file.path, pair.line,
        `${pair.provide} is called (${first(pair.calls.provide)}) but ${missing("inject", pair.inject)} — nothing consumes the capability; inject it where it is used, or delete the pair and its provider`,
        docCompositionRoots);
    }
  },
});

export const feTypeScriptRules = Object.freeze([
  fe007,
  fe008,
  fe010,
  fe011,
  fe013,
  fe014,
  fe015,
  fe020,
  fe030,
  fe032,
  fe040,
  fe044,
  fe046,
]);
