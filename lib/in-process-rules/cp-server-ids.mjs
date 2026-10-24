import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { isCSharpTestCode, isGenerated, isTestScript, report, under, walk } from "./helpers.mjs";
import { parseTemplateExpression, templateExpressions } from "./vue-template.mjs";

const source = "in-process/cp-server-ids.mjs";
const serverRulesRef = "frontend-pa-vsa.md#server-rules-stay-on-the-server";
// An id worth matching: a word-like token, not a route, sentence or format string.
const ID_VALUE = /^[A-Za-z][A-Za-z0-9_.-]{2,}$/;
const SCRIPT = /\.(?:[cm]?ts|vue)$/;
// `public const string XId`, also with the `new` modifier before or after `public`.
const SERVER_ID = /\b(?:public\s+(?:new\s+)?|new\s+public\s+)const\s+string\s+([A-Z]\w*Id)\s*=\s*"/g;

// A test double kept in the backend (a fake connector the dev seed wires in) owns nothing the UI reads.
// The doctrine's test-double prefixes only: `Test…` names production types too (`TestIntegrationConnectionUseCase`).
const TEST_DOUBLE = /^(?:Fake|InMemory|Inline)[A-Z]/;

// `public const string <Name>Id = "<value>"` in non-test backend code (by test project, folder or file name),
// outside test doubles: what the server owns, by value, with its qualified name (the enclosing type chain) for
// the message.
function serverIds(context) {
  const ids = new Map();
  for (const file of context.csharp.csharpFiles) {
    if (!context.csharp.classify(file).backendRoot || isCSharpTestCode(context, file)) continue;
    const masked = context.csharp.mask(file, { preserveStringDelimiters: true });
    const text = file.text();
    for (const match of masked.matchAll(SERVER_ID)) {
      const start = match.index + match[0].length;
      const value = text.slice(start, masked.indexOf('"', start));
      if (!ID_VALUE.test(value) || ids.has(value)) continue;
      const owners = context.csharp.enclosingTypes(file, match.index);
      if (owners.some((owner) => TEST_DOUBLE.test(owner))) continue;
      ids.set(value, [...owners, match[1]].join("."));
    }
  }
  return ids;
}

// A path: a literal, or a template literal's piece, holding a `/` and no whitespace. "Choose import/export" is wording.
const isPath = (text) => text.includes("/") && !/\s/.test(text);

// The server id a frontend literal copies: the whole literal, or one whole segment of a path.
function copiedId(ids, literal) {
  if (ids.has(literal)) return literal;
  if (!isPath(literal)) return null;
  return literal.split(/[/?#]/).find((segment) => ids.has(segment)) ?? null;
}

const CLIENT_METHOD = /^(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE)$/;

// The path handed to the generated openapi-fetch client (`api.GET("/api/people/{id}/export")`): the
// client types it against the schema, so it names an endpoint rather than keeping a copy of a rule.
function isClientPath(ts, node) {
  const call = node.parent;
  return !!call && ts.isCallExpression(call) && call.arguments[0] === node &&
    ts.isPropertyAccessExpression(call.expression) && CLIENT_METHOD.test(call.expression.name.text);
}

// A name that says its value is an id rather than wording, by its last word (camelCase, kebab-case or
// snake_case): `handlerId`, `handler-id`, `data-kind`, `integrationKey`. `valid`, `typeface`, `typeLabel`,
// `data-testid`, `noun` and `subject` don't, so an id-valued word given to them is presentation.
const ID_WORDS = new Set(["id", "ids", "handler", "handlers", "kind", "kinds", "type", "types", "key", "keys"]);
const lastWord = (name) => name.split(/[-_:\s]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z]{2})/).at(-1).toLowerCase();
const isIdName = (name) => ID_WORDS.has(lastWord(name));
// An attribute holds a link or an id by its name; HTML's and Vue's own bare `id`, `type` and `key` don't name a server id.
const LINK_ATTRIBUTE = new Set(["to", "href"]);
const MARKUP_ATTRIBUTE = new Set(["id", "type", "key"]);
const isIdAttribute = (name) => LINK_ATTRIBUTE.has(name) || (!MARKUP_ATTRIBUTE.has(name.toLowerCase()) && isIdName(name));

const EQUALITY = ["EqualsEqualsEqualsToken", "ExclamationEqualsEqualsToken", "EqualsEqualsToken", "ExclamationEqualsToken"];
const FALLBACK = ["QuestionQuestionToken", "BarBarToken"];
const isOperator = (ts, binary, kinds) => kinds.some((kind) => binary.operatorToken.kind === ts.SyntaxKind[kind]);
const MEMBERSHIP = new Set(["includes", "has", "indexOf"]);
const isMembership = (ts, callee) => ts.isPropertyAccessExpression(callee) && MEMBERSHIP.has(callee.name.text);
const COLLECTION = new Set(["Set", "Map"]);

// Whether `parent` passes `value` through unchanged as one of its possible results: parentheses, `as`,
// `satisfies`, `!`, `<T>x`, either branch of a conditional (not its condition), either side of `??` and `||`,
// an array literal's element, and the list given to `new Set(…)`/`new Map(…)`.
const passesThrough = (ts, parent, value) =>
  ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) ||
  ts.isNonNullExpression(parent) || ts.isTypeAssertionExpression(parent) || ts.isArrayLiteralExpression(parent) ||
  (ts.isConditionalExpression(parent) && parent.condition !== value) ||
  (ts.isBinaryExpression(parent) && isOperator(ts, parent, FALLBACK)) ||
  (ts.isNewExpression(parent) && parent.arguments?.[0] === value && ts.isIdentifier(parent.expression) &&
    COLLECTION.has(parent.expression.text));

