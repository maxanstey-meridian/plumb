import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { csharpDeclarations } from "../engine/csharp-types.mjs";
import { matchingCSharpDelimiter } from "../engine/dotnet-analysis.mjs";
import { APPLICATION_FRAMEWORK_PREFIXES, APPLICATION_HIGHER_LAYERS, DOMAIN_FRAMEWORK_PREFIXES, DOMAIN_HIGHER_LAYERS, isFileLocalName, SERVICE_PROVIDER_TYPES } from "../engine/csharp-facts.mjs";
import { inBuildOutput, isCSharpTestCode, propagateConsumers, report } from "./helpers.mjs";

const source = "in-process/be-csharp.mjs";
const dependencyRef = "backend-pa-vsa.md#non-negotiable-dependency-rules";
const modulesRef = "backend-pa-vsa.md#across-modules";
const netRef = "backend-pa-vsa.md#net";
const moduleShapeRef = "backend-pa-vsa.md#standard-module-shape";
const insideModuleRef = "backend-pa-vsa.md#inside-a-module";
const normalized = (value) => value.replaceAll("\\", "/");
const parentOf = (value) => value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
const baseOf = (value) => value.slice(value.lastIndexOf("/") + 1);
const under = (file, directory) => !directory || file === directory || file.startsWith(`${directory}/`);
const parts = (file) => normalized(file).split("/");
const hasSegment = (file, segment) => parts(file).includes(segment);
const lineAt = (file, offset) => file.lineMap().lineAt(offset);
const linesOf = (file, text = file.text()) => text.split(/\r?\n/);

function rootsWith(directory, files) {
  const roots = new Set();
  for (const file of files) {
    const segments = parts(file.path);
    for (let index = 0; index < segments.length - 1; index++) {
      if (segments[index] === directory) roots.add(segments.slice(0, index).join("/"));
    }
  }
  return [...roots].sort();
}

function backendRoots(files) {
  return rootsWith("Modules", files);
}

function commonBackendRoots(files) {
  const common = new Set(rootsWith("Common", files));
  return backendRoots(files).filter((root) => common.has(root));
}

function relativeTo(file, directory) {
  return directory ? file.slice(directory.length + 1) : file;
}

function filesBelow(files, directory) {
  return files.filter((file) => under(file.path, directory));
}

function matchingBrace(text, open) {
  return matchingCSharpDelimiter(text, open, "{", "}");
}

function emit(context, id, severity, file, line, message, docRef) {
  context.report({ id, severity, path: file.path, line, message, docRef });
}

function regexLines(file, text, patterns, callback) {
  for (const [index, line] of linesOf(file, text).entries()) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) { callback(index + 1, line); break; }
    }
  }
}

const prefixPattern = (prefixes) => new RegExp(`^(?:${prefixes.map((prefix) => prefix.replaceAll(".", "\\.")).join("|")})(?:\\.|$)`);
const domainFramework = prefixPattern(DOMAIN_FRAMEWORK_PREFIXES);
const applicationFramework = prefixPattern(APPLICATION_FRAMEWORK_PREFIXES);
const layerPattern = (layers) => new RegExp(`\\.(?:${layers.join("|")})(?:\\.|$)`);
const higherLayer = layerPattern(DOMAIN_HIGHER_LAYERS);
const applicationHigherLayer = layerPattern(APPLICATION_HIGHER_LAYERS);
const dottedName = /\b[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+\b/g;
// Whether a file of this layer may not reach `name`, a using's target or a type's full name.
const reachesPast = (layer, name) => layer === "Domain"
  ? higherLayer.test(name) || domainFramework.test(name)
  : applicationHigherLayer.test(name) || applicationFramework.test(name);

// MER-BE-001 and MER-BE-002: a Domain or Application file that uses a framework or a higher layer, however the name got
// into scope: a using's target (and any dotted name in its type arguments), or the type of each use the compiler binds.
const be001 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ ids: ["MER-BE-001", "MER-BE-002"], source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const facts = context.csharpFacts;
    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path) || hasSegment(file.path, "node_modules")) continue;
      if (isCSharpTestCode(context, file) || !facts.hasFacts(file)) continue;
      const { layer } = context.csharp.classify(file);
      if (layer !== "Domain" && layer !== "Application") continue;
      const judged = new Set();
      const judge = (line, name) => {
        const key = `${line}\0${name}`;
        if (judged.has(key) || !reachesPast(layer, name)) return;
        judged.add(key);
        emit(context, layer === "Domain" ? "MER-BE-001" : "MER-BE-002", "error", file, line,
          layer === "Domain"
            ? `Domain depends on nothing outside itself — remove this reference (${name})`
            : `Application must not depend on Infrastructure or transport frameworks — depend on a port instead (${name})`, dependencyRef);
      };
      for (const using of facts.usings(file)) {
        const target = using.target.replace(/[<[?].*$/, "");
        for (const name of new Set([target, ...using.target.match(dottedName) ?? []])) judge(using.line, name);
      }
      for (const reference of facts.references(file)) {
        if (!reference.qualifier) judge(reference.line, facts.displayName(reference.to));
      }
    }
    for (const backend of backendRoots(context.files)) {
      const hasDomain = context.csharp.csharpFiles.some((file) => under(file.path, backend ? `${backend}/Modules` : "Modules") && /(?:^|\/)Modules\/[^/]+\/Domain\//.test(file.path) && !inBuildOutput(file.path));
      if (!hasDomain) continue;
      for (const file of context.csharp.csharpFiles) {
        if (file.directory !== backend || inBuildOutput(file.path)) continue;
        if (isCSharpTestCode(context, file) || !facts.hasFacts(file)) continue;
        for (const using of facts.usings(file)) {
          if (!using.global) continue;
          const reference = using.target.replace(/[<[?].*$/, "");
          if (!domainFramework.test(reference) && !higherLayer.test(reference)) continue;
          emit(context, "MER-BE-001", "error", file, using.line,
            `Domain depends on nothing outside itself — remove this global using (${reference})`, dependencyRef);
        }
      }
    }
  },
});

// A module's name and layer folder from a path: the folder after its last `Modules` segment, and the folder under that
// (`""` for a file at the module root), as classify() reads them. `root` is the backend root above `Modules`.
export const moduleOfPath = (filePath) => {
  const segments = filePath.split("/");
  const at = segments.lastIndexOf("Modules");
  if (at < 0 || at + 2 >= segments.length) return null;
  return { root: segments.slice(0, at).join("/"), module: segments[at + 1], layer: at + 3 < segments.length ? segments[at + 2] : "" };
};

const layouts = new WeakMap();

// Which module owns what, over the facts: the modules under each backend root, and the module and namespace segment
// of a type, a using, or a namespace. Test code is no module's code. One per scan, shared by MER-BE-003 to 005 and the
// module rules (MER-BE-061 to 064).
export function moduleLayout(context) {
  const facts = context.csharpFacts;
  if (!layouts.has(facts)) layouts.set(facts, buildLayout(context, facts));
  return layouts.get(facts);
}

