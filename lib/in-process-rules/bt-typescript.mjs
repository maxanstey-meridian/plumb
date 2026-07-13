import { Capability, createRuleDescriptor, defineFileRule, defineRepositoryRule } from "../engine/contracts.mjs";
import { hasSegment, pathDepth, report } from "./helpers.mjs";

const source = "in-process/bt-typescript.mjs";
const nestPortRef = "backend-pa-vsa.md#typescript--nest-port-convention";
const nestRef = "backend-pa-vsa.md#typescript--nest";
const dependencyRef = "backend-pa-vsa.md#non-negotiable-dependency-rules";
const modulesRef = "backend-pa-vsa.md#across-modules";
const typescriptFile = (file) => /\.[mc]?ts$/.test(file);
const testFile = (file) => /\.(?:spec|test)\.[mc]?ts$/.test(file) || hasSegment(file, "__tests__");
const withinDepth = (file) => pathDepth(file) <= 12;
const normalized = (file) => file.replaceAll("\\", "/");

const portSpecifier = /\/ports\/|\.port(?:\.js|\.ts)?$/;
const isPortFile = (file) =>
  (file.includes("application/ports/") || file.endsWith(".port.ts")) &&
  !file.endsWith(".d.ts") && !/\.(?:spec|test)\.ts$/.test(file) && !hasSegment(file, "__tests__");

const bt001 = defineFileRule({
  descriptor: createRuleDescriptor({ id: "MER-BT-001", source }),
  requirements: [Capability.TYPESCRIPT],
  files: (file) => file.endsWith(".ts") && isPortFile(file),
  async analyze(file, context) {
    const ts = await context.typescript.runtime();
    const parsed = await context.typescript.source(file);
    if (!ts || !parsed) return;
    const { sourceFile: sf, lineOf } = parsed;
    const emit = (node, message) => report(context, "error", file.path, lineOf(node), message, nestPortRef);
    for (const statement of sf.statements) {
      if (!ts.isClassDeclaration(statement)) continue;
      const modifiers = ts.getCombinedModifierFlags(statement);
      if (!(modifiers & ts.ModifierFlags.Export)) continue;
      const name = statement.name?.text ?? "(anonymous)";
      if (!(modifiers & ts.ModifierFlags.Abstract)) {
        emit(statement, `port class ${name} must be abstract — ports are DI tokens with interface semantics`);
        continue;
      }
      let constructor = null;
      for (const member of statement.members) {
        if (ts.isConstructorDeclaration(member)) { constructor = member; continue; }
        const memberModifiers = ts.getCombinedModifierFlags(member);
        if (memberModifiers & ts.ModifierFlags.Static) { emit(member, `port class ${name} may not have static members`); continue; }
        if (ts.isPropertyDeclaration(member)) { emit(member, `port class ${name} may not declare fields — ports are stateless`); continue; }
        if (ts.isMethodDeclaration(member) && !(memberModifiers & ts.ModifierFlags.Abstract)) {
          emit(member, `port class ${name} may only declare abstract methods — no implementation in a port`);
        }
      }
      if (!constructor) emit(statement, `port class ${name} needs a private constructor() so it cannot be instantiated or extended as a base type`);
      else if (!(ts.getCombinedModifierFlags(constructor) & ts.ModifierFlags.Private)) emit(constructor, `port class ${name}'s constructor must be private`);
      else if (constructor.parameters.length || (constructor.body && constructor.body.statements.length)) {
        emit(constructor, `port class ${name}'s private constructor must be empty — no factory logic in a port`);
      }
    }
  },
});

