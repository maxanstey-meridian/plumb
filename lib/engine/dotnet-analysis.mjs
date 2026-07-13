import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const freeze = (value) => Object.freeze(value);
const normalized = (value) => value.replaceAll("\\", "/");
const parentOf = (directory) => {
  const parent = path.posix.dirname(directory);
  return parent === "." ? "" : parent;
};

function blank(value) {
  return value === "\n" || value === "\r" ? value : " ";
}

export function maskCSharpText(source, { preserveStringDelimiters = false } = {}) {
  let output = "", state = "code", rawDelimiter = "", verbatim = false;
  for (let index = 0; index < source.length; index++) {
    const current = source[index], next = source[index + 1];
    if (state === "line-comment") {
      output += blank(current);
      if (current === "\n") state = "code";
      continue;
    }
    if (state === "block-comment") {
      if (current === "*" && next === "/") { output += "  "; index++; state = "code"; }
      else output += blank(current);
      continue;
    }
    if (state === "raw-string") {
      if (source.startsWith(rawDelimiter, index)) {
        output += " ".repeat(rawDelimiter.length);
        index += rawDelimiter.length - 1;
        state = "code";
      } else output += blank(current);
      continue;
    }
    if (state === "string") {
      if (verbatim && current === '"' && next === '"') { output += "  "; index++; }
      else if (!verbatim && current === "\\") {
        output += " ";
        if (next !== undefined) { output += blank(next); index++; }
      } else if (current === '"') { output += preserveStringDelimiters ? '"' : " "; state = "code"; }
      else output += blank(current);
      continue;
    }
    if (state === "character") {
      if (current === "\\") {
        output += " ";
        if (next !== undefined) { output += blank(next); index++; }
      } else { output += blank(current); if (current === "'") state = "code"; }
      continue;
    }
    if (current === "/" && next === "/") { output += "  "; index++; state = "line-comment"; }
    else if (current === "/" && next === "*") { output += "  "; index++; state = "block-comment"; }
    else if (source.startsWith('"""', index)) {
      rawDelimiter = source.slice(index).match(/^"{3,}/)[0];
      output += " ".repeat(rawDelimiter.length);
      index += rawDelimiter.length - 1;
      state = "raw-string";
    } else if (current === '"') {
      verbatim = index > 0 && source[index - 1] === "@";
      output += preserveStringDelimiters ? '"' : " ";
      state = "string";
    } else if (current === "'") { output += " "; state = "character"; }
    else output += current;
  }
  return output;
}

let xmlParser;

function getXmlParser() {
  if (!xmlParser) {
    const { XMLParser } = require("fast-xml-parser");
    xmlParser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      parseTagValue: false,
      trimValues: true,
    });
  }
  return xmlParser;
}

const arrayOf = (value) => value === undefined ? [] : Array.isArray(value) ? value : [value];

function parseXmlProject(source) {
  const parser = getXmlParser();
  try { return parser.parse(source)?.Project ?? {}; }
  catch { return {}; }
}

function descendants(value, name, found = []) {
  if (Array.isArray(value)) {
    for (const item of value) descendants(item, name, found);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === name) found.push(...arrayOf(child));
      else descendants(child, name, found);
    }
  }
  return found;
}

function textOf(value) {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return textOf(value.at(-1));
  if (typeof value !== "object") return String(value).trim();
  return textOf(value["#text"]);
}

function resolveReference(project, include, byPath, byFoldedPath) {
  const candidate = path.posix.normalize(path.posix.join(project.directory, normalized(include)));
  const exact = byPath.get(candidate)?.path;
  if (exact) return exact;
  return process.platform === "win32" || process.platform === "darwin" ? byFoldedPath.get(candidate.toLowerCase())?.path ?? null : null;
}