function buildLayout(context, facts) {
  const testCache = new Map();
  const isTest = (file) => {
    if (!testCache.has(file.path)) testCache.set(file.path, isCSharpTestCode(context, file));
    return testCache.get(file.path);
  };
  const roots = backendRoots(context.csharp.csharpFiles);
  const modulesByRoot = new Map(roots.map((root) => [root, new Set()]));
  for (const file of context.csharp.csharpFiles) {
    if (inBuildOutput(file.path) || isTest(file)) continue;
    const placed = moduleOfPath(file.path);
    if (placed) modulesByRoot.get(placed.root)?.add(placed.module);
  }
  const rootsOf = (module) => roots.filter((root) => modulesByRoot.get(root).has(module));

  // The module of the type a use or a using names: that of its first part outside test code, in the assembly the
  // compiler bound. Null for a type no module declares.
  const typeCache = new Map();
  const moduleOfType = (fact) => {
    const key = `${fact.to ?? fact.type}\0${fact.assembly}`;
    if (!typeCache.has(key)) {
      let found = null;
      for (const part of facts.partsOf(fact)) {
        if (isTest(part.file)) continue;
        const placed = moduleOfPath(part.file.path);
        if (placed) { found = placed; break; }
      }
      typeCache.set(key, found);
    }
    return typeCache.get(key);
  };

  // The namespace's segment after `Modules.<module>`, else the declaring file's layer folder.
  const segmentOf = (typeName, placed) => {
    const segments = (facts.types.get(typeName)?.namespace ?? "").split(".");
    for (let index = segments.length - 2; index >= 0; index--) {
      if (segments[index] === "Modules" && segments[index + 1] === placed.module) return segments[index + 2] ?? "";
    }
    return placed.layer;
  };

  // Each module with a non-test type in a namespace or below it.
  let byNamespace;
  const modulesInNamespace = (name) => {
    if (!byNamespace) {
      byNamespace = new Map();
      for (const entry of facts.types.values()) {
        for (const part of entry.parts) {
          if (isTest(part.file)) continue;
          const placed = moduleOfPath(part.file.path);
          if (!placed) continue;
          for (let namespace = entry.namespace; ; namespace = namespace.includes(".") ? namespace.slice(0, namespace.lastIndexOf(".")) : "") {
            if (!byNamespace.has(namespace)) byNamespace.set(namespace, new Map());
            const modules = byNamespace.get(namespace);
            const key = `${placed.root}\0${placed.module}`;
            if (!modules.has(key) || part.file.path < modules.get(key).path) modules.set(key, { ...placed, path: part.file.path });
            if (!namespace) break;
          }
        }
      }
    }
    return [...(byNamespace.get(name)?.values() ?? [])];
  };

  // The modules a namespace names, one target each, as `{ target, targetBackend, segment }`: the module its
  // `Modules.<module>` segments give when that is a module folder, else every module with types in it or below.
  const namespaceTargets = (name, backend) => {
    const segments = name.split(".");
    for (let index = segments.length - 2; index >= 0; index--) {
      if (segments[index] !== "Modules") continue;
      const module = segments[index + 1];
      const named = rootsOf(module);
      if (!named.length) break;
      // A module name under two backend roots: the root whose module declares types in this namespace.
      const declared = named.length > 1 ? named.filter((root) => modulesInNamespace(name).some((placed) => placed.root === root && placed.module === module)) : named;
      const among = declared.length ? declared : named;
      return [{ target: module, targetBackend: among.includes(backend) ? backend : among[0], segment: segments[index + 2] ?? "" }];
    }
    return modulesInNamespace(name).map((placed) => ({ target: placed.module, targetBackend: placed.root, segment: placed.layer }));
  };

  const usingTargets = (using, backend) => {
    if (using.targetKind === "type") {
      const placed = moduleOfType(using);
      return placed ? [{ target: placed.module, targetBackend: placed.root, segment: segmentOf(using.type, placed) }] : [];
    }
    return namespaceTargets(using.target, backend);
  };

  // The modules an MSBuild `<Using>` item puts in every file: a namespace, or with Static or an alias a type too.
  const itemTargets = (item, backend) => {
    const targets = item.static ? [] : namespaceTargets(item.target, backend);
    if (item.static || item.alias) {
      for (const part of facts.types.get(item.target)?.parts ?? []) {
        const placed = isTest(part.file) ? null : moduleOfPath(part.file.path);
        if (placed) { targets.push({ target: placed.module, targetBackend: placed.root, segment: segmentOf(item.target, placed) }); break; }
      }
    }
    return targets;
  };

  return { roots, isTest, modulesByRoot, rootsOf, moduleOfType, segmentOf, namespaceTargets, usingTargets, itemTargets, hits: null };
}

// Every reference one file makes into a module's code: `{ backend, file, path, line, owner, layer, common, target,
// targetBackend, segment, global, kind }`. A `using` directive whose target is in module `target` is a `using` hit; a
// type named in full or through the enclosing namespace is a `name` hit. A name brought in by a using is judged at its
// directive. The backend roots are walked as MER-BE-003 to 005 always have: a file below nested roots is read once per
// root, and owner, layer, and common are set only for the root that classifies it. A file the compiler didn't read
// (no facts) gives none.
export function moduleHits(context) {
  const layout = moduleLayout(context);
  if (layout.hits) return layout.hits;
  const facts = context.csharpFacts;
  const hits = [];
  for (const backend of layout.roots) {
    for (const file of filesBelow(context.csharp.csharpFiles, backend)) {
      if (layout.isTest(file) || !facts.hasFacts(file)) continue;
      const classification = context.csharp.classify(file);
      const own = classification.backendRoot === backend;
      const base = { backend, file, path: file.path, owner: own ? classification.module : null, layer: own ? classification.layer : null, common: own && classification.common };
      for (const using of facts.usings(file)) {
        for (const target of layout.usingTargets(using, backend)) hits.push({ ...base, line: using.line, kind: "using", global: using.global, ...target });
      }
      for (const reference of facts.references(file)) {
        if (reference.written !== "qualified" && reference.written !== "enclosing") continue;
        const placed = layout.moduleOfType(reference);
        if (!placed) continue;
        hits.push({ ...base, line: reference.line, kind: "name", global: false, target: placed.module, targetBackend: placed.root, segment: layout.segmentOf(reference.to, placed) });
      }
    }
  }
  layout.hits = hits;
  return hits;
}

const globalUsingMessage = (target, segment) =>
  `global using of ${target}${segment ? `.${segment}` : ""} puts module ${target} in every file of the project — use it only in the files that need it`;

