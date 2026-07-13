import fs from "node:fs";
import path from "node:path";
import { CAPABILITIES } from "./contracts.mjs";

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function resultOf(operation) {
  try { return Object.freeze({ ok: true, value: deepFreeze(operation()) }); }
  catch (error) { return Object.freeze({ ok: false, error }); }
}

function canonicalRelative(value) {
  const normalized = value.split(path.sep).join("/");
  if (!normalized || path.posix.isAbsolute(normalized) || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`invalid inventory path: ${value}`);
  }
  return normalized;
}

export function createRepositorySnapshot(inventory, { readFile = fs.readFileSync } = {}) {
  const textCache = new Map();
  const jsonCache = new Map();
  const counters = {
    textReads: 0,
    lineMaps: 0,
    jsonParses: 0,
    configParses: 0,
    typescriptRuntimeLoads: 0,
    typescriptParses: 0,
    vueExtractions: 0,
    vueScriptParses: 0,
    tsconfigDiscoveries: 0,
    tsconfigParses: 0,
    moduleResolutions: 0,
    frontendRootDiscoveries: 0,
    frontendGraphBuilds: 0,
    dependencyCruiserLoads: 0,
    dependencyCruiserRuns: 0,
    csharpTextReads: 0,
    csharpMasks: 0,
    csharpClassifications: 0,
    dotnetProjectParses: 0,
    dotnetProjectGraphBuilds: 0,
    directoryBuildPropsParses: 0,
    capabilityInitializations: Object.fromEntries(CAPABILITIES.map((name) => [name, 0])),
  };
  const files = inventory.files.map((relativePath) => {
    const relative = canonicalRelative(relativePath);
    return Object.freeze({ path: relative, name: path.posix.basename(relative), directory: path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative) });
  });
  const byPath = new Map(files.map((file) => [file.path, file]));
  if (byPath.size !== files.length) throw new Error("repository inventory contains duplicate canonical paths");

  const text = (file) => {
    const interned = byPath.get(file?.path);
    if (interned !== file) throw new Error("file does not belong to this repository snapshot");
    if (!textCache.has(file.path)) {
      counters.textReads++;
      try {
        textCache.set(file.path, { ok: true, value: readFile(path.resolve(inventory.root, ...file.path.split("/")), "utf8") });
      } catch (error) {
        textCache.set(file.path, { ok: false, error });
      }
    }
    const result = textCache.get(file.path);
    if (!result.ok) throw result.error;
    return result.value;
  };

  const json = (file) => {
    const interned = byPath.get(file?.path);
    if (interned !== file) throw new Error("file does not belong to this repository snapshot");
    if (!jsonCache.has(file.path)) {
      counters.jsonParses++;
      jsonCache.set(file.path, resultOf(() => JSON.parse(text(file))));
    }
    return jsonCache.get(file.path);
  };

  return Object.freeze({
    root: inventory.root,
    mode: inventory.mode,
    files: Object.freeze(files),
    file(relativePath) { return byPath.get(canonicalRelative(relativePath)); },
    text,
    json,
    counters,
  });
}