function parseProject(file, counters) {
  counters.dotnetProjectParses++;
  const source = file.text();
  const xml = parseXmlProject(source);
  const packages = descendants(xml, "PackageReference").map((item) => freeze({
    include: item?.["@_Include"] ?? item?.["@_Update"] ?? "",
    version: item?.["@_Version"] ?? textOf(item?.Version),
  })).filter((item) => item.include);
  const referenceIncludes = descendants(xml, "ProjectReference").map((item) => item?.["@_Include"]).filter(Boolean);
  const properties = unconditionalProperties(xml);
  const property = (name) => properties.get(name.toLowerCase());
  const nameIsTest = /Tests?\.csproj$/i.test(file.name);
  const metadataIsTest = /^true$/i.test(property("IsTestProject") ?? "") || packages.some((item) => /Microsoft\.NET\.Test\.Sdk/i.test(item.include));
  return {
    path: file.path,
    name: file.name,
    directory: file.directory,
    file,
    source,
    packages: freeze(packages),
    referenceIncludes: freeze(referenceIncludes),
    nameIsTest,
    metadataIsTest,
    isTestProject: nameIsTest || metadataIsTest,
    properties: freeze(Object.fromEntries(properties)),
  };
}

function unconditionalProperties(project) {
  const result = new Map();
  for (const group of arrayOf(project.PropertyGroup)) {
    if (!group || typeof group !== "object" || group["@_Condition"] !== undefined) continue;
    for (const [name, value] of Object.entries(group)) {
      if (name.startsWith("@_") || value?.["@_Condition"] !== undefined) continue;
      result.set(name.toLowerCase(), textOf(value));
    }
  }
  return result;
}

