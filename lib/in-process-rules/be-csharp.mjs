import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { report } from "./helpers.mjs";

const source = "in-process/be-csharp.mjs";
const dependencyRef = "backend-pa-vsa.md#non-negotiable-dependency-rules";
const modulesRef = "backend-pa-vsa.md#across-modules";
const netRef = "backend-pa-vsa.md#net";
const moduleShapeRef = "backend-pa-vsa.md#standard-module-shape";
const insideModuleRef = "backend-pa-vsa.md#inside-a-module";
const normalized = (value) => value.replaceAll("\\", "/");
const parentOf = (value) => value.includes("/") ? value.slice(0, value.lastIndexOf("/")) : "";
const baseOf = (value) => value.slice(value.lastIndexOf("/") + 1);
const under = (file, directory) => !directory || file === directory || file.startsWith(`${directory}/`);
const parts = (file) => normalized(file).split("/");
const hasSegment = (file, segment) => parts(file).includes(segment);
const inBuildOutput = (file) => hasSegment(file, "obj") || hasSegment(file, "bin");
const lineAt = (file, offset) => file.lineMap().lineAt(offset);
const linesOf = (file, text = file.text()) => text.split(/\r?\n/);

function rootsWith(directory, files) {
  const roots = new Set();
  for (const file of files) {
    const segments = parts(file.path);
    for (let index = 0; index < segments.length - 1; index++) {
      if (segments[index] === directory) roots.add(segments.slice(0, index).join("/"));
    }
  }
  return [...roots].sort();
}

function backendRoots(files) {
  return rootsWith("Modules", files);
}

function commonBackendRoots(files) {
  const common = new Set(rootsWith("Common", files));
  return backendRoots(files).filter((root) => common.has(root));
}

function relativeTo(file, directory) {
  return directory ? file.slice(directory.length + 1) : file;
}

function filesBelow(files, directory) {
  return files.filter((file) => under(file.path, directory));
}

function matchingBrace(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}" && --depth === 0) return index;
  }
  return -1;
}

function declarations(text) {
  const pattern = /(?:public|internal)\s+(?:sealed\s+|abstract\s+|static\s+|partial\s+|readonly\s+)*(class|interface|record(?:\s+(?:class|struct))?|struct|enum)\s+([A-Za-z_]\w*)/g;
  return [...text.matchAll(pattern)];
}

function emit(context, id, severity, file, line, message, docRef) {
  context.report({ id, severity, path: file.path, line, message, docRef });
}

function regexLines(file, text, patterns, callback) {
  for (const [index, line] of linesOf(file, text).entries()) {
    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(line)) { callback(index + 1, line); break; }
    }
  }
}

