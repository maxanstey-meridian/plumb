import path from "node:path";
import { createRequire } from "node:module";
import { createTypeResolver, csharpUsings, projectUsings as parseProjectUsings } from "./csharp-types.mjs";

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

// A string literal's prefix up to its first quote: `$` runs either side of an optional `@`.
const STRING_OPENING = /(\$*)(@?)(\$*)"/y;

// Blanks comments and string/character contents, keeping offsets and newlines, so the output is exactly as long
// as the source. With `keepStrings`, string and character contents are kept (delimiters, escape backslashes and the
// first of an escaped `{{`/`}}` are still blanked), so a line that masks to blank holds only comments, whitespace or
// bare delimiters. With `preserveStringDelimiters`, a regular or verbatim string keeps its quotes. A string's `$` and
// `@` prefixes stay as code.
//
// Interpolated strings — regular (`$"…"`), verbatim (`$@"…"`, `@$"…"`) and raw (`$"""…"""`, `$$"""…"""`, any
// number of `$` and quotes) — are text with code holes: a hole's code is left unmasked (its own strings, characters
// and comments masked in turn, so holes nest), and its braces are blanked. In a regular or verbatim one `{{` and
// `}}` are text; in a raw one a run of braces opens a hole only when it's as long as the `$` run (its last that
// many braces open it, any before them are text), and the hole closes on as many `}`. Braces, parentheses and
// brackets in a hole's code (lambdas, initializers, calls) are tracked by depth, and a `:` outside them, not part of
// `::`, starts the format clause (`{x:N2}`), which is text up to the hole's close; C# requires a conditional in a
// hole to be parenthesised, so its `:` is never at the top. An alignment's expression (`{x,10}`) is code, and its `,`,
// like the hole's braces and the format clause's `:`, is blanked. A preprocessor directive's line is code, its `"…"`
// pairs (`#line 1 "A.cs"`) strings and a `//` outside them a comment, so a quote in its free text opens no literal.
export function maskCSharpText(source, { preserveStringDelimiters = false, keepStrings = false } = {}) {
  // `stack` holds the open strings and holes, innermost last; with none open, or a hole's code innermost, the
  // masker is in code. `transient` is a comment or character literal, which never holds another construct.
  const stack = [];
  let output = "", transient = null;
  const literal = (text) => keepStrings ? text : blank(text);
  const delimiter = (quote) => preserveStringDelimiters ? quote : " ";
  const run = (index, char) => { let end = index; while (source[end] === char) end++; return end - index; };
  for (let index = 0; index < source.length; index++) {
    const current = source[index], next = source[index + 1];
    if (transient === "line-comment") {
      output += blank(current);
      if (current === "\n") transient = null;
      continue;
    }
    if (transient === "block-comment") {
      if (current === "*" && next === "/") { output += "  "; index++; transient = null; }
      else output += blank(current);
      continue;
    }
    if (transient === "character") {
      if (current === "\\") {
        output += " ";
        if (next !== undefined) { output += literal(next); index++; }
      } else if (current === "'") { output += " "; transient = null; }
      else output += literal(current);
      continue;
    }
    const top = stack.at(-1);
    if (top?.kind === "string") {
      if (top.raw) {
        if (source.startsWith(top.delimiter, index)) {
          output += " ".repeat(top.delimiter.length);
          index += top.delimiter.length - 1;
          stack.pop();
        } else if (current === "{" && top.dollars) {
          const braces = run(index, "{");
          if (braces < top.dollars) { output += [...source.slice(index, index + braces)].map(literal).join(""); }
          else {
            output += literal("{").repeat(braces - top.dollars) + " ".repeat(top.dollars);
            stack.push({ kind: "hole", string: top, depth: 0, format: false });
          }
          index += braces - 1;
        } else output += literal(current);
        continue;
      }
      if (top.verbatim && current === '"' && next === '"') { output += "  "; index++; }
      else if (!top.verbatim && current === "\\") {
        output += " ";
        if (next !== undefined) { output += literal(next); index++; }
      } else if (current === '"') { output += delimiter('"'); stack.pop(); }
      else if (top.dollars && (current === "{" || current === "}") && next === current) { output += " " + literal(next); index++; }
      else if (top.dollars && current === "{") { output += " "; stack.push({ kind: "hole", string: top, depth: 0, format: false }); }
      else output += literal(current);
      continue;
    }
    if (top?.kind === "hole") {
      // A hole closes on a `}` at its top (or anywhere in its format clause): one brace, or a raw string's `$` count.
      if (current === "}" && (top.format || top.depth === 0)) {
        const braces = top.string.raw ? Math.max(1, Math.min(top.string.dollars, run(index, "}"))) : 1;
        output += " ".repeat(braces);
        index += braces - 1;
        stack.pop();
        continue;
      }
      if (top.format) { output += literal(current); continue; }
      if (top.depth === 0 && current === ":" && next !== ":" && source[index - 1] !== ":") {
        output += " ";
        top.format = true;
        continue;
      }
      // The alignment's `,` is the hole's syntax, like its braces: left as code, it would split the call or
      // declaration around the string (`F($"{a,10}")` would read as two arguments).
      if (top.depth === 0 && current === ",") { output += " "; continue; }
      if ("([{".includes(current)) top.depth++;
      else if (")]}".includes(current)) top.depth--;
    }
    // A preprocessor directive (`#` first on its line, after any whitespace or byte-order mark, outside any string)
    // is code to its line's end, so a quote in its free text (`#region Customer's orders`, `#error Don't`) opens no
    // literal. A `"…"` pair on the line (`#line 1 "A.cs"`, `#pragma checksum "A.cs" …`) is a string, masked as one;
    // an unpaired `"` stays code; a `//` outside a pair is left to the code path below, which opens a line comment.
    if (!top && current === "#" && /^\s*$/.test(source.slice(source.lastIndexOf("\n", index - 1) + 1, index))) {
      const newline = source.indexOf("\n", index), lineEnd = newline < 0 ? source.length : newline;
      let at = index;
      while (at < lineEnd && !source.startsWith("//", at)) {
        const close = source[at] === '"' ? source.indexOf('"', at + 1) : -1;
        if (close >= 0 && close < lineEnd) {
          output += delimiter('"') + source.slice(at + 1, close).split("").map(literal).join("") + delimiter('"');
          at = close + 1;
        } else output += source[at++];
      }
      index = at - 1;
      continue;
    }
    if (current === "/" && next === "/") { output += "  "; index++; transient = "line-comment"; continue; }
    if (current === "/" && next === "*") { output += "  "; index++; transient = "block-comment"; continue; }
    if (current === "'") { output += " "; transient = "character"; continue; }
    if (current === '"' || current === "$" || current === "@") {
      STRING_OPENING.lastIndex = index;
      const prefix = STRING_OPENING.exec(source);
      if (prefix) {
        const verbatim = prefix[2] === "@", dollars = prefix[1].length + prefix[3].length;
        const quote = index + prefix[0].length - 1, quotes = run(quote, '"');
        output += source.slice(index, quote);
        if (!verbatim && quotes >= 3) {
          stack.push({ kind: "string", raw: true, delimiter: '"'.repeat(quotes), dollars });
          output += " ".repeat(quotes);
          index = quote + quotes - 1;
        } else {
          stack.push({ kind: "string", raw: false, verbatim, dollars });
          output += delimiter('"');
          index = quote;
        }
        continue;
      }
    }
    output += current;
  }
  return output;
}

