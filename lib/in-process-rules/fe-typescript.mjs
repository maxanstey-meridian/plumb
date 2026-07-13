import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { report } from "./helpers.mjs";

const source = "in-process/fe-typescript.mjs";
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
const isTestTs = (file) => /\.(?:spec|test)\.ts$/.test(file.path) || file.path.split("/").includes("__tests__") || file.path.endsWith(".d.ts");
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

const fe006 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-006", source, variants: ["v1", "both", "none"] }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const variant = context.rivet.variant;
    if (variant === "v2") return;
    const clientSpec = variant === "v1"
      ? /(generated\/(rivet\/)?client|contracts\/client|@[\w.-]+\/contracts)/
      : /(generated\/(rivet\/)?client|contracts\/client)/;
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of appFiles(context, root)) {
        if (!/\.(?:ts|vue)$/.test(file.path) || isTestTs(file)) continue;
        for (const representation of await representations(context, file, "first")) {
          const clientNames = new Set();
          for (const statement of representation.sourceFile.statements) {
            if (!ts.isImportDeclaration(statement) || !clientSpec.test(statement.moduleSpecifier.text ?? "")) continue;
            const clause = statement.importClause;
            if (!clause) continue;
            if (clause.name) clientNames.add(clause.name.text);
            if (clause.namedBindings) {
              if (ts.isNamespaceImport(clause.namedBindings)) clientNames.add(clause.namedBindings.name.text);
              else for (const element of clause.namedBindings.elements) clientNames.add(element.name.text);
            }
          }
          if (!clientNames.size) continue;
          const visit = (node, inTry) => {
            if (ts.isTryStatement(node)) {
              ts.forEachChild(node.tryBlock, (child) => visit(child, true));
              if (node.catchClause) visit(node.catchClause, false);
              if (node.finallyBlock) visit(node.finallyBlock, false);
              return;
            }
            if (inTry && ts.isCallExpression(node) && ts.isAwaitExpression(node.parent) &&
                clientNames.has(leftmostCallOwner(ts, node.expression)) && !/unwrap\s*:\s*false/.test(node.getText(representation.sourceFile))) {
              report(context, "warn", file.path, representation.lineOf(node), "do not try/catch generated client calls — pass { unwrap: false } and narrow on .isOk()", "rivet.md#frontend-result-handling");
            }
            ts.forEachChild(node, (child) => visit(child, inTry));
          };
          ts.forEachChild(representation.sourceFile, (node) => visit(node, false));
        }
      }
    }
  },
});

const fe007 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-007", source, variants: ["v2", "both"] }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const variant = context.rivet.variant;
    if (variant !== "v2" && variant !== "both") return;
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const isClientSpec = (specifier) => context.rivet.contractsPackages.some((name) => specifier === name || specifier.startsWith(`${name}/`)) ||
      /contracts\/(src\/)?(index|client)?$/.test(specifier);
    const verb = /\.(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)\s*\(/;
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of appFiles(context, root)) {
        if (!/\.(?:ts|vue)$/.test(file.path) || isTestTs(file)) continue;
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
            `${what} — openapi-fetch never throws on HTTP errors; capture the result and handle { data, error }`, "rivet.md#frontend-result-handling");
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
  descriptor: createRuleDescriptor({ id: "MER-FE-008", source, variants: ["v2", "both"] }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const variant = context.rivet.variant;
    if (variant !== "v2" && variant !== "both") return;
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const owners = context.rivet.v2Dirs.map((directory) => packageOwner(context, directory));
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
              report(context, "error", file.path, representation.lineOf(node), "openapi-fetch client construction belongs in the generated contracts package facade, not app/UI source", "rivet.md#typescript-client-package");
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
    const emit = (file, representation, node, message) => report(context, "error", file.path, representation.lineOf(node), message, "frontend-pa-vsa.md#ports");
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of appFiles(context, root)) {
        if (!file.path.endsWith(".ts") || !/(^|\/)ports\//.test(file.path) || /(^|\/)application\/ports\//.test(file.path) || isTestTs(file)) continue;
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
          if (issues.length) report(context, "error", file.path, representation.lineOf(declaration), issues.join("; "), "frontend-pa-vsa.md#provide--inject-pattern");
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
            `frontend port type ${statement.name.text} is role-shaped — name the capability, not a Service/Manager/Helper/DataService/Dto`, "frontend-pa-vsa.md#ports");
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
        "useProvideInject must throw when injection is missing and return a non-null T after that guard", "frontend-pa-vsa.md#provide--inject-pattern");
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
        if (!file.path.endsWith(".ts") || !/(^|\/)ports\//.test(file.path) || isTestTs(file)) continue;
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
              `port ${statement.name.text} mirrors generated client ${client.path} one-for-one (${methods.join(", ")}) — a fake API abstraction; shape the port around what the page needs`, "frontend-pa-vsa.md#rivet-rules");
            break;
          }
        }
      }
    }
  },
});

const fe020 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-020", source }),
  requirements: [Capability.TYPESCRIPT],
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
      if (!/\.(?:ts|vue)$/.test(file.path) || shell(file)) continue;
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
              "provideX is shell wiring — move it to app.vue, a layout, or a page; use props/events for local collaboration", "frontend-pa-vsa.md#nuxt-shells-as-composition-roots");
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
  requirements: [Capability.TYPESCRIPT],
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
    const exempt = (file) => {
      const parts = file.path.split("/");
      if (parts.some((part) => /^(?:generated|gen|\.nuxt)$/i.test(part))) return true;
      if (/(?:@generated|auto-generated|generated[^\n]*do not edit)/i.test(file.text().slice(0, 500))) return true;
      if (packageEntry(file)) return true;
      return parts.some((part, index) => part === "app" && parts[index + 1] === "features" && Boolean(parts[index + 2]) &&
        parts[index + 3] === "index.ts" && index + 4 === parts.length);
    };
    for (const file of context.files) {
      if (!/\.(?:ts|tsx|vue)$/.test(file.path) || exempt(file)) continue;
      for (const representation of await representations(context, file)) {
        for (const statement of representation.sourceFile.statements) {
          if (ts.isExportDeclaration(statement) && statement.moduleSpecifier) report(context, "warn", file.path, representation.lineOf(statement),
            "re-export found — delete migration shims; keep only a deliberate curated public feature entry point", "frontend-pa-vsa.md#promotion");
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
              `${baseOf(container)} subtree ${ownSubtree} deep-imports ${target} — move generic code to app/shared, preserve product ownership in app/features, or expose a public feature contract`, "frontend-pa-vsa.md#promotion");
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
        if (!matches) report(context, "warn", file.path, 1, `${base} composable file must export a matching ${expected} function`, "frontend-pa-vsa.md#composables");
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
      if (!/^nuxt\.config\.(?:ts|js|mjs)$/.test(file.name)) continue;
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
      if (!accepted) report(context, "warn", file.path, 1, "Nuxt SPA config must explicitly set ssr: false", "frontend-pa-vsa.md#purpose");
    }
  },
});

export const feTypeScriptRules = Object.freeze([
  fe006,
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
]);
