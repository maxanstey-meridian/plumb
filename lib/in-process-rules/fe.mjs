import { Capability, createRuleDescriptor, defineFileRule } from "../engine/contracts.mjs";
import { hasSegment, lineHits, report } from "./helpers.mjs";

const rgWord = "\\p{Alphabetic}\\p{Mark}\\p{Decimal_Number}\\p{Connector_Punctuation}\\p{Join_Control}";
const rgSpace = "\\p{White_Space}";
const rivetFetch = new RegExp(`(?<![${rgWord}])rivetFetch(?![${rgWord}])`, "u");
const useState = new RegExp(`(?<![${rgWord}])useState[${rgSpace}]*(?:<[^>]*>)?\\(`, "u");

export const feRules = Object.freeze([
  defineFileRule({
    descriptor: createRuleDescriptor({ id: "MER-FE-005", source: "in-process/fe.mjs", variants: ["v1", "both", "none"] }),
    requirements: [Capability.LINE_MAP],
    files(file) {
      return /\.(?:ts|vue)$/.test(file) && !hasSegment(file, "generated") &&
        !/^eslint\.config\./.test(file.split("/").at(-1));
    },
    analyze(file, context) {
      for (const line of lineHits(file, rivetFetch)) {
        report(context, "error", file.path, line, "do not use rivetFetch directly — call the generated clients", "frontend-pa-vsa.md#rivet-rules");
      }
    },
  }),
  defineFileRule({
    descriptor: createRuleDescriptor({ id: "MER-FE-041", source: "in-process/fe.mjs" }),
    requirements: [Capability.PATH],
    files(file) {
      return hasSegment(file, "composables") && /^use-.*\.ts$/.test(file.split("/").at(-1));
    },
    analyze(file, context) {
      if (["node_modules", ".nuxt", "generated"].some((segment) => hasSegment(file.path, segment))) return;
      report(context, "info", file.path, 0, "composable filenames are camelCase (useX.ts), not kebab-case", "frontend-pa-vsa.md#composables");
    },
  }),
  defineFileRule({
    descriptor: createRuleDescriptor({ id: "MER-FE-043", source: "in-process/fe.mjs" }),
    requirements: [Capability.LINE_MAP],
    files(file) {
      const name = file.split("/").at(-1);
      return /\.(?:ts|vue)$/.test(name) && !/\.(?:spec|test)\./.test(name) &&
        !["composables", "node_modules", ".nuxt", "generated", "tests", "__tests__"].some((segment) => hasSegment(file, segment));
    },
    analyze(file, context) {
      for (const line of lineHits(file, useState)) {
        report(context, "warn", file.path, line, "useState belongs inside a composable — consume the owning composable, never the state key", "frontend-pa-vsa.md#composables");
      }
    },
  }),
]);