const be001 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ ids: ["MER-BE-001", "MER-BE-002"], source }),
  requirements: [Capability.CSHARP],
  analyze(context) {
    const domainFramework = /^(?:Microsoft\.AspNetCore|Microsoft\.EntityFrameworkCore|Microsoft\.Extensions\.Logging|OpenTelemetry|FluentResults|Npgsql|Azure|System\.Net\.Http)(?:\.|$)/;
    const applicationFramework = /^(?:Microsoft\.AspNetCore|Microsoft\.EntityFrameworkCore|System\.Net\.Http|Npgsql|Azure)(?:\.|$)/;
    const lexicalReferences = (line) => {
      const references = [];
      const seen = new Set();
      const using = line.match(/^\s*(?:global\s+)?using\s+(?:static\s+)?(?:[A-Za-z_]\w*\s*=\s*)?((?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/);
      if (using) references.push(using[1].replace(/^global::/, ""));
      for (const match of line.matchAll(/\b((?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\b/g)) references.push(match[1].replace(/^global::/, ""));
      return references.filter((reference) => !seen.has(reference) && seen.add(reference));
    };
    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path) || hasSegment(file.path, "node_modules")) continue;
      const { layer } = context.csharp.classify(file);
      if (layer !== "Domain" && layer !== "Application") continue;
      const masked = context.csharp.mask(file);
      for (const [index, line] of masked.split(/\r?\n/).entries()) {
        for (const reference of lexicalReferences(line)) {
          const forbidden = layer === "Domain"
            ? /\.(?:Application|Infrastructure)(?:\.|$)/.test(reference) || domainFramework.test(reference)
            : /\.Infrastructure(?:\.|$)/.test(reference) || applicationFramework.test(reference);
          if (!forbidden) continue;
          emit(context, layer === "Domain" ? "MER-BE-001" : "MER-BE-002", "error", file, index + 1,
            layer === "Domain"
              ? `Domain depends on nothing outside itself — remove this reference (${reference})`
              : `Application must not depend on Infrastructure or transport frameworks — depend on a port instead (${reference})`, dependencyRef);
        }
      }
    }
    for (const backend of backendRoots(context.files)) {
      const hasDomain = context.csharp.csharpFiles.some((file) => under(file.path, backend ? `${backend}/Modules` : "Modules") && /(?:^|\/)Modules\/[^/]+\/Domain\//.test(file.path) && !inBuildOutput(file.path));
      if (!hasDomain) continue;
      for (const file of context.csharp.csharpFiles) {
        if (file.directory !== backend || inBuildOutput(file.path)) continue;
        const masked = context.csharp.mask(file);
        for (const [index, line] of masked.split(/\r?\n/).entries()) {
          const match = line.match(/^\s*global\s+using\s+(?:static\s+)?(?:[A-Za-z_]\w*\s*=\s*)?((?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/);
          if (!match) continue;
          const reference = match[1].replace(/^global::/, "");
          if (!domainFramework.test(reference) && !/\.(?:Application|Infrastructure)(?:\.|$)/.test(reference)) continue;
          emit(context, "MER-BE-001", "error", file, index + 1,
            `Domain depends on nothing outside itself — remove this global using (${reference})`, dependencyRef);
        }
      }
    }
  },
});

const be003 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ ids: ["MER-BE-003", "MER-BE-004", "MER-BE-005"], source }),
  requirements: [Capability.CSHARP],
  analyze(context) {
    const findingId = (segment) => segment === "Domain" ? "MER-BE-003" : segment === "Infrastructure" ? "MER-BE-004" : "MER-BE-005";
    for (const backend of backendRoots(context.csharp.csharpFiles)) {
      const seen = new Set();
      for (const file of filesBelow(context.csharp.csharpFiles, backend)) {
        const classification = context.csharp.classify(file);
        const owner = classification.backendRoot === backend ? classification.module : null;
        const layer = classification.backendRoot === backend ? classification.layer : null;
        const common = classification.backendRoot === backend && classification.common;
        for (const [index, line] of context.csharp.mask(file).split(/\r?\n/).entries()) {
          const hits = [];
          const using = line.match(/^\s*(global\s+)?using\s+(?:static\s+)?(?:[A-Za-z_]\w*\s*=\s*)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\.Modules\.([A-Za-z_]\w*)\.([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*))/);
          if (using) hits.push({ target: using[3], segment: using[4].split(".")[0], global: Boolean(using[1]) });
          else for (const match of line.matchAll(/\bModules\.([A-Za-z_]\w*)\.(Domain|Infrastructure|Application(?:\.Ports)?|Contracts)(?:\b|\.)/g)) {
            hits.push({ target: match[1], segment: match[2].split(".")[0], global: false });
          }
          for (const hit of hits) {
            const flag = hit.segment === "Contracts"
              ? common || Boolean(owner && owner !== hit.target && layer === "Domain")
              : owner ? owner !== hit.target : common || hit.global;
            if (!flag) continue;
            const id = findingId(hit.segment);
            const key = `${id}\t${file.path}\t${index + 1}\t${hit.target}\t${hit.segment}`;
            if (seen.has(key)) continue;
            seen.add(key);
            let message;
            if (hit.segment === "Contracts") message = `module ${owner || "outside module"} ${layer || "shared code"} must not use ${hit.target}.Contracts — published contracts are for Application and integration consumers`;
            else if (id === "MER-BE-003") message = `module ${owner || "outside module"} must not use ${hit.target}.Domain — consume a published contract or define a required port`;
            else if (id === "MER-BE-004") message = `module ${owner || "outside module"} must not use ${hit.target}.Infrastructure — bridge modules at the composition edge`;
            else message = `module ${owner || "outside module"} must not use ${hit.target}.Application internals — publish a contract under ${hit.target}.Contracts or define a consumer-owned required port`;
            emit(context, id, "error", file, index + 1, message, modulesRef);
          }
        }
      }
    }
  },
});

