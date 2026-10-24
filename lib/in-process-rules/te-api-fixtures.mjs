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
const propertyNamed = (ts, object, name) => object.properties.find((property) =>
  ts.isPropertyAssignment(property) && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === name);
const isJsonStringify = (ts, node) => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
  ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "JSON" && node.expression.name.text === "stringify";

// A stand-in API response (Playwright's route.fulfill) built from a bare literal drifts from the
// contract unnoticed; typed against the generated schema, a contract change breaks it at compile time.
const te009 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-TE-009", source }),
  requirements: [Capability.TYPESCRIPT],
  async analyze(context) {
    const ts = await context.typescript.runtime();
    if (!ts) return;
    for (const file of context.files) {
      if (!SCRIPT.test(file.path) || file.path.endsWith(".d.ts") || !isFrontendTestSource(file.path)) continue;
      const representation = await context.typescript.source(file);
      if (!representation) continue;
      walk(ts, representation.sourceFile, (node) => {
        if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "fulfill") return;
        const options = unparenthesized(ts, node.arguments[0]);
        if (!options || !ts.isObjectLiteralExpression(options)) return;
        // Patching a real response (`{ response, json: { ...(await response.json()), extra } }`) is typed by the backend.
        if (options.properties.some((property) => property.name && ts.isIdentifier(property.name) && property.name.text === "response")) return;
        const body = propertyNamed(ts, options, "body")?.initializer;
        const json = propertyNamed(ts, options, "json")?.initializer;
        const payload = body && isJsonStringify(ts, body) ? uncast(ts, body.arguments[0]) : uncast(ts, json);
        if (!isLiteral(ts, payload)) return;
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
