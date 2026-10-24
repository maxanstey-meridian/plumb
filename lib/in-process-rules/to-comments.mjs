import { createRequire } from "node:module";
import { Capability, createConfigParser, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { isGenerated } from "./helpers.mjs";
import { templateComments } from "./vue-template.mjs";

const require = createRequire(import.meta.url);
const source = "in-process/to-comments.mjs";
const tsRef = "tools.md#linting-and-formatting";
const csharpRef = "tools.md#formatting-and-analyzers";
const DEFAULT_WIDTH = 100;
const SCRIPT = /\.(?:[cm]?[jt]s)$/;
const SKIPPED_SEGMENTS = new Set(["node_modules", "generated", "Migrations", ".nuxt", ".output", "dist", "bin", "obj", "coverage"]);
const SKIPPED_NAMES = /(?:\.d\.ts|\.Designer\.cs|\.g\.cs|\.min\.js)$/;
const CSHARPIER_CONFIGS = [".csharpierrc", ".csharpierrc.json", ".csharpierrc.yaml", ".csharpierrc.yml"];
const OXFMT_CONFIGS = [".oxfmtrc.json", ".oxfmtrc.jsonc"];

const parentOf = (value) => value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
const relativeTo = (directory, filePath) => directory ? filePath.slice(directory.length + 1) : filePath;
const positive = (value) => Number.isInteger(value) && value > 0 ? value : undefined;
const skipped = (file) => SKIPPED_NAMES.test(file.name) || file.path.split("/").slice(0, -1).some((segment) => SKIPPED_SEGMENTS.has(segment)) || isGenerated(file);

// picomatch and yaml load when the analysis starts, not inside a config parser: the engine reads a
// parser's throw as an unparseable config, which would hide a missing package.
let packages;
const loaded = () => (packages ??= { picomatch: require("picomatch"), yaml: require("yaml") });

// A CSharpier override or .editorconfig section glob as a matcher of paths relative to the config's
// directory, as CSharpier reads both: a glob without "/" matches at any depth, a leading "/" anchors
// it there, a brace set of one item (`*.{cs}`, not a `{1..3}` range) is that item, and `**` crosses
// directories even inside a segment (`**.cs`), which picomatch's own globstar only does as a whole
// segment. `{` and `,` start a segment and `}` and `,` end one; picomatch's `**/` after `{` or `,`
// needs a directory, so it becomes `{,**/}`.
function configGlob(glob) {
  let unwrapped = glob;
  for (let previous; previous !== unwrapped;) {
    previous = unwrapped;
    unwrapped = unwrapped.replace(/\{([^{},]+)\}/g, (set, item) => item.includes("..") ? set : item);
  }
  const anchored = !unwrapped.includes("/") ? `**/${unwrapped}` : unwrapped.startsWith("/") ? unwrapped.slice(1) : unwrapped;
  const opensSet = (at) => at > 0 && "{,".includes(anchored[at - 1]);
  const segment = (at) => (at === 0 || anchored[at - 1] === "/" || opensSet(at)) && "/},".includes(anchored[at + 2] ?? "/");
  const pattern = anchored.replace(/\*\*(\/)?/g, (star, slash = "", at) => {
    if (!segment(at)) return `{*,*/**/*}${slash}`;
    return opensSet(at) && slash ? "{,**/}" : star;
  });
  return loaded().picomatch(pattern, { dot: true });
}

// CSharpier reads a config that starts with "{" as JSON with case-insensitive keys and anything else
// as YAML with camelCase keys. An override's `files` is one glob.
const csharpierParser = createConfigParser("csharpierrc", (text) => {
  const json = text.trimStart().startsWith("{");
  const parsed = json ? JSON.parse(text) : loaded().yaml.parse(text);
  const read = (object, key) => json
    ? Object.entries(object ?? {}).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1]
    : object?.[key];
  const overrides = read(parsed, "overrides");
  return {
    printWidth: read(parsed, "printWidth"),
    overrides: (Array.isArray(overrides) ? overrides : [])
      .filter((entry) => typeof read(entry, "files") === "string")
      .map((entry) => ({ matches: configGlob(read(entry, "files")), printWidth: read(entry, "printWidth") })),
  };
});

// CSharpier takes the last override whose glob matches the file, else the top-level options. A
// matching override replaces them whole: one without printWidth means CSharpier's default, not the
// top-level width.
function csharpierWidth(config, file) {
  const parsed = config.config(csharpierParser);
  if (!parsed.ok) return DEFAULT_WIDTH;
  const relative = relativeTo(config.directory, file.path);
  const override = parsed.value.overrides.findLast((entry) => entry.matches(relative));
  return positive(override ? override.printWidth : parsed.value.printWidth) ?? DEFAULT_WIDTH;
}

