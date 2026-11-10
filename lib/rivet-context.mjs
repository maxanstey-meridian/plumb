import path from "node:path";

function packageNameAbove(directory, repository, packageFiles) {
  let current = directory;
  for (;;) {
    const packagePath = current ? `${current}/package.json` : "package.json";
    if (packageFiles.has(packagePath)) {
      const file = repository.file(packagePath);
      const parsed = repository.json?.(file) ?? file?.json?.() ?? null;
      const value = parsed?.ok ? parsed.value : parsed ? null : (() => {
        try { return JSON.parse(repository.text(file)); } catch { return null; }
      })();
      return typeof value?.name === "string" && value.name ? value.name : null;
    }
    if (!current) break;
    const parent = path.posix.dirname(current);
    current = parent === current || parent === "." ? "" : parent;
  }
  return null;
}

export function detectRivetContext(repository) {
  const contents = new Map();
  const packageFiles = new Set();
  for (const file of repository.files) {
    if (file.name === "package.json") packageFiles.add(file.path);
    const segments = file.path.split("/");
    const basename = segments.pop();
    let directory = segments.join("/");
    if (!contents.has(directory)) contents.set(directory, new Set());
    contents.get(directory).add(basename);
    while (directory) {
      const child = path.posix.basename(directory);
      directory = path.posix.dirname(directory);
      if (directory === ".") directory = "";
      if (!contents.has(directory)) contents.set(directory, new Set());
      contents.get(directory).add(child);
    }
  }

  const artifactDirs = [], contractsPackages = new Set();
  for (const [directory, names] of contents) {
    if (names.has("openapi.json") && names.has("schema.d.ts")) artifactDirs.push(directory);
  }
  artifactDirs.sort();
  for (const directory of artifactDirs) {
    const name = packageNameAbove(directory, repository, packageFiles);
    if (name) contractsPackages.add(name);
  }
  return Object.freeze({
    artifactDirs: Object.freeze(artifactDirs),
    contractsPackages: Object.freeze([...contractsPackages]),
  });
}
