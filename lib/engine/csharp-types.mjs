// What the text of a masked C# file says by itself: its type and namespace declarations, its `using` directives,
// and a project file's <Using> items. What a name refers to is the compiler's to say (see csharp-facts.mjs).

const freeze = (value) => Object.freeze(value);
const MODIFIERS = new Set(["public", "private", "protected", "internal", "static", "sealed", "abstract", "partial", "readonly", "ref", "unsafe", "file", "new"]);
const DECLARATION = /\bnamespace\s+([A-Za-z_][\w.]*)\s*([;{])?|\b(class|struct|interface|enum|record(?:\s+(?:class|struct))?)\s+([A-Za-z_]\w*)|[{};]/g;
// `[global] using [static] [Alias =] Target;` anywhere: several on one line, one split over lines, a generic
// or array alias target. `using var x = …;` and `using (…)` are statements, not directives, and never match.
const USING = /(?<![\w@.])(global\s+)?using\s+(static\s+)?(?:([A-Za-z_]\w*)\s*=\s*)?((?:global\s*::\s*)?[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*(?:\s*<[^;{}]*>)?(?:\s*\?)?(?:\s*\[[\s,]*\](?:\s*\?)?)*)\s*;/g;
// An opening tag's attributes; quoted values may hold `>`.
const ATTRIBUTES = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)`;
const ITEM_GROUP = new RegExp(String.raw`<ItemGroup\b${ATTRIBUTES}(?<!/)>([\s\S]*?)</ItemGroup>`, "g");
const USING_ITEM = new RegExp(String.raw`<Using\b${ATTRIBUTES}>`, "g");
const join = (left, right) => left ? `${left}.${right}` : right;

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
    // A preprocessor line (`#region private`) is no part of the declaration.
    if (/^[ \t]*#/.test(masked.slice(masked.lastIndexOf("\n", index - 1) + 1, index))) return { start, modifiers };
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

// The namespace scopes (with offset ranges) and type declaration ranges (see csharpDeclarations) of one masked file.
function scanFile(masked) {
  const scopes = [], stack = [], ranges = [];
  let fileNamespace = "", pending = null;
  const namespaceBase = () => stack.findLast((scope) => scope?.kind === "namespace")?.fullName ?? fileNamespace;
  const open = (scope, start) => { if (scope) { scope.start = start; scopes.push(scope); } stack.push(scope); };
  for (const match of masked.matchAll(DECLARATION)) {
    if (match[1]) {
      const fullName = join(namespaceBase(), match[1]);
      if (match[2] === "{") open({ kind: "namespace", fullName, end: masked.length }, match.index);
      else if (match[2] === ";") { fileNamespace = fullName; scopes.push({ kind: "namespace", fullName, start: match.index, end: masked.length }); }
      pending = null;
    } else if (match[4]) {
      if (!declares(masked, match.index)) continue;
      const { start, modifiers } = declarationHead(masked, match.index);
      const outer = stack.findLast((scope) => scope?.kind === "type");
      const range = { name: match[4], kind: match[3].split(/\s+/)[0], modifiers: freeze(modifiers), start, offset: match.index, end: masked.length,
        namespace: namespaceBase(), parent: outer ? ranges.indexOf(outer.range) : -1 };
      ranges.push(range);
      // A type's scope starts at its body: its parameter and base lists don't see its nested types (CS0246).
      pending = { kind: "type", end: masked.length, range };
    } else if (match[0] === "{") { open(pending, match.index); pending = null; }
    else if (match[0] === ";") { if (pending) pending.range.end = match.index + 1; pending = null; }
    else {
      const scope = stack.pop();
      if (!scope) continue;
      scope.end = match.index;
      if (scope.range) scope.range.end = match.index + 1;
    }
  }
  return { scopes, ranges };
}

// The type declarations of one masked file, nested ones included, in source order (of their keywords, so a nested
// type follows the type around it): `name`, `kind` (class, struct, interface, enum or record, a record struct
// included), `modifiers` (in source order), `parent` (the index of the type around it, -1 for a top-level one),
// `start` (its first attribute or modifier), `offset` (its keyword), `end` (just past its closing `}`, or the `;`
// of a bodyless record) and `namespace` (the full name of the innermost namespace around it, "" for the global
// one). A declaration's range holds its attributes, parameter list and base list, which its body does not. Also
// each namespace declaration's `fullName` and offset range, outermost first; a file-scoped one runs to the end of
// the file.
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
