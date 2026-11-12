import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { inBuildOutput, isCSharpTestCode } from "./helpers.mjs";

const source = "in-process/be-transport.mjs";
const closureRef = "rules/backend/never-reference-transport-contracts-from-a-module.md";
const MODULE_LAYERS = new Set(["Contracts", "Domain", "Application", "Infrastructure"]);
const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The namespaces the top-level transport contracts (Contracts/<Feature>/) declare, cut at the last
// ".Contracts": the API's wire types, e.g. App.Contracts for App.Contracts.Orders.
function transportRoots(context) {
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

// The transport contracts as the compiler has them: a type is one when a production file under Contracts/<Feature>/
// declares it, whatever its namespace, and `namespaces` holds each namespace such a type sits in.
function transportContracts(context) {
  const facts = context.csharpFacts;
  const known = new Map();
  const declares = (file) => {
    if (!known.has(file.path)) known.set(file.path, context.csharp.classify(file).contract === "transport" && !isCSharpTestCode(context, file));
    return known.get(file.path);
  };
  const namespaces = new Set();
  for (const entry of facts.types.values()) {
    if (entry.namespace && entry.parts.some((part) => declares(part.file))) namespaces.add(entry.namespace);
  }
  return {
    namespaces,
    // The type a reference or a using binds to, in the assembly the compiler bound.
    holds: (fact) => facts.partsOf(fact).some((part) => declares(part.file)),
    // A type by its full name, as an MSBuild <Using> item gives it.
    holdsName: (name) => Boolean(facts.types.get(name)?.parts.some((part) => declares(part.file))),
  };
}

const EDGE = "a controller, endpoint, request validator or transport mapper at the module root or under Contracts/";
const globalUsingMessage = (form) =>
  `${form} puts the API's transport contract in scope in every file of the project, modules included — ` +
  `remove it and add a file-level using in ${EDGE} that needs it`;

// A module's published contract, domain, use cases and adapters keep to the module's own types; the API's
// transport DTOs are mapped at the edge (module-root presentation files, Contracts/**/…TransportMapper). A module
// file is judged as MER-BE-001 and MER-BE-002 judge one: by each using's target and by the type of each use the
// compiler binds, so a wire type that arrives through `var`, the enclosing namespace or a global using is a use with
// no transport name on its line. A global using of the transport contracts (C# `global using` or MSBuild
// <Using Include>) hands those types to every module file without a using line to review. Global usings are project-scoped, so one in a test project,
// or in a props ItemGroup only test projects take (`'$(IsTestProject)' == 'true'`), leaks nothing into the
// modules. Build output repeats the usings.
const be018 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-018", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const facts = context.csharpFacts;
    const contracts = transportContracts(context);
    const roots = transportRoots(context);
    if (!roots.length && !contracts.namespaces.size) return;
    const rooted = roots.length ? new RegExp(`^(?:global::)?(?:${roots.map(escape).join("|")})\\b`) : null;
    // A name in the transport contracts: at or below a `.Contracts` root, or a namespace a transport type sits in.
    const named = (name) => Boolean(rooted?.test(name)) || contracts.namespaces.has(name.replace(/^global::/, ""));
    // A using the compiler read: its type, or a type inside it, is a transport type, or its namespace is theirs.
    const bindsTransport = (using) => using.targetKind === "type"
      ? [using, ...using.arguments].some((type) => contracts.holds(type))
      : named(using.target);

    for (const file of [...context.csharp.projectFiles, ...context.csharp.propsFiles]) {
      if (inBuildOutput(file.path) || isCSharpTestCode(context, file)) continue;
      for (const using of context.csharp.projectUsings(file)) {
        if (using.testOnly || !(named(using.include) || contracts.holdsName(using.include))) continue;
        context.report({ severity: "error", path: file.path, line: file.lineMap().lineAt(using.offset), message: globalUsingMessage(`<Using Include="${using.include}">`), docRef: closureRef });
      }
    }

    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path) || isCSharpTestCode(context, file)) continue;
      const classification = context.csharp.classify(file);
      const globals = new Set();
      for (const using of context.csharp.usings(file)) {
        if (!using.global) continue;
        const line = file.lineMap().lineAt(using.offset);
        if (!named(using.target) && !facts.usings(file).some((bound) => bound.global && bound.start >= using.offset && bound.start < using.end && bindsTransport(bound))) continue;
        // A statement split over lines is one global using; none of its lines is also a module reference.
        for (let covered = line; covered <= file.lineMap().lineAt(using.end - 1); covered++) globals.add(covered);
        context.report({ severity: "error", path: file.path, line, message: globalUsingMessage(using.text), docRef: closureRef });
      }
      if (!classification.module || !MODULE_LAYERS.has(classification.layer)) continue;
      const where = `module ${classification.module} ${classification.layer}`;
      const flagged = new Set();
      const flag = (line, used, declared) => {
        const key = `${line}\0${used}`;
        if (globals.has(line) || flagged.has(key)) return;
        flagged.add(key);
        context.report({
          severity: "error",
          path: file.path,
          line,
          message: declared
            ? `${where} declares itself in the transport namespace ${used} — move it to Contracts/<Feature>/ or use the module's namespace`
            : `${where} uses ${used}, the API's transport contract — map at the edge (${EDGE}) and keep the module on its own types`,
          docRef: closureRef,
        });
      };
      for (const match of context.csharp.mask(file).matchAll(/\bnamespace\s+([A-Za-z_][\w.]*)/g)) {
        if (named(match[1])) flag(file.lineMap().lineAt(match.index), match[1], true);
      }
      for (const using of facts.usings(file)) {
        if (!using.global && bindsTransport(using)) flag(using.line, using.target, false);
      }
      for (const reference of facts.references(file)) {
        if (!reference.qualifier && contracts.holds(reference)) flag(reference.line, facts.displayName(reference.to), false);
      }
    }
  },
});

export const beTransportRules = Object.freeze([be018]);
