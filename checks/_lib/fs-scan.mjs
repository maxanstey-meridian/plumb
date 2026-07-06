import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const DEFAULT_SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".nuxt",
  ".output",
  "dist",
  "build",
  "vendor",
  "obj",
  "bin",
  ".turbo",
  "coverage",
]);

const VISIBILITY_CACHE = new Map();

const relPosix = (root, abs) => path.relative(root, abs).split(path.sep).join("/");

export function createVisibility(root) {
  const absRoot = path.resolve(root);
  if (VISIBILITY_CACHE.has(absRoot)) return VISIBILITY_CACHE.get(absRoot);

  const probe = spawnSync("git", ["-C", absRoot, "rev-parse", "--show-toplevel"], { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (probe.status !== 0) {
    const empty = { gitMode: false, files: new Set(), dirs: new Set() };
    VISIBILITY_CACHE.set(absRoot, empty);
    return empty;
  }

  const repoRoot = path.resolve((probe.stdout || "").trim());
  const relScanRoot = relPosix(repoRoot, absRoot);
  const list = spawnSync(
    "git",
    ["-C", repoRoot, "ls-files", "-co", "--exclude-standard", "--full-name"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  if (list.status !== 0) {
    const empty = { gitMode: false, files: new Set(), dirs: new Set() };
    VISIBILITY_CACHE.set(absRoot, empty);
    return empty;
  }

  const files = new Set();
  const dirs = new Set();
  for (const raw of (list.stdout || "").split(/\r?\n/)) {
    if (!raw) continue;
    const relRepo = raw.replace(/\\/g, "/");
    if (relScanRoot) {
      if (relRepo !== relScanRoot && !relRepo.startsWith(relScanRoot + "/")) continue;
      const rel = relRepo.slice(relScanRoot.length).replace(/^\/+/, "");
      if (!rel) continue;
      files.add(rel);
      let dir = path.posix.dirname(rel);
      while (dir && dir !== ".") {
        dirs.add(dir);
        dir = path.posix.dirname(dir);
      }
      dirs.add(".");
    } else {
      files.add(relRepo);
      let dir = path.posix.dirname(relRepo);
      while (dir && dir !== ".") {
        dirs.add(dir);
        dir = path.posix.dirname(dir);
      }
      dirs.add(".");
    }
  }

  const vis = { gitMode: true, files, dirs };
  VISIBILITY_CACHE.set(absRoot, vis);
  return vis;
}

export function shouldSkipDir(root, visibility, absDir, extraSkipDirs = []) {
  const base = path.basename(absDir);
  if (DEFAULT_SKIP_DIRS.has(base) || extraSkipDirs.includes(base)) return true;
  if (!visibility.gitMode) return false;
  const rel = relPosix(root, absDir);
  return rel !== "" && rel !== "." && !visibility.dirs.has(rel);
}

export function shouldIncludeFile(root, visibility, absFile) {
  if (!visibility.gitMode) return true;
  return visibility.files.has(relPosix(root, absFile));
}

export function* walkFiles(root, startDir = root, { depth = Infinity, filter = () => true, extraSkipDirs = [] } = {}) {
  const visibility = createVisibility(root);
  function* rec(dir, remaining) {
    if (remaining < 0) return;
    let es;
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!shouldSkipDir(root, visibility, p, extraSkipDirs)) yield* rec(p, remaining - 1);
      } else if (filter(e.name, p) && shouldIncludeFile(root, visibility, p)) {
        yield p;
      }
    }
  }
  yield* rec(startDir, depth);
}

export function* walkDirs(root, startDir = root, { depth = Infinity, filter = () => true, extraSkipDirs = [] } = {}) {
  const visibility = createVisibility(root);
  function* rec(dir, remaining) {
    if (remaining < 0) return;
    let es;
    try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      if (shouldSkipDir(root, visibility, p, extraSkipDirs)) continue;
      if (filter(e.name, p)) yield p;
      yield* rec(p, remaining - 1);
    }
  }
  yield* rec(startDir, depth);
}