const be006 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-006", source }),
  requirements: [Capability.CSHARP],
  analyze(context) {
    for (const backend of commonBackendRoots(context.files)) {
      const commonDirectory = backend ? `${backend}/Common` : "Common";
      const modulesDirectory = backend ? `${backend}/Modules` : "Modules";
      const commonTypes = new Map(), bodies = new Map();
      for (const file of filesBelow(context.csharp.csharpFiles, commonDirectory)) {
        const text = context.csharp.source(file), masked = context.csharp.mask(file);
        const matches = declarations(masked);
        const hasInterface = matches.some((match) => match[1] === "interface");
        for (const match of matches) {
          const kind = match[1], name = match[2];
          if (!bodies.has(name)) {
            const relativeOpen = masked.slice(match.index).search(/[{};]/);
            let end = relativeOpen < 0 ? masked.length : match.index + relativeOpen + 1;
            if (relativeOpen >= 0 && masked[match.index + relativeOpen] === "{") {
              const close = matchingBrace(masked, match.index + relativeOpen);
              end = close < 0 ? masked.length : close + 1;
            }
            bodies.set(name, text.slice(match.index, end));
          }
          if (name.endsWith("Exception") || (hasInterface && kind !== "interface")) continue;
          if (!commonTypes.has(name)) commonTypes.set(name, file);
        }
      }
      const consumers = new Map([...commonTypes].map(([name]) => [name, new Set()]));
      for (const file of filesBelow(context.csharp.csharpFiles, modulesDirectory)) {
        const module = relativeTo(file.path, modulesDirectory).split("/")[0];
        const text = context.csharp.source(file);
        for (const name of commonTypes.keys()) if (new RegExp(`\\b${name}\\b`).test(text)) consumers.get(name).add(module);
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const [owner, body] of bodies) {
          const ownerConsumers = consumers.get(owner);
          if (!ownerConsumers?.size) continue;
          for (const [referenced, referencedConsumers] of consumers) {
            if (referenced === owner || !new RegExp(`\\b${referenced}\\b`).test(body)) continue;
            for (const module of ownerConsumers) if (!referencedConsumers.has(module)) { referencedConsumers.add(module); changed = true; }
          }
        }
      }
      for (const [name, modules] of [...consumers].sort(([left], [right]) => left.localeCompare(right))) {
        if (modules.size !== 1) continue;
        report(context, "info", commonTypes.get(name).path, 0,
          `Common type ${name} is referenced only by module ${[...modules][0]} — review ownership; move it only if ${[...modules][0]} truly owns it`, "backend-pa-vsa.md#sharedcommon-rule");
      }
    }
  },
});

const be007 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-007", source }),
  requirements: [Capability.CSHARP],
  analyze(context) {
    for (const backend of commonBackendRoots(context.files)) {
      const modulesDirectory = backend ? `${backend}/Modules` : "Modules";
      const portsDirectory = backend ? `${backend}/Common/Ports` : "Common/Ports";
      const domainTypes = new Map();
      for (const file of filesBelow(context.csharp.csharpFiles, modulesDirectory)) {
        const relative = relativeTo(file.path, modulesDirectory).split("/");
        if (relative[1] !== "Domain") continue;
        for (const match of declarations(context.csharp.source(file))) if (!domainTypes.has(match[2])) domainTypes.set(match[2], relative[0]);
      }
      for (const file of filesBelow(context.csharp.csharpFiles, portsDirectory)) {
        const text = context.csharp.source(file), local = new Set(declarations(text).map((match) => match[2])), lines = linesOf(file, text);
        for (const name of [...domainTypes.keys()].sort()) {
          if (local.has(name)) continue;
          const pattern = new RegExp(`\\b${name}\\b`), index = lines.findIndex((line) => pattern.test(line));
          if (index < 0) continue;
          report(context, "error", file.path, index + 1,
            `Common port exposes module-owned domain type ${name} — inline a port DTO, move a truly shared value type to Common, or split the port`, "backend-pa-vsa.md#sharedcommon-rule");
        }
      }
    }
  },
});

function simpleCSharpRule(id, { severity, active = () => true, select = () => true, patterns, message, docRef, mask = false, requirements = [Capability.CSHARP] }) {
  return defineRepositoryRule({
    descriptor: createRuleDescriptor({ id, source }), requirements,
    analyze(context) {
      if (!active(context)) return;
      const files = requirements.includes(Capability.DOTNET_PROJECTS)
        ? [...context.csharp.csharpFiles, ...context.dotnetProjects.projectFiles]
        : context.csharp.csharpFiles;
      for (const file of files) {
        if (!select(file)) continue;
        const text = mask && file.path.endsWith(".cs") ? context.csharp.mask(file) : file.text();
        regexLines(file, text, patterns, (line) => emit(context, id, severity, file, line, message, docRef));
      }
    },
  });
}

