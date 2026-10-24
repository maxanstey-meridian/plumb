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

const EDGE = "a controller, endpoint, request validator or transport mapper at the module root or under Contracts/";
const globalUsingMessage = (form) =>
  `${form} puts the API's transport contract in scope in every file of the project, modules included — ` +
  `remove it and add a file-level using in ${EDGE} that needs it`;

// A module's published contract, domain, use cases and adapters keep to the module's own types; the API's
// transport DTOs are mapped at the edge (module-root presentation files, Contracts/**/…TransportMapper). A
// global using of the transport namespace (C# `global using` or MSBuild <Using Include>) hands those types to
// every module file without a using line to review. Global usings are project-scoped, so one in a test project,
// or in a props ItemGroup only test projects take (`'$(IsTestProject)' == 'true'`), leaks nothing into the
// modules. Build output repeats the usings.
const be018 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-018", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const namespaces = transportNamespaces(context);
    if (!namespaces.length) return;
    const alternatives = namespaces.map(escape).join("|");
    const transport = new RegExp(`^(?:global::)?(?:${alternatives})\\b`);
    const reference = new RegExp(`(?<![\\w.])(${alternatives})\\b(?:\\.[A-Za-z_]\\w*)*`);

    for (const file of [...context.csharp.projectFiles, ...context.csharp.propsFiles]) {
      if (inBuildOutput(file.path) || context.dotnetProjects.testEvidence(file).test) continue;
      for (const using of context.csharp.projectUsings(file)) {
        if (using.testOnly || !transport.test(using.include)) continue;
        context.report({ severity: "error", path: file.path, line: file.lineMap().lineAt(using.offset), message: globalUsingMessage(`<Using Include="${using.include}">`), docRef: closureRef });
      }
    }

    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path) || context.dotnetProjects.testEvidence(file).test) continue;
      const classification = context.csharp.classify(file);
      const masked = context.csharp.mask(file);
      const globals = new Set();
      for (const using of context.csharp.usings(file)) {
        if (!using.global || !transport.test(using.target)) continue;
        const line = file.lineMap().lineAt(using.offset);
        // A statement split over lines is one global using; none of its lines is also a module reference.
        for (let covered = line; covered <= file.lineMap().lineAt(using.end - 1); covered++) globals.add(covered - 1);
        context.report({ severity: "error", path: file.path, line, message: globalUsingMessage(using.text), docRef: closureRef });
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
            : `${where} uses ${used}, the API's transport contract — map at the edge (${EDGE}) and keep the module on its own types`,
          docRef: closureRef,
        });
      }
    }
  },
});

export const beTransportRules = Object.freeze([be018]);