const bt002 = defineFileRule({
  descriptor: createRuleDescriptor({ id: "MER-BT-002", source }),
  requirements: [Capability.TYPESCRIPT],
  files(file) {
    return file.endsWith(".ts") && !/\.(?:spec|test)\.ts$/.test(file) && !hasSegment(file, "__tests__");
  },
  async analyze(file, context) {
    const text = file.text();
    if (!text.includes("extends") || !portSpecifier.test(text)) return;
    const ts = await context.typescript.runtime();
    const parsed = await context.typescript.source(file);
    if (!ts || !parsed) return;
    const { sourceFile: sf, lineOf } = parsed;
    const portNames = new Set();
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !portSpecifier.test(statement.moduleSpecifier.text ?? "")) continue;
      const clause = statement.importClause;
      if (!clause) continue;
      if (clause.name) portNames.add(clause.name.text);
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) portNames.add(element.name.text);
      }
    }
    if (!portNames.size) return;
    const visit = (node) => {
      if ((ts.isClassDeclaration(node) || ts.isClassExpression(node)) && node.heritageClauses) {
        for (const heritage of node.heritageClauses) {
          if (heritage.token !== ts.SyntaxKind.ExtendsKeyword) continue;
          for (const type of heritage.types) {
            const base = type.expression.getText(sf);
            if (portNames.has(base)) {
              report(context, "error", file.path, lineOf(type), `adapters implement ports, never extend them — change "extends ${base}" to "implements ${base}"`, nestPortRef);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  },
});

const bt004 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BT-004", source }),
  requirements: [Capability.TYPESCRIPT],
  async analyze(context) {
    let typedInject = false;
    for (const file of context.files) {
      if (file.name !== "package.json") continue;
      try {
        if (file.text().includes('"typed-inject"')) { typedInject = true; break; }
      } catch {}
    }
    if (!typedInject) return;
    const ts = await context.typescript.runtime();
    if (!ts) return;
    for (const file of context.files) {
      if (!file.path.endsWith(".ts") || file.path.endsWith(".d.ts") || /\.(?:spec|test)\.ts$/.test(file.path) || hasSegment(file.path, "__tests__")) continue;
      const text = file.text();
      if (!text.includes("static inject")) continue;
      const parsed = await context.typescript.source(file);
      if (!parsed) continue;
      const { sourceFile: sf, lineOf } = parsed;
      const visit = (node) => {
        if (ts.isClassDeclaration(node)) {
          const name = node.name?.text ?? "(anonymous)";
          const injectProperty = node.members.find((member) =>
            ts.isPropertyDeclaration(member) && (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Static) &&
            ts.isIdentifier(member.name) && member.name.text === "inject");
          if (injectProperty) {
            const initializer = injectProperty.initializer;
            if (!(initializer && ts.isAsExpression(initializer) && initializer.type.getText(sf) === "const")) {
              report(context, "warn", file.path, lineOf(injectProperty), `${name}.inject must be declared "as const" so typed-inject can type-check the tokens`, nestRef);
            }
            const constructor = node.members.find(ts.isConstructorDeclaration);
            for (const parameter of constructor?.parameters ?? []) {
              const modifiers = ts.getCombinedModifierFlags(parameter);
              if (!(modifiers & ts.ModifierFlags.Private) || !(modifiers & ts.ModifierFlags.Readonly)) {
                report(context, "warn", file.path, lineOf(parameter), `injected dependency "${parameter.name.getText(sf)}" in ${name} must be constructor-promoted private readonly`, nestRef);
              }
            }
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  },
});

const layerNames = new Map([
  ["domain", "domain"],
  ["application", "application"], ["app", "application"],
  ["infrastructure", "infrastructure"], ["infra", "infrastructure"],
  ["interface", "interface"], ["interfaces", "interface"],
  ["http", "interface"], ["controllers", "interface"],
  ["contracts", "contracts"],
]);
const domainBannedPackages = /^(@nestjs\/|express(?:\/|$)|fastify(?:\/|$)|hono(?:\/|$)|vue$|typed-inject$|inversify$|@vueuse\/|prisma$|@prisma\/|typeorm$|knex$|drizzle-orm(?:\/|$)|sequelize$|@mikro-orm\/|pino(?:\/|$)|winston(?:\/|$)|bunyan(?:\/|$)|log4js(?:\/|$)|@opentelemetry\/)/;
const applicationTransportPackages = /^(@nestjs\/common$|express(?:\/|$)|fastify(?:\/|$)|hono(?:\/|$))/;
const generatedTransportPackages = /(?:^|\/)(?:generated[-/](?:http|transport)|transport[-/]generated)(?:\/|$)/;

function classifyLayer(file) {
  const segments = normalized(file).split("/");
  let module = null, layer = null;
  for (let index = 0; index < segments.length; index++) {
    if (segments[index] === "modules" && index + 1 < segments.length) module = segments[index + 1];
    else if (layerNames.has(segments[index]) && (module !== null || segments.includes("src"))) {
      if (layer === null) layer = layerNames.get(segments[index]);
    }
  }
  return { module, layer };
}

function moduleReferences(ts, sourceFile) {
  const references = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ node: node.moduleSpecifier, specifier: node.moduleSpecifier.text });
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      references.push({ node: node.moduleReference.expression, specifier: node.moduleReference.expression.text });
      return;
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === "require") || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      references.push({ node: node.arguments[0], specifier: node.arguments[0].text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return references;
}

function isSharedDomainOrKernel(file) {
  const segments = normalized(file).split("/");
  for (let index = 0; index < segments.length - 1; index++) {
    if ((segments[index] === "common" || segments[index] === "shared") && (segments[index + 1] === "domain" || segments[index + 1] === "kernel")) return true;
    if (segments[index] === "src" && (segments[index + 1] === "kernel" || segments[index + 1] === "shared-kernel")) return true;
    if (segments[index] === "modules" && segments[index + 1] === "shared-kernel") return true;
  }
  return false;
}

const bt010 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ ids: ["MER-BT-010", "MER-BT-011", "MER-BT-012"], source }),
  requirements: [Capability.TYPESCRIPT],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const root = normalized(context.root).replace(/\/$/, "");
    for (const file of context.files) {
      if (!typescriptFile(file.path) || !withinDepth(file.path) || file.path.endsWith(".d.ts") || testFile(file.path)) continue;
      const from = classifyLayer(file.path);
      if (!from.layer && !from.module) continue;
      const parsed = await context.typescript.source(file);
      if (!parsed) continue;
      for (const reference of moduleReferences(ts, parsed.sourceFile)) {
        const specifier = reference.specifier;
        const line = parsed.lineOf(reference.node);
        if (!specifier.startsWith(".")) {
          if (from.layer === "domain" && domainBannedPackages.test(specifier)) {
            context.report({ id: "MER-BT-010", severity: "error", path: file.path, line, message: `domain imports framework package "${specifier}" — domain depends on nothing outside itself`, docRef: dependencyRef });
            continue;
          }
          if (from.layer === "application" && (applicationTransportPackages.test(specifier) || generatedTransportPackages.test(specifier))) {
            context.report({ id: "MER-BT-011", severity: "error", path: file.path, line, message: `application must not import transport framework or generated wire package "${specifier}" — keep transport ownership at the interface edge`, docRef: dependencyRef });
            continue;
          }
        }
        const target = await context.typescript.resolve(file, specifier);
        if (!target) continue;
        const normalizedTarget = normalized(target);
        const to = classifyLayer(normalizedTarget);
        const internal = normalizedTarget === root || normalizedTarget.startsWith(`${root}/`);
        const compositionFile = /\.module\.[mc]?ts$/.test(file.path);
        if (from.layer === "domain" && internal && !(
          to.layer === "domain" && ((from.module && from.module === to.module) || (!from.module && !to.module))
        ) && !isSharedDomainOrKernel(normalizedTarget)) {
          context.report({ id: "MER-BT-010", severity: "error", path: file.path, line, message: "domain internal import must remain in its own domain or a genuine shared domain/kernel", docRef: dependencyRef });
        } else if (!compositionFile && from.module && to.module && from.module !== to.module && to.module !== "common" && from.module !== "common" && to.layer !== "contracts") {
          context.report({ id: "MER-BT-012", severity: "error", path: file.path, line, message: `module ${from.module} must not import ${to.module} internals — consume its published contracts or bridge a required port at composition`, docRef: modulesRef });
        } else if (from.layer === "domain" && to.layer && to.layer !== "domain") {
          context.report({ id: "MER-BT-010", severity: "error", path: file.path, line, message: `domain must not import ${to.layer} — domain depends on nothing outside itself`, docRef: dependencyRef });
        } else if (from.layer === "application" && (to.layer === "infrastructure" || to.layer === "interface")) {
          context.report({ id: "MER-BT-011", severity: "error", path: file.path, line, message: `application must not import ${to.layer} — depend inward on domain and application-owned contracts`, docRef: dependencyRef });
        }
      }
    }
  },
});

