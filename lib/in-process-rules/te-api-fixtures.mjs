import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { isFrontendTestSource, walk } from "./helpers.mjs";

const source = "in-process/te-api-fixtures.mjs";
const doublesRef = "testing-philosophy.md#test-doubles";
const SCRIPT = /\.[cm]?ts$/;

const unparenthesized = (ts, node) => {
  while (node && ts.isParenthesizedExpression(node)) node = node.expression;
  return node;
};
// A cast (`as const`, `as OrderDto`, `<OrderDto>`) doesn't check the literal against the contract, so it's
// looked through; `satisfies` does, so it isn't.
const uncast = (ts, node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node))) node = node.expression;
  return node;
};
const isLiteral = (ts, node) => Boolean(node) && (ts.isObjectLiteralExpression(node) || ts.isArrayLiteralExpression(node));
const keyNamed = (ts, property, name) => Boolean(property.name) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === name;
const propertyNamed = (ts, object, name) => object.properties.find((property) => ts.isPropertyAssignment(property) && keyNamed(ts, property, name));
// `(await response.json()) as OrderDto`, `satisfies`, `!` and parentheses don't change where the value came from.
const unwrapped = (ts, node) => {
  while (node && (ts.isParenthesizedExpression(node) || ts.isAwaitExpression(node) || ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node))) node = node.expression;
  return node;
};
const isJsonCall = (ts, node) => Boolean(node) && ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "json";
// The nearest enclosing block-level declaration of `name` visible from `node`.
const declarationOf = (ts, node, name) => {
  for (let scope = node.parent; scope; scope = scope.parent) {
    if (!ts.isBlock(scope) && !ts.isSourceFile(scope)) continue;
    for (const statement of scope.statements) {
      if (!ts.isVariableStatement(statement)) continue;
      const declaration = statement.declarationList.declarations.find((candidate) => ts.isIdentifier(candidate.name) && candidate.name.text === name);
      if (declaration) return declaration;
    }
  }
  return null;
};
// A `.json()` result, inline or through the in-scope `const real = await response.json()`.
const isRealBody = (ts, expression) => {
  const node = unwrapped(ts, expression);
  if (isJsonCall(ts, node)) return true;
  if (!node || !ts.isIdentifier(node)) return false;
  const declaration = declarationOf(ts, node, node.text);
  return Boolean(declaration && declaration.parent.flags & ts.NodeFlags.Const && isJsonCall(ts, unwrapped(ts, declaration.initializer)));
};
// `{ ...(await response.json()), extra }` or `[...real, extra]`: the real body, patched.
const spreadsRealBody = (ts, payload) => (ts.isObjectLiteralExpression(payload) ? payload.properties : payload.elements).some((member) =>
  (ts.isSpreadAssignment(member) || ts.isSpreadElement(member)) && isRealBody(ts, member.expression));
const isJsonStringify = (ts, node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "JSON" && node.expression.name.text === "stringify";

// A stand-in API response (Playwright's route.fulfill) built from a bare literal drifts from the
// contract unnoticed; typed against the generated schema, a contract change breaks it at compile time.
const te009 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-TE-009", source }),
  requirements: [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    for (const file of context.files) {
      if (!SCRIPT.test(file.path) || file.path.endsWith(".d.ts") || !isFrontendTestSource(file.path, context.frontendRoots.owner(file)?.path)) continue;
      const representation = await context.typescript.source(file);
      if (!representation) continue;
      walk(ts, representation.sourceFile, (node) => {
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "fulfill") return;
        const options = unparenthesized(ts, node.arguments[0]);
        if (!options || !ts.isObjectLiteralExpression(options)) return;
        const body = propertyNamed(ts, options, "body")?.initializer;
        const json = propertyNamed(ts, options, "json")?.initializer;
        const payload = body && isJsonStringify(ts, body) ? uncast(ts, body.arguments[0]) : uncast(ts, json);
        if (!isLiteral(ts, payload)) return;
        // Patching a real response (`{ response, json: { ...(await response.json()), extra } }`): the base comes from
        // the real backend; the patched fields are unchecked. `json`/`body` replace the body, so a `response` key
        // alone doesn't make the payload real.
        if (options.properties.some((property) => keyNamed(ts, property, "response")) && spreadsRealBody(ts, payload)) return;
        context.report({
          severity: "warn",
          path: file.path,
          line: representation.lineOf(payload),
          message: "test API response isn't typed against the contract — add satisfies components[\"schemas\"][\"…\"] or build it with a typed fixture helper",
          docRef: doublesRef,
        });
      });
    }
  },
});

export const teApiFixtureRules = Object.freeze([te009]);
