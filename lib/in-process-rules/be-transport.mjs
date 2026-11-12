import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { moduleOfPath, underModuleFolder } from "./be-csharp.mjs";
import { DB_CONTEXT } from "./be-module-order.mjs";
import { inBuildOutput, isCSharpTestCode } from "./helpers.mjs";

const source = "in-process/be-transport.mjs";
const closureRef = "rules/backend/never-reference-transport-contracts-from-a-module.md";
const useCasesOnlyRef = "rules/backend/call-only-use-cases-from-a-controller.md";
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

// The transport classes: the repository types that take requests from outside (controllers, endpoint groups, auth
// event handlers, hubs, Razor pages). A type is one when any production part sits in a file named *Controller.cs or
// *Endpoints.cs (judged by type, so a partial class's other parts are covered), when it derives from one of the
// framework's transport bases, or when a type it is nested in is one. The `names` are full type names, as a
// reference's `from` gives them, and the `files` are the production files holding a part of one. One per scan.
const TRANSPORT_FILE_SUFFIXES = Object.freeze(["Controller.cs", "Endpoints.cs"]);
const TRANSPORT_BASES = Object.freeze([
  "Microsoft.AspNetCore.Mvc.ControllerBase",
  "Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationEvents",
  "Microsoft.AspNetCore.Authentication.RemoteAuthenticationEvents",
  "Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents",
  "Microsoft.AspNetCore.SignalR.Hub",
  "Microsoft.AspNetCore.Mvc.RazorPages.PageModel",
]);
const transports = new WeakMap();

export function transportClasses(context) {
  const facts = context.csharpFacts;
  if (!transports.has(facts)) transports.set(facts, buildTransportClasses(context, facts));
  return transports.get(facts);
}

function buildTransportClasses(context, facts) {
  const productionFiles = new Map();
  const production = (file) => {
    if (!productionFiles.has(file.path)) productionFiles.set(file.path, !inBuildOutput(file.path) && !isCSharpTestCode(context, file));
    return productionFiles.get(file.path);
  };
  const verdicts = new Map();
  const judge = (name) => {
    if (verdicts.has(name)) return verdicts.get(name);
    const entry = facts.types.get(name);
    if (!entry) return false;
    // Set before the walk up, so a containing chain that loops back ends as false.
    verdicts.set(name, false);
    const named = entry.parts.some((part) => production(part.file) && TRANSPORT_FILE_SUFFIXES.some((suffix) => part.file.name.endsWith(suffix)));
    const verdict = named || TRANSPORT_BASES.some((base) => facts.derivesFrom(name, base)) || (entry.containing !== null && judge(entry.containing));
    verdicts.set(name, verdict);
    return verdict;
  };
  const names = new Set();
  const files = new Set();
  for (const [name, entry] of facts.types) {
    if (!judge(name)) continue;
    names.add(name);
    for (const part of entry.parts) if (production(part.file)) files.add(part.file.path);
  }
  return { names, files };
}

// Each use a transport class makes of a type, in a production file the compiler read: a use written out (a
// qualifier is judged at the type it qualifies), or inferred through `var`, a lambda parameter, or an implicit
// using. One finding per line and type name.
function eachTransportUse(context, visit) {
  const facts = context.csharpFacts;
  const transport = transportClasses(context);
  const judged = new Set();
  for (const file of context.csharp.csharpFiles) {
    if (inBuildOutput(file.path) || isCSharpTestCode(context, file) || !facts.hasFacts(file)) continue;
    for (const reference of facts.references(file)) {
      if (reference.qualifier || !transport.names.has(reference.from)) continue;
      const key = `${file.path}\0${reference.line}\0${reference.to}`;
      if (judged.has(key)) continue;
      judged.add(key);
      visit(file, reference, facts.displayName(reference.from), facts.displayName(reference.to));
    }
  }
}

const emit = (context, id, file, line, message) => context.report({ id, severity: "error", path: file.path, line, message, docRef: useCasesOnlyRef });

// A module's Application, as one key: the backend root and the module, for a file under Modules/<module>/Application/.
const applicationOf = (filePath) => {
  if (!underModuleFolder(filePath, "Application")) return null;
  const placed = moduleOfPath(filePath);
  return `${placed.root}\0${placed.module}`;
};