const bt013 = defineFileRule({
  descriptor: createRuleDescriptor({ id: "MER-BT-013", source }),
  requirements: [Capability.TYPESCRIPT],
  files(file) {
    return typescriptFile(file) && withinDepth(file) && !file.endsWith(".d.ts") && !testFile(file) && hasSegment(file, "domain");
  },
  async analyze(file, context) {
    const ts = await context.typescript.runtime();
    const parsed = await context.typescript.source(file);
    if (!ts || !parsed) return;
    const domainPorts = /(?:^|\/)domain\/ports\//.test(file.path);
    for (const node of parsed.sourceFile.statements) {
      if (!ts.isClassDeclaration(node) && !ts.isInterfaceDeclaration(node) && !ts.isTypeAliasDeclaration(node)) continue;
      const name = node.name?.text;
      if (!name || (!name.endsWith("Repository") && !domainPorts)) continue;
      report(context, "error", file.path, parsed.lineOf(node), `domain declaration ${name} is a port — repository and port contracts belong to application`, dependencyRef);
    }
  },
});

const sharedPort = (file) => /(?:^|\/)(?:common|shared)\/(?:application\/)?ports\//.test(file);
const moduleDomain = (file) => /(?:^|\/)modules\/(?!common\/|shared\/)[^/]+\/domain(?:\/|$)/.test(normalized(file));