const be003 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ ids: ["MER-BE-003", "MER-BE-004", "MER-BE-005"], source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const findingId = (segment) => segment === "Domain" ? "MER-BE-003" : segment === "Infrastructure" ? "MER-BE-004" : "MER-BE-005";
    const seen = new Map();
    for (const hit of moduleHits(context)) {
      const { owner, layer, common, path: hitPath } = hit;
      const flag = hit.segment === "Contracts"
        ? common || Boolean(owner && owner !== hit.target && layer === "Domain")
        : owner ? owner !== hit.target : common || hit.global;
      // A global using puts the module in every file of the project, so it is flagged wherever it is written.
      const projectWide = !flag && hit.global;
      if (!flag && !projectWide) continue;
      const id = projectWide ? "MER-BE-005" : findingId(hit.segment);
      const key = `${id}\t${hitPath}\t${hit.line}\t${hit.target}\t${hit.segment}`;
      if (!seen.has(hit.backend)) seen.set(hit.backend, new Set());
      if (seen.get(hit.backend).has(key)) continue;
      seen.get(hit.backend).add(key);
      const who = owner || "outside module";
      let message;
      if (projectWide) message = globalUsingMessage(hit.target, hit.segment);
      else if (hit.segment === "Contracts") message = `module ${who} ${layer || "shared code"} must not use ${hit.target}.Contracts — published contracts are for Application and integration consumers`;
      else if (id === "MER-BE-003") message = `module ${who} must not use ${hit.target}.Domain — consume a published contract or define a required port`;
      else if (id === "MER-BE-004") message = `module ${who} must not use ${hit.target}.Infrastructure — bridge modules at the composition edge`;
      else if (hit.segment === "Application") message = `module ${who} must not use ${hit.target}.Application internals — publish a contract under ${hit.target}.Contracts or define a consumer-owned required port`;
      else message = `module ${who} must not use ${hit.target}'s ${hit.segment || "root namespace"} types — publish a contract under ${hit.target}.Contracts or define a consumer-owned required port`;
      emit(context, id, "error", hit.file, hit.line, message, modulesRef);
    }

    // An MSBuild <Using> item is a global using too: it puts the module in every file of its project, reported at the
    // project file's line. Test-only items and test projects take it into test code only.
    const layout = moduleLayout(context);
    const reported = new Set();
    for (const file of [...context.csharp.projectFiles, ...context.csharp.propsFiles]) {
      if (inBuildOutput(file.path) || layout.isTest(file)) continue;
      for (const using of context.csharp.projectUsings(file)) {
        if (using.testOnly) continue;
        const line = file.lineMap().lineAt(using.offset);
        for (const hit of layout.itemTargets(using, null)) {
          const key = `${file.path}\t${line}\t${hit.target}\t${hit.segment}`;
          if (reported.has(key)) continue;
          reported.add(key);
          emit(context, "MER-BE-005", "error", file, line, globalUsingMessage(hit.target, hit.segment), modulesRef);
        }
      }
    }
  },
});

// The host, the backend's composition root (Program.cs, Middleware/, Infrastructure/, Integration/, …): every
// production file of the backend outside Modules/, Common/ and the transport Contracts/. A transport type's
// consumers are the code that references it, so Contracts/ is neither the host nor a module.
const host = Symbol("host");

// A Common type a single module consumes. A module consumes it where a name it writes resolves to the Common
// declaration (a module's own same-named type is not the Common one), and a candidate's consumers also consume
// the candidates its declaration names. Transport types under Contracts/ are stepping stones the same way: a module
// that references a contract type consumes the Common types it names, through any chain of contract types, and a
// contract type nothing references passes nothing on. A type the host consumes is shared by definition, so it is
// never reported, even when the host is its only consumer. A port's consumers consume the DTOs its signatures name,
// however they receive them, and a call to a static class's extension member consumes the class (the compiler binds
// it to the static class). *Exception types and hidden types (a `file`, private, or protected type, or one nested in
// such a type) are not candidates, but pass consumers on like any other. A consumer is a file that uses the type, as
// the compiler sees it: a written name, an alias, or an inferred type.
const hiddenAccess = new Set(["private", "private protected", "protected", "file"]);
const be006 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-006", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const facts = context.csharpFacts;
    const production = (file) => !inBuildOutput(file.path) && !isCSharpTestCode(context, file);
    const hidden = (entry) => hiddenAccess.has(entry.access) || (entry.containing !== null && Boolean(facts.types.get(entry.containing)) && hidden(facts.types.get(entry.containing)));
    for (const backend of commonBackendRoots(context.files)) {
      const commonDirectory = backend ? `${backend}/Common` : "Common";
      const modulesDirectory = backend ? `${backend}/Modules` : "Modules";
      const contractsDirectory = backend ? `${backend}/Contracts` : "Contracts";
      // Common and transport types, the nodes consumers propagate through, by their parts outside test code and build
      // output; only Common candidates are reported.
      const nodes = new Map();
      for (const [fullName, entry] of facts.types) {
        const productionParts = entry.parts.filter((part) => production(part.file));
        const inCommon = productionParts.filter((part) => under(part.file.path, commonDirectory));
        const parts = (inCommon.length ? inCommon : productionParts.filter((part) => under(part.file.path, contractsDirectory)))
          .sort((left, right) => left.file.path.localeCompare(right.file.path) || left.start - right.start);
        if (!parts.length) continue;
        const display = facts.displayName(fullName);
        const name = display.slice(display.lastIndexOf(".") + 1);
        nodes.set(fullName, { name, parts, files: new Set(parts.map((part) => part.file.path)), candidate: inCommon.length > 0 && !name.endsWith("Exception") && !hidden(entry) });
      }
      const consumers = new Map([...nodes.keys()].map((fullName) => [fullName, new Set()]));
      const nodeOf = (reference) => {
        const node = nodes.get(reference.to);
        return node && facts.partsOf(reference).some((part) => node.files.has(part.file.path)) ? reference.to : null;
      };
      // A global `using static` of a node, in a source file or as a .csproj <Using Static> item, imports its members
      // everywhere, so code calls them without naming the type, and the type is shared, as if the host used it. (A
      // global alias only brings a name in; the references through it are the uses.)
      // (A project item can't name a file-local type, and one displays like the public type beside it.)
      const nodeByName = new Map([...nodes.keys()].filter((fullName) => !isFileLocalName(fullName)).map((fullName) => [facts.displayName(fullName), fullName]));
      const staticImports = [
        ...filesBelow(context.csharp.csharpFiles, backend).filter(production)
          .flatMap((file) => facts.usings(file).filter((using) => using.global && using.static && !using.alias && using.targetKind === "type").map((using) => using.type)),
        ...filesBelow(context.csharp.projectFiles, backend).filter((file) => !inBuildOutput(file.path))
          .flatMap((file) => context.csharp.projectUsings(file).filter((using) => using.static && !using.alias && !using.testOnly).map((using) => nodeByName.get(using.target.replace(/[<[?].*$/, "")))),
      ];
      for (const fullName of staticImports) if (nodes.has(fullName)) consumers.get(fullName).add(host);
      // A test of a module's code is not a consumer that owns the type.
      const consume = (files, consumerOf) => {
        for (const file of files.filter(production)) {
          const consumer = consumerOf(file);
          for (const reference of facts.references(file)) {
            const node = nodeOf(reference);
            if (node) consumers.get(node).add(consumer);
          }
        }
      };
      consume(filesBelow(context.csharp.csharpFiles, modulesDirectory), (file) => relativeTo(file.path, modulesDirectory).split("/")[0]);
      consume(filesBelow(context.csharp.csharpFiles, backend).filter((file) => !["Modules", "Common", "Contracts"].includes(relativeTo(file.path, backend).split("/")[0])), () => host);
      // The nodes each node's declaration names: a use inside a node, or inside a type nested in one, of another node.
      const named = new Map([...nodes.keys()].map((fullName) => [fullName, new Set()]));
      const nodeFiles = new Set([...nodes.values()].flatMap((node) => [...node.files]));
      for (const file of context.csharp.csharpFiles.filter((candidate) => nodeFiles.has(candidate.path))) {
        for (const reference of facts.references(file)) {
          const target = nodeOf(reference);
          if (!target) continue;
          for (let owner = reference.from; owner; owner = facts.types.get(owner)?.containing ?? null) {
            if (owner !== target && named.has(owner)) named.get(owner).add(target);
          }
        }
      }
      propagateConsumers(consumers, named);
      const reported = [...nodes].filter(([fullName, node]) => node.candidate && consumers.get(fullName).size === 1 && !consumers.get(fullName).has(host))
        .sort(([leftName, left], [rightName, right]) => left.name.localeCompare(right.name) || leftName.localeCompare(rightName));
      for (const [fullName, node] of reported) {
        const module = [...consumers.get(fullName)][0];
        report(context, "info", node.parts[0].file.path, 0,
          `Common type ${node.name} is referenced only by module ${module} — review ownership; move it only if ${module} truly owns it`, "backend-pa-vsa.md#sharedcommon-rule");
      }
    }
  },
});

