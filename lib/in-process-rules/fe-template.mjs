import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { isFrontendTestSource, report, under, walk } from "./helpers.mjs";
import { parseTemplateExpression, templateExpressions } from "./vue-template.mjs";

const source = "in-process/fe-template.mjs";
const typeSafetyRef = "coding-philosophy.md#type-safety-all-stacks";

const isConstAssertion = (ts, node) =>
  ts.isTypeReferenceNode(node.type) && ts.isIdentifier(node.type.typeName) && node.type.typeName.text === "const";
const isFlaggedAssertion = (ts, node) =>
  (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) && !isConstAssertion(ts, node);

// A chain (`x as unknown as T`) is one cast: only its outermost assertion is reported.
const isInnerOfChain = (ts, node) => {
  let parent = node.parent;
  while (parent && ts.isParenthesizedExpression(parent)) parent = parent.parent;
  return Boolean(parent) && isFlaggedAssertion(ts, parent);
};

// Findings are single-line; a formatter-wrapped expression would otherwise put a newline in the message.
const snippet = (node, sourceFile) => node.getText(sourceFile).replace(/\s+/g, " ");

// Script blocks are oxlint's (typescript/consistent-type-assertions, typescript/no-non-null-assertion
// in the golden config); templates are invisible to it, so this covers them.
const fe045 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-FE-045", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    const seen = new Set();
    for (const root of context.frontendRoots.withinDepth(6)) {
      for (const file of context.files) {
        if (!file.path.endsWith(".vue") || !under(file.path, root.appPath) || isFrontendTestSource(file.path, root.path) || seen.has(file.path)) continue;
        seen.add(file.path);
        for (const expression of templateExpressions(context, file)) {
          const parsed = parseTemplateExpression(ts, expression);
          walk(ts, parsed.sourceFile, (node) => {
            if (isFlaggedAssertion(ts, node)) {
              if (isInnerOfChain(ts, node)) return;
              report(context, "error", file.path, parsed.lineOf(node),
                `type assertion in a template (${snippet(node, parsed.sourceFile)}) — oxlint can't see templates; bind with v-model, a typed handler or useTemplateRef instead`,
                typeSafetyRef);
            } else if (ts.isNonNullExpression(node)) {
              report(context, "error", file.path, parsed.lineOf(node),
                `non-null assertion in a template (${snippet(node, parsed.sourceFile)}) — oxlint can't see templates; narrow with v-if or a computed instead`,
                typeSafetyRef);
            }
          });
        }
      }
    }
  },
});

export const feTemplateRules = Object.freeze([fe045]);