export function createDotnetAnalysis({ files, counters }) {
  const csharpFiles = freeze(files.filter((file) => file.path.endsWith(".cs")));
  const projectFiles = freeze(files.filter((file) => file.path.endsWith(".csproj")));
  const propsFiles = freeze(files.filter((file) => file.name === "Directory.Build.props"));
  const csharpSeen = new Set(), maskCache = new Map(), classificationCache = new Map(), projectCache = new Map(), propsCache = new Map();
  const propsForCache = new Map();
  const backendRoots = [...new Set(csharpFiles.flatMap((file) => {
    const segments = file.path.split("/"), roots = [];
    for (let index = 0; index < segments.length - 1; index++) if (segments[index] === "Modules") roots.push(segments.slice(0, index).join("/"));
    return roots;
  }))].sort((left, right) => right.length - left.length || left.localeCompare(right));
  let projectsValue, projectByPath, projectsByDirectory;

  const source = (file) => {
    if (!file?.path.endsWith(".cs") || !csharpFiles.includes(file)) throw new Error("file is not a visible C# source");
    if (!csharpSeen.has(file.path)) { csharpSeen.add(file.path); counters.csharpTextReads++; }
    return file.text();
  };
  const mask = (file, options = {}) => {
    if (!file?.path.endsWith(".cs") || !csharpFiles.includes(file)) throw new Error("file is not a visible C# source");
    const mode = options.preserveStringDelimiters ? "string-delimiters" : "full";
    const key = `${file.path}\0${mode}`;
    if (!maskCache.has(key)) { counters.csharpMasks++; maskCache.set(key, maskCSharpText(source(file), options)); }
    return maskCache.get(key);
  };
  const classify = (file) => {
    if (!file?.path.endsWith(".cs") || !csharpFiles.includes(file)) throw new Error("file is not a visible C# source");
    if (!classificationCache.has(file.path)) {
      counters.csharpClassifications++;
      const segments = file.path.split("/");
      const modules = segments.lastIndexOf("Modules");
      const backendRoot = backendRoots.find((root) => {
        if (root && !file.path.startsWith(`${root}/`)) return false;
        const relative = root ? file.path.slice(root.length + 1) : file.path;
        return relative.startsWith("Modules/") || relative.startsWith("Common/");
      }) ?? null;
      const relative = backendRoot ? file.path.slice(backendRoot.length + 1) : file.path;
      classificationCache.set(file.path, freeze({
        backendRoot,
        module: modules < 0 ? null : segments[modules + 1] ?? null,
        layer: modules < 0 ? null : segments[modules + 2] ?? null,
        atModuleRoot: modules >= 0 && segments.length === modules + 3,
        common: relative.startsWith("Common/"),
        testPath: segments.slice(0, -1).some((segment) => /tests?$/i.test(segment)),
        testFileName: /Tests?\.cs$/i.test(file.name),
      }));
    }
    return classificationCache.get(file.path);
  };
  const ensureProjects = () => {
    if (projectsValue) return;
    counters.dotnetProjectGraphBuilds++;
    const parsed = projectFiles.map((file) => {
      if (!projectCache.has(file.path)) projectCache.set(file.path, parseProject(file, counters));
      return projectCache.get(file.path);
    });
    projectByPath = new Map(parsed.map((project) => [project.path, project]));
    const projectByFoldedPath = new Map(parsed.map((project) => [project.path.toLowerCase(), project]));
    projectsByDirectory = new Map();
    for (const project of parsed) {
      if (!projectsByDirectory.has(project.directory)) projectsByDirectory.set(project.directory, []);
      projectsByDirectory.get(project.directory).push(project);
    }
    for (const values of projectsByDirectory.values()) values.sort((a, b) => a.path.localeCompare(b.path));
    projectsValue = freeze(parsed.map((project) => freeze({
      ...project,
      references: freeze(project.referenceIncludes.map((include) => resolveReference(project, include, projectByPath, projectByFoldedPath)).filter(Boolean)),
    })));
    projectByPath = new Map(projectsValue.map((project) => [project.path, project]));
  };
  const projects = () => { ensureProjects(); return projectsValue; };
  const project = (value) => { ensureProjects(); return projectByPath.get(typeof value === "string" ? value : value?.path); };
  const nearestProject = (file) => {
    ensureProjects();
    let directory = file.directory;
    while (true) {
      const found = projectsByDirectory.get(directory)?.[0];
      if (found) return projectByPath.get(found.path);
      if (!directory) return null;
      directory = parentOf(directory);
    }
  };
  const referencedProjects = (value, { transitive = true } = {}) => {
    const start = project(value);
    if (!start) return freeze([]);
    const seen = new Set([start.path]), queue = [...start.references], result = [];
    while (queue.length) {
      const nextPath = queue.shift();
      if (seen.has(nextPath)) continue;
      seen.add(nextPath);
      const next = projectByPath.get(nextPath);
      if (!next) continue;
      result.push(next);
      if (transitive) queue.push(...next.references);
    }
    return freeze(result);
  };
  const propsFor = (value) => {
    const target = project(value);
    if (!target) return freeze([]);
    if (propsForCache.has(target.path)) return propsForCache.get(target.path);
    let directory = target.directory;
    while (true) {
      const found = propsFiles.find((file) => file.directory === directory);
      if (found) {
        const result = freeze([found]);
        propsForCache.set(target.path, result);
        return result;
      }
      if (!directory) {
        const result = freeze([]);
        propsForCache.set(target.path, result);
        return result;
      }
      directory = parentOf(directory);
    }
  };
  const properties = (file) => {
    if (!propsCache.has(file.path)) {
      counters.directoryBuildPropsParses++;
      propsCache.set(file.path, unconditionalProperties(parseXmlProject(file.text())));
    }
    return propsCache.get(file.path);
  };
  const projectProperty = (value, name) => {
    const target = project(value);
    if (!target) return undefined;
    return target.properties[name.toLowerCase()];
  };
  const nearestInheritedProperty = (value, name) => {
    const target = project(value);
    if (!target) return undefined;
    const nearest = propsFor(target).at(-1);
    return nearest ? properties(nearest).get(name.toLowerCase()) : undefined;
  };
  const testEvidence = (file) => {
    const owner = nearestProject(file);
    const segments = file.path.split("/");
    return freeze({
      project: owner,
      projectMetadata: owner?.metadataIsTest ?? false,
      projectName: owner?.nameIsTest ?? false,
      projectNameContainsTest: owner ? /test/i.test(owner.name) : false,
      path: segments.some((segment) => /^(?:tests?|.+\.tests?)$/i.test(segment)),
      fileName: /Tests?\.cs$/i.test(file.name),
    });
  };

  return freeze({ csharpFiles, projectFiles, propsFiles, source, mask, classify, projects, project, nearestProject, referencedProjects, propsFor, projectProperty, nearestInheritedProperty, testEvidence });
}
