import { isNuxtConfig } from "../engine/frontend-analysis.mjs";

export const hasSegment = (file, segment) => file === segment || file.startsWith(`${segment}/`) || file.includes(`/${segment}/`);
export const pathDepth = (file) => file.split("/").length - 1;
// Build output (obj/, bin/) repeats generated copies of a project's sources.
export const inBuildOutput = (file) => file.split("/").some((segment) => segment === "obj" || segment === "bin");
export const under = (file, directory) => !directory || file.startsWith(`${directory}/`);
export const relativeTo = (file, directory) => directory ? file.slice(directory.length + 1) : file;

export function lineHits(file, pattern) {
  const hits = [];
  let lines;
  try { lines = file.lineMap().lines; }
  catch { return hits; }
  for (const [index, line] of lines.entries()) {
    pattern.lastIndex = 0;
    if (pattern.test(line)) hits.push(index + 1);
  }
  return hits;
}

export function report(context, severity, path, line, message, docRef) {
  context.report({ severity, path, line, message, docRef });
}

// Nuxt app-tree folders, relative to a frontend root (the nuxt.config directory).
export const appTrees = new Set(["app", "pages", "components", "composables", "layouts", "plugins", "shared", "src"]);
export const inAppTree = (relative) => appTrees.has(relative.split("/")[0]);

// A TypeScript test source: a colocated *.spec / *.test file, anything under __tests__/, or anything in the
// top-level test/, tests/ or e2e/ tree of its package (testing-philosophy.md#test-location). Its package is the
// nearest directory above it holding a nuxt.config or a package.json, so a tests/ folder inside the app
// (app/pages/tests/, src/test/) is app code and a monorepo package's own test/ is tests. Every rule reads the
// same answer from the file list alone, without starting frontend analysis. A package that itself sits in a
// test tree (a Nuxt fixture app under tests/fixtures/) is test code. A workspace root (a package.json declaring
// `workspaces`, or one beside a pnpm-workspace.yaml listing `packages:`) is not a package: a file with no
// nearer package counts the first test/, tests/ or e2e/ folder before any app-tree folder.
const TEST_TREES = new Set(["test", "tests", "e2e"]);
const packageDirectories = new WeakMap();
const packageRootOf = (context, directories) => {
  if (!packageDirectories.has(context)) {
    const directoryOf = (file) => file.path.split("/").slice(0, -1).join("/");
    const workspaces = new Set(context.files.filter((file) => file.name === "pnpm-workspace.yaml" && /^packages\s*:/m.test(file.text())).map(directoryOf));
    const isPackage = (file) => file.name === "package.json" && !workspaces.has(directoryOf(file)) && !/"workspaces"\s*:/.test(file.text());
    packageDirectories.set(context, new Set(context.files.filter((file) => isNuxtConfig(file.name) || isPackage(file)).map(directoryOf)));
  }
  const packages = packageDirectories.get(context);
  for (let length = directories.length; length >= 0; length--) {
    const directory = directories.slice(0, length).join("/");
    if (packages.has(directory)) return directory;
  }
  return undefined;
};
export const isTypeScriptTestSource = (context, file) => {
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)) return true;
  const directories = file.split("/").slice(0, -1);
  if (directories.includes("__tests__")) return true;
  const root = packageRootOf(context, directories);
  if (root === undefined) {
    for (const segment of directories) {
      if (appTrees.has(segment)) return false;
      if (TEST_TREES.has(segment)) return true;
    }
    return false;
  }
  if (root.split("/").some((segment) => TEST_TREES.has(segment))) return true;
  return TEST_TREES.has(relativeTo(file, root).split("/").slice(0, -1)[0]);
};
export const isTestScript = (context, file) => isTypeScriptTestSource(context, file.path);

// Generated output: under a generated/gen/openapi-generated/.nuxt directory, or carrying a generated-file header.
export const isGenerated = (file) =>
  file.path.split("/").slice(0, -1).some((segment) => /^(?:generated|gen|openapi-generated|\.nuxt)$/i.test(segment)) ||
  /(?:@generated|auto-generated|generated[^\n]*do not edit)/i.test(file.text().slice(0, 500));

export function walk(ts, node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(ts, child, visit));
}