const be008 = simpleCSharpRule("MER-BE-008", {
  severity: "error", select: (file) => /(?:^|\/)Modules\/[^/]+\/Domain\//.test(file.path) && !inBuildOutput(file.path),
  patterns: [/\binterface\s+I[A-Za-z0-9_]*Repository\b/, /\bclass\s+[A-Za-z0-9_]*Repository\b/],
  message: "repository declarations belong in Application/Ports, not Domain", docRef: dependencyRef,
});

const be009 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-009", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    const type = "(?:(?:global::)?System\\.)?IServiceProvider";
    const patterns = [
      new RegExp(`\\b(?:private|protected|internal|public)\\s+(?:(?:static|readonly)\\s+)*${type}\\s*\\??\\s+[_A-Za-z]\\w*\\s*[;=]`, "g"),
      new RegExp(`\\b(?:public|internal|private|protected)\\s+(?:sealed\\s+|abstract\\s+|partial\\s+)*class\\s+\\w+(?:\\s*<[^>{}]+>)?\\s*\\([^)]*?${type}\\s*\\??\\s+[_A-Za-z]\\w*`, "g"),
      new RegExp(`\\b(?:public|internal|private|protected)\\s+\\w+\\s*\\([^)]*?${type}\\s*\\??\\s+[_A-Za-z]\\w*`, "g"),
    ];
    for (const file of context.csharp.csharpFiles) {
      if (!["Domain", "Application"].includes(context.csharp.classify(file).layer) || inBuildOutput(file.path)) continue;
      const masked = context.csharp.mask(file), found = new Set();
      for (const pattern of patterns) for (const match of masked.matchAll(pattern)) found.add(lineAt(file, match.index));
      for (const line of [...found].sort((a, b) => a - b)) report(context, "error", file.path, line,
        "System.IServiceProvider hides dependencies; inject the required port directly", dependencyRef);
    }
  },
});

const be010 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-010", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    const modules = new Set();
    for (const file of context.files) {
      if (inBuildOutput(file.path)) continue;
      const segments = parts(file.path);
      for (let index = 0; index + 2 < segments.length; index++) if (segments[index] === "Modules") modules.add(segments.slice(0, index + 2).join("/"));
    }
    for (const module of [...modules].sort()) {
      const name = baseOf(module), projectDirectory = parentOf(parentOf(module));
      const registration = context.file(`${module}/${name}Module.cs`);
      let extension = "";
      if (registration) {
        const match = context.csharp.source(registration).match(new RegExp(`\\b(Add${name}[A-Za-z0-9_]*Module)\\s*\\(\\s*this\\s+(?:[A-Za-z_][A-Za-z0-9_.]*\\.)?IServiceCollection\\b`, "s"));
        extension = match?.[1] ?? "";
      }
      if (!extension) {
        context.report({ severity: "warn", path: module, line: 0, message: `module ${name} must expose an Add${name}*Module IServiceCollection extension from ${name}Module.cs`, docRef: moduleShapeRef });
        continue;
      }
      const program = context.csharp.csharpFiles.find((file) => under(file.path, projectDirectory) && file.name === "Program.cs" && !inBuildOutput(file.path));
      if (!program || new RegExp(`\\.${extension}\\s*\\(`).test(context.csharp.source(program))) continue;
      const aggregates = new Set();
      for (const file of context.csharp.csharpFiles) {
        if (!under(file.path, projectDirectory) || inBuildOutput(file.path) || !new RegExp(`\\.${extension}\\s*\\(`).test(context.csharp.source(file))) continue;
        const pattern = new RegExp(`\\b(Add[A-Za-z0-9_]+)\\s*\\(\\s*this\\s+(?:[A-Za-z_][A-Za-z0-9_.]*\\.)?IServiceCollection\\b[\\s\\S]*?\\.${extension}\\s*\\(`, "g");
        for (const match of context.csharp.source(file).matchAll(pattern)) aggregates.add(match[1]);
      }
      if (![...aggregates].some((aggregate) => new RegExp(`\\.${aggregate}\\s*\\(`).test(context.csharp.source(program)))) {
        report(context, "warn", program.path, 0, `executable must compose ${extension} directly or through a called aggregate extension`, moduleShapeRef);
      }
    }
  },
});

