import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";

const docDependency = "frontend-pa-vsa.md#dependency-rule";
const docComponents = "frontend-pa-vsa.md#components";
const docPromotion = "frontend-pa-vsa.md#promotion";
const helper = /use-?provide-?inject/i;
const layers = ["logic", "ports", "adapters", "composables", "components"];
const forbidden = {
  logic: new Set(["ports", "adapters", "composables", "components"]),
  ports: new Set(["adapters", "composables", "components"]),
  adapters: new Set(["composables", "components"]),
  components: new Set(["adapters"]),
};

const basename = (file) => file.split("/").at(-1);
const dirname = (file) => file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : "";
const under = (file, directory) => !directory || file === directory || file.startsWith(`${directory}/`);
const relativeTo = (file, directory) => directory ? file.slice(directory.length + 1) : file;

function layerOf(file, appPath) {
  const segments = relativeTo(file.path, appPath).split("/");
  return layers.find((layer) => segments.includes(layer)) ?? null;
}

function subtreeOf(file, appPath) {
  const segments = relativeTo(file.path, appPath).split("/");
  if (segments[0] === "pages") {
    return segments.length > 1 ? `pages/${segments[1].replace(/\.(vue|ts)$/, "")}` : "pages";
  }
  if (segments[0] === "layouts") return `layouts/${(segments[1] || "").replace(/\.(vue|ts)$/, "")}`;
  if (segments.length === 1) return "app";
  return segments[0];
}

function capabilityOf(file) {
  const base = basename(file.path).replace(/\.(ts|js|mjs|vue)$/, "");
  if (!/^use[-A-Z]/.test(base)) return null;
  return base
    .replace(/^use-?/, "")
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join("");
}

function unwrap(ts, node) {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) || ts.isNonNullExpression(node))) {
    node = node.expression;
  }
  return node;
}

async function createInjectCapabilityIndex(context) {
  const ts = await context.typescript.runtime();
  const cache = new Map();
  return async (directory) => {
    if (!cache.has(directory)) cache.set(directory, (async () => {
      const capabilities = new Set();
      if (!ts) return capabilities;
      for (const file of context.files) {
        if (!file.path.endsWith(".ts") || !under(file.path, directory) || file.path === directory) continue;
        const source = await context.typescript.source(file);
        if (!source) continue;
        const laterExports = new Set();
        for (const statement of source.sourceFile.statements) {
          if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause ||
              !ts.isNamedExports(statement.exportClause)) continue;
          for (const element of statement.exportClause.elements) {
            laterExports.add((element.propertyName ?? element.name).text);
          }
        }
        for (const statement of source.sourceFile.statements) {
          if (!ts.isVariableStatement(statement)) continue;
          const directExport = statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isArrayBindingPattern(declaration.name) || declaration.name.elements.length !== 2) continue;
            const names = declaration.name.elements.map((element) =>
              ts.isBindingElement(element) && ts.isIdentifier(element.name) ? element.name.text : "");
            if (!directExport && !names.every((name) => laterExports.has(name))) continue;
            const initializer = unwrap(ts, declaration.initializer);
            const expression = initializer && ts.isCallExpression(initializer) ? unwrap(ts, initializer.expression) : null;
            if (!initializer || !ts.isCallExpression(initializer) || !expression ||
                !ts.isIdentifier(expression) || expression.text !== "useProvideInject") continue;
            const match = names[0].match(/^inject([A-Z]\w*)$/);
            if (match && names[1] === `provide${match[1]}`) capabilities.add(match[1]);
          }
        }
      }
      return capabilities;
    })());
    return cache.get(directory);
  };
}

