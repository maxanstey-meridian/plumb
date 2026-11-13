import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Namespace prefixes the framework rules judge (MER-BE-001 and MER-BE-002). The facts tool records a use of an outside
// type only when its full name, or the full name of one of its base classes, equals one of these or starts with one
// followed by `.`, or when its own name has one of EXTERNAL_SEGMENTS as a segment, so each list lives here once and the
// rule that judges it imports it.
export const DOMAIN_FRAMEWORK_PREFIXES = Object.freeze([
  "Microsoft.AspNetCore",
  "Microsoft.EntityFrameworkCore",
  "Microsoft.Extensions.Logging",
  "OpenTelemetry",
  "FluentResults",
  "Npgsql",
  "Azure",
  "System.Net.Http",
]);
export const APPLICATION_FRAMEWORK_PREFIXES = Object.freeze([
  "Microsoft.AspNetCore",
  "Microsoft.EntityFrameworkCore",
  "System.Net.Http",
  "Npgsql",
  "Azure",
]);
export const SERVICE_PROVIDER_TYPES = Object.freeze(["System.IServiceProvider"]);
export const EXTERNAL_PREFIXES = Object.freeze([...new Set([...DOMAIN_FRAMEWORK_PREFIXES, ...APPLICATION_FRAMEWORK_PREFIXES, ...SERVICE_PROVIDER_TYPES])]);
// The layers MER-BE-001 and MER-BE-002 judge: a domain type may not use Application or Infrastructure, an application
// type may not use Infrastructure.
export const DOMAIN_HIGHER_LAYERS = Object.freeze(["Application", "Infrastructure"]);
export const APPLICATION_HIGHER_LAYERS = Object.freeze(["Infrastructure"]);
// An outside `Vendor.Infrastructure.Thing` is still seen.
export const EXTERNAL_SEGMENTS = Object.freeze([...new Set([...DOMAIN_HIGHER_LAYERS, ...APPLICATION_HIGHER_LAYERS])]);

const TOOL_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "dotnet", "Plumb.CSharpFacts");
const TOOL_DLL = ["bin", "Release", "net10.0", "Plumb.CSharpFacts.dll"];
export const TOOL_STAMP = "sources.sha256";
const WRITTEN = Object.freeze(["qualified", "enclosing", "imported", "none"]);

