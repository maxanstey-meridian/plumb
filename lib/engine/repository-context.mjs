import path from "node:path";
import { Capability } from "./contracts.mjs";
import { createFrontendAnalysis } from "./frontend-analysis.mjs";
import { createTypeScriptAnalysis } from "./typescript-analysis.mjs";
import { createDotnetAnalysis } from "./dotnet-analysis.mjs";

const SEVERITIES = new Set(["error", "warn", "info"]);

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  if (value instanceof Map || value instanceof Set || ArrayBuffer.isView(value)) {
    throw new TypeError(`unsupported mutable parsed value: ${value.constructor.name}`);
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function resultOf(operation) {
  try { return Object.freeze({ ok: true, value: deepFreeze(operation()) }); }
  catch (error) { return Object.freeze({ ok: false, error: deepFreeze(error) }); }
}

function readonlySet(values) {
  const set = new Set(values);
  let view;
  view = Object.freeze({
    get size() { return set.size; },
    has(value) { return set.has(value); },
    values() { return set.values(); },
    keys() { return set.keys(); },
    entries() { return set.entries(); },
    forEach(callback, thisArg) { set.forEach((value) => callback.call(thisArg, value, value, view)); },
    [Symbol.iterator]() { return set[Symbol.iterator](); },
  });
  return view;
}

function createLineMap(text) {
  const starts = [0];
  for (let offset = 0; offset < text.length; offset++) if (text.charCodeAt(offset) === 10) starts.push(offset + 1);
  const lines = Object.freeze(text.split("\n"));
  return Object.freeze({
    starts: Object.freeze(starts),
    lines,
    lineAt(offset) {
      if (!Number.isInteger(offset) || offset < 0 || offset > text.length) throw new Error(`invalid text offset: ${offset}`);
      let low = 0, high = starts.length;
      while (low + 1 < high) {
        const middle = Math.floor((low + high) / 2);
        if (starts[middle] <= offset) low = middle;
        else high = middle;
      }
      return low + 1;
    },
  });
}

function validateFinding(descriptor, finding) {
  const id = finding.id ?? (descriptor.ids.length === 1 ? descriptor.ids[0] : null);
  if (!descriptor.ids.includes(id)) throw new Error(`${descriptor.source} reported undeclared rule ID ${id}`);
  if (!SEVERITIES.has(finding.severity)) throw new Error(`${id} reported invalid severity ${finding.severity}`);
  const locationPath = finding.path?.split("\\").join("/");
  if (!locationPath || path.posix.isAbsolute(locationPath) || locationPath === ".." || locationPath.startsWith("../") || locationPath.includes("/../")) {
    throw new Error(`${id} reported invalid location ${finding.path}`);
  }
  if (!Number.isInteger(finding.line) || finding.line < 0) throw new Error(`${id} reported invalid line ${finding.line}`);
  if (typeof finding.message !== "string" || !finding.message || /[\t\r\n]/.test(finding.message) ||
      typeof finding.docRef !== "string" || !finding.docRef || /[\t\r\n]/.test(finding.docRef)) {
    throw new Error(`${id} reported an invalid message or docRef`);
  }
  return Object.freeze({ id, sev: finding.severity, loc: `${locationPath}:${finding.line}`, msg: finding.message, ref: finding.docRef });
}

export function createRepositoryContext(snapshot, plannedCapabilities, {
  rivet,
  packs,
  staticInputs = {},
  typescriptLoader,
  dependencyCruiserLoader,
} = {}) {
  const planned = new Set(plannedCapabilities);
  const fileContexts = new Map();
  const lineMapCache = new Map();
  const configCache = new Map();
  const staticConfigCache = new Map();
  const findings = [];
  const diagnostics = [];
  const diagnosticSet = new Set();
  let typescriptAnalysis;
  let frontendAnalysis;
  let dotnetAnalysis;

  const requireCapability = (capability) => {
    if (!planned.has(capability)) throw new Error(`capability was not planned: ${capability}`);
  };
  for (const capability of planned) snapshot.counters.capabilityInitializations[capability]++;

  const diagnostic = (message) => {
    if (diagnosticSet.has(message)) return;
    diagnosticSet.add(message);
    diagnostics.push(message);
  };

  const contextFor = (file) => {
    if (fileContexts.has(file.path)) return fileContexts.get(file.path);
    const context = Object.freeze({
      path: file.path,
      name: file.name,
      directory: file.directory,
      text() {
        requireCapability(Capability.TEXT);
        return snapshot.text(file);
      },
      lineMap() {
        requireCapability(Capability.LINE_MAP);
        if (!lineMapCache.has(file.path)) {
          snapshot.counters.lineMaps++;
          lineMapCache.set(file.path, resultOf(() => createLineMap(snapshot.text(file))));
        }
        const result = lineMapCache.get(file.path);
        if (!result.ok) throw result.error;
        return result.value;
      },
      json() {
        requireCapability(Capability.JSON);
        return snapshot.json(file);
      },
      config(parser) {
        requireCapability(Capability.BASIC_CONFIG);
        let byParser = configCache.get(file.path);
        if (!byParser) { byParser = new Map(); configCache.set(file.path, byParser); }
        if (!byParser.has(parser.name)) {
          snapshot.counters.configParses++;
          byParser.set(parser.name, resultOf(() => parser.parse(snapshot.text(file))));
        }
        return byParser.get(parser.name);
      },
    });
    fileContexts.set(file.path, context);
    return context;
  };

  const base = Object.freeze({
    root: snapshot.root,
    files: Object.freeze(snapshot.files.map(contextFor)),
    packs: readonlySet(packs ?? []),
    rivet: deepFreeze(rivet),
    file(relativePath) {
      const file = snapshot.file(relativePath);
      return file ? contextFor(file) : undefined;
    },
    staticText(name) {
      const load = staticInputs[name];
      if (!load) throw new Error(`unknown static input: ${name}`);
      return load();
    },
    staticConfig(name, parser) {
      requireCapability(Capability.BASIC_CONFIG);
      const key = `${name}\0${parser.name}`;
      if (!staticConfigCache.has(key)) {
        snapshot.counters.configParses++;
        staticConfigCache.set(key, resultOf(() => parser.parse(base.staticText(name))));
      }
      return staticConfigCache.get(key);
    },
    get typescript() {
      requireCapability(Capability.TYPESCRIPT);
      if (!typescriptAnalysis) typescriptAnalysis = createTypeScriptAnalysis({
        root: snapshot.root,
        files: base.files,
        counters: snapshot.counters,
        diagnostic,
        loader: typescriptLoader,
      });
      return typescriptAnalysis;
    },
    get frontendRoots() {
      requireCapability(Capability.FRONTEND_ROOTS);
      return getFrontendAnalysis();
    },
    get frontendGraph() {
      requireCapability(Capability.FRONTEND_GRAPH);
      return getFrontendAnalysis();
    },
    get csharp() {
      requireCapability(Capability.CSHARP);
      return getDotnetAnalysis();
    },
    get dotnetProjects() {
      requireCapability(Capability.DOTNET_PROJECTS);
      return getDotnetAnalysis();
    },
  });

  function getFrontendAnalysis() {
    if (!frontendAnalysis) frontendAnalysis = createFrontendAnalysis({
      root: snapshot.root,
      files: base.files,
      fileByPath: (relativePath) => base.file(relativePath),
      typescript: () => base.typescript,
      counters: snapshot.counters,
      diagnostic,
      loader: dependencyCruiserLoader,
    });
    return frontendAnalysis;
  }

  function getDotnetAnalysis() {
    if (!dotnetAnalysis) dotnetAnalysis = createDotnetAnalysis({ files: base.files, counters: snapshot.counters });
    return dotnetAnalysis;
  }

  return Object.freeze({
    context: base,
    owner(descriptor) {
      return Object.freeze(Object.defineProperties({
        report(finding) { findings.push(validateFinding(descriptor, finding)); },
      }, Object.getOwnPropertyDescriptors(base)));
    },
    findings() { return [...findings]; },
    diagnostics() { return [...diagnostics]; },
  });
}

export { createLineMap, deepFreeze };
