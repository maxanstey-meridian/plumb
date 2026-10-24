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

// A frontend test source: a colocated *.spec / *.test file, anything under __tests__/, or anything under a
// frontend tests/ or e2e/ tree (testing-philosophy.md#test-location). A tests/ or e2e/ segment inside an app
// tree (e.g. app/pages/tests/) is a route or feature folder, not a test tree, so it does not count.
const appTreeSegments = new Set(["app", "pages", "layouts", "components", "composables", "plugins", "shared", "src"]);
export const isFrontendTestSource = (file) => {
  if (/\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file)) return true;
  const directories = file.split("/").slice(0, -1);
  if (directories.includes("__tests__")) return true;
  for (const segment of directories) {
    if (appTreeSegments.has(segment)) return false;
    if (segment === "tests" || segment === "e2e") return true;
  }
  return false;
};

// Generated output: under a generated/gen/openapi-generated/.nuxt directory, or carrying a generated-file header.
export const isGenerated = (file) =>
  file.path.split("/").slice(0, -1).some((segment) => /^(?:generated|gen|openapi-generated|\.nuxt)$/i.test(segment)) ||
  /(?:@generated|auto-generated|generated[^\n]*do not edit)/i.test(file.text().slice(0, 500));

export function walk(ts, node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(ts, child, visit));
}
