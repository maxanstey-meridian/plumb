import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { inBuildOutput } from "./helpers.mjs";

const source = "in-process/be-transport.mjs";
const closureRef = "backend-pa-vsa.md#published-contract-closure";
const MODULE_LAYERS = new Set(["Contracts", "Domain", "Application", "Infrastructure"]);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The namespaces the top-level transport contracts (Contracts/<Feature>/) declare, cut at the last
// ".Contracts": the API's wire types, e.g. App.Contracts for App.Contracts.Orders.
function transportNamespaces(context) {
  const namespaces = new Set();
  for (const file of context.csharp.csharpFiles) {
    if (context.csharp.classify(file).contract !== "transport") continue;
    for (const match of context.csharp.mask(file).matchAll(/\bnamespace\s+([A-Za-z_][\w.]*)/g)) {
      const root = match[1].match(/^(.*\.Contracts)(?:\.|$)/)?.[1];
      if (root) namespaces.add(root);
    }
  }
  return [...namespaces];
}

const globalUsingMessage = (form) =>
  `${form} puts the API's transport contract in scope in every file of the project, modules included — ` +
  "remove it and add a file-level using in the controllers and Contracts transport mappers that need it";

// Global usings are project-scoped, so one in a test project, or in a props ItemGroup only test projects
// take (`'$(IsTestProject)' == 'true'`), leaks nothing into the modules. Build output repeats the usings.
const testOnly = (attributes) => {
  const condition = attributes.match(/\bCondition\s*=\s*(?:"([^"]*)"|'([^']*)')/);
  const value = (condition?.[1] ?? condition?.[2] ?? "").replace(/\s+/g, "");
  return /^(?:'\$\(IsTestProject\)'=='?true'?|'?true'?=='\$\(IsTestProject\)')$/i.test(value);
};
// An opening tag's attributes; quoted values may hold `>`, and a self-closing tag has no body.
const ATTRIBUTES = String.raw`((?:[^>"']|"[^"]*"|'[^']*')*)`;

// A module's published contract, domain, use cases and adapters keep to the module's own types; the API's
// transport DTOs are mapped at the edge (controllers, Contracts/**/…TransportMapper). A global using of
// the transport namespace (C# `global using` or MSBuild <Using Include>) hands those types to every module
// file without a using line to review.
const be018 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-018", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const namespaces = transportNamespaces(context);
    if (!namespaces.length) return;
    const alternatives = namespaces.map(escape).join("|");
    const transport = new RegExp(`^(?:global::)?(?:${alternatives})\\b`);
    const reference = new RegExp(`(?<![\\w.])(${alternatives})\\b(?:\\.[A-Za-z_]\\w*)*`);
    const globalUsing = new RegExp(`\\bglobal\\s+using\\s+(?:static\\s+)?(?:[A-Za-z_]\\w*\\s*=\\s*)?(?:global::)?(?:${alternatives})\\b[^;]*`, "g");

    for (const file of [...context.csharp.projectFiles, ...context.csharp.propsFiles]) {
      if (inBuildOutput(file.path) || context.dotnetProjects.testEvidence(file).test) continue;
      const xml = file.text().replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
      for (const group of xml.matchAll(new RegExp(String.raw`<ItemGroup\b${ATTRIBUTES}(?<!/)>([\s\S]*?)</ItemGroup>`, "g"))) {
        if (testOnly(group[1])) continue;
        const body = group.index + group[0].length - group[2].length - "</ItemGroup>".length;
        for (const item of group[2].matchAll(new RegExp(String.raw`<Using\b${ATTRIBUTES}>`, "g"))) {
          const include = item[1].match(/\bInclude\s*=\s*["']([^"']*)["']/)?.[1];
          if (!include || testOnly(item[1])) continue;
          for (const target of include.split(";").map((value) => value.trim()).filter((value) => transport.test(value))) {
            const line = file.lineMap().lineAt(body + item.index);
            context.report({ severity: "error", path: file.path, line, message: globalUsingMessage(`<Using Include="${target}">`), docRef: closureRef });
          }
        }
      }
    }

    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path) || context.dotnetProjects.testEvidence(file).test) continue;
      const classification = context.csharp.classify(file);
      const masked = context.csharp.mask(file);
      const globals = new Set();
      for (const match of masked.matchAll(globalUsing)) {
        const line = file.lineMap().lineAt(match.index);
        // A statement split over lines is one global using; none of its lines is also a module reference.
        for (let covered = line; covered <= file.lineMap().lineAt(match.index + match[0].length); covered++) globals.add(covered - 1);
        context.report({ severity: "error", path: file.path, line, message: globalUsingMessage(match[0].replace(/\s+/g, " ").trim()), docRef: closureRef });
      }
      if (!classification.module || !MODULE_LAYERS.has(classification.layer)) continue;
      const lines = masked.split(/\r?\n/);
      for (const [index, line] of lines.entries()) {
        const match = !globals.has(index) && line.match(reference);
        if (!match) continue;
        const used = match[0];
        const where = `module ${classification.module} ${classification.layer}`;
        context.report({
          severity: "error",
          path: file.path,
          line: index + 1,
          message: /\bnamespace\s+$/.test(line.slice(0, match.index))
            ? `${where} declares itself in the transport namespace ${used} — move it to Contracts/<Feature>/ or use the module's namespace`
            : `${where} uses ${used}, the API's transport contract — map at the edge (a controller or a Contracts transport mapper) and keep the module on its own types`,
          docRef: closureRef,
        });
      }
    }
  },
});

export const beTransportRules = Object.freeze([be018]);