const EMPTY = Object.freeze([]);
// A type's full name is its namespace, containing types, and name joined by `.`. A generic type's name ends in its arity
// (`Box`1`), and a file-local type's (`file class Foo`) carries the compiler's file marker (`<A>F3C…__Foo`, a hash of the
// file's path), so a file-local type is its own type beside a public one of the same name. displayName drops both, and
// the marker never reaches a message.
const FILE_MARKER = /<[^<>]*>F[0-9A-F]+__/;
const FILE_MARKERS = new RegExp(FILE_MARKER, "g");
const displayName = (fullName) => fullName.replace(/`\d+/g, "").replace(FILE_MARKERS, "");
// Whether the type, or a type containing it, is file-local.
export const isFileLocalName = (fullName) => FILE_MARKER.test(fullName);

// The installed SDK versions, or null when there is no `dotnet`.
function listSdks() {
  const result = spawnSync("dotnet", ["--list-sdks"], { encoding: "utf8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout.split("\n").map((line) => line.match(/^(\d+\.\d+\.\d+\S*)\s/)?.[1]).filter(Boolean);
}

function runProcess(command, args) {
  return spawnSync(command, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

// A SHA-256 (hex) over the tool's compile inputs: every .cs and .csproj under the folder outside bin/ and obj/, in
// ordinal order of their `/`-separated relative paths, each as its path, NUL, its bytes, NUL. `pnpm build:csharp`
// writes it beside the DLL; the tool counts as built when the two match, so an edited or deleted source is stale and
// an unrelated file in the folder is not.
export function toolSourceHash(folder) {
  const sources = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "bin" && entry.name !== "obj") walk(full);
      } else if (entry.name.endsWith(".cs") || entry.name.endsWith(".csproj")) {
        sources.push(path.relative(folder, full).split(path.sep).join("/"));
      }
    }
  };
  walk(folder);
  const hash = createHash("sha256");
  for (const relative of sources.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) {
    hash.update(relative).update("\0").update(fs.readFileSync(path.join(folder, ...relative.split("/")))).update("\0");
  }
  return hash.digest("hex");
}

// The tool opens each project's whole reference closure and skips a passed project that an earlier one already opened, so a
// project goes after every passed project that references it, directly or not (an app before the tests that reference it, not
// after), and is opened once. Projects that reference one another in no order stay in path order.
function referrersFirst(paths, dotnetProjects) {
  const reaches = new Map(paths.map((project) => [project, new Set(dotnetProjects.referencedProjects(project).map((referenced) => referenced.path))]));
  const remaining = [...paths];
  const ordered = [];
  while (remaining.length) {
    // A reference cycle is no valid project graph, and leaves the first remaining project to go next.
    const next = remaining.findIndex((candidate) => !remaining.some((other) => other !== candidate && reaches.get(other).has(candidate)));
    ordered.push(...remaining.splice(Math.max(next, 0), 1));
  }
  return ordered;
}

function emptyFacts(available) {
  return Object.freeze({
    available,
    projects: EMPTY,
    types: new Map(),
    tables: EMPTY,
    snapshotTables: EMPTY,
    defaultSchemas: EMPTY,
    partsOf: () => EMPTY,
    displayName,
    usings: () => EMPTY,
    references: () => EMPTY,
    hasFacts: () => false,
    derivesFrom: (typeName, fullName) => typeName === fullName,
    outsideBaseClasses: () => EMPTY,
  });
}

// What the C# compiler says about the repository's code, asked of Roslyn through dotnet/Plumb.CSharpFacts (one run per
// scan, on first use). `run`, `dotnet` (the installed SDK versions, or null), and `toolFolder` stand in for the real
// process, SDK lookup, and tool build in tests, as the frontend analysis takes its loader.
export function createCSharpFacts({
  root,
  files,
  repositoryFiles,
  dotnetProjects,
  diagnostic,
  run = runProcess,
  dotnet = listSdks,
  toolFolder = TOOL_FOLDER,
  prefixes = EXTERNAL_PREFIXES,
  segments = EXTERNAL_SEGMENTS,
}) {
  const csharpFiles = files.filter((file) => file.path.endsWith(".cs"));
  const fileByPath = new Map(files.map((file) => [file.path, file]));

  const toPass = new Set();
  for (const file of csharpFiles) {
    const project = dotnetProjects.nearestProject(file);
    if (project) toPass.add(project.path);
  }
  if (toPass.size === 0) return emptyFacts(true);

  const versions = dotnet();
  if (!versions || !versions.some((version) => Number.parseInt(version, 10) === 10)) {
    diagnostic("plumb: .NET 10 SDK not found — C# facts rules skipped (install the .NET 10 SDK)");
    return emptyFacts(false);
  }

  const dll = path.join(toolFolder, ...TOOL_DLL);
  let built = false;
  try {
    fs.statSync(dll);
    built = fs.readFileSync(path.join(path.dirname(dll), TOOL_STAMP), "utf8") === toolSourceHash(toolFolder);
  } catch { built = false; }
  if (!built) {
    diagnostic("plumb: C# facts tool not built — C# facts rules skipped (run pnpm build:csharp in the plumb folder)");
    return emptyFacts(false);
  }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-csharp-facts-"));
  let raw;
  try {
    const out = path.join(scratch, "facts.json");
    // The tool skips what a build generates, and has to know what in a build's folders is the repository's own.
    const repoFiles = path.join(scratch, "repo-files.txt");
    fs.writeFileSync(repoFiles, repositoryFiles.map((file) => file.path).filter((file) => file.endsWith(".cs")).join("\n"));
    const args = [dll, "--root", root, "--out", out, "--repo-files", repoFiles];
    for (const prefix of prefixes) args.push("--external", prefix);
    for (const segment of segments) args.push("--external-segment", segment);
    args.push(...referrersFirst([...toPass].sort(), dotnetProjects));
    const result = run("dotnet", args);
    if (result.error || result.status !== 0) {
      const reason = result.error ? result.error.message : (result.stderr ?? "").split("\n").find((line) => line.trim()) ?? "";
      diagnostic(`plumb: C# facts tool failed (${result.error ? "no exit code" : result.status ?? `signal ${result.signal}`}: ${reason.trim()})`);
      return emptyFacts(false);
    }
    try {
      raw = JSON.parse(fs.readFileSync(out, "utf8"));
    } catch {
      diagnostic(`plumb: C# facts tool failed (${result.status}: unreadable output)`);
      return emptyFacts(false);
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  const strings = raw.strings;
  const str = (index) => (index < 0 ? null : strings[index]);
  const asFile = (filePath) => fileByPath.get(filePath) ?? Object.freeze({ path: filePath, name: path.posix.basename(filePath), directory: path.posix.dirname(filePath) === "." ? "" : path.posix.dirname(filePath) });
  // A fact's line, from the offset the tool gave and the file's own line map; null for a file outside the inventory.
  const lineOf = (filePath, offset) => (fileByPath.has(filePath) ? fileByPath.get(filePath).lineMap().lineAt(offset) : null);

  const projectList = Object.freeze(raw.projects.map((entry) => Object.freeze({ path: entry.path, loaded: entry.loaded, messages: Object.freeze([...entry.messages]) })));
  for (const entry of projectList) {
    if (entry.messages.length) diagnostic(`plumb: C# facts incomplete for ${entry.path}: ${(entry.messages[0] ?? "").replace(/\s+/g, " ").trim()}`);
  }

  const documents = new Set(raw.documents.map(str));

  const types = new Map();
  for (const entry of raw.types) {
    const name = str(entry.name);
    const parts = entry.parts.map(([file, start, end, declaredUnder]) => {
      const filePath = str(file);
      return Object.freeze({
        file: asFile(filePath),
        line: lineOf(filePath, start),
        endLine: lineOf(filePath, Math.max(start, end - 1)),
        start,
        end,
        assembly: str(entry.assembly),
        // The target frameworks a multi-target project declares it under, in the project's order; none for a single-target
        // project's.
        frameworks: declaredUnder ? Object.freeze(declaredUnder.map(str)) : EMPTY,
      });
    });
    const known = types.get(name);
    if (known) {
      known.parts.push(...parts);
      for (const base of entry.baseTypes.map(str)) if (!known.baseTypes.includes(base)) known.baseTypes.push(base);
    } else {
      types.set(name, { name, kind: entry.kind, namespace: str(entry.namespace), containing: str(entry.containing), access: entry.access, baseTypes: entry.baseTypes.map(str), parts });
    }
  }
  for (const entry of types.values()) {
    Object.freeze(entry.parts);
    Object.freeze(entry.baseTypes);
    Object.freeze(entry);
  }

  // The outside types the tool recorded, with their bases. They stay apart from `types`, which is the repository's own.
  const outsideBases = new Map();
  const outsideClasses = new Map();
  for (const entry of raw.outsideTypes) {
    const name = str(entry.name);
    const known = outsideBases.get(name) ?? new Set();
    for (const base of entry.baseTypes) known.add(str(base));
    outsideBases.set(name, known);
    outsideClasses.set(name, Object.freeze(entry.baseClasses.map(str)));
  }

  const bySort = (left, right) => left.start - right.start;
  const usingsByFile = new Map();
  for (const entry of raw.usings) {
    const filePath = str(entry.file);
    const fact = Object.freeze({
      file: asFile(filePath),
      line: lineOf(filePath, entry.start),
      start: entry.start,
      global: entry.global,
      static: entry.static,
      alias: str(entry.alias),
      target: str(entry.target),
      targetKind: entry.targetKind,
      type: str(entry.type),
      assembly: str(entry.assembly),
      // The types inside a type target (a type argument, an array element, a tuple element, a nullable's underlying type).
      arguments: entry.arguments ? Object.freeze(entry.arguments.map(([type, assembly]) => Object.freeze({ type: str(type), assembly: str(assembly) }))) : EMPTY,
    });
    if (!usingsByFile.has(filePath)) usingsByFile.set(filePath, []);
    usingsByFile.get(filePath).push(fact);
  }
  for (const list of usingsByFile.values()) { list.sort(bySort); Object.freeze(list); }

  // References are many; their lines are worked out when a file's are first asked for.
  const rawReferences = new Map(raw.references.map(([file, rows]) => [str(file), rows]));
  const referenceCache = new Map();
  const referencesOf = (filePath) => {
    if (!referenceCache.has(filePath)) {
      const list = (rawReferences.get(filePath) ?? []).map((row) => {
        const [start, end, from, fromMember, to, assembly, member, written, qualifier, external, namespace] = row;
        return Object.freeze({
          file: asFile(filePath),
          line: lineOf(filePath, start),
          start,
          end,
          from: str(from),
          fromMember: str(fromMember),
          to: str(to),
          assembly: str(assembly),
          member: str(member),
          written: WRITTEN[written],
          qualifier: qualifier === 1,
          external: external === 1,
          namespace: str(namespace),
        });
      }).sort(bySort);
      referenceCache.set(filePath, Object.freeze(list));
    }
    return referenceCache.get(filePath);
  };

  const mapped = (rows, shape) => Object.freeze(rows.map((entry) => {
    const filePath = str(entry.file);
    return Object.freeze({ file: asFile(filePath), line: lineOf(filePath, entry.start), start: entry.start, ...shape(entry) });
  }));
  const tables = mapped(raw.tables, (entry) => ({ method: entry.method, schema: str(entry.schema), table: str(entry.table) }));
  const snapshotTables = mapped(raw.snapshotTables, (entry) => ({ entity: str(entry.entity), method: entry.method, schema: str(entry.schema), table: str(entry.table) }));
  const defaultSchemas = mapped(raw.defaultSchemas, (entry) => ({ schema: str(entry.schema) }));

  const pathOf = (file) => (typeof file === "string" ? file : file.path);
  return Object.freeze({
    available: true,
    projects: projectList,
    types,
    tables,
    snapshotTables,
    defaultSchemas,
    // The parts of the type a reference or a using names, in the assembly the compiler bound it to.
    partsOf(fact) {
      const entry = types.get(fact.to ?? fact.type);
      return entry ? Object.freeze(entry.parts.filter((part) => part.assembly === fact.assembly)) : EMPTY;
    },
    displayName,
    usings: (file) => usingsByFile.get(pathOf(file)) ?? EMPTY,
    references: (file) => referencesOf(pathOf(file)),
    hasFacts: (file) => documents.has(pathOf(file)),
    // Whether the type is, or has among its base classes and interfaces, the named type: a repository type by its own
    // facts, an outside type by the bases the tool recorded for it.
    derivesFrom: (typeName, fullName) => typeName === fullName || (types.get(typeName)?.baseTypes.includes(fullName) ?? false) || (outsideBases.get(typeName)?.has(fullName) ?? false),
    // The base classes of an outside type the tool recorded, nearest first, without the interfaces it implements;
    // none for any other type.
    outsideBaseClasses: (typeName) => outsideClasses.get(typeName) ?? EMPTY,
  });
}