// The C# test location shared by classify() and testEvidence(), and the project name in parseProject(): a
// `tests`/`test` folder; a separated `Orders.Tests` / `integration-tests` / `unit_tests` suffix; a separated
// name ending in PascalCase `Tests` (`Orders.UnitTests`, `Api.E2ETests`, `App.UITests`); or a bare PascalCase
// `IntegrationTests` / `E2ETests` folder above the backend tree (inside Modules/, Contracts/ or Common/ it is a
// feature name such as `LabTests` or `BloodTests`). Inside the backend tree a separated name ending in its own
// feature folder's name, the folder right under Modules/, Contracts/ or Common/ (`Modules/LabTests/Acme.LabTests`),
// is that feature's project, not a test. The `T` is
// case-sensitive, so never `Contests` or `Latest`. Test files are PascalCase `*Tests.cs` / `*Test.cs` outside
// the backend tree (`Modules/…/GovUkPayConnectionTest.cs` is production).
const BACKEND_TREE = new Set(["Modules", "Contracts", "Common"]);
const inBackendTree = (ancestors) => ancestors.some((ancestor) => BACKEND_TREE.has(ancestor));
const namesItsFeature = (segment, ancestors) => {
  const last = segment.split(/[.\-_]/).at(-1);
  return ancestors.some((ancestor, index) => BACKEND_TREE.has(ancestor) && ancestors[index + 1] === last);
};
export const isTestDirectory = (segment, ancestors = []) =>
  /(?:^|[.\-_])tests?$/i.test(segment)
  || (/[.\-_]\w*[A-Za-z0-9]Tests?$/.test(segment) && !namesItsFeature(segment, ancestors))
  || (/[A-Za-z0-9]Tests?$/.test(segment) && !inBackendTree(ancestors));