export const feGraphRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-FE-004", source: "in-process/fe-graph-rules.mjs" }),
    requirements: [Capability.FRONTEND_GRAPH],
    async analyze(context) {
      for (const root of context.frontendRoots.withinDepth(6)) {
        const graph = await context.frontendGraph.graph(root);
        if (!graph) continue;
        for (const edge of graph.edges) {
          const fromLayer = layerOf(edge.from, root.appPath);
          const toLayer = layerOf(edge.to, root.appPath);
          if (!fromLayer || !toLayer || !forbidden[fromLayer]?.has(toLayer)) continue;
          if (fromLayer === "ports" && helper.test(basename(edge.to.path))) continue;
          context.report({
            severity: "error",
            path: edge.from.path,
            line: edge.line,
            message: `${fromLayer}/ must not import from ${toLayer}/ (${relativeTo(edge.to.path, root.appPath)}) — layer order is logic ← ports ← adapters ← composables ← pages`,
            docRef: docDependency,
          });
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-FE-021", source: "in-process/fe-graph-rules.mjs" }),
    requirements: [Capability.FRONTEND_GRAPH],
    async analyze(context) {
      const injectCapabilities = await createInjectCapabilityIndex(context);
      for (const root of context.frontendRoots.all()) {
        const graph = await context.frontendGraph.graph(root);
        if (!graph) continue;
        const sharedCapabilities = await injectCapabilities(`${root.appPath}/shared/ports`.replace(/^\//, ""));
        for (const edge of graph.edges) {
          if (layerOf(edge.from, root.appPath) !== "components" ||
              layerOf(edge.to, root.appPath) !== "composables" || edge.typeOnly) continue;
          const capability = capabilityOf(edge.to);
          if (!capability || /^provideinject$/i.test(capability)) continue;
          const capabilities = new Set(sharedCapabilities);
          let directory = edge.from.directory;
          while (under(directory, root.appPath)) {
            const portDirectory = `${directory}/ports`.replace(/^\//, "");
            for (const candidate of await injectCapabilities(portDirectory)) capabilities.add(candidate);
            if (directory === root.appPath) break;
            directory = dirname(directory);
          }
          const hit = [...capabilities].find((candidate) => capability === candidate ||
            ["Rivet", "Platform", "Tauri"].some((prefix) => capability === `${prefix}${candidate}`));
          if (!hit) continue;
          context.report({
            severity: "warn",
            path: edge.from.path,
            line: edge.line,
            message: `component imports implementation composable ${basename(edge.to.path)} but a port exists (inject${hit}) — inject the port instead`,
            docRef: docComponents,
          });
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ ids: ["MER-FE-022", "MER-FE-031"], source: "in-process/fe-graph-rules.mjs" }),
    requirements: [Capability.FRONTEND_GRAPH],
    async analyze(context) {
      for (const root of context.frontendRoots.withinDepth(6)) {
        const graph = await context.frontendGraph.graph(root);
        if (!graph) continue;
        const shared = `${root.appPath}/shared/`.replace(/^\//, "");
        const consumers = new Map();
        for (const edge of graph.edges) {
          if (!edge.to.path.startsWith(shared) || edge.from.path.startsWith(shared)) continue;
          if (!consumers.has(edge.to.path)) consumers.set(edge.to.path, new Set());
          consumers.get(edge.to.path).add(subtreeOf(edge.from, root.appPath));
        }
        for (const [file, subtrees] of [...consumers].sort(([left], [right]) => left.localeCompare(right))) {
          if (subtrees.size !== 1 || helper.test(basename(file))) continue;
          const only = [...subtrees][0];
          const sharedComposables = `${root.appPath}/shared/composables/`.replace(/^\//, "");
          if (file.startsWith(sharedComposables)) {
            context.report({
              id: "MER-FE-022",
              severity: "warn",
              path: file,
              line: 0,
              message: `shared composable is consumed only by ${only} — composables live at their composition root; move it into that subtree`,
              docRef: docPromotion,
            });
          } else {
            context.report({
              id: "MER-FE-031",
              severity: "info",
              path: file,
              line: 0,
              message: `only one subtree (${only}) consumes this shared item — review ownership; consumer count alone does not prove misplacement`,
              docRef: docPromotion,
            });
          }
        }
      }
    },
  }),
]);