// An oxfmt override glob: configGlob's matching, except that a leading "/" never matches and "./"
// anchors the glob at the config's directory.
const oxfmtGlob = (glob) => glob.startsWith("/") ? () => false : configGlob(glob.startsWith("./") ? glob.slice(1) : glob);

// oxfmt's top-level printWidth and its overrides, each a `files` and an `excludeFiles` matcher list
// and the printWidth its options set, if any.
const oxfmtParser = (parse) => createConfigParser("oxfmtrc-widths", (text) => {
  const parsed = parse(text);
  const globs = (value) => (Array.isArray(value) ? value : []).filter((glob) => typeof glob === "string").map(oxfmtGlob);
  return {
    printWidth: parsed?.printWidth,
    overrides: (Array.isArray(parsed?.overrides) ? parsed.overrides : []).map((entry) => ({
      files: globs(entry?.files),
      excludeFiles: globs(entry?.excludeFiles),
      printWidth: entry?.options?.printWidth,
    })),
  };
});

// oxfmt layers the options of every override whose `files` match the file and whose `excludeFiles`
// don't over the top-level options, in array order, so the width comes from the last such override
// that sets printWidth, else the top level. (Unlike CSharpier, a matching override without a
// printWidth keeps the width it layers over.)
function oxfmtWidth(config, parser, file) {
  const parsed = config.config(parser);
  if (!parsed.ok) return DEFAULT_WIDTH;
  const relative = relativeTo(config.directory, file.path);
  const override = parsed.value.overrides.findLast((entry) => entry.printWidth !== undefined
    && entry.files.some((matches) => matches(relative)) && !entry.excludeFiles.some((matches) => matches(relative)));
  return positive(override ? override.printWidth : parsed.value.printWidth) ?? DEFAULT_WIDTH;
}

function nearestConfig(context, directory, names) {
  for (let current = directory; ; current = parentOf(current)) {
    const config = names.map((name) => context.file(current ? `${current}/${name}` : name)).find(Boolean);
    if (config || !current) return config ?? null;
  }
}

// .editorconfig as its root flag and its sections in file order, each a path matcher and the
// max_line_length it sets (keys are case-insensitive). A later section overrides an earlier one even
// when its header repeats, so they can't be merged by name.
const editorconfigParser = createConfigParser("editorconfig-sections", (text) => {
  let root = false;
  const sections = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = line.match(/^\[(.+)\]$/);
    const pair = line.match(/^([^=]+?)\s*=\s*(.*)$/);
    const key = pair?.[1].toLowerCase();
    if (header) sections.push({ matches: configGlob(header[1].trim()), maxLineLength: undefined });
    else if (sections.length && key === "max_line_length") sections.at(-1).maxLineLength = pair[2];
    else if (!sections.length && key === "root") root = pair[2].toLowerCase() === "true";
  }
  return { root, sections };
});

// CSharpier falls back to .editorconfig's max_line_length when it has no config of its own. The
// nearest file with a section that matches this file and sets it wins (its last such section); a
// value that isn't a positive integer (0, off) is ignored, leaving CSharpier's default width. A
// root file ends the search.
function editorconfigWidth(context, file) {
  for (let current = file.directory; ; current = parentOf(current)) {
    const parsed = context.file(current ? `${current}/.editorconfig` : ".editorconfig")?.config(editorconfigParser);
    if (parsed?.ok) {
      const relative = relativeTo(current, file.path);
      const value = parsed.value.sections.findLast((section) => section.maxLineLength !== undefined && section.matches(relative))?.maxLineLength;
      if (value !== undefined) return (/^\d+$/.test(value) && positive(Number(value))) || DEFAULT_WIDTH;
      if (parsed.value.root) return DEFAULT_WIDTH;
    }
    if (!current) return DEFAULT_WIDTH;
  }
}

function cached(cache, key, compute) {
  if (!cache.has(key)) cache.set(key, compute());
  return cache.get(key);
}

// Lines `firstLine..lastLine` of the comment at text[start, end) that hold nothing but comment: the
// first line only if no code precedes it, the last only if no code follows it.
function* ownLines(text, start, end, firstLine, lastLine) {
  const lineStart = text.lastIndexOf("\n", start - 1) + 1;
  const newline = text.indexOf("\n", end);
  const codeBefore = text.slice(lineStart, start).trim() !== "";
  const codeAfter = text.slice(end, newline < 0 ? text.length : newline).trim() !== "";
  for (let line = firstLine; line <= lastLine; line++) {
    if ((line === firstLine && codeBefore) || (line === lastLine && codeAfter)) continue;
    yield line;
  }
}