export const isTestFileName = (name, ancestors = []) => /Tests?\.cs$/.test(name) && !inBackendTree(ancestors);
// Whether a repo-relative C# path sits in a test folder.
export const isTestPath = (filePath) => {
  const segments = filePath.split("/");
  return segments.slice(0, -1).some((segment, index) => isTestDirectory(segment, segments.slice(0, index)));
};

export function matchingCSharpDelimiter(text, open, opening = text[open], closing = ({ "(": ")", "[": "]", "{": "}", "<": ">" })[opening]) {
  if (!closing || text[open] !== opening) return -1;
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === opening) depth++;
    else if (text[index] === closing && --depth === 0) return index;
  }
  return -1;
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

// The test SDK, or a test framework that runs without it (TUnit, xUnit v3 on Microsoft.Testing.Platform, in any of
// its `xunit.v3`, `xunit.v3.core`, `xunit.v3.mtp-v1`/`-v2`/`-off` packages). Exact package names: helper packages
// such as `xunit.abstractions` or `xunit.v3.assert` ship in production libraries too.
const TEST_PACKAGES = new Set(["microsoft.net.test.sdk", "tunit", "xunit", "nunit", "mstest", "mstest.testframework"]);
const XUNIT_V3_PACKAGE = /^xunit\.v3(?:\.core)?(?:\.mtp-(?:v\d|off))?$/i;
const isTestPackage = (include) => TEST_PACKAGES.has(include.toLowerCase()) || XUNIT_V3_PACKAGE.test(include);
// `<Project Sdk="MSTest.Sdk/3.6.0">` or `<Sdk Name="MSTest.Sdk" />` sets IsTestProject itself, with no package reference.
const isTestSdk = (sdk) => String(sdk ?? "").split(";").some((item) => /^mstest\.sdk(?:\/|$)/i.test(item.trim()));
const usesTestSdk = (xml) => isTestSdk(xml["@_Sdk"]) || descendants(xml, "Sdk").some((element) => isTestSdk(element?.["@_Name"]));

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
  // Named like a test folder (`App.Tests`, `api-tests`, `IntegrationTests` outside the backend tree); never `Contest` or `Latest`.
  const nameIsTest = isTestDirectory(file.name.replace(/\.csproj$/i, ""), file.directory ? file.directory.split("/") : []);
  const metadataIsTest = /^true$/i.test(property("IsTestProject") ?? "") || usesTestSdk(xml) || packages.some((item) => isTestPackage(item.include));
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
    const key = `${file.path}\0${options.keepStrings ? "keep-strings" : "blank-strings"}\0${options.preserveStringDelimiters ? "delimiters" : "no-delimiters"}`;
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
        return relative.startsWith("Modules/") || relative.startsWith("Common/") || relative.startsWith("Contracts/");
      }) ?? null;
      const relative = backendRoot ? file.path.slice(backendRoot.length + 1) : file.path;
      const relativeSegments = relative.split("/");
      const publishedContract = modules >= 0 && segments[modules + 2] === "Contracts";
      const transportContract = relativeSegments[0] === "Contracts" && Boolean(relativeSegments[1]);
      const atModuleRoot = modules >= 0 && segments.length === modules + 3;
      classificationCache.set(file.path, freeze({
        backendRoot,
        module: modules < 0 ? null : segments[modules + 1] ?? null,
        layer: modules < 0 ? null : segments[modules + 2] ?? null,
        atModuleRoot,
        contract: transportContract ? "transport" : publishedContract ? "published" : null,
        contractOwner: transportContract ? relativeSegments[1] : publishedContract ? segments[modules + 1] : null,
        presentation: atModuleRoot && /(?:Controller|Endpoints)\.cs$/.test(file.name),
        common: relative.startsWith("Common/"),
        testPath: isTestPath(file.path),
        testFileName: isTestFileName(file.name, segments.slice(0, -1)),
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
    const projectMetadata = owner?.metadataIsTest ?? false, projectName = owner?.nameIsTest ?? false;
    const path = isTestPath(file.path), fileName = isTestFileName(file.name, file.path.split("/").slice(0, -1));
    return freeze({
      project: owner,
      projectMetadata,
      projectName,
      // `ArchitectureTesting`, `Api.Tests`, `api.tests`, `integration-test`; not `Attestation`, `Latest` or `Contest`.
      projectNameContainsTest: owner ? /Test|(?:^|[.\-_])test/.test(owner.name) : false,
      path,
      fileName,
      // Test source by any signal: test project metadata or name, a test folder, or a test file name.
      test: projectMetadata || projectName || path || fileName,
    });
  };

  // The `using` directives of a C# file and the <Using> items of a project or props file, each with its offset
  // (see csharp-types.mjs). The type resolver and MER-BE-018 read the same parse.
  const usingsCache = new Map(), projectUsingsCache = new Map();
  const usings = (file) => {
    if (!usingsCache.has(file.path)) usingsCache.set(file.path, csharpUsings(mask(file)));
    return usingsCache.get(file.path);
  };
  const projectUsings = (file) => {
    if (!projectFiles.includes(file) && !propsFiles.includes(file)) throw new Error("file is not a visible project or props file");
    if (!projectUsingsCache.has(file.path)) projectUsingsCache.set(file.path, parseProjectUsings(file.text()));
    return projectUsingsCache.get(file.path);
  };

  let typeResolver;
  const types = () => typeResolver ??= createTypeResolver({
    csharpFiles, mask, usings, projectUsings, isTestProject: (value) => value.metadataIsTest, nearestProject, referencedProjects, propsFor,
  });
  const resolveType = (name, file, offset, options) => types().resolve(name, file, offset, options);
  const namespaceInScope = (file, offset, namespace) => types().namespaceInScope(file, offset, namespace);
  const enclosingTypes = (file, offset) => { mask(file); return types().enclosingTypes(file, offset); };
  const typeReferences = (file) => { mask(file); return types().references(file); };

  return freeze({
    csharpFiles, projectFiles, propsFiles, source, mask, classify, usings, projectUsings, resolveType, namespaceInScope, enclosingTypes,
    typeReferences,    projects, project, nearestProject, referencedProjects, propsFor, projectProperty, nearestInheritedProperty, testEvidence,
  });
}