const be011 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-011", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path)) continue;
      const classification = context.csharp.classify(file);
      if (classification.module && file.name.endsWith("Controller.cs") && !classification.atModuleRoot) {
        report(context, "warn", file.path, 0, "controllers live at the module root; do not create an Interface/ transport folder", moduleShapeRef);
      }
      if (classification.layer === "Interface" && !file.name.endsWith("Controller.cs")) {
        report(context, "warn", file.path, 0, "transport must not be placed in an Interface/ folder; keep endpoints/controllers at the module root", moduleShapeRef);
      }
    }
  },
});

const be012 = simpleCSharpRule("MER-BE-012", {
  severity: "error", requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS], select: (file) => !hasSegment(file.path, "obj"),
  patterns: [/\.Scan\(\s*\w+\s*=>/, /\bScrutor\b/, /FromAssembliesOf|AddClassesFromAssembl/],
  message: "no DI auto-scanning — register every use case and port explicitly in the module file", docRef: netRef,
});
const be013 = simpleCSharpRule("MER-BE-013", {
  severity: "error", requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS], select: (file) => !hasSegment(file.path, "obj"),
  patterns: [/using MediatR/, /\bIMediator\b/, /\bISender\b/, /"MediatR/],
  message: "no MediatR — call use cases directly: useCase.ExecuteAsync(command, ct)", docRef: netRef,
});
const be014 = simpleCSharpRule("MER-BE-014", {
  severity: "error", requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS], select: (file) => !hasSegment(file.path, "obj"),
  patterns: [/using AutoMapper/, /\bCreateMap</, /"AutoMapper/],
  message: "no AutoMapper — construct DTOs/records explicitly", docRef: netRef,
});

const be015 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-015", source }), requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    if (context.dotnetProjects.projects().some((project) => project.packages.some((item) => /EntityFrameworkCore|Dapper/i.test(item.include)))) return;
    const patterns = [/\bNpgsqlCommand\b/, /\bSqlCommand\b/, /\bNpgsqlDataReader\b/, /\.ExecuteReaderAsync?\b/, /\.ExecuteScalarAsync?\b/, /\.ExecuteNonQueryAsync?\b/, /\bGetOrdinal\b/, /\bCommandText\b/];
    for (const file of context.csharp.csharpFiles) {
      if (hasSegment(file.path, "obj")) continue;
      let hit = null;
      regexLines(file, context.csharp.source(file), patterns, (line) => { if (hit === null) hit = line; });
      if (hit !== null) {
        report(context, "warn", file.path, hit, "no EF Core or Dapper referenced but raw ADO.NET SQL is hand-rolled here — adopt EF Core or Dapper to reduce AI agent cognitive load", netRef);
        return;
      }
    }
  },
});

const be020 = simpleCSharpRule("MER-BE-020", {
  severity: "warn", select: (file) => hasSegment(file.path, "Modules") && !hasSegment(file.path, "obj"),
  patterns: [/^\s*public\s+(?:partial\s+)?class\s+(?![A-Za-z0-9_]*Workflow\b)(?![^\n]*AbstractValidator<)[A-Za-z0-9_]+/],
  message: "concrete classes in Modules must be sealed (exceptions: Temporal workflows, open-generic validators)", docRef: netRef,
});
const be021 = simpleCSharpRule("MER-BE-021", {
  severity: "warn", select: (file) => hasSegment(file.path, "Modules") && !inBuildOutput(file.path),
  patterns: [/^\s*(?:public|internal|private|protected)?\s*(?:sealed\s+|partial\s+)*class\s+[A-Za-z_][A-Za-z0-9_]*(?:Command|Result|Request|Response|Dto|Data|Snapshot)\b/],
  message: "message and data shapes (*Command/*Result/*Request/*Response/*Dto/*Data/*Snapshot) should be records", docRef: netRef,
});