function surfaceNodes(ts, node) {
  if (ts.isTypeAliasDeclaration(node)) return [node.type];
  if (ts.isInterfaceDeclaration(node)) return [...(node.typeParameters ?? []), ...(node.heritageClauses ?? []), ...node.members];
  if (ts.isFunctionDeclaration(node)) return [
    ...(node.typeParameters ?? []),
    ...node.parameters.flatMap((parameter) => parameter.type ? [parameter.type] : []),
    ...(node.type ? [node.type] : []),
  ];
  if (ts.isVariableDeclaration(node)) {
    const callable = node.type && ts.isFunctionTypeNode(node.type) ? node.type :
      node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer)) ? node.initializer : null;
    if (!callable) return [];
    return [
      ...(callable.typeParameters ?? []),
      ...callable.parameters.flatMap((parameter) => parameter.type ? [parameter.type] : []),
      ...(callable.type ? [callable.type] : []),
    ];
  }
  if (!ts.isClassDeclaration(node) || !(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Abstract)) return [];
  const nodes = [...(node.typeParameters ?? []), ...(node.heritageClauses ?? [])];
  for (const member of node.members) {
    if (ts.getCombinedModifierFlags(member) & ts.ModifierFlags.Private) continue;
    if (ts.isPropertyDeclaration(member)) {
      if (member.type) nodes.push(member.type);
      continue;
    }
    if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member) || ts.isGetAccessorDeclaration(member) || ts.isSetAccessorDeclaration(member) || ts.isConstructorDeclaration(member)) {
      nodes.push(...(member.typeParameters ?? []));
      for (const parameter of member.parameters) if (parameter.type) nodes.push(parameter.type);
      if (member.type) nodes.push(member.type);
    }
  }
  return nodes;
}

const bt014 = defineFileRule({
  descriptor: createRuleDescriptor({ id: "MER-BT-014", source }),
  requirements: [Capability.TYPESCRIPT],
  files: (file) => typescriptFile(file) && withinDepth(file) && !file.endsWith(".d.ts") && sharedPort(file),
  async analyze(file, context) {
    const ts = await context.typescript.runtime();
    const parsed = await context.typescript.source(file);
    if (!ts || !parsed) return;
    const sf = parsed.sourceFile;
    const tainted = new Set();
    const referencedTaint = async (nodes) => {
      const used = new Set();
      const references = [];
      const visit = (node) => {
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal)) {
          references.push({ importType: node });
          return;
        }
        if (ts.isIdentifier(node) && tainted.has(node.text)) references.push({ name: node.text });
        ts.forEachChild(node, visit);
      };
      for (const node of nodes) visit(node);
      for (const reference of references) {
        if (reference.name) used.add(reference.name);
        else {
          const node = reference.importType;
          const target = await context.typescript.resolve(file, node.argument.literal.text);
          if (target && moduleDomain(target)) used.add(node.getText());
        }
      }
      return used;
    };
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : null;
      const target = specifier && await context.typescript.resolve(file, specifier);
      if (!target || !moduleDomain(target)) continue;
      if (ts.isExportDeclaration(statement)) {
        report(context, "error", file.path, parsed.lineOf(statement), "shared port re-exports module-owned domain types — publish a module contract instead", modulesRef);
        continue;
      }
      const clause = statement.importClause;
      if (clause?.name) tainted.add(clause.name.text);
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) tainted.add(element.name.text);
      }
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) tainted.add(clause.namedBindings.name.text);
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const statement of sf.statements) {
        if ((!ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) || tainted.has(statement.name.text)) continue;
        if ((await referencedTaint(surfaceNodes(ts, statement))).size) {
          tainted.add(statement.name.text);
          changed = true;
        }
      }
    }
    for (const statement of sf.statements) {
      if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const element of statement.exportClause.elements) {
          const local = element.propertyName?.text ?? element.name.text;
          if (tainted.has(local)) report(context, "error", file.path, parsed.lineOf(statement), `shared port exports module-owned domain alias ${local} — use a shared or published contract`, modulesRef);
        }
        continue;
      }
      if (!(ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Export)) continue;
      const surfaces = ts.isVariableStatement(statement) ? statement.declarationList.declarations :
        ts.isTypeAliasDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isFunctionDeclaration(statement) ||
        (ts.isClassDeclaration(statement) && (ts.getCombinedModifierFlags(statement) & ts.ModifierFlags.Abstract)) ? [statement] : [];
      for (const surface of surfaces) {
        for (const name of await referencedTaint(surfaceNodes(ts, surface))) {
          report(context, "error", file.path, parsed.lineOf(surface), `shared port signature exposes module-owned domain type ${name} — use a shared or published contract`, modulesRef);
        }
      }
    }
  },
});