// A Common port that uses a type declared in a module's Domain, as the compiler binds each use.
const be007 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-007", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const facts = context.csharpFacts;
    for (const backend of commonBackendRoots(context.files)) {
      const modulesDirectory = backend ? `${backend}/Modules` : "Modules";
      const portsDirectory = backend ? `${backend}/Common/Ports` : "Common/Ports";
      const inDomain = (part) => under(part.file.path, modulesDirectory) && relativeTo(part.file.path, modulesDirectory).split("/")[1] === "Domain";
      for (const file of filesBelow(context.csharp.csharpFiles, portsDirectory)) {
        if (isCSharpTestCode(context, file) || !facts.hasFacts(file)) continue;
        const exposed = new Map();
        for (const reference of facts.references(file)) {
          const key = `${reference.to}\0${reference.assembly}`;
          if (exposed.has(key) || !facts.partsOf(reference).some(inDomain)) continue;
          const display = facts.displayName(reference.to);
          exposed.set(key, { name: display.slice(display.lastIndexOf(".") + 1), line: reference.line });
        }
        for (const { name, line } of [...exposed.values()].sort((left, right) => left.name.localeCompare(right.name) || left.line - right.line)) {
          report(context, "error", file.path, line,
            `Common port exposes module-owned domain type ${name} — inline a port DTO, move a truly shared value type to Common, or split the port`, "backend-pa-vsa.md#sharedcommon-rule");
        }
      }
    }
  },
});

// `projectFiles` also reads the .csproj files (package references); `skipTests` leaves out test code, which is
// judged by testing standards rather than production rules. Either needs DOTNET_PROJECTS.
function simpleCSharpRule(id, { severity, active = () => true, select = () => true, patterns, message, docRef, mask = false, projectFiles = false, skipTests = false }) {
  return defineRepositoryRule({
    descriptor: createRuleDescriptor({ id, source }),
    requirements: projectFiles || skipTests ? [Capability.CSHARP, Capability.DOTNET_PROJECTS] : [Capability.CSHARP],
    analyze(context) {
      if (!active(context)) return;
      const files = projectFiles ? [...context.csharp.csharpFiles, ...context.dotnetProjects.projectFiles] : context.csharp.csharpFiles;
      for (const file of files) {
        if (!select(file) || (skipTests && isCSharpTestCode(context, file))) continue;
        const text = mask && file.path.endsWith(".cs") ? context.csharp.mask(file) : file.text();
        regexLines(file, text, patterns, (line) => emit(context, id, severity, file, line, message, docRef));
      }
    },
  });
}

const be008 = simpleCSharpRule("MER-BE-008", {
  severity: "error", skipTests: true, mask: true, select: (file) => /(?:^|\/)Modules\/[^/]+\/Domain\//.test(file.path) && !inBuildOutput(file.path),
  patterns: [/\binterface\s+I[A-Za-z0-9_]*Repository\b/, /\bclass\s+[A-Za-z0-9_]*Repository\b/],
  message: "repository declarations belong in Application/Ports, not Domain", docRef: dependencyRef,
});

// A Domain or Application file that uses `System.IServiceProvider`, however it names it (through an alias, a parameter,
// a local, or a call on a value of the type), one finding per line. An `IServiceProvider` the app declares is its own.
const be009 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-009", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const facts = context.csharpFacts;
    for (const file of context.csharp.csharpFiles) {
      if (!["Domain", "Application"].includes(context.csharp.classify(file).layer) || inBuildOutput(file.path)) continue;
      if (isCSharpTestCode(context, file) || !facts.hasFacts(file)) continue;
      const lines = new Set(facts.references(file).filter((reference) => SERVICE_PROVIDER_TYPES.includes(reference.to)).map((reference) => reference.line));
      for (const line of [...lines].sort((a, b) => a - b)) report(context, "error", file.path, line,
        "System.IServiceProvider hides dependencies; inject the required port directly", dependencyRef);
    }
  },
});

const be010 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-010", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    // Modules by their production C#: a test project mirroring Modules/Orders/ declares no module.
    const modules = new Set();
    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path) || isCSharpTestCode(context, file)) continue;
      const segments = parts(file.path);
      for (let index = 0; index + 2 < segments.length; index++) if (segments[index] === "Modules") modules.add(segments.slice(0, index + 2).join("/"));
    }
    for (const module of [...modules].sort()) {
      const name = baseOf(module), projectDirectory = parentOf(parentOf(module));
      const registration = context.file(`${module}/${name}Module.cs`);
      let extension = "";
      if (registration) {
        const match = context.csharp.source(registration).match(new RegExp(`\\b(Add${name}[A-Za-z0-9_]*Module)\\s*\\(\\s*this\\s+(?:[A-Za-z_][A-Za-z0-9_.]*\\.)?IServiceCollection\\b`, "s"));
        extension = match?.[1] ?? "";
      }
      if (!extension) {
        context.report({ severity: "warn", path: module, line: 0, message: `module ${name} must expose an Add${name}*Module IServiceCollection extension from ${name}Module.cs`, docRef: moduleShapeRef });
        continue;
      }
      const program = context.csharp.csharpFiles.find((file) => under(file.path, projectDirectory) && file.name === "Program.cs" && !inBuildOutput(file.path));
      if (!program || new RegExp(`\\.${extension}\\s*\\(`).test(context.csharp.source(program))) continue;
      const aggregates = new Set();
      for (const file of context.csharp.csharpFiles) {
        if (!under(file.path, projectDirectory) || inBuildOutput(file.path) || !new RegExp(`\\.${extension}\\s*\\(`).test(context.csharp.source(file))) continue;
        const pattern = new RegExp(`\\b(Add[A-Za-z0-9_]+)\\s*\\(\\s*this\\s+(?:[A-Za-z_][A-Za-z0-9_.]*\\.)?IServiceCollection\\b[\\s\\S]*?\\.${extension}\\s*\\(`, "g");
        for (const match of context.csharp.source(file).matchAll(pattern)) aggregates.add(match[1]);
      }
      if (![...aggregates].some((aggregate) => new RegExp(`\\.${aggregate}\\s*\\(`).test(context.csharp.source(program)))) {
        report(context, "warn", program.path, 0, `executable must compose ${extension} directly or through a called aggregate extension`, moduleShapeRef);
      }
    }
  },
});

