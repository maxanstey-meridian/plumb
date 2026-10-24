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
// snake_case, with `Id` split off an acronym): `handlerId`, `handler-id`, `data-kind`, `integrationKey`,
// `externalCRMId`. `valid`, `typeface`, `typeLabel`, `data-testid`, `noun` and `subject` don't, so an
// id-valued word given to them is presentation; nor do test hooks (`data-test-id`, `testId`, `data-qa-id`),
// whose value is a selector the tests read.
const ID_WORDS = new Set(["id", "ids", "uuid", "guid", "handler", "handlers", "kind", "kinds", "type", "types", "key", "keys"]);
const TEST_HOOK_WORDS = new Set(["test", "qa"]);
const words = (name) =>
  name.split(/[-_:\s]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z]{2})|(?<=[A-Z])(?=Ids?$)/).map((word) => word.toLowerCase());
const isIdName = (name) => {
  const parts = words(name);
  const last = parts.at(-1);
  return ID_WORDS.has(last) && !(/^ids?$/.test(last) && TEST_HOOK_WORDS.has(parts.at(-2)));
};
// An attribute holds a link or an id by its name. HTML's own bare `id` and `type` on a native element
// (lowercase, unhyphenated tag) don't name a server id, though a component's `id` or `type` prop can;
// Vue reserves `key` on every element, so it's never a prop.
const LINK_ATTRIBUTE = new Set(["to", "href"]);
const MARKUP_ATTRIBUTE = new Set(["id", "type"]);
const isNativeTag = (tag) => /^[a-z][a-z0-9]*$/.test(tag ?? "");
function isIdAttribute(name, tag) {
  if (LINK_ATTRIBUTE.has(name)) return true;
  const bare = name.toLowerCase();
  if (bare === "key" || (MARKUP_ATTRIBUTE.has(bare) && isNativeTag(tag))) return false;
  return isIdName(name);
}
// `:class` and `:style` objects key on class names and CSS properties, not ids.
const PRESENTATION_BINDING = new Set(["class", "style"]);

const EQUALITY = ["EqualsEqualsEqualsToken", "ExclamationEqualsEqualsToken", "EqualsEqualsToken", "ExclamationEqualsToken"];
const FALLBACK = ["QuestionQuestionToken", "BarBarToken"];
const ASSIGNMENT = ["EqualsToken", "QuestionQuestionEqualsToken", "BarBarEqualsToken", "AmpersandAmpersandEqualsToken"];
const isOperator = (ts, binary, kinds) => kinds.some((kind) => binary.operatorToken.kind === ts.SyntaxKind[kind]);
const MEMBERSHIP = new Set(["includes", "has", "indexOf"]);
const isMembership = (ts, callee) => ts.isPropertyAccessExpression(callee) && MEMBERSHIP.has(callee.name.text);
const KEYED = new Set(["get", "set"]);
const isKeyed = (ts, callee) => ts.isPropertyAccessExpression(callee) && KEYED.has(callee.name.text);
const REF = new Set(["ref", "shallowRef"]);
const COLLECTION = new Set(["Set", "Map"]);
const isNewCollection = (ts, node, value, names = COLLECTION) =>
  ts.isNewExpression(node) && node.arguments?.[0] === value && ts.isIdentifier(node.expression) && names.has(node.expression.text);
const MAP = new Set(["Map"]);
// An entry of the list given to `new Map(…)` (`["csv", "export"]`): only its key, element 0, is held as a key.
const isMapEntry = (ts, array) =>
  !!array.parent && ts.isArrayLiteralExpression(array.parent) && isNewCollection(ts, array.parent.parent, array.parent, MAP);

// Whether `parent` passes `value` through unchanged as one of its possible results: parentheses, `as`,
// `satisfies`, `!`, `<T>x`, either branch of a conditional (not its condition), either side of `??` and `||`,
// the right side of `&&`, an array literal's element (only the key of a `new Map(…)` entry), and the list
// given to `new Set(…)`/`new Map(…)`.
const passesThrough = (ts, parent, value) =>
  ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent) || ts.isSatisfiesExpression(parent) ||
  ts.isNonNullExpression(parent) || ts.isTypeAssertionExpression(parent) ||
  (ts.isArrayLiteralExpression(parent) && (!isMapEntry(ts, parent) || parent.elements[0] === value)) ||
  (ts.isConditionalExpression(parent) && parent.condition !== value) ||
  (ts.isBinaryExpression(parent) && (isOperator(ts, parent, FALLBACK) ||
    (parent.right === value && isOperator(ts, parent, ["AmpersandAmpersandToken"])))) ||
  isNewCollection(ts, parent, value);

