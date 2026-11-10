import path from "node:path";
import { createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { hasSegment, isTestScript, lineHits, report, under } from "./helpers.mjs";

const generatedHeader = (file) => {
  try { return /generated|do not edit/i.test(file.text().split("\n").slice(0, 5).join("\n")); }
  catch { return false; }
};
const readOnlyRef = "rules/tools/treat-generated-output-as-read-only-and-unlinted.md";
const contractsPackageRef = "rules/rivet/keep-generated-rivet-output-in-a-contracts-package.md";
const configureOnceRef = "rules/rivet/configure-the-rivet-client-once-at-startup.md";
const rgWord = "\\p{Alphabetic}\\p{Mark}\\p{Decimal_Number}\\p{Connector_Punctuation}\\p{Join_Control}";
const configureRivet = new RegExp(`(?<![${rgWord}])configureRivet\\(`, "u");

export const rvRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-RV-020", source: "in-process/rv.mjs" }),
    analyze(context) {
      const expected = new Set(["openapi.json", "schema.d.ts", "api.contract.json"]);
      for (const directory of context.rivet.artifactDirs) {
        for (const file of context.files) {
          if (!under(file.path, directory)) continue;
          if (!expected.has(file.name)) report(context, "error", file.path, 1, "hand-written file inside the generated artifact dir — only openapi.json, api.contract.json + schema.d.ts belong here; the facade lives in src/", readOnlyRef);
          else if (file.name === "schema.d.ts" && !generatedHeader(file)) report(context, "error", file.path, 1, "schema.d.ts is missing its openapi-typescript header — generated artifacts are read-only, regenerate via the repo's task", readOnlyRef);
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-RV-021", source: "in-process/rv.mjs" }),
    analyze(context) {
      const markers = new Set(context.files.filter((file) => file.name === "package.json" || /^nuxt\.config\..*$/.test(file.name)).map((file) => file.directory));
      const groups = new Map();
      for (const file of context.files) {
        // Test source by the shared definition (rules/tests/keep-frontend-tests-in-a-top-level-tests-folder.md).
        if (!file.path.endsWith(".ts") || hasSegment(file.path, "generated") || isTestScript(context, file)) continue;
        for (const line of lineHits(file, configureRivet)) {
          if (file.lineMap().lines[line - 1].includes("function configureRivet")) continue;
          let directory = file.directory, app = "";
          while (directory) {
            if (markers.has(directory)) { app = directory; break; }
            const parent = path.posix.dirname(directory);
            directory = parent === "." ? "" : parent;
          }
          if (!groups.has(app)) groups.set(app, []);
          groups.get(app).push({ file, line });
        }
      }
      for (const hits of groups.values()) {
        for (const hit of hits) {
          if (hits.length > 1) report(context, "error", hit.file.path, hit.line, `configureRivet called ${hits.length} times in this app — bootstrap Rivet exactly once, in a plugin`, configureOnceRef);
          else if (!hit.file.path.includes("plugins/")) report(context, "warn", hit.file.path, hit.line, "configureRivet should be called from a plugin at the app boundary", configureOnceRef);
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-RV-025", source: "in-process/rv.mjs" }),
    analyze(context) {
      for (const directory of context.rivet.artifactDirs) {
        if (directory.split("/").includes("packages")) continue;
        report(context, "warn", directory, 0, "generated output lives in a workspace packages/contracts package, not inside the app — the package boundary makes read-only structural", contractsPackageRef);
      }
    },
  }),
]);
