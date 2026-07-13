import fs from "node:fs";
import path from "node:path";

const SOURCE_KINDS = Object.freeze({
  ".ts": "TS",
  ".tsx": "TSX",
  ".mts": "TS",
  ".cts": "TS",
  ".js": "JS",
  ".jsx": "JSX",
  ".mjs": "JS",
  ".cjs": "JS",
});

const VUE_SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
const LANG_RE = /\blang\s*=\s*["']([^"']+)["']/i;

function realpathIfPossible(file) {
  try { return fs.realpathSync(file); } catch { return path.resolve(file); }
}

function runtimeModule(module) {
  return module?.default ?? module;
}

function scriptKind(ts, kind) {
  return ts.ScriptKind[kind];
}

export function createTypeScriptAnalysis({ root, files, counters, diagnostic, loader = () => import("typescript") }) {
  const sourceCache = new Map();
  const vueCache = new Map();
  const vueSourceCache = new Map();
  const nearestConfigCache = new Map();
  const optionsCache = new Map();
  const resolutionCache = new Map();
  const visible = new Set(files.map((file) => file.path));
  const fileByPath = new Map(files.map((file) => [file.path, file]));
  const reportedConfigs = new Set();
  let runtimePromise;
  let runtimeDiagnostic = false;

  const runtime = () => {
    if (!runtimePromise) {
      counters.typescriptRuntimeLoads++;
      runtimePromise = Promise.resolve().then(loader).then(runtimeModule).catch(() => {
        if (!runtimeDiagnostic) {
          runtimeDiagnostic = true;
          diagnostic("plumb: TypeScript not installed under ~/.meridian/plumb — TypeScript rules skipped (pnpm install in plumb)");
        }
        return null;
      });
    }
    return runtimePromise;
  };

  const source = (file) => {
    if (fileByPath.get(file?.path) !== file) throw new Error("file does not belong to this TypeScript analysis context");
    const kind = SOURCE_KINDS[path.posix.extname(file.path).toLowerCase()];
    if (!kind) throw new Error(`unsupported TypeScript source: ${file.path}`);
    const key = `${file.path}\0source\0${kind}`;
    if (!sourceCache.has(key)) sourceCache.set(key, (async () => {
      const ts = await runtime();
      if (!ts) return null;
      counters.typescriptParses++;
      const text = file.text();
      const sourceFile = ts.createSourceFile(file.path, text, ts.ScriptTarget.Latest, true, scriptKind(ts, kind));
       return Object.freeze({
         file,
         representation: "source",
         text,
         kind,
         scriptKind: scriptKind(ts, kind),
         sourceFile,
         lineOf(node) { return sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1; },
       });
    })());
    return sourceCache.get(key);
  };

  const vueScripts = (file) => {
    if (fileByPath.get(file?.path) !== file) throw new Error("file does not belong to this TypeScript analysis context");
    if (!vueCache.has(file.path)) {
      counters.vueExtractions++;
      const text = file.text();
      const lineMap = file.lineMap();
      const blocks = [];
      VUE_SCRIPT_RE.lastIndex = 0;
      let match;
      while ((match = VUE_SCRIPT_RE.exec(text))) {
        const openingLength = match[0].indexOf(">") + 1;
        const bodyStart = match.index + openingLength;
        const bodyEnd = bodyStart + match[2].length;
        const blockText = match[2];
        const language = (LANG_RE.exec(match[1])?.[1] ?? "js").toLowerCase();
        const kind = language === "tsx" ? "TSX" : language === "ts" ? "TS" : language === "jsx" ? "JSX" : "JS";
        const index = blocks.length;
        blocks.push(Object.freeze({
          file,
          index,
          representation: `vue-script:${index}`,
          text: blockText,
          bodyStart,
          bodyEnd,
          language,
          kind,
          originalLine(offset = 0) {
            if (!Number.isInteger(offset) || offset < 0 || offset > blockText.length) throw new Error(`invalid Vue script offset: ${offset}`);
            return lineMap.lineAt(bodyStart + offset);
          },
        }));
      }
      vueCache.set(file.path, Object.freeze(blocks));
    }
    return vueCache.get(file.path);
  };

  const vueScript = (file) => vueScripts(file)[0] ?? null;

  const vueSource = (block) => {
    const known = vueScripts(block.file)[block.index];
    if (known !== block) throw new Error("Vue script block does not belong to this analysis context");
    const key = `${block.file.path}\0${block.representation}\0${block.kind}`;
    if (!vueSourceCache.has(key)) vueSourceCache.set(key, (async () => {
      const ts = await runtime();
      if (!ts) return null;
      counters.vueScriptParses++;
      const sourceFile = ts.createSourceFile(`${block.file.path}#${block.index}`, block.text, ts.ScriptTarget.Latest, true, scriptKind(ts, block.kind));
      return Object.freeze({
        ...block,
        scriptKind: scriptKind(ts, block.kind),
        sourceFile,
        lineOf(node) { return block.originalLine(node.getStart(sourceFile)); },
      });
    })());
    return vueSourceCache.get(key);
  };

  const nearestConfig = (file) => {
    if (!nearestConfigCache.has(file.path)) {
      counters.tsconfigDiscoveries++;
      let directory = file.directory;
      let found = null;
      while (true) {
        const candidate = directory ? `${directory}/tsconfig.json` : "tsconfig.json";
        if (visible.has(candidate)) { found = candidate; break; }
        if (!directory) break;
        const parent = path.posix.dirname(directory);
        directory = parent === "." ? "" : parent;
      }
      nearestConfigCache.set(file.path, found);
    }
    return nearestConfigCache.get(file.path);
  };

  const reportConfig = (ts, configPath, error) => {
    if (!error || reportedConfigs.has(configPath)) return;
    reportedConfigs.add(configPath);
    const detail = ts.flattenDiagnosticMessageText(error.messageText, " ");
    diagnostic(`plumb: TypeScript alias resolution degraded for ${configPath}: ${detail}`);
  };

  const optionsForConfig = (configPath) => {
    if (!configPath) return Promise.resolve(null);
    if (!optionsCache.has(configPath)) optionsCache.set(configPath, (async () => {
      const ts = await runtime();
      if (!ts) return null;
      counters.tsconfigParses++;
      const absolute = path.resolve(root, ...configPath.split("/"));
      const readConfigText = (fileName) => {
        const relative = path.relative(root, fileName).split(path.sep).join("/");
        const visibleFile = fileByPath.get(relative);
        return visibleFile ? visibleFile.text() : ts.sys.readFile(fileName);
      };
      const read = ts.readConfigFile(absolute, readConfigText);
      if (read.error) { reportConfig(ts, configPath, read.error); return null; }
      const parsed = ts.parseJsonConfigFileContent(read.config, {
        ...ts.sys,
        readDirectory(directory, extensions = []) {
          const normalizedDirectory = path.resolve(directory);
          return files.map((file) => path.resolve(root, ...file.path.split("/")))
            .filter((file) => (file === normalizedDirectory || file.startsWith(`${normalizedDirectory}${path.sep}`)) &&
              (!extensions.length || extensions.some((extension) => file.endsWith(extension))));
        },
        readFile: readConfigText,
      }, path.dirname(absolute));
      reportConfig(ts, configPath, parsed.errors.find((error) => error.category === ts.DiagnosticCategory.Error));
      return parsed.options;
    })());
    return optionsCache.get(configPath);
  };

  const compilerOptions = async (file) => optionsForConfig(nearestConfig(file));

  const resolve = async (file, specifier) => {
    const relative = specifier.startsWith(".");
    const configPath = relative ? null : nearestConfig(file);
    const key = `${file.path}\0${specifier}\0${configPath ?? ""}`;
    if (!resolutionCache.has(key)) resolutionCache.set(key, (async () => {
      counters.moduleResolutions++;
      const from = realpathIfPossible(path.resolve(root, ...file.path.split("/")));
      if (relative) return realpathIfPossible(path.resolve(path.dirname(from), specifier));
      const options = await optionsForConfig(configPath);
      if (!options) return null;
      const ts = await runtime();
      if (!ts) return null;
      const resolved = ts.resolveModuleName(specifier, from, options, ts.sys).resolvedModule;
      if (!resolved) return null;
      const resolvedFile = realpathIfPossible(resolved.resolvedFileName).replace(/\.d\.[mc]?ts$/, "");
      if (resolved.isExternalLibraryImport && resolvedFile.split(path.sep).includes("node_modules")) return null;
      return resolvedFile;
    })());
    return resolutionCache.get(key);
  };

  return Object.freeze({ runtime, source, vueScript, vueScripts, vueSource, nearestConfig, compilerOptions, resolve });
}
