const NODE = Object.freeze({ COMMENT: 3, INTERPOLATION: 5, ATTRIBUTE: 6, DIRECTIVE: 7 });
// The compiler's element tagType for a plain HTML or SVG element (components, slots and templates differ).
const NATIVE_ELEMENT = 0;

const cache = new WeakMap();

// Every script expression in a Vue file's template, with the file line it starts on: interpolations,
// directive values (v-if, :prop, @event, v-model), dynamic directive arguments (:[key]) and v-for's
// iterable. A directive value carries its static argument as `name` (`handler-id` for :handler-id), and
// every prop entry carries its element's `tag` and whether it is `native` HTML or SVG (the compiler's own reading,
// not a component). A directive's entries carry its `directive` name (`bind` for `:x` and `v-bind`, `on` for `@x` and
// `v-on`) and whether it `hasArgument`, static or dynamic (`v-bind="{…}"` has none). With `attributes`, static
// attribute values too (kind "attribute", with the attribute's `name`).
// Empty when the file has no template or the compiler is missing (the TypeScript analysis reports that once).
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
  const expression = (node, name, element) =>
    expressions.push(Object.freeze({ kind: "expression", name, ...element, content: node.content, line: node.loc.start.line }));
  const visit = (node) => {
    if (node.type === NODE.COMMENT) comments.push(Object.freeze({ start: node.loc.start, end: node.loc.end }));
    if (node.type === NODE.INTERPOLATION && node.content?.content) expression(node.content);
    const element = { tag: node.tag, native: node.tagType === NATIVE_ELEMENT };
    for (const prop of node.props ?? []) {
      if (prop.type === NODE.DIRECTIVE) {
        const directive = { ...element, directive: prop.name, hasArgument: !!prop.arg };
        if (prop.arg && !prop.arg.isStatic && prop.arg.content) expression(prop.arg, undefined, directive);
        const value = prop.name === "for" ? prop.forParseResult?.source : prop.exp;
        if (value?.content) expression(value, prop.arg?.isStatic ? prop.arg.content : undefined, directive);
      } else if (prop.type === NODE.ATTRIBUTE && prop.value?.content) {
        expressions.push(Object.freeze({
          kind: "attribute", name: prop.name, ...element, content: prop.value.content, line: prop.value.loc.start.line,
        }));
      }
    }
    for (const child of node.children ?? []) visit(child);
  };
  visit(ast);
  const result = Object.freeze({ expressions: Object.freeze(expressions), comments: Object.freeze(comments) });
  cache.set(ast, result);
  return result;
}

// A template expression parsed as TypeScript, with the file line of any node in it. It's read as one
// expression, so `{ name: 'export' }` is an object rather than a block holding a label; a multi-statement
// handler (`@click="a(); b()"`) doesn't parse as one and is read as statements. `whole` is the node the
// entire content stands as: the wrapping parentheses of an expression, undefined for statements.
export function parseTemplateExpression(ts, expression) {
  const parse = (text) => ts.createSourceFile("template.ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  // The newline keeps a trailing `//` comment from swallowing the closing parenthesis.
  let sourceFile = parse(`(${expression.content}\n)`);
  const [statement] = sourceFile.statements;
  const isWhole = !sourceFile.parseDiagnostics?.length && sourceFile.statements.length === 1 &&
    ts.isExpressionStatement(statement) && ts.isParenthesizedExpression(statement.expression) &&
    statement.expression.getStart(sourceFile) === 0 && statement.expression.end === sourceFile.text.length;
  if (!isWhole) sourceFile = parse(expression.content);
  return Object.freeze({
    sourceFile,
    whole: isWhole ? statement.expression : undefined,
    // The leading `(` shifts offsets by one but adds no line break, so a node's line within the parsed
    // text is its line within the content.
    lineOf(node) { return expression.line + sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line; },
  });
}
