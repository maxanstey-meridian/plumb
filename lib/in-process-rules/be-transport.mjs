import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";

const source = "in-process/be-transport.mjs";
const closureRef = "backend-pa-vsa.md#published-contract-closure";
const MODULE_LAYERS = new Set(["Contracts", "Domain", "Application"]);
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

// A module's published contract, domain and use cases keep to the module's own types; the API's
// transport DTOs are mapped at the edge (controllers, Contracts/**/…TransportMapper).
const be018 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-018", source }),
  requirements: [Capability.CSHARP],
  analyze(context) {
    const namespaces = transportNamespaces(context);
    if (!namespaces.length) return;
    const reference = new RegExp(`(?<![\\w.])(${namespaces.map(escape).join("|")})\\b(?:\\.[A-Za-z_]\\w*)*`);
    for (const file of context.csharp.csharpFiles) {
      const classification = context.csharp.classify(file);
      if (!classification.module || !MODULE_LAYERS.has(classification.layer) || classification.testPath || classification.testFileName) continue;
      for (const [index, line] of context.csharp.mask(file).split(/\r?\n/).entries()) {
        const used = line.match(reference)?.[0];
        if (!used) continue;
        context.report({
          severity: "error",
          path: file.path,
          line: index + 1,
          message: `module ${classification.module} ${classification.layer} uses ${used}, the API's transport contract — map at the edge (a controller or a Contracts transport mapper) and keep the module on its own types`,
          docRef: closureRef,
        });
      }
    }
  },
});

export const beTransportRules = Object.freeze([be018]);