function parameterHasCancellationToken(parameters) {
  const values = [], stack = { angle: 0, paren: 0, square: 0, brace: 0 }; let value = "";
  for (const character of parameters) {
    if (character === "," && !Object.values(stack).some(Boolean)) { values.push(value); value = ""; continue; }
    value += character;
    if (character === "<") stack.angle++; else if (character === ">" && stack.angle) stack.angle--;
    else if (character === "(") stack.paren++; else if (character === ")" && stack.paren) stack.paren--;
    else if (character === "[") stack.square++; else if (character === "]" && stack.square) stack.square--;
    else if (character === "{") stack.brace++; else if (character === "}" && stack.brace) stack.brace--;
  }
  values.push(value);
  return values.some((parameter) => {
    let top = "", angle = 0, paren = 0, square = 0, brace = 0;
    for (const character of parameter) {
      if (character === "<") { angle++; top += " "; continue; }
      if (character === ">" && angle) { angle--; top += " "; continue; }
      if (character === "(") { paren++; top += " "; continue; }
      if (character === ")" && paren) { paren--; top += " "; continue; }
      if (character === "[") { square++; top += " "; continue; }
      if (character === "]" && square) { square--; top += " "; continue; }
      if (character === "{") { brace++; top += " "; continue; }
      if (character === "}" && brace) { brace--; top += " "; continue; }
      top += angle || paren || square || brace ? " " : character;
    }
    return /\b(?:(?:global::)?System\.Threading\.)?CancellationToken\s*\??\s+[_A-Za-z]\w*(?:\s*=.*)?\s*$/s.test(top);
  });
}

const be022 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-022", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (!hasSegment(file.path, "Modules") || !file.name.endsWith("UseCase.cs") || inBuildOutput(file.path)) continue;
      const code = context.csharp.mask(file), classes = /\bclass\s+(\w*UseCase)\b[^\{]*\{/g;
      for (const declaration of code.matchAll(classes)) {
        const open = declaration.index + declaration[0].lastIndexOf("{"), close = matchingBrace(code, open);
        const end = close < 0 ? code.length : close + 1, body = code.slice(open + 1, end - 1);
        const methods = /\b(?:public|internal|private|protected)\s+(?:static\s+)?(?:async\s+)?[A-Za-z_][A-Za-z0-9_<>,.?\[\]\s]*\s+ExecuteAsync\s*\(/gs;
        let hasExecute = false;
        for (const method of body.matchAll(methods)) {
          hasExecute = true;
          const parameterOpen = method.index + method[0].lastIndexOf("("), parameterClose = matchingParenthesis(body, parameterOpen);
          const parameters = body.slice(parameterOpen + 1, parameterClose < 0 ? body.length : parameterClose);
          if (!parameterHasCancellationToken(parameters)) emit(context, "MER-BE-022", "error", file, lineAt(file, open + 1 + method.index), "ExecuteAsync must take a CancellationToken", netRef);
        }
        if (!hasExecute) emit(context, "MER-BE-022", "error", file, lineAt(file, declaration.index), "UseCase class must declare ExecuteAsync", netRef);
      }
    }
  },
});

function matchingParenthesis(text, open) {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "(") depth++;
    else if (text[index] === ")" && --depth === 0) return index;
  }
  return -1;
}

const be023 = simpleCSharpRule("MER-BE-023", {
  severity: "warn", select: (file) => hasSegment(file.path, "Modules") && !inBuildOutput(file.path),
  patterns: [/\bclass\s+[A-Za-z_][A-Za-z0-9_]*(?:Manager|Helper)\b/],
  message: "Manager/Helper class name is vague; name the concrete responsibility", docRef: "backend-pa-vsa.md#coding-style-rules",
});

const be024 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-024", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    for (const layer of ["Domain", "Application"]) for (const file of context.csharp.csharpFiles) {
      if (context.csharp.classify(file).layer !== layer || inBuildOutput(file.path)) continue;
      if (file.name.endsWith("Tests.cs") || file.path.split("/").slice(0, -1).some((segment) => segment.includes("Tests"))) continue;
      regexLines(file, context.csharp.mask(file), [/\b(?:DateTime|DateTimeOffset)\.(?:Now|UtcNow|Today)\b|\bTimeProvider\.System\b/], (line) => {
        emit(context, "MER-BE-024", layer === "Domain" ? "error" : "warn", file, line,
          `ambient time in ${layer}; pass time explicitly or depend on an application time port`, "backend-pa-vsa.md#resilience-and-time");
      });
    }
  },
});