// The expression a literal stands as.
function outermost(ts, node) {
  let value = node;
  while (value.parent && passesThrough(ts, value.parent, value)) value = value.parent;
  return value;
}

// A property's name as text, reading a computed string (`["handlerId"]`) as the name it spells.
const propertyName = (ts, name) =>
  ts.isComputedPropertyName(name) ? (ts.isStringLiteralLike(name.expression) ? name.expression.text : "") : (name.text ?? "");

// Where a literal equal to an id is the UI's copy of it rather than wording. The literal stands as its
// outermost expression, which is the copy when it's compared (`===`, `in`, `case`, `.includes`/`.has`/
// `.indexOf` either way round), held (any initialiser, the right side of `=`, a property under an id-named
// key), used as a key (quoted, computed or indexed), or a whole template expression bound to an id-named
// `attribute`. Returned or passed to a plain call (`pluralise(count, "export")`), it's wording.
function isIdPosition(ts, node, attribute) {
  const value = outermost(ts, node);
  const parent = value.parent;
  if (!parent) return false;
  if (ts.isBinaryExpression(parent)) {
    return isOperator(ts, parent, EQUALITY) || (parent.left === value && isOperator(ts, parent, ["InKeyword"])) ||
      (parent.right === value && isOperator(ts, parent, ["EqualsToken"]));
  }
  if (ts.isCaseClause(parent)) return parent.expression === value;
  if (ts.isCallExpression(parent)) return parent.arguments.includes(value) && isMembership(ts, parent.expression);
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.expression === value && isMembership(ts, parent) && !!parent.parent &&
      ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
  }
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) ||
      ts.isPropertyDeclaration(parent) || ts.isEnumMember(parent)) return parent.initializer === value;
  if (ts.isShorthandPropertyAssignment(parent)) return parent.objectAssignmentInitializer === value;
  if (ts.isPropertyAssignment(parent)) return parent.name === value || isIdName(propertyName(ts, parent.name));
  if (ts.isComputedPropertyName(parent)) return true;
  if (ts.isElementAccessExpression(parent)) return parent.argumentExpression === value;
  if (ts.isExpressionStatement(parent)) return attribute !== undefined && isIdAttribute(attribute);
  return false;
}

// Each literal that could copy a server id: a path anywhere, and a whole literal only in an id position.
// `attribute` names the template attribute a parsed expression is bound to.
function literalsIn(ts, sourceFile, visit, attribute) {
  walk(ts, sourceFile, (node) => {
    const isText = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node);
    if (!isText && !ts.isTemplateHead(node) && !ts.isTemplateMiddle(node) && !ts.isTemplateTail(node)) return;
    // Type positions never count. A literal type (`kind: "export" | "form"`), a template literal type or an
    // interface member name is only a type; a value compared against it is flagged where that value is written.
    if (ts.findAncestor(node.parent, (ancestor) => ts.isTypeNode(ancestor) || ts.isTypeElement(ancestor))) return;
    if (isText) {
      const parent = node.parent;
      if (parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent))) return;
      if (parent && ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) return;
      if (isClientPath(ts, node)) return;
    }
    if (isPath(node.text) || (isText && isIdPosition(ts, node, attribute))) visit(node, node.text);
  });
}

async function scriptRepresentations(context, file) {
  if (!file.path.endsWith(".vue")) {
    const representation = await context.typescript.source(file);
    return representation ? [representation] : [];
  }
  return (await Promise.all(context.typescript.vueScripts(file).map((block) => context.typescript.vueSource(block)))).filter(Boolean);
}

// The UI keeping its own copy of an id the server owns, compared against or built into a link. It
// agrees today and drifts later; the DTO should carry it. A path counts anywhere, a whole literal only
// in an id position (isIdPosition, and id-named template attributes): the same word as UI wording
// (`noun: "export"`, `subject="export"`, `pluralise(count, "export")`) is presentation.
// Dispatch on a handler id (which component renders) looks the same as a copy, so it's baselined case
// by case rather than exempted by name.
const cp001 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-CP-001", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ids = serverIds(context);
    if (!ids.size) return;
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const seenFiles = new Set();
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of context.files) {
        if (!SCRIPT.test(file.path) || file.path.endsWith(".d.ts") || !under(file.path, root.appPath) ||
            isTestScript(context, file) || seenFiles.has(file.path) || isGenerated(file)) continue;
        seenFiles.add(file.path);
        const reported = new Set();
        const emit = (line, literal) => {
          const id = copiedId(ids, literal);
          if (!id || reported.has(`${line}\0${id}`)) return;
          reported.add(`${line}\0${id}`);
          report(context, "warn", file.path, line,
            `"${id}" is ${ids.get(id)} on the server — take it from the DTO (or have the DTO send it) instead of keeping a copy`,
            serverRulesRef);
        };
        for (const representation of await scriptRepresentations(context, file)) {
          literalsIn(ts, representation.sourceFile, (node, literal) => emit(representation.lineOf(node), literal));
        }
        if (!file.path.endsWith(".vue")) continue;
        for (const entry of templateExpressions(context, file, { attributes: true })) {
          // An attribute's whole value counts only when the attribute holds a link or an id (`to`, `href`,
          // `data-kind`, `handler-id`, bound or static); `class`, `icon`, `subject`, `noun` and `id` are presentation.
          if (entry.kind === "attribute") {
            if (isIdAttribute(entry.name)) emit(entry.line, entry.content);
            continue;
          }
          const parsed = parseTemplateExpression(ts, entry);
          literalsIn(ts, parsed.sourceFile, (node, literal) => emit(parsed.lineOf(node), literal), entry.name);
        }
      }
    }
  },
});

export const cpRules = Object.freeze([cp001]);
