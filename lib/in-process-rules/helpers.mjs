export const hasSegment = (file, segment) => file === segment || file.startsWith(`${segment}/`) || file.includes(`/${segment}/`);
export const pathDepth = (file) => file.split("/").length - 1;
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

// A frontend test source: a colocated *.spec / *.test file, anything under __tests__/, or anything under the
// frontend root's own top-level tests/ or e2e/ tree (testing-philosophy.md#test-location), so a tests/ folder
// inside the app (app/pages/tests/, utils/tests/) is app code. A frontend root that itself sits in a test tree
// (a Nuxt fixture app under tests/fixtures/) is test code. Without a known root (`frontendRoot` undefined),
// the first tests/ or e2e/ folder before any app-tree folder counts.
export const isFrontendTestSource = (file, frontendRoot) => {
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)) return true;
  if (file.split("/").slice(0, -1).includes("__tests__")) return true;
  if (frontendRoot === undefined || !under(file, frontendRoot)) {
    for (const segment of file.split("/").slice(0, -1)) {
      if (appTrees.has(segment)) return false;
      if (segment === "tests" || segment === "e2e") return true;
    }
    return false;
  }
  if (frontendRoot && isFrontendTestSource(`${frontendRoot}/_`)) return true;
  const directories = relativeTo(file, frontendRoot).split("/").slice(0, -1);
  return directories[0] === "tests" || directories[0] === "e2e";
};

// Generated output: under a generated/gen/openapi-generated/.nuxt directory, or carrying a generated-file header.
export const isGenerated = (file) =>
  file.path.split("/").slice(0, -1).some((segment) => /^(?:generated|gen|openapi-generated|\.nuxt)$/i.test(segment)) ||
  /(?:@generated|auto-generated|generated[^\n]*do not edit)/i.test(file.text().slice(0, 500));

export function walk(ts, node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(ts, child, visit));
}
