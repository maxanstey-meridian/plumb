import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { matchingCSharpDelimiter } from "../engine/dotnet-analysis.mjs";
import { isFrontendTestSource, isGenerated, report, under, walk } from "./helpers.mjs";
import { parseTemplateExpression, templateExpressions } from "./vue-template.mjs";

const source = "in-process/cp-server-ids.mjs";
const serverRulesRef = "frontend-pa-vsa.md#server-rules-stay-on-the-server";
// An id worth matching: a word-like token, not a route, sentence or format string.
const ID_VALUE = /^[A-Za-z][A-Za-z0-9_.-]{2,}$/;
const SCRIPT = /\.(?:[cm]?ts|vue)$/;
// `(?!where\b)`: in `class C<T> where T : class where U : struct`, the `class where` is a constraint, not a type.
const TYPE_DECLARATION = /\b(?:record\s+(?:class|struct)|class|struct|record|interface)\s+(?!where\b)([A-Za-z_]\w*)/g;
// `public const string XId`, also with the `new` modifier before or after `public`.
const SERVER_ID = /\b(?:public\s+(?:new\s+)?|new\s+public\s+)const\s+string\s+([A-Z]\w*Id)\s*=\s*"/g;

// The types whose `{…}` bodies contain `offset`, outermost first: a nested type that closed earlier doesn't own it.
function ownersAt(masked, offset) {
  const owners = [];
  for (const declaration of masked.matchAll(TYPE_DECLARATION)) {
    if (declaration.index >= offset) break;
    const rest = masked.slice(declaration.index + declaration[0].length);
    const body = rest.search(/[{;]/);
    if (body < 0 || rest[body] !== "{") continue;
    const open = declaration.index + declaration[0].length + body;
    if (open < offset && matchingCSharpDelimiter(masked, open, "{", "}") > offset) owners.push(declaration[1]);
  }
  return owners;
}

// A test double kept in the backend (a fake connector the dev seed wires in) owns nothing the UI reads.
const TEST_DOUBLE = /^(?:Fake|Test)[A-Z]/;

// `public const string <Name>Id = "<value>"` in non-test backend code, outside test doubles: what the
// server owns, by value, with its qualified name (the enclosing type chain) for the message.
function serverIds(context) {
  const ids = new Map();
  for (const file of context.csharp.csharpFiles) {
    const classification = context.csharp.classify(file);
    if (!classification.backendRoot || classification.testPath || classification.testFileName) continue;
    const masked = context.csharp.mask(file, { preserveStringDelimiters: true });
    const text = file.text();
    for (const match of masked.matchAll(SERVER_ID)) {
      const start = match.index + match[0].length;
      const value = text.slice(start, masked.indexOf('"', start));
      if (!ID_VALUE.test(value) || ids.has(value)) continue;
      const owners = ownersAt(masked, match.index);
      if (owners.some((owner) => TEST_DOUBLE.test(owner))) continue;
      ids.set(value, [...owners, match[1]].join("."));
    }
  }
  return ids;
}

// The server id a frontend literal copies: the whole literal, or one whole segment of a path. An API
// route (`/api/…`) names the endpoint the generated client checks, not a rule the UI keeps.
function copiedId(ids, literal) {
  if (ids.has(literal)) return literal;
  if (!literal.includes("/") || literal.startsWith("/api/")) return null;
  return literal.split(/[/?#]/).find((segment) => ids.has(segment)) ?? null;
}

function literalsIn(ts, sourceFile, visit) {
  walk(ts, sourceFile, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      if (parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent))) return;
      if (parent && ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) return;
      // A literal type (`kind: "export" | "form"`) is only a type; a value checked against it is a literal of its own.
      if (parent && ts.isLiteralTypeNode(parent)) return;
      visit(node, node.text);
    } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      visit(node, node.text);
    }
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
// agrees today and drifts later; the DTO should carry it. Dispatch on a handler id (which component
// renders) looks the same, so it's baselined case by case rather than exempted by name.
const cp001 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-CP-001", source }),
  requirements: [Capability.CSHARP, Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ids = serverIds(context);
    if (!ids.size) return;
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const seenFiles = new Set();
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of context.files) {
        if (!SCRIPT.test(file.path) || file.path.endsWith(".d.ts") || !under(file.path, root.appPath) ||
            isFrontendTestSource(file.path, root.path) || seenFiles.has(file.path) || isGenerated(file)) continue;
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
          if (entry.kind === "attribute") { emit(entry.line, entry.content); continue; }
          const parsed = parseTemplateExpression(ts, entry);
          literalsIn(ts, parsed.sourceFile, (node, literal) => emit(parsed.lineOf(node), literal));
        }
      }
    }
  },
});

export const cpRules = Object.freeze([cp001]);
