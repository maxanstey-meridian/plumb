import { createRequire } from "node:module";
import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";

const require = createRequire(import.meta.url);
const source = "in-process/to-comments.mjs";
const tsRef = "tools.md#linting-and-formatting";
const csharpRef = "tools.md#formatting-and-analyzers";
const DEFAULT_WIDTH = 100;
const SCRIPT = /\.(?:[cm]?[jt]s)$/;
const SKIPPED_SEGMENTS = new Set(["node_modules", "generated", "Migrations", ".nuxt", ".output", "dist", "bin", "obj", "coverage"]);
const SKIPPED_NAMES = /(?:\.d\.ts|\.Designer\.cs|\.g\.cs|\.min\.js)$/;

const parentOf = (value) => value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
const skipped = (file) => SKIPPED_NAMES.test(file.name) || file.path.split("/").slice(0, -1).some((segment) => SKIPPED_SEGMENTS.has(segment));

// printWidth from the nearest of `names` above the file, else the formatter's default.
function widthFor(context, file, names, cache) {
  const key = `${names[0]}\0${file.directory}`;
  if (!cache.has(key)) {
    let width = DEFAULT_WIDTH;
    for (let directory = file.directory; ; directory = parentOf(directory)) {
      const config = names.map((name) => context.file(directory ? `${directory}/${name}` : name)).find(Boolean);
      if (config) {
        const match = config.text().match(/"?printWidth"?\s*:\s*(\d+)/);
        if (match) width = Number(match[1]);
        break;
      }
      if (!directory) break;
    }
    cache.set(key, width);
  }
  return cache.get(key);
}

// A comment line that's still too wide once wrapped at spaces is one unbreakable token (a URL, a path).
function wrappable(line, width) {
  const indent = line.length - line.trimStart().length;
  const words = line.trim().replace(/^(?:\/\/+|\/\*+|\*+\/?|<!--)\s*/, "").replace(/\s*(?:\*\/|-->)$/, "").split(/\s+/).filter(Boolean);
  return words.length > 1 && words.every((word) => word.length <= width - indent - 4);
}

// Lines of `text` (0-based) that hold only comment, from the TypeScript comment ranges in it.
function commentOnlyLines(ts, sourceFile) {
  const text = sourceFile.text;
  const ranges = new Map();
  const collect = (node) => {
    for (const range of ts.getLeadingCommentRanges(text, node.pos) ?? []) ranges.set(range.pos, range);
    if (node.kind === ts.SyntaxKind.EndOfFileToken) return;
    for (const child of node.getChildren(sourceFile)) collect(child);
  };
  collect(sourceFile);
  const lines = new Set();
  for (const range of ranges.values()) {
    const first = sourceFile.getLineAndCharacterOfPosition(range.pos);
    const last = sourceFile.getLineAndCharacterOfPosition(range.end);
    const lineStart = sourceFile.getPositionOfLineAndCharacter(first.line, 0);
    if (text.slice(lineStart, range.pos).trim()) continue;
    const afterEnd = text.slice(range.end, text.indexOf("\n", range.end) < 0 ? text.length : text.indexOf("\n", range.end));
    for (let line = first.line; line <= last.line; line++) {
      if (line === last.line && afterEnd.trim()) continue;
      lines.add(line);
    }
  }
  return lines;
}

// Formatters keep code to the line width but don't wrap comments, so a reworded comment silently
// overflows until someone rewraps it by hand.
const to015 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-TO-015", source }),
  requirements: [Capability.TYPESCRIPT, Capability.CSHARP],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    const widths = new Map();
    const check = (file, line, number, width, docRef) => {
      if (line.length <= width || !wrappable(line, width)) return;
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
      const width = widthFor(context, file, [".csharpierrc", ".csharpierrc.json", ".csharpierrc.yaml"], widths);
      const masked = context.csharp.mask(file).split(/\r?\n/);
      file.text().split(/\r?\n/).forEach((line, index) => {
        if (/^\s*(?:\/\/|\/\*|\*)/.test(line) && !masked[index]?.trim()) check(file, line, index + 1, width, csharpRef);
      });
    }

    if (!ts) return;
    for (const file of context.files) {
      const vue = file.path.endsWith(".vue");
      if ((!vue && !SCRIPT.test(file.path)) || skipped(file)) continue;
      const width = widthFor(context, file, [".oxfmtrc.json", ".oxfmtrc.jsonc"], widths);
      const fileLines = file.text().split(/\r?\n/);
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
      if (vue) templateComments(file, fileLines, (line, number) => check(file, line, number, width, tsRef));
    }
  },
});

// HTML comment lines inside a Vue file's <template>.
function templateComments(file, fileLines, visit) {
  let template;
  try { template = require("@vue/compiler-sfc").parse(file.text(), { filename: file.path }).descriptor.template; }
  catch { return; }
  if (!template) return;
  let open = false;
  for (let number = template.loc.start.line; number <= template.loc.end.line; number++) {
    const line = fileLines[number - 1] ?? "";
    const startsComment = /^\s*<!--/.test(line);
    if (open || startsComment) visit(line, number);
    if (startsComment || open) open = !line.includes("-->");
  }
}

export const toCommentRules = Object.freeze([to015]);
