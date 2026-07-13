import fs from "node:fs";
import path from "node:path";

const EXTS = [".ts", ".mjs", ".js", ".vue", ".json"];
const SOURCE_RE = /\.(ts|js|mjs|cjs)$/;
const IMPORT_RE = /(?:^|\n)\s*(import\s+type\s+|export\s+type\s+[^'\"]*?from\s*|import\s[^'\"]*?from\s*|import\s*\(\s*|import\s*|export\s[^'\"]*?from\s*)["']([^"']+)["']/g;

const depthOf = (value) => value ? value.split("/").length : 0;
const under = (file, directory) => !directory || file === directory || file.startsWith(`${directory}/`);

export function createFrontendAnalysis({ root, files, fileByPath, typescript, counters, diagnostic, loader = () => import("dependency-cruiser") }) {
  let roots;
  let cruiserPromise;
  let cruiserDiagnostic = false;
  const graphCache = new Map();

  const discover = () => {
    if (!roots) {
      counters.frontendRootDiscoveries++;
      const found = new Map();
      for (const file of files) {
        if (!/^nuxt\.config\.(ts|js|mjs)$/.test(file.name)) continue;
        const rootPath = file.directory;
        if (found.has(rootPath)) continue;
        const appCandidate = rootPath ? `${rootPath}/app` : "app";
        const appPath = files.some((candidate) => candidate.path.startsWith(`${appCandidate}/`)) ? appCandidate : rootPath;
        found.set(rootPath, Object.freeze({ path: rootPath, appPath, config: file }));
      }
      roots = Object.freeze([...found.values()].sort((a, b) => a.path.localeCompare(b.path)));
    }
    return roots;
  };

  const all = () => discover();
  const withinDepth = (maxDepth = 6) => Object.freeze(discover().filter((entry) => depthOf(entry.config.directory) <= maxDepth));
  const owner = (file) => discover().filter((entry) => under(file.path, entry.path)).sort((a, b) => depthOf(b.path) - depthOf(a.path))[0] ?? null;

  const cruiser = () => {
    if (!cruiserPromise) {
      counters.dependencyCruiserLoads++;
      cruiserPromise = Promise.resolve().then(loader).then((module) => module?.cruise ? module : module?.default).catch(() => {
        if (!cruiserDiagnostic) {
          cruiserDiagnostic = true;
          diagnostic("plumb: dependency-cruiser not installed under ~/.meridian/plumb — graph rules skipped (pnpm install in plumb)");
        }
        return null;
      });
    }
    return cruiserPromise;
  };

  const graph = (frontendRoot) => {
    const internedRoot = discover().find((entry) => entry === frontendRoot);
    if (!internedRoot) throw new Error("frontend root does not belong to this analysis context");
    if (!graphCache.has(frontendRoot.path)) graphCache.set(frontendRoot.path, (async () => {
      if (!await typescript().runtime()) return null;
      const dependencyCruiser = await cruiser();
      if (!dependencyCruiser) return null;
      counters.frontendGraphBuilds++;
      counters.dependencyCruiserRuns++;
      const absoluteRoot = path.resolve(root, ...frontendRoot.path.split("/").filter(Boolean));
      const sources = files.filter((file) => under(file.path, frontendRoot.appPath) && SOURCE_RE.test(file.name))
        .map((file) => path.posix.relative(frontendRoot.path || ".", file.path));
      const result = await dependencyCruiser.cruise(sources.length ? sources : [path.posix.relative(frontendRoot.path || ".", frontendRoot.appPath) || "."], {
        baseDir: absoluteRoot,
        doNotFollow: { path: "node_modules" },
        exclude: { path: "(^|/)(node_modules|\\.git|\\.nuxt|\\.output|dist|build|generated)(/|$)" },
        tsPreCompilationDeps: true,
        enhancedResolveOptions: {
          extensions: EXTS,
          alias: {
            "~~": absoluteRoot,
            "@@": absoluteRoot,
            "~": path.resolve(root, ...frontendRoot.appPath.split("/").filter(Boolean)),
            "@": path.resolve(root, ...frontendRoot.appPath.split("/").filter(Boolean)),
          },
        },
      });
      const candidates = new Map();
      for (const file of files) {
        const absolute = path.resolve(root, ...file.path.split("/"));
        candidates.set(path.normalize(absolute), file);
        try { candidates.set(path.normalize(fs.realpathSync(absolute)), file); } catch {}
      }
      const visibleFile = (absolute) => {
        const normalized = path.normalize(absolute);
        const direct = candidates.get(normalized);
        if (direct) return direct;
        try { return candidates.get(path.normalize(fs.realpathSync(normalized))); } catch { return undefined; }
      };
      const typeOnlyCache = new Map();
      const importIsTypeOnly = (file, specifier) => {
        const key = `${file.path}\0${specifier}`;
        if (!typeOnlyCache.has(key)) typeOnlyCache.set(key, (async () => {
          const ts = await typescript().runtime();
          if (!ts) return false;
          const representations = file.path.endsWith(".vue")
            ? await Promise.all(typescript().vueScripts(file).map((block) => typescript().vueSource(block)))
            : [await typescript().source(file)];
          const imports = representations.filter(Boolean).flatMap((representation) =>
            representation.sourceFile.statements.filter((statement) =>
              ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === specifier));
          if (!imports.length) return false;
          return imports.every((statement) => {
            const clause = statement.importClause;
            if (!clause) return false;
            if (clause.isTypeOnly) return true;
            return !clause.name && clause.namedBindings && ts.isNamedImports(clause.namedBindings) &&
              clause.namedBindings.elements.length > 0 && clause.namedBindings.elements.every((element) => element.isTypeOnly);
          });
        })());
        return typeOnlyCache.get(key);
      };
      const edges = [];
      for (const module of result.output.modules ?? []) {
        const from = visibleFile(path.resolve(absoluteRoot, module.source));
        if (!from || !under(from.path, frontendRoot.appPath)) continue;
        for (const dependency of module.dependencies ?? []) {
          if (dependency.couldNotResolve || dependency.coreModule) continue;
          const to = visibleFile(path.resolve(absoluteRoot, dependency.resolved));
          if (!to || !under(to.path, frontendRoot.appPath)) continue;
          const text = from.text();
          const line = text.split("\n").findIndex((value) => value.includes(`"${dependency.module}"`) || value.includes(`'${dependency.module}'`)) + 1;
          edges.push({ from, to, line, typeOnly: await importIsTypeOnly(from, dependency.module) });
        }
      }

      const visiblePaths = new Set(files.map((file) => file.path));
      const resolveVue = (specifier, from) => {
        let base;
        if (specifier.startsWith(".")) base = path.posix.normalize(path.posix.join(from.directory, specifier));
        else if (specifier.startsWith("~~/") || specifier.startsWith("@@/")) base = path.posix.join(frontendRoot.path, specifier.slice(3));
        else if (specifier.startsWith("~/") || specifier.startsWith("@/")) base = path.posix.join(frontendRoot.appPath, specifier.slice(2));
        else return null;
        for (const candidate of [base, ...EXTS.map((extension) => base + extension), ...EXTS.map((extension) => `${base}/index${extension}`)]) {
          if (visiblePaths.has(candidate)) return fileByPath(candidate);
        }
        return null;
      };
      for (const from of files.filter((file) => under(file.path, frontendRoot.appPath) && file.name.endsWith(".vue"))) {
        for (const block of typescript().vueScripts(from)) {
          IMPORT_RE.lastIndex = 0;
          let match;
          while ((match = IMPORT_RE.exec(block.text))) {
            const to = resolveVue(match[2], from);
            if (!to || !under(to.path, frontendRoot.appPath)) continue;
            const specifierOffset = match.index + match[0].lastIndexOf(match[2]);
            edges.push({ from, to, line: block.originalLine(specifierOffset), typeOnly: await importIsTypeOnly(from, match[2]) });
          }
        }
      }
      const seen = new Set();
      const deduped = edges.filter((edge) => {
        const key = `${edge.from.path}\0${edge.to.path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).sort((a, b) => a.from.path.localeCompare(b.from.path) || a.to.path.localeCompare(b.to.path) || a.line - b.line)
        .map((edge) => Object.freeze(edge));
      const nodes = [...new Set(deduped.flatMap((edge) => [edge.from, edge.to]))].sort((a, b) => a.path.localeCompare(b.path));
      return Object.freeze({ root: frontendRoot, nodes: Object.freeze(nodes), edges: Object.freeze(deduped) });
    })());
    return graphCache.get(frontendRoot.path);
  };

  return Object.freeze({ all, withinDepth, owner, graph });
}