const be030 = simpleCSharpRule("MER-BE-030", {
  severity: "error", active: (context) => context.files.some((file) => hasSegment(file.path, "Modules") && !hasSegment(file.path, "node_modules")),
  select: (file) => !hasSegment(file.path, "obj") && (file.name.endsWith("Controller.cs") || file.name.endsWith("Endpoints.cs")),
  patterns: [/\bI[A-Z][A-Za-z]*Repository\b/, /\bDbContext\b/],
  message: "transport must depend on use cases/queries, not repositories or DbContext", docRef: insideModuleRef,
});
const be031 = simpleCSharpRule("MER-BE-031", {
  severity: "error", select: (file) => !hasSegment(file.path, "obj") && (file.name.endsWith("Controller.cs") || file.name.endsWith("Endpoints.cs")),
  patterns: [/using Microsoft\.EntityFrameworkCore/, /using Npgsql/],
  message: "persistence imports do not belong at the transport edge", docRef: insideModuleRef,
});

const repositoryPortFile = (file) => /(?:^|\/)Modules\/[^/]+\/Application\/Ports\//.test(file.path);
const be040 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-040", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (!repositoryPortFile(file)) continue;
      const text = context.csharp.source(file), masked = context.csharp.mask(file), interfaces = /\binterface\s+I\w*Repository\b[^\{]*\{/g;
      for (const declaration of masked.matchAll(interfaces)) {
        const open = declaration.index + declaration[0].lastIndexOf("{"), close = matchingBrace(masked, open), body = masked.slice(open + 1, close < 0 ? masked.length : close);
        const signatures = /(?:^|[{};])\s*([\w<>,.?\[\]\s]+)\s+((?:Get|List|Find|Search|Read|Query)\w*)\s*\([^;{}]*\)\s*;/gms;
        for (const match of body.matchAll(signatures)) {
          const returnType = match[1].replace(/\s+/g, " ").trim();
          if (!/\b[A-Za-z_]\w*(?:Dto|Row|View|Projection)\b|\bPaged(?:Result|List|Response)?\s*</.test(returnType)) continue;
          const offset = open + 1 + match.index + match[0].indexOf(match[2]);
          report(context, "warn", file.path, lineAt(file, offset), `read-shaped repository return (${returnType}) merits review; prefer a focused query port when this is a projection`, "backend-pa-vsa.md#cqrs-lite");
        }
      }
    }
  },
});

const be041 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-041", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    for (const file of context.csharp.csharpFiles) {
      if (!repositoryPortFile(file)) continue;
      const text = context.csharp.source(file);
      for (const declaration of text.matchAll(/\binterface\s+(I\w*Repository)\b[^{}]*\{/g)) {
        const open = declaration.index + declaration[0].lastIndexOf("{"), close = matchingBrace(text, open);
        if (close < 0) continue;
        const count = [...text.slice(open + 1, close).matchAll(/\b\w+\s*\([^;{}]*\)\s*;/gs)].length;
        if (count > 10) report(context, "info", file.path, lineAt(file, declaration.index), `${declaration[1]} has ${count} methods; split repository responsibilities above ten signatures`, "backend-pa-vsa.md#ports-and-adapters");
      }
    }
  },
});

const be051 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-051", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    const nestedName = /^(?:Command|Result|Query|Response)$|(?:Command|Result)$/;
    for (const file of context.csharp.csharpFiles) {
      if (!hasSegment(file.path, "Modules") && !hasSegment(file.path, "Application")) continue;
      const text = context.csharp.mask(file); let depth = 0, pending = false; const typeDepths = [];
      for (const match of text.matchAll(/\b(class|record|struct|interface)\s+([A-Za-z_]\w*)|[{};]/g)) {
        if (match[0] === "{") { depth++; if (pending) { typeDepths.push(depth); pending = false; } }
        else if (match[0] === "}") { if (typeDepths.at(-1) === depth) typeDepths.pop(); depth--; }
        else if (match[0] === ";") pending = false;
        else {
          if (match[1] === "record" && typeDepths.length && nestedName.test(match[2])) report(context, "warn", file.path, lineAt(file, match.index),
            `Command/Result records are siblings of the use case, not nested inside it — lift ${match[2]} to a top-level record`, "backend-pa-vsa.md#commands-and-results");
          pending = true;
        }
      }
    }
  },
});

