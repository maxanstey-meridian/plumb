// C# type-name resolution over the scanned sources, in the compiler's lookup order: enclosing types, then each
// enclosing namespace from the innermost out, each level's own members before the aliases and then the usings
// written in that namespace declaration; the top-of-file usings and the project's global usings come last,
// with the global namespace. Names are matched without generic arity.

const freeze = (value) => Object.freeze(value);
const MODIFIERS = new Set(["public", "private", "protected", "internal", "static", "sealed", "abstract", "partial", "readonly", "ref", "unsafe", "file", "new"]);
const DECLARATION = /\bnamespace\s+([A-Za-z_][\w.]*)\s*([;{])?|\b(class|struct|interface|enum|record(?:\s+(?:class|struct))?)\s+([A-Za-z_]\w*)|[{};]/g;
// `[global] using [static] [Alias =] Target;` anywhere: several on one line, one split over lines, a generic
// or array alias target. `using var x = …;` and `using (…)` are statements, not directives, and never match.
const USING = /(?<![\w@.])(global\s+)?using\s+(static\s+)?(?:([A-Za-z_]\w*)\s*=\s*)?((?:global\s*::\s*)?[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*(?:\s*<[^;{}]*>)?(?:\s*\?)?(?:\s*\[[\s,]*\](?:\s*\?)?)*)\s*;/g;
// A written name (`Name`, `A.B.Name`, `global::A.B.Name`) that is not a member access (`x.Name`, `x?.Name`); a
// spread's or range's `..` is no member access (`[.. Name]`).
const REFERENCE = /(?<![\w@]|(?<!\.)\.\s*)(global\s*::\s*)?[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*/g;
// An opening tag's attributes; quoted values may hold `>`.
const ATTRIBUTES = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)`;
const ITEM_GROUP = new RegExp(String.raw`<ItemGroup\b${ATTRIBUTES}(?<!/)>([\s\S]*?)</ItemGroup>`, "g");
const USING_ITEM = new RegExp(String.raw`<Using\b${ATTRIBUTES}>`, "g");
const join = (left, right) => left ? `${left}.${right}` : right;
const AMBIGUOUS = Symbol("ambiguous");
// An alias whose target the scan doesn't declare: the name is bound, just not to anything plumb can read.
const OUTSIDE = Symbol("outside");

// A type keyword only declares a type after a modifier, an attribute or the start of a member; `var record in`,
// `where T : class` and `Order record` are not declarations. A preprocessor line (`#nullable enable`) ends one;
// a keyword on the preprocessor line itself (`#region Response record types`) is not code.
function declares(masked, index) {
  if (/^[ \t]*#/.test(masked.slice(masked.lastIndexOf("\n", index - 1) + 1, index))) return false;
  const before = masked.slice(Math.max(0, index - 200), index).trimEnd();
  if (!before || /[;{}\]]$/.test(before) || /^[ \t]*#/.test(before.slice(before.lastIndexOf("\n") + 1))) return true;
  return MODIFIERS.has(before.match(/([A-Za-z_]\w*)$/)?.[1]);
}

// Where a type declaration whose keyword sits at `offset` starts, and its modifiers in source order: before its
// modifiers and its attribute sections, so `[Produces(typeof(X))] public sealed class` starts at the `[`. An
// assembly or module attribute belongs to the file, not to the type after it.
function declarationHead(masked, offset) {
  const modifiers = [];
  let start = offset;
  for (;;) {
    let index = start;
    while (index > 0 && /\s/.test(masked[index - 1])) index--;
    let word = index;
    while (word > 0 && /\w/.test(masked[word - 1])) word--;
    if (word < index && MODIFIERS.has(masked.slice(word, index)) && masked[word - 1] !== "@") { modifiers.unshift(masked.slice(word, index)); start = word; continue; }
    if (masked[index - 1] !== "]") return { start, modifiers };
    let open = index - 1;
    for (let depth = 0; open >= 0; open--) {
      if (masked[open] === "]") depth++;
      else if (masked[open] === "[" && !--depth) break;
    }
    if (open < 0 || /^\[\s*(?:assembly|module)\s*:/.test(masked.slice(open, index))) return { start, modifiers };
    start = open;
  }
}

// The type declarations, named scopes (namespaces and type bodies, with offset ranges), declared-name offsets
// (each type name and namespace segment) and declaration ranges (see csharpDeclarations) of one masked file.
function scanFile(masked) {
  const types = [], scopes = [], stack = [], declared = new Set(), ranges = [];
  let fileNamespace = "", pending = null;
  const namespaceBase = () => stack.findLast((scope) => scope?.kind === "namespace")?.fullName ?? fileNamespace;
  const typeBase = () => stack.findLast(Boolean)?.fullName ?? fileNamespace;
  const open = (scope, start) => { if (scope) { scope.start = start; scopes.push(scope); } stack.push(scope); };
  for (const match of masked.matchAll(DECLARATION)) {
    if (match[1]) {
      const fullName = join(namespaceBase(), match[1]);
      const nameStart = match.index + match[0].indexOf(match[1], "namespace".length);
      for (const segment of match[1].matchAll(/[A-Za-z_]\w*/g)) declared.add(nameStart + segment.index);
      if (match[2] === "{") open({ kind: "namespace", fullName, end: masked.length }, match.index);
      else if (match[2] === ";") { fileNamespace = fullName; scopes.push({ kind: "namespace", fullName, start: match.index, end: masked.length }); }
      pending = null;
    } else if (match[4]) {
      if (!declares(masked, match.index)) continue;
      const fullName = join(typeBase(), match[4]);
      types.push(freeze({ name: match[4], fullName, offset: match.index }));
      declared.add(match.index + match[0].length - match[4].length);
      const { start, modifiers } = declarationHead(masked, match.index);
      const range = { name: match[4], kind: match[3].split(/\s+/)[0], modifiers: freeze(modifiers), start, offset: match.index, end: masked.length, namespace: namespaceBase() };
      ranges.push(range);
      // A type's scope starts at its body: its parameter and base lists don't see its nested types (CS0246).
      pending = { kind: "type", name: match[4], fullName, end: masked.length, range };
    } else if (match[0] === "{") { open(pending, match.index); pending = null; }
    else if (match[0] === ";") { if (pending) pending.range.end = match.index + 1; pending = null; }
    else { const scope = stack.pop(); if (scope) { scope.end = match.index; if (scope.range) scope.range.end = match.index + 1; } }
  }
  return { types, scopes, declared, ranges };
}

// The type declarations of one masked file, nested ones included, in source order (of their keywords, so a nested
// type follows the type around it): `name`, `kind` (class, struct, interface, enum or record, a record struct
// included), `modifiers` (in source order), `start` (its first attribute or modifier), `offset` (its keyword),
// `end` (just past its closing `}`, or the `;` of a bodyless record) and `namespace` (the full name of the
// innermost namespace around it, "" for the global one). A declaration's range holds its
// attributes, parameter list and base list, which its scope (see enclosingTypes) does not. Also each namespace
// declaration's `fullName` and offset range, outermost first; a file-scoped one runs to the end of the file.
export function csharpDeclarations(masked) {
  const { scopes, ranges } = scanFile(masked);
  return freeze({
    types: freeze(ranges.map((range) => freeze({ ...range }))),
    namespaces: freeze(scopes.filter((scope) => scope.kind === "namespace").map(({ fullName, start, end }) => freeze({ fullName, start, end }))),
  });
}

// Every `using` directive of one masked C# file: global or not, static or not, its alias, its target (whitespace
// and `global::` removed, generic arguments kept), its source text without the `;`, and its offset range.
export function csharpUsings(masked) {
  return freeze([...masked.matchAll(USING)].map((match) => freeze({
    global: Boolean(match[1]),
    static: Boolean(match[2]),
    alias: match[3] ?? null,
    target: match[4].replace(/\s+/g, "").replace(/^global::/, ""),
    text: match[0].slice(0, -1).replace(/\s+/g, " ").trim(),
    offset: match.index,
    end: match.index + match[0].length,
  })));
}

// A Condition only test projects meet: `'$(IsTestProject)' == 'true'`, either way round, `true` quoted or not.
function testOnlyCondition(attributes) {
  const condition = attributes.match(/\bCondition\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  const value = (condition?.[1] ?? condition?.[2] ?? "").replace(/\s+/g, "");
  return /^(?:'\$\(IsTestProject\)'=='?true'?|'?true'?=='\$\(IsTestProject\)')$/i.test(value);
}

// Every <Using Include> in the ItemGroups of a project or props file, one entry per `;`-separated value: the
// value as written, its target without `global::`, Alias, Static="true", whether the group's or the item's
// Condition limits it to test projects, and the item's offset. Comments are skipped; <ItemGroup /> has no body.
export function projectUsings(xml) {
  const text = xml.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
  const result = [];
  for (const group of text.matchAll(ITEM_GROUP)) {
    const body = group.index + group[0].length - group[2].length - "</ItemGroup>".length;
    for (const item of group[2].matchAll(USING_ITEM)) {
      const attribute = (name) => {
        const match = item[1].match(new RegExp(String.raw`\b${name}\s*=\s*(?:"([^"]*)"|'([^']*)')`));
        return match ? match[1] ?? match[2] : undefined;
      };
      const include = attribute("Include");
      if (!include) continue;
      const testOnly = testOnlyCondition(group[1]) || testOnlyCondition(item[1]);
      const alias = attribute("Alias") ?? null, isStatic = /^true$/i.test(attribute("Static") ?? "");
      for (const value of include.split(";").map((part) => part.trim()).filter(Boolean)) {
        result.push(freeze({ include: value, target: value.replace(/^global::/, ""), alias, static: isStatic, testOnly, offset: body + item.index }));
      }
    }
  }
  return freeze(result);
}

// `usings(file)` and `projectUsings(file)` are the analysis's cached parses; `isTestProject(project)` says
// whether `$(IsTestProject)` is true for it, so test-only <Using> items reach only test projects.
export function createTypeResolver({ csharpFiles, mask, usings, projectUsings: projectUsingsOf, isTestProject, nearestProject, referencedProjects, propsFor }) {
  const byFullName = new Map(), scanned = new Map(), globalCache = new Map(), visibleCache = new Map();
  for (const file of csharpFiles) {
    const masked = mask(file);
    const { types, scopes, declared } = scanFile(masked);
    // Each directive belongs to the innermost namespace declaration it's written in, or to the file (null).
    const namespaces = scopes.filter((scope) => scope.kind === "namespace");
    const scoped = usings(file).filter((using) => !using.static).map((using) => freeze({
      ...using, scope: namespaces.findLast((scope) => scope.start <= using.offset && using.offset < scope.end) ?? null,
    }));
    scanned.set(file.path, { scopes, declared, usings: scoped });
    for (const type of types) {
      const declaration = freeze({ ...type, file });
      if (!byFullName.has(type.fullName)) byFullName.set(type.fullName, []);
      byFullName.get(type.fullName).push(declaration);
    }
  }

  // Global usings reach every file of their project: `global using` in its sources and <Using> items in its
  // .csproj and nearest Directory.Build.props (test-only ones for test projects only).
  const globalUsings = (project) => {
    const key = project?.path ?? "";
    if (!globalCache.has(key)) {
      const found = [];
      for (const file of csharpFiles) {
        if ((nearestProject(file)?.path ?? "") !== key) continue;
        found.push(...scanned.get(file.path).usings.filter((using) => using.global));
      }
      if (project) {
        const testProject = isTestProject(project);
        for (const file of [project.file, ...propsFor(project)]) {
          found.push(...projectUsingsOf(file).filter((using) => !using.static && (testProject || !using.testOnly)));
        }
      }
      globalCache.set(key, found);
    }
    return globalCache.get(key);
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

  // The named scopes around `offset`, outermost first.
  const enclosing = (file, offset) => (scanned.get(file.path)?.scopes ?? [])
    .filter((scope) => scope.start <= offset && offset < scope.end)
    .sort((left, right) => left.start - right.start);

  // One full lookup against the declarations `visible` allows: a match, null, AMBIGUOUS between usings, or
  // OUTSIDE for an alias bound to a type the scan doesn't declare (under `visibleOnly`, that target's name with no
  // declarations instead). An alias names its target wherever the scan declares it, visible or not.
  function lookup(name, file, offset, project, visible, visibleOnly) {
    const found = (fullName, among = visible) => {
      const declarations = declarationsOf(fullName, among);
      return declarations ? freeze({ fullName, declarations: freeze(declarations) }) : null;
    };
    if (name.startsWith("global::")) return found(name.slice("global::".length));

    const scopes = enclosing(file, offset);
    for (const scope of scopes.filter((value) => value.kind === "type").reverse()) {
      const match = found(join(scope.fullName, name));
      if (match) return match;
    }
    const [head, ...rest] = name.split(".");
    // One level's directives: an alias binds the name for good (a closed generic `Page<OrderDto>`, a nullable or
    // an array names the element's generic type); otherwise the usings that bring it in, two of them ambiguous.
    const throughUsings = (directives) => {
      const alias = directives.find((using) => using.alias === head);
      if (alias) {
        const target = [alias.target.replace(/[<[?].*$/, ""), ...rest].join(".");
        return found(target) ?? found(target, null) ?? (visibleOnly ? freeze({ fullName: target, declarations: freeze([]) }) : OUTSIDE);
      }
      const imported = new Map();
      for (const using of directives) {
        if (using.alias) continue;
        const match = found(join(using.target, name));
        if (match) imported.set(match.fullName, match);
      }
      return imported.size > 1 ? AMBIGUOUS : [...imported.values()][0] ?? null;
    };
    const fileUsings = scanned.get(file.path)?.usings ?? [];
    const namespaces = scopes.filter((scope) => scope.kind === "namespace");
    const innermost = namespaces.at(-1)?.fullName ?? "";
    const parts = innermost ? innermost.split(".") : [];
    for (let length = parts.length; length >= 0; length--) {
      const level = parts.slice(0, length).join(".");
      const match = found(join(level, name));
      if (match) return match;
      // A level's own members win over its directives (CS0576 only fires when both bind the name).
      const directives = length
        ? fileUsings.filter((using) => namespaces.includes(using.scope) && using.scope.fullName === level)
        : [...fileUsings.filter((using) => !using.global && !using.scope), ...globalUsings(project)];
      const bound = throughUsings(directives);
      if (bound) return bound;
    }
    return null;
  }

  // The type a written name (`OrderDto`, `Orders.OrderDto`, `Wire.OrderDto`, `global::App.OrderDto`) refers to
  // at `offset` in `file`: { fullName, declarations } (partial parts, or one name declared in several
  // projects), or null when it's outside the scan or ambiguous between usings. The referrer's project and
  // the projects it references decide first; only a name none of them declares falls back to the whole scan,
  // unless `visibleOnly`: then a type counts only where it's declared in a project the file compiles against, and
  // an alias still names its target (with no declarations when the scan has none), so a caller can tell whose it is.
  function resolve(written, file, offset, { visibleOnly = false } = {}) {
    const name = written.replace(/\s+/g, "");
    const project = nearestProject(file);
    const visible = visibleProjects(project);
    let match = lookup(name, file, offset, project, visible, visibleOnly);
    if (match === null && visible && !visibleOnly) match = lookup(name, file, offset, project, null);
    return match === AMBIGUOUS || match === OUTSIDE ? null : match;
  }

  // The short names of the types whose bodies contain `offset`, outermost first. A type's scope starts at its
  // body `{`, so its own parameter and base lists are outside it.
  const enclosingTypes = (file, offset) => freeze(enclosing(file, offset).filter((scope) => scope.kind === "type").map((scope) => scope.name));

  // The names written in `file` that may refer to a type, one entry per segment of a dotted name: `name` (the
  // segment), `written` (the name up to and including it, as resolve() takes it) and its offset. Member
  // accesses (`x.Name`) and the names a type or namespace declaration introduces are left out.
  function references(file) {
    const { declared } = scanned.get(file.path);
    const result = [];
    for (const match of mask(file).matchAll(REFERENCE)) {
      const qualifier = match[1] ? "global::" : "", start = match.index + (match[1]?.length ?? 0), names = [];
      for (const segment of match[0].slice(match[1]?.length ?? 0).matchAll(/[A-Za-z_]\w*/g)) {
        names.push(segment[0]);
        const offset = start + segment.index;
        if (!declared.has(offset)) result.push(freeze({ name: segment[0], written: qualifier + names.join("."), offset }));
      }
    }
    return freeze(result);
  }

  return freeze({ resolve, enclosingTypes, references });
}
