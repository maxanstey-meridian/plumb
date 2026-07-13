import path from "node:path";
import fs from "node:fs";

let cachedManifest = null;

function canonical(value) {
  try { return fs.realpathSync(value); }
  catch { return path.resolve(value); }
}

function within(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function manifest() {
  const file = process.env.PLUMB_FILE_MANIFEST;
  const root = process.env.PLUMB_REPO_ROOT;
  if (!file || !root) throw new Error("plumb: producer requires a runner-provided file manifest");
  if (cachedManifest?.file === file && cachedManifest?.root === root) return cachedManifest;
  const files = fs.readFileSync(file).toString("utf8").split("\0").filter(Boolean);
  const absoluteFiles = files.map((relative) => path.resolve(root, ...relative.split("/")));
  const fileSet = new Set(absoluteFiles);
  const filesByDirectory = new Map();
  const dirSet = new Set([path.resolve(root)]);
  for (const absolute of absoluteFiles) {
    const parent = path.dirname(absolute);
    if (!filesByDirectory.has(parent)) filesByDirectory.set(parent, []);
    filesByDirectory.get(parent).push(absolute);
    for (let directory = path.dirname(absolute); within(path.resolve(root), directory); directory = path.dirname(directory)) {
      dirSet.add(directory);
      if (directory === path.resolve(root)) break;
    }
  }
  cachedManifest = { file, root: path.resolve(root), absoluteFiles, filesByDirectory, fileSet, dirSet };
  return cachedManifest;
}

export function createVisibility(root) {
  const state = manifest();
  return { root: canonical(root), state };
}

export function shouldSkipDir(root, visibility, absDir, extraSkipDirs = []) {
  const base = path.basename(absDir);
  return extraSkipDirs.includes(base) || !visibility.state.dirSet.has(path.resolve(absDir));
}

export function shouldIncludeFile(root, visibility, absFile) {
  return visibility.state.fileSet.has(canonical(absFile));
}

export function* walkFiles(root, startDir = root, { depth = Infinity, filter = () => true, extraSkipDirs = [] } = {}) {
  const state = manifest();
  const start = canonical(startDir);
  const candidates = depth === 0 ? (state.filesByDirectory.get(start) ?? []) : state.absoluteFiles;
  for (const absolute of candidates) {
    if (!within(start, absolute)) continue;
    const relative = path.relative(start, absolute);
    const segments = relative.split(path.sep);
    if (segments.length - 1 > depth || segments.slice(0, -1).some((segment) => extraSkipDirs.includes(segment))) continue;
    if (filter(path.basename(absolute), absolute)) yield absolute;
  }
}

export function* walkDirs(root, startDir = root, { depth = Infinity, filter = () => true, extraSkipDirs = [] } = {}) {
  const state = manifest();
  const start = canonical(startDir);
  const directories = [...state.dirSet].filter((directory) => directory !== start && within(start, directory)).sort();
  for (const directory of directories) {
    const segments = path.relative(start, directory).split(path.sep);
    if (segments.length > depth + 1 || segments.some((segment) => extraSkipDirs.includes(segment))) continue;
    if (filter(path.basename(directory), directory)) yield directory;
  }
}

export function createManifestRepositoryView(root) {
  const state = manifest();
  const resolvedRoot = path.resolve(root);
  if (resolvedRoot !== state.root) throw new Error("manifest repository root does not match producer root");
  const files = Object.freeze(state.absoluteFiles.map((absolute) => {
    const relative = path.relative(state.root, absolute).split(path.sep).join("/");
    return Object.freeze({ path: relative, name: path.posix.basename(relative), directory: path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative) });
  }));
  const byPath = new Map(files.map((file) => [file.path, file]));
  const textCache = new Map();
  const text = (file) => {
    if (byPath.get(file?.path) !== file) throw new Error("file does not belong to this manifest repository view");
    if (!textCache.has(file.path)) {
      try { textCache.set(file.path, { ok: true, value: fs.readFileSync(path.resolve(state.root, ...file.path.split("/")), "utf8") }); }
      catch (error) { textCache.set(file.path, { ok: false, error }); }
    }
    const result = textCache.get(file.path);
    if (!result.ok) throw result.error;
    return result.value;
  };
  return Object.freeze({
    root: state.root,
    files,
    file(relative) { return byPath.get(relative.split(path.sep).join("/")); },
    text,
  });
}
