import { createRequire } from "node:module";
import { Capability, createConfigParser, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { moduleLayout, moduleOfPath } from "./be-csharp.mjs";
import { tableOwnership } from "./be-table-ownership.mjs";
import { inBuildOutput, under } from "./helpers.mjs";

const require = createRequire(import.meta.url);
const source = "in-process/be-module-order.mjs";
// MER-BE-062 (a loop) cites the one-way rule; MER-BE-061 (a reference against the claims), MER-BE-063 (a wrong
// claims file), and MER-BE-065 (a reference no claim covers) cite the claims rule.
const oneWayRef = "rules/backend/run-module-dependencies-one-way.md";
const claimsRef = "rules/backend/write-each-module-dependency-down-as-a-claim.md";
const CLAIMS = ".plumb-modules.json";
const DB_CONTEXT = "Microsoft.EntityFrameworkCore.DbContext";

// graphlib and yaml load when the rule first runs, not inside the config parser: the engine reads a parser's throw as
// an unparseable config, which would hide a missing package.
let packages;
const loaded = () => (packages ??= { graphlib: require("@dagrejs/graphlib"), yaml: require("yaml") });

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const sorted = (values) => [...values].sort();

// The shortest path from `from` to `to` over sorted successors (breadth first, so the same on every run), or null.
// With `from` equal to `to` it is the shortest loop through that node.
function shortestPath(successors, from, to) {
  const previous = new Map([[from, null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    for (const next of successors(node)) {
      if (next === to) {
        const path = [to];
        for (let at = node; at !== null; at = previous.get(at)) path.unshift(at);
        return path;
      }
      if (!previous.has(next)) { previous.set(next, node); queue.push(next); }
    }
  }
  return null;
}

// The key positions of the claims file, as plain data: each key's path, its offset in the file's own text, and whether
// it repeats an earlier key of its map. yaml reads JSON, reports duplicate keys, and keeps ranges; JSON.parse keeps
// only the last of two equal keys and gives no positions.
const claimsParser = createConfigParser("plumb-modules-keys", (text) => {
  const { parseDocument, isMap, isScalar } = loaded().yaml;
  const document = parseDocument(text);
  const repeats = new Set(document.errors.filter((error) => error.code === "DUPLICATE_KEY").map((error) => error.pos[0]));
  const keys = [];
  const walk = (node, path) => {
    if (!isMap(node) || path.length >= 3) return;
    for (const pair of node.items) {
      if (!isScalar(pair.key)) continue;
      const here = [...path, String(pair.key.value)];
      keys.push({ path: here, offset: pair.key.range[0], repeated: repeats.has(pair.key.range[0]) });
      walk(pair.value, here);
    }
  };
  walk(document.contents, []);
  return keys;
});

// The claims, module to the modules it depends on with each reason, and the problems with the file (MER-BE-063), each
// `{ line, message }`. Every problem says what happens to the claim. `stated` is true when the file has a "modules"
// map to read: only then is a reference with no claim a finding (MER-BE-065).
function readClaims(context, layout) {
  const claims = new Map();
  const problems = [];
  const file = context.file(CLAIMS);
  if (!file) return { claims, problems, stated: false };
  const parsed = file.config(claimsParser);
  const keys = parsed.ok ? parsed.value : [];
  const same = (left, right) => left.length === right.length && left.every((segment, index) => segment === right[index]);
  const lineOf = (offset) => (offset === undefined ? 1 : file.lineMap().lineAt(offset));
  const keyLine = (path) => lineOf(keys.find((key) => same(key.path, path))?.offset);
  const repeatLine = (path) => {
    const key = keys.find((candidate) => candidate.repeated && same(candidate.path, path));
    return key ? lineOf(key.offset) : null;
  };
  const problem = (line, what, fix) => problems.push({ line, message: `${CLAIMS} ${what} — ${fix}` });
  const unusable = (line, what, fix) => { problem(line, what, fix); return { claims, problems, stated: false }; };

  let data;
  try { data = JSON.parse(file.text().slice(file.text().charCodeAt(0) === 0xFEFF ? 1 : 0)); }
  catch (error) { return unusable(1, `isn't valid JSON (${error.message})`, "fix the syntax; no claims apply until then"); }
  if (!isObject(data)) return unusable(1, "must be a JSON object with a \"modules\" map", "no claims apply until it is");
  if (repeatLine(["modules"]) !== null) return unusable(repeatLine(["modules"]), "has the key \"modules\" twice", "keep one; no claims apply until then");
  const unknown = Object.keys(data).find((key) => key !== "modules");
  if (unknown !== undefined) return unusable(keyLine([unknown]), `has the unknown top-level key "${unknown}"`, "only \"modules\" is read: remove it; no claims apply until then");
  if (!isObject(data.modules)) return unusable(keyLine(["modules"]), "needs a \"modules\" object mapping each module to the modules it depends on", "add it; no claims apply until then");

  const known = new Set([...layout.modulesByRoot.values()].flatMap((modules) => [...modules]));
  const missing = (name) => `names module ${name}, which has no Modules/${name} folder`;
  for (const [name, entry] of Object.entries(data.modules)) {
    const twice = repeatLine(["modules", name]);
    if (twice !== null) { problem(twice, `lists module ${name} twice`, "keep one entry; the claims of both are ignored"); continue; }
    if (!isObject(entry)) { problem(keyLine(["modules", name]), `has ${entry === null ? "null" : Array.isArray(entry) ? "array" : typeof entry} for ${name}, not an object of claims`, "give \"Module\": \"reason\" claims; this entry is skipped"); continue; }
    if (!known.has(name)) { problem(keyLine(["modules", name]), missing(name), "remove it or fix the name; its claims are dropped"); continue; }
    for (const [dependency, reason] of Object.entries(entry)) {
      const path = ["modules", name, dependency];
      const repeated = repeatLine(path);
      if (repeated !== null) { problem(repeated, `claims ${name} → ${dependency} twice`, "keep one; both are ignored"); continue; }
      if (dependency === name) { problem(keyLine(path), `claims ${name} depends on itself`, "remove the claim"); continue; }
      if (!known.has(dependency)) { problem(keyLine(path), missing(dependency), "remove it or fix the name; the claim is dropped"); continue; }
      if (typeof reason !== "string" || !reason.trim()) { problem(keyLine(path), `claims ${name} → ${dependency} with no reason`, "give the domain fact that makes the first need the second; the claim is dropped"); continue; }
      if (!claims.has(name)) claims.set(name, new Map());
      claims.get(name).set(dependency, reason);
    }
  }

  // Claims that loop contradict each other, and the file doesn't say which is false: drop them all.
  const { Graph, alg } = loaded().graphlib;
  const graph = new Graph();
  for (const [name, dependencies] of claims) for (const dependency of dependencies.keys()) graph.setEdge(name, dependency);
  for (const set of alg.tarjan(graph).filter((component) => component.length > 1)) {
    const members = new Set(set);
    const first = sorted(members)[0];
    const successors = (node) => sorted((claims.get(node) ?? new Map()).keys()).filter((next) => members.has(next));
    problem(keyLine(["modules", first]), `claims a loop (${shortestPath(successors, first, first).join(" → ")})`, "remove the claim that's false; every claim among these modules is ignored");
    for (const name of members) for (const dependency of [...(claims.get(name)?.keys() ?? [])]) if (members.has(dependency)) claims.get(name).delete(dependency);
  }
  return { claims, problems, stated: true };
}

// The dependency edges of one backend root: "A\0B" to `{ from, to, files }`, where `files` maps a path to the file's
// first reference to B, `{ file, line, kind, route }`. A kind is `direct` (a using, or a name of a type of B, however
// written), `table` (a mapping of B's table), or `derived` (a route through code outside the modules).
function buildEdges(context, layout, backend, tables) {
  const facts = context.csharpFacts;
  const edges = new Map();
  const add = (from, to, file, line, kind, route = null) => {
    const key = `${from}\0${to}`;
    if (!edges.has(key)) edges.set(key, { from, to, files: new Map() });
    const { files } = edges.get(key);
    const known = files.get(file.path);
    // A direct reference outranks a derived one in the same file; otherwise the earlier line wins.
    const better = !known || (known.kind === "derived") > (kind === "derived") || ((known.kind === "derived") === (kind === "derived") && line < known.line);
    if (better) files.set(file.path, { file, line, kind, route });
  };

  const own = [];
  for (const file of context.csharp.csharpFiles) {
    if (layout.isTest(file) || inBuildOutput(file.path) || !facts.hasFacts(file)) continue;
    // The module nodes come from moduleOfPath, so a file's module is decided by it too (a file directly under
    // `Modules/` is no module's code, and routes like host code).
    const placed = moduleOfPath(file.path);
    if (placed?.root === backend) own.push({ file, module: placed.module });
  }
  for (const { file, module } of own) {
    for (const using of facts.usings(file)) {
      for (const hit of layout.usingTargets(using, backend)) {
        if (hit.targetBackend === backend && hit.target !== module) add(module, hit.target, file, using.line, "direct");
      }
    }
    for (const reference of facts.references(file)) {
      const placed = layout.moduleOfType(reference);
      if (placed?.root === backend && placed.module !== module) add(module, placed.module, file, reference.line, "direct");
    }
  }
  for (const entry of tables.find((table) => table.backend === backend)?.wrong ?? []) add(entry.module, entry.owner, entry.file, entry.line, "table");

  addDerived(context, layout, backend, own, add);
  return edges;
}

// Code outside the modules is a route between them, type by type. A route type is declared only in the
// root's host, transport-contract, or Common files. A persistence root (a `DbContext`, and the in-source interfaces it
// implements) is no route as a type, but each of its members is, as a node of its own.
function addDerived(context, layout, backend, own, add) {
  const facts = context.csharpFacts;
  const { Graph, alg } = loaded().graphlib;
  const routeFile = (file) => under(file.path, backend) && !layout.isTest(file) && !inBuildOutput(file.path) && !moduleOfPath(file.path);
  const routeTypes = new Set();
  const roots = new Set();
  const rootInterfaces = new Set();
  for (const entry of facts.types.values()) {
    const parts = entry.parts.filter((part) => !layout.isTest(part.file));
    if (parts.length && parts.every((part) => routeFile(part.file))) routeTypes.add(entry.name);
    if (entry.baseTypes.includes(DB_CONTEXT)) {
      roots.add(entry.name);
      for (const base of entry.baseTypes) if (facts.types.get(base)?.kind === "interface") rootInterfaces.add(base);
    }
  }
  if (!routeTypes.size && !roots.size) return;

  // The node a use of a route type, or of a member of a root or a root's interface, stands for; null for neither.
  const nodeFor = (reference) => {
    if (roots.has(reference.to) || rootInterfaces.has(reference.to)) return reference.member === null ? null : `member:${reference.to}.${reference.member}`;
    return routeTypes.has(reference.to) ? `type:${reference.to}` : null;
  };

  const steps = new Map();
  const where = new Map();
  const step = (from, to, path) => {
    if (!steps.has(from)) steps.set(from, new Set());
    steps.get(from).add(to);
    const key = `${from}\0${to}`;
    if (!where.has(key) || path < where.get(key)) where.set(key, path);
  };
  for (const file of context.csharp.csharpFiles) {
    if (!routeFile(file) || !facts.hasFacts(file)) continue;
    for (const reference of facts.references(file)) {
      let from = null;
      if (roots.has(reference.from)) from = reference.fromMember === null ? null : `member:${reference.from}.${reference.fromMember}`;
      else if (routeTypes.has(reference.from)) from = `type:${reference.from}`;
      if (!from) continue;
      const placed = layout.moduleOfType(reference);
      const to = placed ? (placed.root === backend ? `module:${placed.module}` : null) : nodeFor(reference);
      if (to) step(from, to, file.path);
    }
  }

  // What each module file starts from: its first use of a route type or root member, per node.
  const starts = own.map(({ file, module }) => {
    const first = new Map();
    for (const reference of facts.references(file)) {
      if (layout.moduleOfType(reference)) continue;
      const node = nodeFor(reference);
      if (node && (!first.has(node) || reference.line < first.get(node))) first.set(node, reference.line);
    }
    return { file, module, first };
  });
  // A member of a root's interface is the root's member of that name.
  const interfaceMembers = new Set();
  for (const { first } of starts) for (const node of first.keys()) interfaceMembers.add(node);
  for (const [from, successors] of steps) for (const node of [from, ...successors]) interfaceMembers.add(node);
  for (const node of interfaceMembers) {
    const match = node.match(/^member:(.+)\.([^.]+)$/);
    if (!match || !rootInterfaces.has(match[1])) continue;
    for (const root of sorted(roots)) if (facts.types.get(root).baseTypes.includes(match[1])) step(node, `member:${root}.${match[2]}`, "");
  }

  const graph = new Graph();
  for (const [from, successors] of steps) for (const to of successors) graph.setEdge(from, to);
  const reached = new Map();
  const reaches = (start) => {
    if (!reached.has(start)) reached.set(start, graph.hasNode(start) ? alg.preorder(graph, [start]).filter((node) => node.startsWith("module:")).map((node) => node.slice(7)) : []);
    return reached.get(start);
  };
  const successorsOf = (node) => sorted(steps.get(node) ?? []);
  const describe = (node) => facts.displayName(node.slice(node.indexOf(":") + 1));
  const classOf = (node) => {
    if (node.startsWith("member:")) return "member";
    const path = facts.types.get(node.slice(5)).parts.find((part) => !layout.isTest(part.file)).file.path;
    const relative = backend ? path.slice(backend.length + 1) : path;
    return relative.startsWith("Common/") ? "common" : relative.startsWith("Contracts/") ? "transport" : "host";
  };

  for (const { file, module, first } of starts) {
    const reachedModules = new Map();
    for (const [node, line] of first) {
      for (const target of reaches(node)) {
        if (target !== module && (!reachedModules.has(target) || line < reachedModules.get(target).line)) reachedModules.set(target, { line, node });
      }
    }
    for (const [target, { line, node }] of reachedModules) {
      const path = shortestPath(successorsOf, node, `module:${target}`);
      // An interface member's hop to the root's member of the same name holds no file; it is not shown.
      const hops = path.slice(0, -1).flatMap((hop, index) => {
        const holder = where.get(`${hop}\0${path[index + 1]}`);
        return holder ? [`${describe(hop)} (${holder})`] : [];
      });
      add(module, target, file, line, "derived", { text: hops.join(" → "), first: describe(node), kind: classOf(node) });
    }
  }
}

const loopText = (path) => path.join(" → ");

// The fix a derived edge gets, by what its first route type is.
function derivedFix(route, from, to) {
  if (route.kind === "member") return `stop calling ${route.first} from module ${from}: it reads ${to}'s data, so move that query into ${to} and reach it through a consumer-owned required port`;
  if (route.kind === "common") return `move what reaches ${to} out of shared type ${route.first}: Common names no module, directly or through host code`;
  if (route.kind === "transport") return `stop using ${route.first} from module ${from}: move what ${from} uses from it into ${from}'s own transport mapping, or into Common if it's genuinely shared`;
  return `stop using ${route.first} from module ${from}: register it at the host, or move what ${route.first} needs from ${to} behind a consumer-owned port`;
}

const portFix = "replace this reference with a consumer-owned required port bridged at the host";

const moduleOrder = defineRepositoryRule({
  descriptor: createRuleDescriptor({ ids: ["MER-BE-061", "MER-BE-062", "MER-BE-063", "MER-BE-065"], source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const layout = moduleLayout(context);
    if (!layout.roots.length) return;
    const { Graph, alg } = loaded().graphlib;
    const report = (id, path, line, message) => context.report({ id, severity: "error", path, line, message, docRef: id === "MER-BE-062" ? oneWayRef : claimsRef });

    const { claims, problems, stated } = readClaims(context, layout);
    for (const { line, message } of problems) report("MER-BE-063", CLAIMS, line, message);

    const tables = tableOwnership(context);
    for (const backend of layout.roots) {
      const modules = sorted(layout.modulesByRoot.get(backend));
      if (modules.length < 2) continue;
      const edges = buildEdges(context, layout, backend, tables);
      if (!edges.size) continue;

      const claimed = new Graph();
      for (const module of modules) claimed.setNode(module);
      for (const [name, dependencies] of claims) {
        for (const dependency of dependencies.keys()) if (modules.includes(name) && modules.includes(dependency)) claimed.setEdge(name, dependency);
      }
      const dependsOn = (from, to) => alg.preorder(claimed, [from]).includes(to);

      const all = new Graph();
      for (const module of modules) all.setNode(module);
      const verdicts = new Map();
      for (const [key, edge] of edges) {
        all.setEdge(edge.from, edge.to);
        // B claims, through other claims, to depend on A: the reference runs against the claims.
        verdicts.set(key, dependsOn(edge.to, edge.from) ? "against" : dependsOn(edge.from, edge.to) ? "declared" : "undecided");
      }
      const remaining = new Graph();
      for (const module of modules) remaining.setNode(module);
      for (const [key, edge] of edges) if (verdicts.get(key) !== "against") remaining.setEdge(edge.from, edge.to);
      const looped = new Map();
      for (const component of alg.tarjan(remaining).filter((set) => set.length > 1)) for (const module of component) looped.set(module, component);

      const succ = (graph) => (node) => sorted(graph.successors(node) ?? []);
      for (const [key, edge] of [...edges].sort(([left], [right]) => left.localeCompare(right))) {
        const verdict = verdicts.get(key);
        let id;
        let graph = remaining;
        if (verdict === "against") { id = "MER-BE-061"; graph = all; }
        else if (verdict === "undecided" && looped.get(edge.from)?.includes(edge.to)) id = "MER-BE-062";
        // Outside any loop, a reference no claim covers is a finding only in a repository that states its claims.
        else if (verdict === "undecided" && stated) id = "MER-BE-065";
        else continue;
        const back = shortestPath(succ(graph), edge.to, edge.from);
        const loop = back ? loopText([edge.from, ...back]) : null;
        for (const { file, line, kind, route } of [...edge.files.values()].sort((left, right) => left.file.path.localeCompare(right.file.path))) {
          const through = kind === "derived" ? ` through ${route.text}` : "";
          const fix = kind === "derived" ? derivedFix(route, edge.from, edge.to)
            : kind === "table" ? `read ${edge.to}'s table through a consumer-owned required port bridged at the host, or ${edge.to}'s published contract`
            : null;
          let message;
          if (id === "MER-BE-061") {
            message = `module ${edge.from} must not depend on ${edge.to}${through}: ${CLAIMS} claims ${edge.to} depends on ${edge.from}, directly or through other claims${loop ? ` (loop ${loop})` : ""} — ${fix ?? "define a consumer-owned required port in " + edge.from + " and bridge it at the host, or move a genuinely shared type to Common"}`;
          } else if (id === "MER-BE-065") {
            message = `module ${edge.from} depends on ${edge.to}${through} and ${CLAIMS} has no claim that covers it — if ${edge.from} can't keep its rules without ${edge.to}, add that claim with its reason; if not, ${fix ?? portFix}`;
          } else {
            message = `modules ${edge.from} and ${edge.to} are in a loop (${loop})${through ? ` through ${route.text}, and` : " and"} ${CLAIMS} doesn't say whether ${edge.from} depends on ${edge.to} — if ${edge.from} can't keep its rules without ${edge.to}, add that claim with its reason; if not, ${fix ?? portFix}`;
          }
          report(id, file.path, line, message);
        }
      }
    }
  },
});

export const beModuleOrderRules = Object.freeze([moduleOrder]);
