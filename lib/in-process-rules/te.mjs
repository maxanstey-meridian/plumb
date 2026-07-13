import { createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { hasSegment, pathDepth, relativeTo, report, under } from "./helpers.mjs";

const appTrees = new Set(["app", "pages", "components", "composables", "layouts", "plugins", "shared", "src"]);
const inAppTree = (relative) => appTrees.has(relative.split("/")[0]);

export const teRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TE-006", source: "in-process/te.mjs" }),
    analyze(context) {
      for (const config of context.files) {
        if (!/^nuxt\.config\./.test(config.name) || hasSegment(config.path, "node_modules") || pathDepth(config.path) >= 6) continue;
        const root = config.directory;
        const seen = new Set();
        for (const file of context.files) {
          if (!under(file.path, root) || hasSegment(file.path, "node_modules") || hasSegment(file.path, ".nuxt")) continue;
          const relative = relativeTo(file.path, root);
          const segments = relative.split("/");
          for (let index = 0; index < segments.length - 1; index++) {
            if (segments[index] !== "__tests__") continue;
            const directory = segments.slice(0, index + 1).join("/");
            if (!seen.has(directory) && inAppTree(directory)) {
              seen.add(directory);
              report(context, "warn", root ? `${root}/${directory}` : directory, 0, "frontend tests live in top-level tests/ — colocated __tests__/ dirs are not house style", "testing-philosophy.md#test-location");
            }
          }
        }
        for (const file of context.files) {
          if (!under(file.path, root) || hasSegment(file.path, "node_modules") || hasSegment(file.path, ".nuxt") || hasSegment(file.path, "__tests__")) continue;
          const relative = relativeTo(file.path, root);
          if (/\.(?:spec|test)\.ts$/.test(relative) && inAppTree(relative)) report(context, "warn", file.path, 0, "frontend tests live in top-level tests/ — move this colocated spec", "testing-philosophy.md#test-location");
        }
      }
    },
  }),
]);
