import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const NODE = Object.freeze({ INTERPOLATION: 5, ATTRIBUTE: 6, DIRECTIVE: 7 });

let compiler;
let compilerLoaded = false;
const loadCompiler = () => {
  if (!compilerLoaded) {
    compilerLoaded = true;
    try { compiler = require("@vue/compiler-sfc"); }
    catch { compiler = null; }
  }
  return compiler;
};

const cache = new WeakMap();

// Every script expression in a Vue file's template, with the file line it starts on: interpolations,
// directive values (v-if, :prop, @event, v-model) and v-for's iterable. With `attributes`, static
// attribute values too (kind "attribute"). Empty when the file has no template or the compiler is
// missing.
export function templateExpressions(file, { attributes = false } = {}) {
  if (!cache.has(file)) cache.set(file, collect(file));
  const found = cache.get(file);
  return attributes ? found : found.filter((entry) => entry.kind === "expression");
}

function collect(file) {
  const sfc = loadCompiler();
  if (!sfc) return Object.freeze([]);
  let ast;
  try { ast = sfc.parse(file.text(), { filename: file.path }).descriptor.template?.ast; }
  catch { return Object.freeze([]); }
  if (!ast) return Object.freeze([]);
  const found = [];
  const visit = (node) => {
    if (node.type === NODE.INTERPOLATION && node.content?.content) {
      found.push(Object.freeze({ kind: "expression", content: node.content.content, line: node.content.loc.start.line }));
    }
    for (const prop of node.props ?? []) {
      if (prop.type === NODE.DIRECTIVE && prop.exp?.content) {
        const content = prop.name === "for" ? prop.exp.content.match(/^[\s\S]+?\s+(?:in|of)\s+([\s\S]+)$/)?.[1] : prop.exp.content;
        if (content) found.push(Object.freeze({ kind: "expression", content, line: prop.exp.loc.start.line }));
      } else if (prop.type === NODE.ATTRIBUTE && prop.value?.content) {
        found.push(Object.freeze({ kind: "attribute", content: prop.value.content, line: prop.value.loc.start.line }));
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(ast);
  return Object.freeze(found);
}

// A template expression parsed as TypeScript, with the file line of any node in it.
export function parseTemplateExpression(ts, expression) {
  const sourceFile = ts.createSourceFile("template.ts", expression.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return Object.freeze({
    sourceFile,
    lineOf(node) { return expression.line + sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line; },
  });
}

export function walk(ts, node, visit) {
  visit(node);
  ts.forEachChild(node, (child) => walk(ts, child, visit));
}