// True when rewrapping can't fix the line: the overflow sits in its last word and that word (a URL,
// a path) is too wide even on a line of its own. Prose after a long word could still move down.
function unbreakable(line, width) {
  const body = line.replace(/\s*(?:\*\/|-->)\s*$/, "");
  const lastWord = body.search(/\S+$/);
  if (lastWord < 0 || lastWord > width) return false;
  const prefix = line.match(/^\s*(?:\/\/+|\/\*+|\*+|<!--)?\s*/)[0].length;
  return prefix + body.length - lastWord > width;
}

// Lines of `sourceFile` (0-based) that hold only comment, from the TypeScript comment ranges in it.
// Trailing ranges catch a block comment that opens after code and runs on over later lines.
function commentOnlyLines(ts, sourceFile) {
  const text = sourceFile.text;
  const ranges = new Map();
  const collect = (node) => {
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) ranges.set(range.pos, range);
    for (const range of ts.getTrailingCommentRanges(text, node.end) ?? []) ranges.set(range.pos, range);
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    for (const child of node.getChildren(sourceFile)) collect(child);
  };
  collect(sourceFile);
  const lines = new Set();
  for (const range of ranges.values()) {
    const first = sourceFile.getLineAndCharacterOfPosition(range.pos).line;
    const last = sourceFile.getLineAndCharacterOfPosition(range.end).line;
    for (const line of ownLines(text, range.pos, range.end, first, last)) lines.add(line);
  }
  return lines;
}

// Formatters keep code to the line width but don't wrap comments, so a reworded comment silently
// overflows until someone rewraps it by hand.
const to015 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-TO-015", source }),
  requirements: [Capability.TYPESCRIPT, Capability.CSHARP],
  async analyze(context) {
    loaded();
    const configs = new Map();
    const oxfmtConfigs = new Map();
    const check = (file, line, number, width, docRef) => {
      if (line.length <= width || unbreakable(line, width)) return;
      context.report({
        severity: "info",
        path: file.path,
        line: number,
        message: `comment line is ${line.length} characters, past the ${width}-character line width (formatters don't wrap comments) — rewrap it`,
        docRef,
      });
    };

    for (const file of context.csharp.csharpFiles) {
      if (skipped(file)) continue;
      // Overrides and sections match per file, so only the config lookup is shared by a directory.
      const config = cached(configs, file.directory, () => nearestConfig(context, file.directory, CSHARPIER_CONFIGS));
      const width = config ? csharpierWidth(config, file) : editorconfigWidth(context, file);
      // String contents are kept (only their delimiters and escape backslashes are blanked), so a
      // non-empty line that masks to blank holds comment and nothing else.
      const masked = context.csharp.mask(file, { keepStrings: true }).split(/\r?\n/);
      file.text().split(/\r?\n/).forEach((line, index) => {
        if (line.trim() && !masked[index]?.trim()) check(file, line, index + 1, width, csharpRef);
      });
    }

    const frontend = context.files.filter((file) => (file.path.endsWith(".vue") || SCRIPT.test(file.path)) && !skipped(file));
    if (!frontend.length) return;
    const ts = await context.typescript.runtime();
    const oxfmt = oxfmtParser(ts ? (text) => {
      const { config, error } = ts.parseConfigFileTextToJson("oxfmtrc.jsonc", text);
      if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
      return config;
    } : JSON.parse);
    for (const file of frontend) {
      const vue = file.path.endsWith(".vue");
      // Overrides match per file, so only the config lookup is shared by a directory.
      const config = cached(oxfmtConfigs, file.directory, () => nearestConfig(context, file.directory, OXFMT_CONFIGS));
      const width = config ? oxfmtWidth(config, oxfmt, file) : DEFAULT_WIDTH;
      const text = file.text();
      const fileLines = text.split(/\r?\n/);
      if (ts) {
        const representations = vue
          ? (await Promise.all(context.typescript.vueScripts(file).map((block) => context.typescript.vueSource(block)))).filter(Boolean)
          : [await context.typescript.source(file)].filter(Boolean);
        for (const representation of representations) {
          const { sourceFile } = representation;
          for (const line of commentOnlyLines(ts, sourceFile)) {
            const number = vue ? representation.originalLine(sourceFile.getPositionOfLineAndCharacter(line, 0)) : line + 1;
            check(file, fileLines[number - 1] ?? "", number, width, tsRef);
          }
        }
      }
      if (!vue) continue;
      for (const { start, end } of templateComments(context, file)) {
        for (const number of ownLines(text, start.offset, end.offset, start.line, end.line)) check(file, fileLines[number - 1] ?? "", number, width, tsRef);
      }
    }
  },
});

export const toCommentRules = Object.freeze([to015]);
