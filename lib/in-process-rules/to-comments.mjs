import { Capability, createConfigParser, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { isGenerated } from "./helpers.mjs";
import { iniParser } from "./to.mjs";
import { templateComments } from "./vue-template.mjs";

const source = "in-process/to-comments.mjs";
const tsRef = "tools.md#linting-and-formatting";
const csharpRef = "tools.md#formatting-and-analyzers";
const DEFAULT_WIDTH = 100;
const SCRIPT = /\.(?:[cm]?[jt]s)$/;
const SKIPPED_SEGMENTS = new Set(["node_modules", "generated", "Migrations", ".nuxt", ".output", "dist", "bin", "obj", "coverage"]);
const SKIPPED_NAMES = /(?:\.d\.ts|\.Designer\.cs|\.g\.cs|\.min\.js)$/;
const CSHARPIER_CONFIGS = [".csharpierrc", ".csharpierrc.json", ".csharpierrc.yaml", ".csharpierrc.yml"];
const OXFMT_CONFIGS = [".oxfmtrc.json", ".oxfmtrc.jsonc"];
// .editorconfig sections that cover a .cs file: [*], [*.cs], [**/*.cs], [*.{cs,…}].
const CS_SECTION = /^(?:\*|(?:\*\*\/)?\*\.(?:cs|\{(?:[^}]*,)?cs(?:,[^}]*)?\}))$/;

const parentOf = (value) => value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
const skipped = (file) => SKIPPED_NAMES.test(file.name) || file.path.split("/").slice(0, -1).some((segment) => SKIPPED_SEGMENTS.has(segment)) || isGenerated(file);

// CSharpier reads JSON or YAML; only the unindented (top-level) YAML key is the file-wide width.
const csharpierParser = createConfigParser("csharpierrc", (text) => {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/^["']?printWidth["']?\s*:\s*(\d+)\s*(?:#.*)?$/m);
  return match ? { printWidth: Number(match[1]) } : {};
});

// The top-level printWidth of a parsed config; one inside `overrides` only applies to its globs.
const printWidth = (result) => result.ok && Number.isInteger(result.value?.printWidth) && result.value.printWidth > 0 ? result.value.printWidth : DEFAULT_WIDTH;

function nearestConfig(context, directory, names) {
  for (let current = directory; ; current = parentOf(current)) {
    const config = names.map((name) => context.file(current ? `${current}/${name}` : name)).find(Boolean);
    if (config || !current) return config ?? null;
  }
}

// CSharpier falls back to .editorconfig's max_line_length when it has no config of its own.
function editorconfigWidth(context, directory) {
  for (let current = directory; ; current = parentOf(current)) {
    const parsed = context.file(current ? `${current}/.editorconfig` : ".editorconfig")?.config(iniParser);
    if (parsed?.ok) {
      let width;
      for (const [section, values] of Object.entries(parsed.value)) {
        if (CS_SECTION.test(section) && Object.hasOwn(values, "max_line_length")) width = /^\d+$/.test(values.max_line_length) ? Number(values.max_line_length) : DEFAULT_WIDTH;
      }
      if (width !== undefined) return width;
      if (parsed.value[""]?.root === "true") return null;
    }
    if (!current) return null;
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
    const widths = new Map();
    const check = (file, line, number, width, docRef) => {
      if (line.length <= width || unbreakable(line, width)) return;
      context.report({
        severity: "warn",
        path: file.path,
        line: number,
        message: `comment line is ${line.length} characters, past the ${width}-character line width (formatters don't wrap comments) — rewrap it`,
        docRef,
      });
    };

    for (const file of context.csharp.csharpFiles) {
      if (skipped(file)) continue;
      const width = cached(widths, `cs\0${file.directory}`, () => {
        const config = nearestConfig(context, file.directory, CSHARPIER_CONFIGS);
        return config ? printWidth(config.config(csharpierParser)) : editorconfigWidth(context, file.directory) ?? DEFAULT_WIDTH;
      });
      // Only comments are blanked, so a non-empty line that masks to blank is comment and nothing else.
      const masked = context.csharp.mask(file, { keepStrings: true }).split(/\r?\n/);
      file.text().split(/\r?\n/).forEach((line, index) => {
        if (line.trim() && !masked[index]?.trim()) check(file, line, index + 1, width, csharpRef);
      });
    }

    const frontend = context.files.filter((file) => (file.path.endsWith(".vue") || SCRIPT.test(file.path)) && !skipped(file));
    if (!frontend.length) return;
    const ts = await context.typescript.runtime();
    const jsonc = ts && createConfigParser("jsonc-typescript", (text) => {
      const { config, error } = ts.parseConfigFileTextToJson("oxfmtrc.jsonc", text);
      if (error) throw new Error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
      return config;
    });
    for (const file of frontend) {
      const vue = file.path.endsWith(".vue");
      const width = cached(widths, `ts\0${file.directory}`, () => {
        const config = nearestConfig(context, file.directory, OXFMT_CONFIGS);
        return config ? printWidth(jsonc ? config.config(jsonc) : config.json()) : DEFAULT_WIDTH;
      });
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
