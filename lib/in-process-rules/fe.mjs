import { createRuleDescriptor, defineFileRule } from "../engine/contracts.mjs";
import { hasSegment, isTestScript, lineHits, report } from "./helpers.mjs";

const rgWord = "\\p{Alphabetic}\\p{Mark}\\p{Decimal_Number}\\p{Connector_Punctuation}\\p{Join_Control}";
const rgSpace = "\\p{White_Space}";
const useState = new RegExp(`(?<![${rgWord}])useState[${rgSpace}]*(?:<[^>]*>)?\\(`, "u");

export const feRules = Object.freeze([
  defineFileRule({
    descriptor: createRuleDescriptor({ id: "MER-FE-041", source: "in-process/fe.mjs" }),
    files(file) {
      return hasSegment(file, "composables") && /^use-.*\.ts$/.test(file.split("/").at(-1));
    },
    analyze(file, context) {
      if (["node_modules", ".nuxt", "generated"].some((segment) => hasSegment(file.path, segment))) return;
      report(context, "info", file.path, 0, "composable filenames are camelCase (useX.ts), not kebab-case", "rules/frontend/name-a-composable-file-after-its-function.md");
    },
  }),
  defineFileRule({
    descriptor: createRuleDescriptor({ id: "MER-FE-043", source: "in-process/fe.mjs" }),
    files(file) {
      return /\.(?:ts|vue)$/.test(file) && !["composables", "node_modules", ".nuxt", "generated"].some((segment) => hasSegment(file, segment));
    },
    analyze(file, context) {
      // Test source by the shared definition (rules/tests/keep-frontend-tests-in-a-top-level-tests-folder.md).
      if (isTestScript(context, file)) return;
      for (const line of lineHits(file, useState)) {
        report(context, "warn", file.path, line, "useState belongs inside a composable — consume the owning composable, never the state key", "rules/frontend/call-usestate-only-inside-a-composable.md");
      }
    },
  }),
]);