const be011 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-011", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path) || isCSharpTestCode(context, file)) continue;
      const classification = context.csharp.classify(file);
      if (classification.module && file.name.endsWith("Controller.cs") && !classification.atModuleRoot) {
        report(context, "warn", file.path, 0, "controllers live at the module root; do not create an Interface/ transport folder", moduleShapeRef);
      }
      if (classification.layer === "Interface" && !file.name.endsWith("Controller.cs")) {
        report(context, "warn", file.path, 0, "transport must not be placed in an Interface/ folder; keep endpoints/controllers at the module root", moduleShapeRef);
      }
    }
  },
});

const be012 = simpleCSharpRule("MER-BE-012", {
  severity: "error", projectFiles: true, skipTests: true, select: (file) => !hasSegment(file.path, "obj"),
  patterns: [/\.Scan\(\s*\w+\s*=>/, /\bScrutor\b/, /FromAssembliesOf|AddClassesFromAssembl/],
  message: "no DI auto-scanning — register every use case and port explicitly in the module file", docRef: netRef,
});
const be013 = simpleCSharpRule("MER-BE-013", {
  severity: "error", projectFiles: true, skipTests: true, select: (file) => !hasSegment(file.path, "obj"),
  patterns: [/using MediatR/, /\bIMediator\b/, /\bISender\b/, /"MediatR/],
  message: "no MediatR — call use cases directly: useCase.ExecuteAsync(command, ct)", docRef: netRef,
});
const be014 = simpleCSharpRule("MER-BE-014", {
  severity: "error", projectFiles: true, skipTests: true, select: (file) => !hasSegment(file.path, "obj"),
  patterns: [/using AutoMapper/, /\bCreateMap</, /"AutoMapper/],
  message: "no AutoMapper — construct DTOs/records explicitly", docRef: netRef,
});

const be015 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-015", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    if (context.dotnetProjects.projects().some((project) => project.packages.some((item) => /EntityFrameworkCore|Dapper/i.test(item.include)))) return;
    const patterns = [/\bNpgsqlCommand\b/, /\bSqlCommand\b/, /\bNpgsqlDataReader\b/, /\.ExecuteReaderAsync?\b/, /\.ExecuteScalarAsync?\b/, /\.ExecuteNonQueryAsync?\b/, /\bGetOrdinal\b/, /\bCommandText\b/];
    for (const file of context.csharp.csharpFiles) {
      if (hasSegment(file.path, "obj")) continue;
      let hit = null;
      regexLines(file, context.csharp.source(file), patterns, (line) => { if (hit === null) hit = line; });
      if (hit !== null) {
        report(context, "warn", file.path, hit, "no EF Core or Dapper referenced but raw ADO.NET SQL is hand-rolled here — adopt EF Core or Dapper to reduce AI agent cognitive load", netRef);
        return;
      }
    }
  },
});

// A published or transport contract file that depends on module code outside `Modules/<X>/Contracts/`: a using of a
// namespace in module X (read by name), a using of a type that sits there (an alias or `using static`, flagged at the
// directive), or a use of such a type, however its name got into scope. One finding per (line, name).
const be016 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-016", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const facts = context.csharpFacts;
    const modulePath = /\b((?:[A-Za-z_]\w*\.)*Modules\.[A-Za-z_]\w*(?:\.([A-Za-z_]\w*))?)/;
    // The name a finding gives: the full name up to one segment past `Modules.<X>`, else the whole of it.
    const nameOf = (fullName) => modulePath.exec(fullName)?.[1] ?? fullName;
    const outsideContracts = (parts) => parts.some((part) => {
      if (isCSharpTestCode(context, part.file)) return false;
      const placed = moduleOfPath(part.file.path);
      return placed !== null && placed.layer !== "Contracts";
    });
    for (const file of context.csharp.csharpFiles) {
      const classification = context.csharp.classify(file);
      if (!classification.contract || inBuildOutput(file.path) || isCSharpTestCode(context, file) || !facts.hasFacts(file)) continue;
      const kind = classification.contract === "transport" ? "transport" : "module";
      const seen = new Set();
      const flag = (line, name) => {
        const key = `${line}\0${name}`;
        if (seen.has(key)) return;
        seen.add(key);
        emit(context, "MER-BE-016", "error", file, line,
          `published ${kind} contract depends on ${name} — contracts are closed over published or genuinely shared types`,
          "backend-pa-vsa.md#published-contract-closure");
      };
      for (const using of facts.usings(file)) {
        if (using.targetKind === "type") {
          if (outsideContracts(facts.partsOf(using))) flag(using.line, nameOf(facts.displayName(using.type)));
          continue;
        }
        const named = modulePath.exec(using.target);
        if (named && named[2] !== "Contracts") flag(using.line, named[1]);
      }
      for (const reference of facts.references(file)) {
        if (outsideContracts(facts.partsOf(reference))) flag(reference.line, nameOf(facts.displayName(reference.to)));
      }
    }
  },
});

const be017 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-017", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const root of commonBackendRoots(context.csharp.csharpFiles)) {
      const prefix = root ? `${root}/` : "";
      const modules = new Set(), common = new Map();
      for (const file of context.csharp.csharpFiles) {
        if (!under(file.path, root) || inBuildOutput(file.path) || isCSharpTestCode(context, file)) continue;
        const relative = file.path.slice(prefix.length), segments = relative.split("/");
        if (segments[0] === "Modules" && segments[1]) modules.add(segments[1]);
        if (segments[0] === "Common" && segments[1] && !common.has(segments[1])) common.set(segments[1], file);
      }
      for (const feature of [...modules].filter((name) => common.has(name)).sort()) {
        const file = common.get(feature);
        emit(context, "MER-BE-017", "error", file, 0,
          `Common/${feature} shadows Modules/${feature} — keep feature-owned language with its module`,
          "backend-pa-vsa.md#commonmodule-shadowing");
      }
    }
  },
});

