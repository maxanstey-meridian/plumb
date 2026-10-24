import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { isFrontendTestPath, report, under } from "./helpers.mjs";
import { parseTemplateExpression, templateExpressions, walk } from "./vue-template.mjs";

const source = "in-process/cp-server-ids.mjs";
const serverRulesRef = "frontend-pa-vsa.md#server-rules-stay-on-the-server";
// An id worth matching: a word-like token, not a route, sentence or format string.
const ID_VALUE = /^[A-Za-z][A-Za-z0-9_.-]{2,}$/;
const SCRIPT = /\.(?:[cm]?ts|vue)$/;

// `const string <Name>Id = "<value>"` in non-test backend code: what the server owns, by value, with
// the declaring type for the message.
function serverIds(context) {
  const ids = new Map();
  for (const file of context.csharp.csharpFiles) {
    const classification = context.csharp.classify(file);
    if (!classification.backendRoot || classification.testPath || classification.testFileName) continue;
    const masked = context.csharp.mask(file, { preserveStringDelimiters: true });
    const text = file.text();
    for (const match of masked.matchAll(/\bconst\s+string\s+([A-Za-z_]\w*Id)\s*=\s*"/g)) {
      const start = match.index + match[0].length;
      const value = text.slice(start, text.indexOf('"', start));
      if (!ID_VALUE.test(value) || ids.has(value)) continue;
      const owner = [...masked.slice(0, match.index).matchAll(/\b(?:class|record|struct)\s+([A-Za-z_]\w*)/g)].at(-1)?.[1];
      ids.set(value, owner ? `${owner}.${match[1]}` : match[1]);
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

function literalsIn(ts, sourceFile, visit) {
  walk(ts, sourceFile, (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      const parent = node.parent;
      if (parent && (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent) || ts.isExternalModuleReference(parent))) return;
      if (parent && ts.isCallExpression(parent) && parent.expression.kind === ts.SyntaxKind.ImportKeyword) return;
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
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const ids = serverIds(context);
    if (!ids.size) return;
    const seenFiles = new Set();
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of context.files) {
        if (!SCRIPT.test(file.path) || file.path.endsWith(".d.ts") || !under(file.path, root.appPath) ||
            isFrontendTestPath(file.path) || seenFiles.has(file.path)) continue;
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
        for (const entry of templateExpressions(file, { attributes: true })) {
          if (entry.kind === "attribute") { emit(entry.line, entry.content); continue; }
          const parsed = parseTemplateExpression(ts, entry);
          literalsIn(ts, parsed.sourceFile, (node, literal) => emit(parsed.lineOf(node), literal));
        }
      }
    }
  },
});

export const cpRules = Object.freeze([cp001]);