const be052 = simpleCSharpRule("MER-BE-052", {
  severity: "warn", select: (file) => !inBuildOutput(file.path), patterns: [/\b(?:record|class|struct)\s+\w*ErrorDto\b/],
  message: "use the canonical ErrorResponse(Code, Message, Errors) envelope — no *ErrorDto variants", docRef: "backend-pa-vsa.md#error-envelope",
});
const be053 = simpleCSharpRule("MER-BE-053", {
  severity: "warn", select: (file) => hasSegment(file.path, "Modules") && file.name.endsWith("UseCase.cs") && !inBuildOutput(file.path),
  patterns: [/public\s+(?:async\s+)?(?:Task<\s*)?[A-Za-z0-9_]*(?:Response|Dto)>?\s+(?:Execute|ExecuteAsync)\s*\(/],
  message: "use case returns a transport-shaped type (*Response/*Dto); return a domain type or *Result and map at the edge, or drop the use case if it only maps", docRef: "backend-pa-vsa.md#commands-and-results",
});

const be054 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-054", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    const files = context.csharp.csharpFiles.filter((file) => !inBuildOutput(file.path));
    const api = files.some((file) => /\[RivetContract\b|\b(?:MapControllers|AddControllers)\s*\(|\.Map(?:Get|Post|Put|Delete|Patch)\s*\(/.test(context.csharp.source(file)));
    if (!api) return;
    const matches = [];
    const declaration = /\b(?:record\s+(?:class\s+|struct\s+)?|class\s+|struct\s+)ErrorResponse\b/;
    for (const file of files) regexLines(file, context.csharp.source(file), [declaration], (line) => matches.push({ file, line }));
    if (!matches.length) return;
    if (matches.length > 1) for (const match of matches) report(context, "warn", match.file.path, match.line, "ErrorResponse must have one canonical declaration; duplicate found", "backend-pa-vsa.md#error-envelope");
    const canonical = /\bsealed\s+record(?:\s+class)?\s+ErrorResponse\s*\(\s*string\s+Code\s*,\s*string\s+Message\s*,\s*IReadOnlyDictionary\s*<\s*string\s*,\s*string\s*\[\s*\]\s*>\s*\?\s*Errors\s*=\s*null\s*\)\s*;/s;
    for (const file of new Set(matches.map((match) => match.file))) if (!canonical.test(context.csharp.source(file))) report(context, "warn", file.path, 0,
      "ErrorResponse must be sealed record ErrorResponse(string Code, string Message, IReadOnlyDictionary<string, string[]>? Errors = null)", "backend-pa-vsa.md#error-envelope");
  },
});

const be060 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-060", source }), requirements: [Capability.CSHARP],
  analyze(context) {
    const configs = [];
    for (const file of context.csharp.csharpFiles) {
      if (inBuildOutput(file.path)) continue;
      for (const match of context.csharp.source(file).matchAll(/class\s+\w+\s*:[^{]*IEntityTypeConfiguration<(\w+)>/g)) configs.push({ file, entity: match[1], line: lineAt(file, match.index) });
    }
    for (const config of configs) {
      const segments = parts(config.file.path), moduleIndex = segments.lastIndexOf("Modules");
      if (moduleIndex < 0) {
        report(context, "warn", config.file.path, config.line, `entity config for ${config.entity} lives outside Modules/ — entity mapping belongs in the owning module's Infrastructure`, "backend-pa-vsa.md#persistence");
        continue;
      }
      const owner = segments[moduleIndex + 1]; let entityOwner = null;
      for (const file of context.csharp.csharpFiles) {
        if (hasSegment(file.path, "obj")) continue;
        const candidate = parts(file.path), candidateModules = candidate.lastIndexOf("Modules");
        if (candidateModules < 0 || candidate[candidateModules + 2] !== "Domain") continue;
        if (new RegExp(`\\b(?:class|record)\\s+${config.entity}\\b`).test(context.csharp.source(file))) { entityOwner = candidate[candidateModules + 1]; break; }
      }
      if (entityOwner && entityOwner !== owner) report(context, "warn", config.file.path, config.line,
        `entity config for ${config.entity} lives in module ${owner} but the entity belongs to ${entityOwner} — the owning module maps its own entities`, "backend-pa-vsa.md#persistence");
    }
  },
});

export const beCSharpRules = Object.freeze([
  be001, be003, be006, be007, be008, be009, be010, be011, be012, be013, be014, be015,
  be020, be021, be022, be023, be024, be030, be031, be040, be041, be051, be052, be053, be054, be060,
]);
