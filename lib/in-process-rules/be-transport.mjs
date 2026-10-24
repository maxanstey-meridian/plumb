import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";

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

// Global usings are project-scoped, so one in a test project leaks nothing into the modules.
const testSource = (evidence) => evidence.projectMetadata || evidence.projectName || evidence.path || evidence.fileName;

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
    const reference = new RegExp(`(?<![\\w.])(${alternatives})\\b(?:\\.[A-Za-z_]\\w*)*`);
    const globalUsing = new RegExp(`^\\s*global\\s+using\\s+(?:static\\s+)?(?:[A-Za-z_]\\w*\\s*=\\s*)?(?:global::)?((?:${alternatives})\\b(?:\\.[A-Za-z_]\\w*)*)`);
    const projectUsing = new RegExp(`<Using\\b[^>]*\\bInclude\\s*=\\s*["']((?:${alternatives})\\b[\\w.]*)["']`);

    for (const file of [...context.csharp.projectFiles, ...context.csharp.propsFiles]) {
      if (testSource(context.dotnetProjects.testEvidence(file))) continue;
      const xml = file.text().replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
      for (const [index, line] of xml.split(/\r?\n/).entries()) {
        const match = line.match(projectUsing);
        if (match) context.report({ severity: "error", path: file.path, line: index + 1, message: globalUsingMessage(`<Using Include="${match[1]}">`), docRef: closureRef });
      }
    }

    for (const file of context.csharp.csharpFiles) {
      const classification = context.csharp.classify(file);
      const lines = context.csharp.mask(file).split(/\r?\n/);
      const globals = new Set();
      if (!testSource(context.dotnetProjects.testEvidence(file))) {
        for (const [index, line] of lines.entries()) {
          const match = line.match(globalUsing);
          if (!match) continue;
          globals.add(index);
          context.report({ severity: "error", path: file.path, line: index + 1, message: globalUsingMessage(match[0].trim()), docRef: closureRef });
        }
      }
      if (!classification.module || !MODULE_LAYERS.has(classification.layer) || classification.testPath || classification.testFileName) continue;
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
