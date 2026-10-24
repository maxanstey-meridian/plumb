// C# type-name resolution over the scanned sources, in the compiler's lookup order: enclosing types, then the
// enclosing namespace and each parent, then the file's usings plus the project's global usings. Names are
// matched without generic arity. Directives inside a block namespace are treated as file-wide.

const freeze = (value) => Object.freeze(value);
const MODIFIERS = new Set(["public", "private", "protected", "internal", "static", "sealed", "abstract", "partial", "readonly", "ref", "unsafe", "file", "new"]);
const DECLARATION = /\bnamespace\s+([A-Za-z_][\w.]*)\s*([;{])?|\b(class|struct|interface|enum|record(?:\s+(?:class|struct))?)\s+([A-Za-z_]\w*)|[{};]/g;
const USING = /^[ \t]*(global\s+)?using\s+(static\s+)?(?:([A-Za-z_]\w*)\s*=\s*)?(?:global::)?([A-Za-z_][\w.]*)\s*;/gm;
const join = (left, right) => left ? `${left}.${right}` : right;
const AMBIGUOUS = Symbol("ambiguous");

// A type keyword only declares a type after a modifier, an attribute or the start of a member; `var record in`,
// `where T : class` and `Order record` are not declarations. A preprocessor line (`#nullable enable`) ends one;
// a keyword on the preprocessor line itself (`#region Response record types`) is not code.
function declares(masked, index) {
  if (/^[ \t]*#/.test(masked.slice(masked.lastIndexOf("\n", index - 1) + 1, index))) return false;
  const before = masked.slice(Math.max(0, index - 200), index).trimEnd();
  if (!before || /[;{}\]]$/.test(before) || /^[ \t]*#/.test(before.slice(before.lastIndexOf("\n") + 1))) return true;
  return MODIFIERS.has(before.match(/([A-Za-z_]\w*)$/)?.[1]);
}

// The type declarations and named scopes (namespaces and type bodies, with offset ranges) of one masked file.
function scanFile(masked) {
  const types = [], scopes = [], stack = [];
  let fileNamespace = "", pending = null;
  const namespaceBase = () => stack.findLast((scope) => scope?.kind === "namespace")?.fullName ?? fileNamespace;
  const typeBase = () => stack.findLast(Boolean)?.fullName ?? fileNamespace;
  const open = (scope, start) => { if (scope) { scope.start = start; scopes.push(scope); } stack.push(scope); };
  for (const match of masked.matchAll(DECLARATION)) {
    if (match[1]) {
      const fullName = join(namespaceBase(), match[1]);
      if (match[2] === "{") open({ kind: "namespace", fullName, end: masked.length }, match.index);
      else if (match[2] === ";") { fileNamespace = fullName; scopes.push({ kind: "namespace", fullName, start: match.index, end: masked.length }); }
      pending = null;
    } else if (match[4]) {
      if (!declares(masked, match.index)) continue;
      const fullName = join(typeBase(), match[4]);
      types.push(freeze({ name: match[4], fullName, offset: match.index }));
      // A type's scope starts at its body: its parameter and base lists don't see its nested types (CS0246).
      pending = { kind: "type", fullName, end: masked.length };
    } else if (match[0] === "{") { open(pending, match.index); pending = null; }
    else if (match[0] === ";") pending = null;
    else { const scope = stack.pop(); if (scope) scope.end = match.index; }
  }
  return { types, scopes };
}

// `using` directives of one masked file: namespaces, aliases, and whether each is global.
function usingsOf(masked) {
  const result = [];
  for (const match of masked.matchAll(USING)) {
    if (match[2]) continue;
    result.push({ global: Boolean(match[1]), alias: match[3] ?? null, target: match[4] });
  }
  return result;
}

// <Using Include="X" [Alias="Y"] /> items in a project or props file; Static="true" items import members only.
function projectUsingsOf(xml) {
  const result = [];
  for (const match of xml.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<Using\b([^>]*)>/g)) {
    const attribute = (name) => match[1].match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`))?.[1];
    const include = attribute("Include");
    if (!include || /^true$/i.test(attribute("Static") ?? "")) continue;
    result.push({ global: true, alias: attribute("Alias") ?? null, target: include.replace(/^global::/, "") });
  }
  return result;
}

export function createTypeResolver({ csharpFiles, mask, nearestProject, referencedProjects, propsFor }) {
  const byFullName = new Map(), scanned = new Map(), projectUsings = new Map(), visibleCache = new Map();
  for (const file of csharpFiles) {
    const masked = mask(file);
    const { types, scopes } = scanFile(masked);
    scanned.set(file.path, { scopes, usings: usingsOf(masked) });
    for (const type of types) {
      const declaration = freeze({ ...type, file });
      if (!byFullName.has(type.fullName)) byFullName.set(type.fullName, []);
      byFullName.get(type.fullName).push(declaration);
    }
  }

  // Global usings reach every file of their project: `global using` in its sources and <Using> items in its
  // .csproj and nearest Directory.Build.props.
  const globalUsings = (project) => {
    const key = project?.path ?? "";
    if (!projectUsings.has(key)) {
      const usings = [];
      for (const file of csharpFiles) {
        if ((nearestProject(file)?.path ?? "") !== key) continue;
        usings.push(...scanned.get(file.path).usings.filter((using) => using.global));
      }
      if (project) for (const file of [project.file, ...propsFor(project)]) usings.push(...projectUsingsOf(file.text()));
      projectUsings.set(key, usings);
    }
    return projectUsings.get(key);
  };

  // The projects a file compiles against: its own and those it references. A scan with no projects sees all.
  const visibleProjects = (project) => {
    if (!project) return null;
    if (!visibleCache.has(project.path)) visibleCache.set(project.path, new Set([project.path, ...referencedProjects(project).map((value) => value.path)]));
    return visibleCache.get(project.path);
  };

  // The declarations of one full name in `visible` projects, or every declaration when `visible` is null.
  const declarationsOf = (fullName, visible) => {
    const all = byFullName.get(fullName);
    if (!all || !visible) return all ?? null;
    const seen = all.filter((declaration) => visible.has(nearestProject(declaration.file)?.path));
    return seen.length ? seen : null;
  };

  // One full lookup against the declarations `visible` allows: a match, null, or AMBIGUOUS between usings.
  function lookup(name, file, offset, project, visible) {
    const found = (fullName) => {
      const declarations = declarationsOf(fullName, visible);
      return declarations ? freeze({ fullName, declarations: freeze(declarations) }) : null;
    };
    if (name.startsWith("global::")) return found(name.slice("global::".length));

    const { scopes, usings: fileUsings } = scanned.get(file.path) ?? { scopes: [], usings: [] };
    const usings = [...fileUsings.filter((using) => !using.global), ...globalUsings(project)];
    const [head, ...rest] = name.split(".");
    const alias = usings.find((using) => using.alias === head);
    if (alias) return found([alias.target, ...rest].join("."));

    const enclosing = scopes.filter((scope) => scope.start <= offset && offset < scope.end).sort((left, right) => left.start - right.start);
    for (const scope of enclosing.filter((value) => value.kind === "type").reverse()) {
      const match = found(join(scope.fullName, name));
      if (match) return match;
    }
    const namespace = enclosing.findLast((scope) => scope.kind === "namespace")?.fullName ?? "";
    const parts = namespace ? namespace.split(".") : [];
    for (let length = parts.length; length >= 0; length--) {
      const match = found(join(parts.slice(0, length).join("."), name));
      if (match) return match;
    }
    const imported = new Map();
    for (const using of usings) {
      if (using.alias) continue;
      const match = found(join(using.target, name));
      if (match) imported.set(match.fullName, match);
    }
    return imported.size > 1 ? AMBIGUOUS : [...imported.values()][0] ?? null;
  }

  // The type a written name (`OrderDto`, `Orders.OrderDto`, `Wire.OrderDto`, `global::App.OrderDto`) refers to
  // at `offset` in `file`: { fullName, declarations } (partial parts, or one name declared in several
  // projects), or null when it's outside the scan or ambiguous between usings. The referrer's project and
  // the projects it references decide first; only a name none of them declares falls back to the whole scan.
  function resolve(written, file, offset) {
    const name = written.replace(/\s+/g, "");
    const project = nearestProject(file);
    const visible = visibleProjects(project);
    let match = lookup(name, file, offset, project, visible);
    if (match === null && visible) match = lookup(name, file, offset, project, null);
    return match === AMBIGUOUS ? null : match;
  }

  return freeze({ resolve });
}