const be020 = simpleCSharpRule("MER-BE-020", {
  severity: "warn", skipTests: true, select: (file) => hasSegment(file.path, "Modules") && !hasSegment(file.path, "obj"),
  patterns: [/^\s*public\s+(?:partial\s+)?class\s+(?![A-Za-z0-9_]*Workflow\b)(?![^\n]*AbstractValidator<)[A-Za-z0-9_]+/],
  message: "concrete classes in Modules must be sealed (exceptions: Temporal workflows, open-generic validators)", docRef: netRef,
});
const be021 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-021", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const declaration = /^\s*(?:public|internal|private|protected)?\s*(?:sealed\s+|partial\s+)*class\s+[A-Za-z_]\w*(?:Command|Result|Request|Response|Dto|Data|Snapshot)\b/gm;
    for (const file of context.csharp.csharpFiles) {
      if (!hasSegment(file.path, "Modules") || inBuildOutput(file.path) || isCSharpTestCode(context, file)) continue;
      const masked = context.csharp.mask(file);
      const importsBrighter = /^\s*using\s+Paramore\.Brighter\s*;/m.test(masked);
      for (const match of masked.matchAll(declaration)) {
        const body = masked.indexOf("{", match.index + match[0].length);
        if (body < 0) continue;
        const header = masked.slice(match.index + match[0].length, body);
        const brighterBase = /:\s*(?:global::)?Paramore\.Brighter\.Command\b/.test(header)
          || (importsBrighter && /:\s*Command\b/.test(header));
        if (brighterBase) continue;
        emit(context, "MER-BE-021", "warn", file, lineAt(file, match.index),
          "message and data shapes (*Command/*Result/*Request/*Response/*Dto/*Data/*Snapshot) should be records", netRef);
      }
    }
  },
});

function parameterHasCancellationToken(parameters) {
  const values = [], stack = { angle: 0, paren: 0, square: 0, brace: 0 }; let value = "";
  for (const character of parameters) {
    if (character === "," && !Object.values(stack).some(Boolean)) { values.push(value); value = ""; continue; }
    value += character;
    if (character === "<") stack.angle++; else if (character === ">" && stack.angle) stack.angle--;
    else if (character === "(") stack.paren++; else if (character === ")" && stack.paren) stack.paren--;
    else if (character === "[") stack.square++; else if (character === "]" && stack.square) stack.square--;
    else if (character === "{") stack.brace++; else if (character === "}" && stack.brace) stack.brace--;
  }
  values.push(value);
  return values.some((parameter) => {
    let top = "", angle = 0, paren = 0, square = 0, brace = 0;
    for (const character of parameter) {
      if (character === "<") { angle++; top += " "; continue; }
      if (character === ">" && angle) { angle--; top += " "; continue; }
      if (character === "(") { paren++; top += " "; continue; }
      if (character === ")" && paren) { paren--; top += " "; continue; }
      if (character === "[") { square++; top += " "; continue; }
      if (character === "]" && square) { square--; top += " "; continue; }
      if (character === "{") { brace++; top += " "; continue; }
      if (character === "}" && brace) { brace--; top += " "; continue; }
      top += angle || paren || square || brace ? " " : character;
    }
    return /\b(?:(?:global::)?System\.Threading\.)?CancellationToken\s*\??\s+[_A-Za-z]\w*(?:\s*=.*)?\s*$/s.test(top);
  });
}

const be022 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-022", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (!hasSegment(file.path, "Modules") || !file.name.endsWith("UseCase.cs") || inBuildOutput(file.path) || isCSharpTestCode(context, file)) continue;
      const code = context.csharp.mask(file), classes = /\bclass\s+(\w*UseCase)\b[^\{]*\{/g;
      for (const declaration of code.matchAll(classes)) {
        const open = declaration.index + declaration[0].lastIndexOf("{"), close = matchingBrace(code, open);
        const end = close < 0 ? code.length : close + 1, body = code.slice(open + 1, end - 1);
        const methods = /\b(?:public|internal|private|protected)\s+(?:static\s+)?(?:async\s+)?[A-Za-z_][A-Za-z0-9_<>,.?\[\]\s]*\s+ExecuteAsync\s*\(/gs;
        let hasExecute = false;
        for (const method of body.matchAll(methods)) {
          hasExecute = true;
          const parameterOpen = method.index + method[0].lastIndexOf("("), parameterClose = matchingParenthesis(body, parameterOpen);
          const parameters = body.slice(parameterOpen + 1, parameterClose < 0 ? body.length : parameterClose);
          if (!parameterHasCancellationToken(parameters)) emit(context, "MER-BE-022", "error", file, lineAt(file, open + 1 + method.index), "ExecuteAsync must take a CancellationToken", netRef);
        }
        if (!hasExecute) emit(context, "MER-BE-022", "error", file, lineAt(file, declaration.index), "UseCase class must declare ExecuteAsync", netRef);
      }
    }
  },
});

function matchingParenthesis(text, open) {
  return matchingCSharpDelimiter(text, open, "(", ")");
}

const be023 = simpleCSharpRule("MER-BE-023", {
  severity: "warn", skipTests: true, select: (file) => hasSegment(file.path, "Modules") && !inBuildOutput(file.path),
  patterns: [/\bclass\s+[A-Za-z_][A-Za-z0-9_]*(?:Manager|Helper)\b/],
  message: "Manager/Helper class name is vague; name the concrete responsibility", docRef: "backend-pa-vsa.md#coding-style-rules",
});

const be024 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-024", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const layer of ["Domain", "Application"]) for (const file of context.csharp.csharpFiles) {
      if (context.csharp.classify(file).layer !== layer || inBuildOutput(file.path)) continue;
      if (isCSharpTestCode(context, file)) continue;
      regexLines(file, context.csharp.mask(file), [/\b(?:DateTime|DateTimeOffset)\.(?:Now|UtcNow|Today)\b|\bTimeProvider\.System\b/], (line) => {
        emit(context, "MER-BE-024", layer === "Domain" ? "error" : "warn", file, line,
          `ambient time in ${layer}; pass time explicitly or depend on an application time port`, "backend-pa-vsa.md#resilience-and-time");
      });
    }
  },
});

const be030 = simpleCSharpRule("MER-BE-030", {
  severity: "error", skipTests: true, active: (context) => context.files.some((file) => hasSegment(file.path, "Modules") && !hasSegment(file.path, "node_modules")),
  select: (file) => !hasSegment(file.path, "obj") && (file.name.endsWith("Controller.cs") || file.name.endsWith("Endpoints.cs")),
  patterns: [/\bI[A-Z][A-Za-z]*Repository\b/, /\bDbContext\b/],
  message: "transport must depend on use cases/queries, not repositories or DbContext", docRef: insideModuleRef,
});
const be031 = simpleCSharpRule("MER-BE-031", {
  severity: "error", skipTests: true, select: (file) => !hasSegment(file.path, "obj") && (file.name.endsWith("Controller.cs") || file.name.endsWith("Endpoints.cs")),
  patterns: [/using Microsoft\.EntityFrameworkCore/, /using Npgsql/],
  message: "persistence imports do not belong at the transport edge", docRef: insideModuleRef,
});

