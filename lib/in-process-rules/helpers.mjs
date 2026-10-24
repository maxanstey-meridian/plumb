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

// A frontend test or e2e source: a *.spec / *.test file, or anything under a tests/, e2e/ or
// __tests__/ directory.
export const isFrontendTestPath = (file) => /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(file) ||
  file.split("/").slice(0, -1).some((segment) => segment === "tests" || segment === "e2e" || segment === "__tests__");
