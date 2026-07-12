import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const CONFIG_CACHE = new Map();
let reportedConfigDegradation = false;

function realpathIfPossible(file) {
  try { return fs.realpathSync(file); } catch { return path.resolve(file); }
}

function reportConfigDegradation(configFile, diagnostic) {
  if (reportedConfigDegradation) return;
  reportedConfigDegradation = true;
  const detail = ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
  process.stderr.write(`plumb: TypeScript alias resolution degraded for ${configFile}: ${detail}\n`);
}

function nearestTsconfig(root, file) {
  const absRoot = path.resolve(root);
  let dir = path.dirname(path.resolve(file));
  while (dir === absRoot || dir.startsWith(absRoot + path.sep)) {
    const candidate = path.join(dir, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;
    if (dir === absRoot) break;
    dir = path.dirname(dir);
  }
  return null;
}

function compilerOptions(configFile) {
  if (CONFIG_CACHE.has(configFile)) return CONFIG_CACHE.get(configFile);
  const read = ts.readConfigFile(configFile, ts.sys.readFile);
  if (read.error) {
    reportConfigDegradation(configFile, read.error);
    CONFIG_CACHE.set(configFile, null);
    return null;
  }
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configFile));
  const configError = parsed.errors.find((error) => error.category === ts.DiagnosticCategory.Error);
  if (configError) reportConfigDegradation(configFile, configError);
  CONFIG_CACHE.set(configFile, parsed.options);
  return parsed.options;
}

export function resolveTsImport(root, fromFile, specifier) {
  const realFrom = realpathIfPossible(fromFile);
  if (specifier.startsWith(".")) return realpathIfPossible(path.resolve(path.dirname(realFrom), specifier));
  const configFile = nearestTsconfig(root, fromFile);
  if (!configFile) return null;
  const options = compilerOptions(configFile);
  if (!options) return null;
  const resolved = ts.resolveModuleName(specifier, realFrom, options, ts.sys).resolvedModule;
  if (!resolved) return null;
  const resolvedFile = realpathIfPossible(resolved.resolvedFileName).replace(/\.d\.[mc]?ts$/, "");
  if (resolved.isExternalLibraryImport && resolvedFile.split(path.sep).includes("node_modules")) return null;
  return resolvedFile;
}