const compositionFile = (file) => /(?:^|\/)(?:main|bootstrap|composition-root)\.[mc]?ts$/.test(file);

const bt015 = defineFileRule({
  descriptor: createRuleDescriptor({ id: "MER-BT-015", source }),
  requirements: [Capability.TYPESCRIPT],
  files(file) {
    return typescriptFile(file) && withinDepth(file) && !file.endsWith(".d.ts") &&
      ["domain", "application", "app"].some((segment) => hasSegment(file, segment)) && !compositionFile(file) && !testFile(file);
  },
  async analyze(file, context) {
    const ts = await context.typescript.runtime();
    const parsed = await context.typescript.source(file);
    if (!ts || !parsed) return;
    const sf = parsed.sourceFile;
    const emitted = new Set();
    const emit = (node, detail) => {
      const line = parsed.lineOf(node);
      if (emitted.has(line)) return;
      emitted.add(line);
      report(context, "error", file.path, line, `${detail} — inject the required dependency explicitly`, dependencyRef);
    };
    const locatorTypes = new Set();
    const locatorValues = new Set();
    const locatorFactories = new Set();
    const packageExports = new Map([
      ["inversify", { types: new Set(["Container"]), values: new Set(), factories: new Set() }],
      ["tsyringe", { types: new Set(), values: new Set(["container"]), factories: new Set() }],
      ["typedi", { types: new Set(["Container"]), values: new Set(["Container"]), factories: new Set() }],
      ["awilix", { types: new Set(), values: new Set(), factories: new Set(["createContainer"]) }],
      ["typed-inject", { types: new Set(), values: new Set(), factories: new Set(["createInjector"]) }],
    ]);
    for (const statement of sf.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
      const specifier = statement.moduleSpecifier.text;
      const named = statement.importClause?.namedBindings;
      if (named && ts.isNamespaceImport(named)) {
        const namespace = named.name.text;
        if (specifier === "@nestjs/core") locatorTypes.add(`${namespace}.ModuleRef`);
        const known = packageExports.get(specifier);
        for (const name of known?.types ?? []) locatorTypes.add(`${namespace}.${name}`);
        for (const name of known?.values ?? []) locatorValues.add(`${namespace}.${name}`);
        for (const name of known?.factories ?? []) locatorFactories.add(`${namespace}.${name}`);
        continue;
      }
      if (!named || !ts.isNamedImports(named)) continue;
      for (const element of named.elements) {
        const imported = element.propertyName?.text ?? element.name.text;
        const local = element.name.text;
        if (specifier === "@nestjs/core" && imported === "ModuleRef") {
          locatorTypes.add(local);
          emit(statement, "ModuleRef is a service locator inside domain/application");
          continue;
        }
        const known = packageExports.get(specifier);
        if (known?.types.has(imported)) locatorTypes.add(local);
        if (known?.values.has(imported)) locatorValues.add(local);
        if (known?.factories.has(imported)) locatorFactories.add(local);
      }
    }
    const bindingName = (name) => ts.isIdentifier(name) ? name.text : null;
    const collectBindings = (node) => {
      if ((ts.isParameter(node) || ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.type && locatorTypes.has(node.type.getText(sf))) {
        const name = bindingName(node.name);
        if (name) {
          locatorValues.add(name);
          if (ts.isParameter(node) && ts.getCombinedModifierFlags(node) & (ts.ModifierFlags.Private | ts.ModifierFlags.Public | ts.ModifierFlags.Protected)) locatorValues.add(`this.${name}`);
        }
      }
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const name = bindingName(node.name);
        if (name && ts.isCallExpression(node.initializer) && locatorFactories.has(node.initializer.expression.getText(sf))) locatorValues.add(name);
        if (name && ts.isNewExpression(node.initializer) && locatorTypes.has(node.initializer.expression.getText(sf))) locatorValues.add(name);
      }
      ts.forEachChild(node, collectBindings);
    };
    collectBindings(sf);
    let changed = true;
    while (changed) {
      changed = false;
      const collectAliases = (node) => {
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && locatorValues.has(node.initializer.getText(sf)) && !locatorValues.has(node.name.text)) {
          locatorValues.add(node.name.text);
          changed = true;
        }
        ts.forEachChild(node, collectAliases);
      };
      collectAliases(sf);
    }
    const visitCalls = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
        const receiver = node.expression.expression;
        const owner = receiver.getText(sf);
        const method = node.expression.name.text;
        const knownReceiver = locatorValues.has(owner) ||
          (ts.isNewExpression(receiver) && locatorTypes.has(receiver.expression.getText(sf))) ||
          (ts.isCallExpression(receiver) && locatorFactories.has(receiver.expression.getText(sf)));
        if (knownReceiver && /^(?:get|resolve|create)$/.test(method)) emit(node, `${owner}.${method} performs service location inside domain/application`);
      }
      ts.forEachChild(node, visitCalls);
    };
    visitCalls(sf);
  },
});