// The types each module's Application implements: a base type's full name, to the Applications holding a production
// part of a class, record, or struct that has it among its bases. An interface that extends another implements nothing.
function implementedInApplication(context) {
  const implemented = new Map();
  for (const entry of context.csharpFacts.types.values()) {
    if (entry.kind === "interface") continue;
    for (const part of entry.parts) {
      const application = inBuildOutput(part.file.path) || isCSharpTestCode(context, part.file) ? null : applicationOf(part.file.path);
      if (application === null) continue;
      for (const base of entry.baseTypes) {
        if (!implemented.has(base)) implemented.set(base, new Set());
        implemented.get(base).add(application);
      }
    }
  }
  return implemented;
}

// MER-BE-067: a transport class calls use cases and nothing else of a module's: not a port (an interface declared
// under Modules/<module>/Application/, in Ports/ or beside the use cases) and not an Infrastructure adapter (a type
// every production part of which sits under Modules/<module>/Infrastructure/). A port is what Infrastructure
// implements, so an interface the same module's Application implements is a use case or a service behind an
// interface (one a decorator wraps, say), and is left alone. A record, enum, struct, delegate, or class under
// Application/ is a use case's input, output, or helper, and is left alone. A DbContext is MER-BE-030's.
const be067 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-067", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const facts = context.csharpFacts;
    const implemented = implementedInApplication(context);
    eachTransportUse(context, (file, reference, from, name) => {
      if (facts.derivesFrom(reference.to, DB_CONTEXT)) return;
      const parts = facts.partsOf(reference).filter((part) => !inBuildOutput(part.file.path) && !isCSharpTestCode(context, part.file));
      if (parts.length === 0) return;
      const applications = parts.map((part) => applicationOf(part.file.path)).filter((application) => application !== null);
      if (facts.types.get(reference.to).kind === "interface" && applications.length > 0) {
        if (applications.some((application) => implemented.get(reference.to)?.has(application))) return;
        emit(context, "MER-BE-067", file, reference.line, `${from} must not use ${name}, a module's port — a controller calls use cases only; call a use case instead`);
      } else if (parts.every((part) => underModuleFolder(part.file.path, "Infrastructure"))) {
        emit(context, "MER-BE-067", file, reference.line, `${from} must not use ${name}, a module's Infrastructure adapter — a controller calls use cases only; call a use case instead`);
      }
    });
  },
});

// MER-BE-030: a transport class never uses a DbContext, the named one of the app or DbContext itself, from this
// repository or a referenced assembly, however the name reached the line (a field, a parameter, `var`).
const be030 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-030", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const facts = context.csharpFacts;
    eachTransportUse(context, (file, reference, from, name) => {
      if (!facts.derivesFrom(reference.to, DB_CONTEXT)) return;
      emit(context, "MER-BE-030", file, reference.line, `${from} must not use ${name}, a DbContext — a controller calls use cases only; call a use case instead`);
    });
  },
});

// MER-BE-031: persistence stays out of the transport edge. A file holding a transport class may not import
// Microsoft.EntityFrameworkCore or Npgsql (or a namespace or type below them, by whole segment, so
// Microsoft.EntityFrameworkCoreExtras is not one), and a transport class may not use a type from those namespaces
// however it came into scope (a global using, an implicit using, a qualified name). A DbContext is MER-BE-030's.
const PERSISTENCE_NAMESPACES = Object.freeze(["Microsoft.EntityFrameworkCore", "Npgsql"]);
const withinPersistence = (name) => PERSISTENCE_NAMESPACES.some((root) => name === root || name.startsWith(`${root}.`));
const be031 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-031", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const facts = context.csharpFacts;
    const transport = transportClasses(context);
    for (const file of context.csharp.csharpFiles) {
      if (!transport.files.has(file.path) || inBuildOutput(file.path) || isCSharpTestCode(context, file) || !facts.hasFacts(file)) continue;
      const judged = new Set();
      for (const using of facts.usings(file)) {
        const names = using.targetKind === "type" ? [using, ...using.arguments].map((named) => named.type).filter((name) => name !== null) : [using.target];
        for (const name of names) {
          const key = `${using.line}\0${name}`;
          if (judged.has(key) || !withinPersistence(name)) continue;
          judged.add(key);
          emit(context, "MER-BE-031", file, using.line, `${using.global ? "global using" : "using"} ${facts.displayName(name)} imports persistence into a file with a transport class — a controller calls use cases only; call a use case instead`);
        }
      }
    }
    eachTransportUse(context, (file, reference, from, name) => {
      if (!reference.namespace || !withinPersistence(reference.namespace) || facts.derivesFrom(reference.to, DB_CONTEXT)) return;
      emit(context, "MER-BE-031", file, reference.line, `${from} must not use ${name}, from the persistence namespace ${reference.namespace} — a controller calls use cases only; call a use case instead`);
    });
  },
});

export const beTransportRules = Object.freeze([be018, be030, be031, be067]);