const be032 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-032", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (!file.name.endsWith("Controller.cs") || inBuildOutput(file.path)) continue;
      if (isCSharpTestCode(context, file)) continue;
      const masked = context.csharp.mask(file);
      for (const declaration of masked.matchAll(/\bclass\s+([A-Za-z_]\w*Controller)\b[^;{]*\{/g)) {
        const own = declaration[1], open = declaration.index + declaration[0].lastIndexOf("{"), close = matchingBrace(masked, open);
        if (close < 0) continue;
        const bodyStart = declaration.index, body = masked.slice(bodyStart, close + 1), reported = new Set();
        for (const match of body.matchAll(/\b([A-Za-z_]\w*Controller)\b/g)) {
          const dependency = match[1];
          if (dependency === "ApiController" || dependency === "Controller" || dependency === "ControllerBase" || dependency === own || reported.has(dependency)) continue;
          reported.add(dependency);
          emit(context, "MER-BE-032", "error", file, lineAt(file, bodyStart + match.index),
            `${own} depends on ${dependency} — share the underlying Application capability instead`, insideModuleRef);
        }
      }
    }
  },
});

const repositoryPortFile = (file) => /(?:^|\/)Modules\/[^/]+\/Application\/Ports\//.test(file.path);
const be040 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-040", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (!repositoryPortFile(file)) continue;
      const text = context.csharp.source(file), masked = context.csharp.mask(file), interfaces = /\binterface\s+I\w*Repository\b[^\{]*\{/g;
      for (const declaration of masked.matchAll(interfaces)) {
        const open = declaration.index + declaration[0].lastIndexOf("{"), close = matchingBrace(masked, open), body = masked.slice(open + 1, close < 0 ? masked.length : close);
        const signatures = /(?:^|[{};])\s*([\w<>,.?\[\]\s]+)\s+((?:Get|List|Find|Search|Read|Query)\w*)\s*\([^;{}]*\)\s*;/gms;
        for (const match of body.matchAll(signatures)) {
          const returnType = match[1].replace(/\s+/g, " ").trim();
          if (!/\b[A-Za-z_]\w*(?:Dto|Row|View|Projection)\b|\bPaged(?:Result|List|Response)?\s*</.test(returnType)) continue;
          const offset = open + 1 + match.index + match[0].indexOf(match[2]);
          report(context, "warn", file.path, lineAt(file, offset), `read-shaped repository return (${returnType}) merits review; prefer a focused query port when this is a projection`, "backend-pa-vsa.md#cqrs-lite");
        }
      }
    }
  },
});

const be041 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-041", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (!repositoryPortFile(file)) continue;
      const text = context.csharp.source(file);
      for (const declaration of text.matchAll(/\binterface\s+(I\w*Repository)\b[^{}]*\{/g)) {
        const open = declaration.index + declaration[0].lastIndexOf("{"), close = matchingBrace(text, open);
        if (close < 0) continue;
        const count = [...text.slice(open + 1, close).matchAll(/\b\w+\s*\([^;{}]*\)\s*;/gs)].length;
        if (count > 10) report(context, "info", file.path, lineAt(file, declaration.index), `${declaration[1]} has ${count} methods; split repository responsibilities above ten signatures`, "backend-pa-vsa.md#ports-and-adapters");
      }
    }
  },
});

function csharpStatementEnd(text, start) {
  const depth = { "(": 0, "[": 0, "{": 0 };
  const close = { ")": "(", "]": "[", "}": "{" };
  for (let index = start; index < text.length; index++) {
    const character = text[index];
    if (character in depth) depth[character]++;
    else if (character in close && depth[close[character]]) depth[close[character]]--;
    else if (character === ";" && !Object.values(depth).some(Boolean)) return index;
  }
  return -1;
}

const be042 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-042", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const methodPattern = /\b(?:public|internal|private|protected)\s+(?:static\s+)?(?:async\s+)?[A-Za-z_][A-Za-z0-9_<>,.?\[\]\s]*?\s+((?:Get|List|Find|Search|Read|Query|Exists|Count)[A-Za-z0-9_]*)\s*\(/gs;
    const disclosedMutation = /(?:Or|And)(?:Create|Add|Update|Delete|Remove|Save|Write|Mark)/;
    const mutation = /\.(?:ExecuteUpdate(?:Async)?|ExecuteDelete(?:Async)?|SaveChanges(?:Async)?)\s*\(|\b(?:db|context|_db|_context)\.(?:Add(?:Async|Range|RangeAsync)?|Update(?:Range)?|Remove(?:Range)?)\s*\(|\bEntityState\.(?:Added|Modified|Deleted)\b/;
    for (const file of context.csharp.csharpFiles) {
      if (!file.name.endsWith("Repository.cs") || inBuildOutput(file.path)) continue;
      if (isCSharpTestCode(context, file)) continue;
      const masked = context.csharp.mask(file);
      for (const method of masked.matchAll(methodPattern)) {
        if (disclosedMutation.test(method[1])) continue;
        const parameterOpen = method.index + method[0].lastIndexOf("("), parameterClose = matchingParenthesis(masked, parameterOpen);
        if (parameterClose < 0) continue;
        const terminator = /=>|\{|;/.exec(masked.slice(parameterClose + 1));
        if (!terminator || terminator[0] === ";") continue;
        const terminatorOffset = parameterClose + 1 + terminator.index;
        let bodyStart, bodyEnd;
        if (terminator[0] === "=>") {
          bodyStart = terminatorOffset + 2;
          bodyEnd = csharpStatementEnd(masked, bodyStart);
        } else {
          bodyStart = terminatorOffset + 1;
          bodyEnd = matchingBrace(masked, terminatorOffset);
        }
        if (bodyEnd < 0) continue;
        const hit = mutation.exec(masked.slice(bodyStart, bodyEnd));
        if (!hit) continue;
        emit(context, "MER-BE-042", "warn", file, lineAt(file, bodyStart + hit.index),
          `${method[1]} performs a persistence mutation — read-shaped repository methods must be persistence-pure`, "backend-pa-vsa.md#cqrs-lite");
      }
    }
  },
});

const be051 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-051", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const nestedName = /^(?:Command|Result|Query|Response)$|(?:Command|Result)$/;
    for (const file of context.csharp.csharpFiles) {
      if ((!hasSegment(file.path, "Modules") && !hasSegment(file.path, "Application")) || isCSharpTestCode(context, file)) continue;
      for (const type of csharpDeclarations(context.csharp.mask(file)).types) {
        if (type.kind === "record" && type.parent >= 0 && nestedName.test(type.name)) report(context, "warn", file.path, lineAt(file, type.offset),
          `Command/Result records are siblings of the use case, not nested inside it — lift ${type.name} to a top-level record`, "backend-pa-vsa.md#commands-and-results");
      }
    }
  },
});