function binds(ts, binding, name) {
  if (ts.isIdentifier(binding)) return binding.text === name;
  if (ts.isObjectBindingPattern(binding) || ts.isArrayBindingPattern(binding)) {
    return binding.elements.some((element) => ts.isBindingElement(element) && binds(ts, element.name, name));
  }
  return false;
}

function statementBinds(ts, statement, name) {
  if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some((declaration) => binds(ts, declaration.name, name));
  if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) && statement.name) return statement.name.text === name;
  if (ts.isImportDeclaration(statement)) {
    const clause = statement.importClause;
    if (clause?.name?.text === name) return true;
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) return clause.namedBindings.name.text === name;
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) return clause.namedBindings.elements.some((element) => element.name.text === name);
  }
  return false;
}

function isShadowed(ts, name, node) {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if ((ts.isBlock(scope) || ts.isSourceFile(scope)) && scope.statements.some((statement) => statementBinds(ts, statement, name))) return true;
    if (ts.isFunctionLike(scope) && scope.parameters.some((parameter) => binds(ts, parameter.name, name))) return true;
    if (ts.isCatchClause(scope) && scope.variableDeclaration && binds(ts, scope.variableDeclaration.name, name)) return true;
  }
  return false;
}

const bt016 = defineFileRule({
  descriptor: createRuleDescriptor({ id: "MER-BT-016", source }),
  requirements: [Capability.TYPESCRIPT],
  files(file) {
    return typescriptFile(file) && withinDepth(file) && !file.endsWith(".d.ts") && !testFile(file) &&
      (hasSegment(file, "domain") || hasSegment(file, "application") || hasSegment(file, "app"));
  },
  async analyze(file, context) {
    const ts = await context.typescript.runtime();
    const parsed = await context.typescript.source(file);
    if (!ts || !parsed) return;
    const sf = parsed.sourceFile;
    const owner = hasSegment(file.path, "domain") ? "domain" : "application";
    const visit = (node) => {
      const callee = (ts.isCallExpression(node) || ts.isNewExpression(node)) ? node.expression.getText(sf) : "";
      const args = (ts.isCallExpression(node) || ts.isNewExpression(node)) ? node.arguments : undefined;
      const bareDate = !isShadowed(ts, "Date", node);
      const bareTemporal = !isShadowed(ts, "Temporal", node);
      const globalObject = !isShadowed(ts, "globalThis", node);
      const dateNow = ts.isCallExpression(node) && ((bareDate && callee === "Date.now") || (globalObject && callee === "globalThis.Date.now"));
      const newDate = ts.isNewExpression(node) && ((bareDate && callee === "Date") || (globalObject && callee === "globalThis.Date")) && (args?.length ?? 0) === 0;
      const dateCall = ts.isCallExpression(node) && ((bareDate && callee === "Date") || (globalObject && callee === "globalThis.Date"));
      const temporalNow = ts.isCallExpression(node) && ((bareTemporal && callee.startsWith("Temporal.Now.")) || (globalObject && callee.startsWith("globalThis.Temporal.Now.")));
      if (dateNow || newDate || dateCall || temporalNow) {
        const expression = node.getText(sf);
        report(context, owner === "domain" ? "error" : "warn", file.path, parsed.lineOf(node), `${owner} reads ambient time via ${expression} — pass the instant or a clock dependency explicitly`, dependencyRef);
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  },
});

const configOwner = /^(?:src\/)?(?:config|bootstrap)(?:\/.*|\.[mc]?ts)$/;
const buildToolConfig = /^(?:[a-z0-9_-]+)\.config\.[mc]?ts$/;

const bt017 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BT-017", source }),
  requirements: [Capability.TYPESCRIPT],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const packageRoots = new Set(context.files.filter((file) => file.name === "package.json").map((file) => file.directory));
    const findPackageRoot = (file) => {
      let directory = file.directory;
      for (let count = 0; count < 16; count++) {
        if (packageRoots.has(directory)) return directory;
        if (!directory) break;
        const slash = directory.lastIndexOf("/");
        directory = slash < 0 ? "" : directory.slice(0, slash);
      }
      return "";
    };
    for (const file of context.files) {
      if (!typescriptFile(file.path) || !withinDepth(file.path) || file.path.endsWith(".d.ts") ||
          /\.(?:spec|test)\.[mc]?ts$/.test(file.path) || ["__tests__", "test", "tests"].some((segment) => hasSegment(file.path, segment))) continue;
      const packageRoot = findPackageRoot(file);
      const relative = packageRoot ? file.path.slice(packageRoot.length + 1) : file.path;
      if (configOwner.test(relative) || (buildToolConfig.test(file.name) && file.directory === packageRoot)) continue;
      const parsed = await context.typescript.source(file);
      if (!parsed) continue;
      const sf = parsed.sourceFile;
      const scopes = new Map([[sf, new Map()]]);
      const isScope = (node) => ts.isSourceFile(node) || ts.isFunctionLike(node) || ts.isBlock(node) || ts.isCatchClause(node);
      const addBinding = (scope, name, kind = "local") => {
        if (ts.isIdentifier(name)) scopes.get(scope).set(name.text, kind);
        else if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
          for (const element of name.elements) if (ts.isBindingElement(element)) addBinding(scope, element.name, kind);
        }
      };
      const collectBindings = (node, scope) => {
        if (ts.isFunctionDeclaration(node) && node.name) addBinding(scope, node.name);
        const childScope = node === sf ? sf : isScope(node) ? node : scope;
        if (childScope !== scope && !scopes.has(childScope)) scopes.set(childScope, new Map());
        if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) addBinding(childScope, node.name);
        if (ts.isImportDeclaration(node) && node.importClause && ts.isStringLiteral(node.moduleSpecifier)) {
          const kind = ["node:process", "process"].includes(node.moduleSpecifier.text) ? "process" : "local";
          if (node.importClause.name) addBinding(childScope, node.importClause.name, kind);
          if (node.importClause.namedBindings && ts.isNamespaceImport(node.importClause.namedBindings)) addBinding(childScope, node.importClause.namedBindings.name, kind);
          if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
            for (const element of node.importClause.namedBindings.elements) addBinding(childScope, element.name);
          }
        }
        ts.forEachChild(node, (child) => collectBindings(child, childScope));
      };
      collectBindings(sf, sf);
      const bindingKind = (name, node) => {
        for (let current = node; current; current = current.parent) {
          const binding = scopes.get(current)?.get(name);
          if (binding) return binding;
        }
        return "global";
      };
      const importedEnvironment = [];
      for (const statement of sf.statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !["node:process", "process"].includes(statement.moduleSpecifier.text)) continue;
        const clause = statement.importClause;
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const element of clause.namedBindings.elements) {
            if ((element.propertyName?.text ?? element.name.text) === "env") importedEnvironment.push({ name: element.name.text, node: statement });
          }
        }
      }
      const emitted = new Set();
      const emit = (node, environmentSource) => {
        const line = parsed.lineOf(node);
        if (emitted.has(line)) return;
        emitted.add(line);
        report(context, "warn", file.path, line, `production code reads ${environmentSource} outside a root configuration owner — bind and validate configuration at the edge`, nestRef);
      };
      for (const imported of importedEnvironment) emit(imported.node, `environment imported as ${imported.name} from node:process`);
      const visit = (node) => {
        const processSource = (expression) => {
          if (ts.isIdentifier(expression)) {
            const kind = bindingKind(expression.text, expression);
            return kind === "process" || (kind === "global" && expression.text === "process");
          }
          return ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && expression.expression.text === "globalThis" &&
            bindingKind("globalThis", expression.expression) === "global" && expression.name.text === "process";
        };
        if (ts.isPropertyAccessExpression(node) && processSource(node.expression) && node.name.text === "env") {
          emit(node, ts.isIdentifier(node.expression) ? "process.env" : "globalThis.process.env");
        }
        if (ts.isElementAccessExpression(node) && processSource(node.expression) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === "env") {
          emit(node, ts.isIdentifier(node.expression) ? "process['env']" : "globalThis.process['env']");
        }
        if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && ["Bun", "Deno"].includes(node.expression.text) &&
            bindingKind(node.expression.text, node.expression) === "global" && node.name.text === "env") emit(node, `${node.expression.text}.env`);
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
  },
});

