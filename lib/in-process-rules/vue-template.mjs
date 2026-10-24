const NODE = Object.freeze({ COMMENT: 3, INTERPOLATION: 5, ATTRIBUTE: 6, DIRECTIVE: 7 });

const cache = new WeakMap();

// Every script expression in a Vue file's template, with the file line it starts on: interpolations,
// directive values (v-if, :prop, @event, v-model), dynamic directive arguments (:[key]) and v-for's
// iterable. A directive value carries its static argument as `name` (`handler-id` for :handler-id).
// With `attributes`, static attribute values too (kind "attribute", with the attribute's `name`). Empty
// when the file has no template or the compiler is missing (the TypeScript analysis reports that once).
export function templateExpressions(context, file, { attributes = false } = {}) {
  const found = collect(context, file).expressions;
  return attributes ? found : found.filter((entry) => entry.kind === "expression");
}

// Every HTML comment in a Vue file's template, with its first and last file lines.
export function templateComments(context, file) {
  return collect(context, file).comments;
}

function collect(context, file) {
  const ast = context.typescript.vueTemplate(file);
  if (!ast) return Object.freeze({ expressions: Object.freeze([]), comments: Object.freeze([]) });
  if (cache.has(ast)) return cache.get(ast);
  const expressions = [];
  const comments = [];
  const expression = (node, name) => expressions.push(Object.freeze({ kind: "expression", name, content: node.content, line: node.loc.start.line }));
  const visit = (node) => {
    if (node.type === NODE.COMMENT) comments.push(Object.freeze({ start: node.loc.start, end: node.loc.end }));
    if (node.type === NODE.INTERPOLATION && node.content?.content) expression(node.content);
    for (const prop of node.props ?? []) {
      if (prop.type === NODE.DIRECTIVE) {
        if (prop.arg && !prop.arg.isStatic && prop.arg.content) expression(prop.arg);
        const value = prop.name === "for" ? prop.forParseResult?.source : prop.exp;
        if (value?.content) expression(value, prop.arg?.isStatic ? prop.arg.content : undefined);
      } else if (prop.type === NODE.ATTRIBUTE && prop.value?.content) {
        expressions.push(Object.freeze({ kind: "attribute", name: prop.name, content: prop.value.content, line: prop.value.loc.start.line }));
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(ast);
  const result = Object.freeze({ expressions: Object.freeze(expressions), comments: Object.freeze(comments) });
  cache.set(ast, result);
  return result;
}

// A template expression parsed as TypeScript, with the file line of any node in it.
export function parseTemplateExpression(ts, expression) {
  const sourceFile = ts.createSourceFile("template.ts", expression.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  return Object.freeze({
    sourceFile,
    lineOf(node) { return expression.line + sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line; },
  });
}
