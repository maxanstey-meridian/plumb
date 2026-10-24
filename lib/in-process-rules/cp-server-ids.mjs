import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { isGenerated, isTestScript, report, under, walk } from "./helpers.mjs";
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
    if (!context.csharp.classify(file).backendRoot || context.dotnetProjects.testEvidence(file).test) continue;
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

// The server id a frontend literal copies: the whole literal, or one whole segment of a path.
function copiedId(ids, literal) {
  if (ids.has(literal)) return literal;
  if (!literal.includes("/")) return null;
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

// A name that says its value is an id rather than wording: `handlerId`, `kind`, `data-key`. `noun`,
// `subject`, `label` and `class` don't, so an id-valued word given to them is presentation.
const ID_NAME = /id$|handler|kind|type|key/i;
const LINK_ATTRIBUTE = new Set(["to", "href"]);
const EQUALITY = ["EqualsEqualsEqualsToken", "ExclamationEqualsEqualsToken", "EqualsEqualsToken", "ExclamationEqualsToken"];
const MEMBERSHIP = new Set(["includes", "has", "indexOf"]);
const ARRAY_MEMBERSHIP = new Set(["includes", "indexOf"]);

// The expression a literal stands as, past parentheses, `as const`, `satisfies` and `!`.
function outermost(ts, node) {
  let value = node;
  while (value.parent && (ts.isParenthesizedExpression(value.parent) || ts.isAsExpression(value.parent) ||
      ts.isSatisfiesExpression(value.parent) || ts.isNonNullExpression(value.parent))) value = value.parent;
  return value;
}

// Where a literal equal to an id is the UI's copy of it rather than wording: compared (`===`, `case`,
// `.includes`/`.has`/`.indexOf`, a listed array tested with `.includes`), held as a constant (alone or
// in a listed array), given to an id-named property, or used as an object key.
function isIdPosition(ts, node) {
  const value = outermost(ts, node);
  const parent = value.parent;
  if (!parent) return false;
  if (ts.isBinaryExpression(parent)) return EQUALITY.some((kind) => parent.operatorToken.kind === ts.SyntaxKind[kind]);
  if (ts.isCaseClause(parent)) return parent.expression === value;
  if (ts.isVariableDeclaration(parent)) return parent.initializer === value;
  if (ts.isPropertyAssignment(parent)) return parent.name === value || ID_NAME.test(parent.name.text ?? "");
  if (ts.isCallExpression(parent)) {
    return parent.arguments.includes(value) && ts.isPropertyAccessExpression(parent.expression) &&
      MEMBERSHIP.has(parent.expression.name.text);
  }
  if (!ts.isArrayLiteralExpression(parent)) return false;
  const list = outermost(ts, parent);
  const access = list.parent;
  if (access && ts.isVariableDeclaration(access)) return access.initializer === list;
  return !!access && ts.isPropertyAccessExpression(access) && access.expression === list &&
    ARRAY_MEMBERSHIP.has(access.name.text) && !!access.parent && ts.isCallExpression(access.parent);
}

// Each literal that could copy a server id: a path (a literal, or a template literal's piece, holding a
// `/`) anywhere, and a whole literal only in an id position.
function literalsIn(ts, sourceFile, visit) {
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
    if (node.text.includes("/") || (isText && isIdPosition(ts, node))) visit(node, node.text);
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
// agrees today and drifts later; the DTO should carry it. Only id positions count (isIdPosition, and
// the template attributes below): the same word as UI wording (`noun: "export"`, `subject="export"`)
// is presentation.
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
          // A static attribute counts only when it holds a link or an id (`to`, `href`, `data-kind`,
          // `handler-id`); `class`, `icon`, `subject` and `noun` are presentation.
          if (entry.kind === "attribute") {
            if (LINK_ATTRIBUTE.has(entry.name) || ID_NAME.test(entry.name)) emit(entry.line, entry.content);
            continue;
          }
          const parsed = parseTemplateExpression(ts, entry);
          literalsIn(ts, parsed.sourceFile, (node, literal) => emit(parsed.lineOf(node), literal));
        }
      }
    }
  },
});

export const cpRules = Object.freeze([cp001]);