const be052 = simpleCSharpRule("MER-BE-052", {
  severity: "warn", skipTests: true, select: (file) => !inBuildOutput(file.path), patterns: [/\b(?:record|class|struct)\s+\w*ErrorDto\b/],
  message: "use the canonical ErrorResponse(Code, Message, Errors) envelope — no *ErrorDto variants", docRef: "backend-pa-vsa.md#error-envelope",
});
const be053 = simpleCSharpRule("MER-BE-053", {
  severity: "warn", skipTests: true, select: (file) => hasSegment(file.path, "Modules") && file.name.endsWith("UseCase.cs") && !inBuildOutput(file.path),
  patterns: [/public\s+(?:async\s+)?(?:Task<\s*)?[A-Za-z0-9_]*(?:Response|Dto)>?\s+(?:Execute|ExecuteAsync)\s*\(/],
  message: "use case returns a transport-shaped type (*Response/*Dto); return a domain type or *Result and map at the edge, or drop the use case if it only maps", docRef: "backend-pa-vsa.md#commands-and-results",
});

const be054 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-054", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    // A test's own ErrorResponse, declared to read a response body, is not a second envelope.
    const files = context.csharp.csharpFiles.filter((file) => !inBuildOutput(file.path) && !isCSharpTestCode(context, file));
    const api = files.some((file) => /\[RivetContract\b|\b(?:MapControllers|AddControllers)\s*\(|\.Map(?:Get|Post|Put|Delete|Patch)\s*\(/.test(context.csharp.source(file)));
    if (!api) return;
    const matches = [];
    const declaration = /\b(?:record\s+(?:class\s+|struct\s+)?|class\s+|struct\s+)ErrorResponse\b/;
    for (const file of files) regexLines(file, context.csharp.source(file), [declaration], (line) => matches.push({ file, line }));
    if (!matches.length) return;
    if (matches.length > 1) for (const match of matches) report(context, "warn", match.file.path, match.line, "ErrorResponse must have one canonical declaration; duplicate found", "backend-pa-vsa.md#error-envelope");
    const canonical = /\bsealed\s+record(?:\s+class)?\s+ErrorResponse\s*\(\s*string\s+Code\s*,\s*string\s+Message\s*,\s*IReadOnlyDictionary\s*<\s*string\s*,\s*string\s*\[\s*\]\s*>\s*\?\s*Errors\s*=\s*null\s*\)\s*;/s;
    for (const file of new Set(matches.map((match) => match.file))) if (!canonical.test(context.csharp.source(file))) report(context, "warn", file.path, 0,
      "ErrorResponse must be sealed record ErrorResponse(string Code, string Message, IReadOnlyDictionary<string, string[]>? Errors = null)", "backend-pa-vsa.md#error-envelope");
  },
});

const be055 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-055", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const validators = new Set([
      "NotNull", "Null", "NotEmpty", "Empty", "Equal", "NotEqual", "Length", "ExactLength",
      "MinimumLength", "MaximumLength", "LessThan", "LessThanOrEqualTo", "GreaterThan", "GreaterThanOrEqualTo",
      "InclusiveBetween", "ExclusiveBetween", "CreditCard", "EmailAddress", "IsInEnum", "IsEnumName",
      "Matches", "Must", "MustAsync", "PrecisionScale", "ScalePrecision",
    ]);
    const inspectChain = (context, file, statement, chainStart, sourceOffset) => {
      const calls = [];
      let paren = 0, square = 0, brace = 0;
      for (let index = chainStart; index < statement.length; index++) {
        const character = statement[index];
        if (character === "(") paren++;
        else if (character === ")" && paren) paren--;
        else if (character === "[") square++;
        else if (character === "]" && square) square--;
        else if (character === "{") brace++;
        else if (character === "}" && brace) brace--;
        else if (character === "." && !paren && !square && !brace) {
          const name = /^[A-Za-z_]\w*/.exec(statement.slice(index + 1))?.[0];
          if (name) calls.push({ name, index });
        }
      }
      const failures = calls.filter((call) => validators.has(call.name));
      for (let index = 0; index < failures.length; index++) {
        const current = failures[index], next = failures[index + 1]?.index ?? statement.length;
        if (calls.some((call) => call.name === "WithErrorCode" && call.index > current.index && call.index < next)) continue;
        emit(context, "MER-BE-055", "error", file, lineAt(file, sourceOffset + current.index),
          `${current.name} has no WithErrorCode before the next validator`, "backend-pa-vsa.md#validation-error-codes");
      }
    };
    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path)) continue;
      if (isCSharpTestCode(context, file)) continue;
      const masked = context.csharp.mask(file);
      for (const rule of masked.matchAll(/\b(?:[A-Za-z_]\w*\.)?RuleFor(?:Each)?\s*\(/g)) {
        const end = csharpStatementEnd(masked, rule.index);
        if (end < 0) continue;
        const statement = masked.slice(rule.index, end + 1);
        const open = statement.indexOf("("), ruleClose = matchingParenthesis(statement, open);
        if (ruleClose < 0) continue;
        inspectChain(context, file, statement, ruleClose + 1, rule.index);
      }

      const builders = new Set([...masked.matchAll(/\bIRuleBuilder(?:Options)?\s*<[^;(){}]+>\s+([A-Za-z_]\w*)/g)].map((match) => match[1]));
      if (!builders.size) continue;
      const root = new RegExp(`(?:=>|\\breturn)\\s+(${[...builders].join("|")})\\s*\\.`, "g");
      for (const chain of masked.matchAll(root)) {
        const end = csharpStatementEnd(masked, chain.index);
        if (end < 0) continue;
        const statement = masked.slice(chain.index, end + 1), chainStart = statement.indexOf(".");
        inspectChain(context, file, statement, chainStart, chain.index);
      }
    }
  },
});

const be060 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-060", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const configs = [];
    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path) || isCSharpTestCode(context, file)) continue;
      for (const match of context.csharp.source(file).matchAll(/class\s+\w+\s*:[^{]*IEntityTypeConfiguration<(\w+)>/g)) configs.push({ file, entity: match[1], line: lineAt(file, match.index) });
    }
    // Production Domain files with their owning module.
    const domainFiles = [];
    if (configs.length) for (const file of context.csharp.csharpFiles) {
      if (hasSegment(file.path, "obj")) continue;
      const candidate = parts(file.path), candidateModules = candidate.lastIndexOf("Modules");
      if (candidateModules < 0 || candidate[candidateModules + 2] !== "Domain" || isCSharpTestCode(context, file)) continue;
      domainFiles.push({ file, module: candidate[candidateModules + 1] });
    }
    for (const config of configs) {
      const segments = parts(config.file.path), moduleIndex = segments.lastIndexOf("Modules");
      if (moduleIndex < 0) {
        report(context, "warn", config.file.path, config.line, `entity config for ${config.entity} lives outside Modules/ — entity mapping belongs in the owning module's Infrastructure`, "backend-pa-vsa.md#persistence");
        continue;
      }
      const owner = segments[moduleIndex + 1], declaration = new RegExp(`\\b(?:class|record)\\s+${config.entity}\\b`);
      const entityOwner = domainFiles.find(({ file }) => declaration.test(context.csharp.source(file)))?.module ?? null;
      if (entityOwner && entityOwner !== owner) report(context, "warn", config.file.path, config.line,
        `entity config for ${config.entity} lives in module ${owner} but the entity belongs to ${entityOwner} — the owning module maps its own entities`, "backend-pa-vsa.md#persistence");
    }
  },
});

export const beCSharpRules = Object.freeze([
  be001, be003, be006, be007, be008, be009, be010, be011, be012, be013, be014, be015, be016, be017,
  be020, be021, be022, be023, be024, be030, be031, be032, be040, be041, be042, be051, be052, be053, be054, be055, be060,
]);