const databasePackage = /^(?:@prisma\/|prisma$|typeorm$|knex$|drizzle-orm(?:\/|$)|sequelize$|@mikro-orm\/|pg$|postgres$|mysql2$|mongodb$|mongoose$|redis$|ioredis$|better-sqlite3$|@aws-sdk\/(?:client|lib)-dynamodb$|aws-sdk\/clients\/dynamodb$)/;
const architecturalLayers = new Set(["domain", "application", "app", "infrastructure", "infra"]);
const transportLayers = new Set(["interface", "interfaces", "http", "controllers"]);

function isTransport(file) {
  const parts = file.split("/");
  if (parts.some((part) => architecturalLayers.has(part))) return false;
  return parts.some((part) => transportLayers.has(part)) || /(?:^|[-.])(?:controller|routes?|resolver|endpoint|handler)\.[mc]?ts$/.test(parts.at(-1));
}

function classifyTransport(file) {
  const parts = normalized(file).split("/");
  return { infrastructure: parts.includes("infrastructure") || parts.includes("infra") };
}

const bt020 = defineFileRule({
  descriptor: createRuleDescriptor({ id: "MER-BT-020", source }),
  requirements: [Capability.TYPESCRIPT],
  files(file) {
    return typescriptFile(file) && withinDepth(file) && !file.endsWith(".d.ts") && isTransport(file) && !/\.(?:spec|test)\.[mc]?ts$/.test(file);
  },
  async analyze(file, context) {
    const ts = await context.typescript.runtime();
    const parsed = await context.typescript.source(file);
    if (!ts || !parsed) return;
    const references = [];
    const collect = (node) => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        references.push({ node, specifier: node.moduleSpecifier.text });
        return;
      }
      if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
        references.push({ node, specifier: node.moduleReference.expression.text });
        return;
      }
      if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) &&
          ((ts.isIdentifier(node.expression) && node.expression.text === "require") || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
        references.push({ node, specifier: node.arguments[0].text });
      }
      ts.forEachChild(node, collect);
    };
    collect(parsed.sourceFile);
    for (const { node, specifier } of references) {
      if (!specifier.startsWith(".") && databasePackage.test(specifier)) {
        report(context, "error", file.path, parsed.lineOf(node), `transport imports database/ORM package "${specifier}" — call an application use case or query instead`, dependencyRef);
        continue;
      }
      const target = await context.typescript.resolve(file, specifier);
      if (target && classifyTransport(target).infrastructure) {
        report(context, "error", file.path, parsed.lineOf(node), "transport imports infrastructure — call an application use case or query instead", dependencyRef);
      }
    }
  },
});

export const btTypescriptRules = Object.freeze([
  bt001,
  bt002,
  bt004,
  bt010,
  bt013,
  bt014,
  bt015,
  bt016,
  bt017,
  bt020,
]);