// The expression a literal stands as.
function outermost(ts, node) {
  let value = node;
  while (value.parent && passesThrough(ts, value.parent, value)) value = value.parent;
  return value;
}

// A property's name as text, reading a computed string (`["handlerId"]`) as the name it spells.
const propertyName = (ts, name) =>
  ts.isComputedPropertyName(name) ? (ts.isStringLiteralLike(name.expression) ? name.expression.text : "") : (name.text ?? "");

// The name an assignment's target holds its value under: a bare variable's (or a ref's, `tab.value`) holds
// it whatever its name, like an initialiser; a property or element (`state.handlerId`, `el["title"]`) by
// its own name.
function holdsAsId(ts, target) {
  if (ts.isIdentifier(target)) return true;
  if (ts.isPropertyAccessExpression(target)) {
    return (target.name.text === "value" && ts.isIdentifier(target.expression)) || isIdName(target.name.text);
  }
  return ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression) &&
    isIdName(target.argumentExpression.text);
}

// Where a literal equal to an id is the UI's copy of it rather than wording. The literal stands as its
// outermost expression, which is the copy when it's compared (`===`, `in`, `case`, `.includes`/`.has`/
// `.indexOf` either way round), held (a variable, parameter or enum initialiser, `ref(…)`'s initial
// value, an assignment or class field by the name it's held under, a property under an id-named key),
// used as a key (quoted, computed, indexed, or `.get`/`.set`'s first argument), or a template's whole
// expression (`template.whole`) bound to an id-named attribute. Returned or passed to a plain call
// (`pluralise(count, "export")`), it's wording. `template` is the parsed template expression and the
// attribute (`name`, `tag`) it's bound to.
function isIdPosition(ts, node, template) {
  const value = outermost(ts, node);
  const parent = value.parent;
  if (!parent) return false;
  if (template?.whole === value) return template.name !== undefined && isIdAttribute(template.name, template.tag);
  const isKey = !PRESENTATION_BINDING.has(template?.name);
  if (ts.isBinaryExpression(parent)) {
    return isOperator(ts, parent, EQUALITY) || (parent.left === value && isOperator(ts, parent, ["InKeyword"])) ||
      (parent.right === value && isOperator(ts, parent, ASSIGNMENT) && holdsAsId(ts, parent.left));
  }
  if (ts.isCaseClause(parent)) return parent.expression === value;
  if (ts.isCallExpression(parent)) {
    if (parent.arguments[0] === value && (isKeyed(ts, parent.expression) ||
        (ts.isIdentifier(parent.expression) && REF.has(parent.expression.text)))) return true;
    return parent.arguments.includes(value) && isMembership(ts, parent.expression);
  }
  if (ts.isPropertyAccessExpression(parent)) {
    return parent.expression === value && isMembership(ts, parent) && !!parent.parent &&
      ts.isCallExpression(parent.parent) && parent.parent.expression === parent;
  }
  if (ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isBindingElement(parent) ||
      ts.isEnumMember(parent)) return parent.initializer === value;
  if (ts.isPropertyDeclaration(parent)) return parent.initializer === value && isIdName(propertyName(ts, parent.name));
  if (ts.isShorthandPropertyAssignment(parent)) return parent.objectAssignmentInitializer === value;
  if (ts.isPropertyAssignment(parent)) return parent.name === value ? isKey : isIdName(propertyName(ts, parent.name));
  if (ts.isComputedPropertyName(parent)) return isKey;
  if (ts.isElementAccessExpression(parent)) return parent.argumentExpression === value;
  return false;
}

// Each literal that could copy a server id: a path anywhere, and a whole literal only in an id position.
// `template` is a parsed template expression with the attribute it's bound to (isIdPosition).
function literalsIn(ts, sourceFile, visit, template) {
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
    if (isPath(node.text) || (isText && isIdPosition(ts, node, template))) visit(node, node.text);
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
          // `data-kind`, `handler-id`, a component's `type`, bound or static); `class`, `icon`, `subject`,
          // `noun` and a native element's `id` are presentation.
          if (entry.kind === "attribute") {
            if (isIdAttribute(entry.name, entry.tag)) emit(entry.line, entry.content);
            continue;
          }
          const parsed = parseTemplateExpression(ts, entry);
          literalsIn(ts, parsed.sourceFile, (node, literal) => emit(parsed.lineOf(node), literal),
            { whole: parsed.whole, name: entry.name, tag: entry.tag });
        }
      }
    }
  },
});

export const cpRules = Object.freeze([cp001]);
