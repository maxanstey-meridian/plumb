export const Capability = Object.freeze({
  PATH: "path",
  TEXT: "text",
  LINE_MAP: "line-map",
  JSON: "json",
  BASIC_CONFIG: "basic-config",
  TYPESCRIPT: "typescript",
  FRONTEND_ROOTS: "frontend-roots",
  FRONTEND_GRAPH: "frontend-graph",
  CSHARP: "csharp",
  DOTNET_PROJECTS: "dotnet-projects",
});

export const CAPABILITIES = Object.freeze(Object.values(Capability));

const DEPENDENCIES = Object.freeze({
  [Capability.PATH]: [],
  [Capability.TEXT]: [Capability.PATH],
  [Capability.LINE_MAP]: [Capability.TEXT],
  [Capability.JSON]: [Capability.TEXT],
  [Capability.BASIC_CONFIG]: [Capability.TEXT],
  [Capability.TYPESCRIPT]: [Capability.PATH, Capability.TEXT, Capability.LINE_MAP],
  [Capability.FRONTEND_ROOTS]: [Capability.PATH],
  [Capability.FRONTEND_GRAPH]: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  [Capability.CSHARP]: [Capability.LINE_MAP],
  [Capability.DOTNET_PROJECTS]: [Capability.PATH, Capability.TEXT],
});

export function planCapabilities(rules) {
  const planned = new Set();
  const add = (capability) => {
    if (!Object.hasOwn(DEPENDENCIES, capability)) throw new Error(`unknown capability: ${capability}`);
    if (planned.has(capability)) return;
    for (const dependency of DEPENDENCIES[capability]) add(dependency);
    planned.add(capability);
  };
  for (const rule of rules) for (const capability of rule.requirements) add(capability);
  return Object.freeze([...planned]);
}

export function createRuleDescriptor({ id, ids = id ? [id] : null, source, variants = null }) {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error("rule descriptors require at least one ID");
  if (new Set(ids).size !== ids.length) throw new Error(`${source} repeats a rule ID`);
  for (const ruleId of ids) if (!/^MER-[A-Z]{2}-\d{3}$/.test(ruleId)) throw new Error(`invalid rule ID: ${ruleId}`);
  const packs = new Set(ids.map((ruleId) => ruleId.split("-")[1]));
  if (packs.size !== 1) throw new Error(`${source} declares IDs from multiple packs`);
  return Object.freeze({
    ids: Object.freeze([...ids]),
    pack: ids[0].split("-")[1],
    source,
    variants: variants ? Object.freeze([...variants]) : null,
  });
}

function defineRule(kind, descriptor, requirements, analyze, extra = {}) {
  if (typeof analyze !== "function") throw new Error(`${descriptor.source} has no analyze function`);
  return Object.freeze({
    kind,
    descriptor,
    requirements: Object.freeze([...new Set(requirements)]),
    analyze,
    ...extra,
  });
}

export function defineRepositoryRule(options) {
  return defineRule("repository", options.descriptor, options.requirements ?? [Capability.PATH], options.analyze);
}

export function defineFileRule(options) {
  if (typeof options.files !== "function") throw new Error(`${options.descriptor.source} has no file selector`);
  return defineRule("file", options.descriptor, options.requirements ?? [Capability.PATH], options.analyze, { files: options.files });
}

export function defineSyntaxRule(options) {
  if (!options.language) throw new Error(`${options.descriptor.source} has no syntax language`);
  if (typeof options.register !== "function") throw new Error(`${options.descriptor.source} has no visitor registration`);
  return Object.freeze({
    kind: "syntax",
    descriptor: options.descriptor,
    requirements: Object.freeze([Capability.TYPESCRIPT]),
    language: options.language,
    files: options.files ?? null,
    register: options.register,
  });
}

export function createConfigParser(name, parse) {
  if (!name || typeof parse !== "function") throw new Error("config parsers require a name and parse function");
  return Object.freeze({ name, parse });
}
