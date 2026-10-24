import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { matchingCSharpDelimiter } from "../engine/dotnet-analysis.mjs";

const source = "in-process/rv-responses.mjs";
const payloadRef = "rivet.md#route-payload-ownership";
const OPENERS = { "(": ")", "<": ">", "[": "]", "{": "}" };

// Top-level comma-separated parts of a parameter or generic argument list, with their offsets.
function topLevelParts(text, offset) {
  const parts = [];
  const stack = [];
  let start = 0;
  for (let index = 0; index <= text.length; index++) {
    const character = text[index];
    if (index === text.length || (character === "," && !stack.length)) {
      if (text.slice(start, index).trim()) parts.push({ text: text.slice(start, index), offset: offset + start });
      start = index + 1;
    } else if (OPENERS[character]) stack.push(OPENERS[character]);
    else if (character === stack.at(-1)) stack.pop();
  }
  return parts;
}

// The `=` that starts a parameter's default, at depth 0 and not part of =>, ==, <=, >= or !=.
function defaultAt(text) {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (OPENERS[character]) depth++;
    else if (Object.values(OPENERS).includes(character)) depth--;
    else if (character === "=" && !depth && text[index + 1] !== ">" && text[index + 1] !== "=" && !"<>!=".includes(text[index - 1])) return index;
  }
  return -1;
}

// Type names in a type expression as written (OrderDto, App.Contracts.Orders.OrderDto, global::App.OrderDto).
const identifiers = (text) =>
  [...text.matchAll(/(?:global::)?[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*/g)].map((match) => match[0].replace(/\s+/g, ""));

// ErrorResponse's `Errors = null` is canonical and BE-054 owns its shape and location, so it isn't
// followed. A PaginatedResponse is: its fields are always sent, so a default on one is the same gap.
const isErrorResponse = (type) => type.name === "ErrorResponse";

// Test code by any signal the project analysis has: test project metadata or name, a test folder or file name.
const isTest = (context, file) => context.dotnetProjects.testEvidence(file).test;

// `JsonIgnoreCondition.WhenWritingNull` / `.WhenWritingDefault`, bare, namespace-qualified or global::.
const DROPPING_CONDITION = String.raw`(?:global::)?(?:[\w.]+\.)?JsonIgnoreCondition\s*\.\s*(WhenWritingNull|WhenWritingDefault)\b`;
const CONDITIONAL_IGNORE = new RegExp(String.raw`\bJsonIgnore\s*\(\s*Condition\s*=\s*${DROPPING_CONDITION}`);
// A [JsonIgnore] that keeps the member off the wire entirely (no Condition, or Condition = Always).
const ALWAYS_IGNORED = /\bJsonIgnore\s*(?:\]|,|\(\s*(?:\)|Condition\s*=\s*(?:global::)?(?:[\w.]+\.)?JsonIgnoreCondition\s*\.\s*Always\b))/;
const GLOBAL_DROPPING = new RegExp(String.raw`\bDefaultIgnoreCondition\s*=\s*${DROPPING_CONDITION}`, "g");
// Where the host's response serializer is configured, which Rivet's .ToResult()/.ToActionResult() write with: the
// minimal API and MVC JSON options, in a host call (`ConfigureHttpJsonOptions(…)`, `AddJsonOptions(…)`,
// `Configure<JsonOptions>(…)`, `AddOptions<JsonOptions>().Configure(…)`) or the Configure method of an
// IConfigureOptions<JsonOptions>. A source-generated context's [JsonSourceGenerationOptions] and an adapter's
// own JsonSerializerOptions set only their own options.
const JSON_OPTIONS = String.raw`(?:global::)?(?:[\w.]+\.)?JsonOptions`;
const HOST_JSON_OPTIONS = new RegExp(String.raw`\b(?:ConfigureHttpJsonOptions|AddJsonOptions|(?:Post)?Configure\s*<\s*${JSON_OPTIONS}\s*>|AddOptions\s*<\s*${JSON_OPTIONS}\s*>\s*\(\s*\)\s*\.\s*(?:Post)?Configure\w*(?:\s*<[^<>()]*>)?)\s*\(`, "g");
const CONFIGURE_METHOD = new RegExp(String.raw`\bvoid\s+(?:Post)?Configure\s*\(\s*(?:string\??\s+\w+\s*,\s*)?${JSON_OPTIONS}\s+\w+\s*\)\s*(\{|=>)`, "g");
// A [JsonConverter] writes its type's JSON itself, so the type's own members aren't what the client sees.
const CONVERTER = /\bJsonConverter(?:Attribute)?\s*\(/;
const ATTRIBUTES = /^\s*(?:\[[^\]]*\]\s*)*/;
const MEMBER_MODIFIERS = new Set(["public", "private", "protected", "internal", "static", "readonly", "required", "virtual", "override", "abstract", "sealed", "new", "unsafe", "extern", "partial"]);

// One serialized member (a positional parameter or a public instance property) from its attribute list and
// the declaration after it; `from` is where its type name is looked up.
function member(file, attributes, name, type, offset, from, hasDefault) {
  return {
    name,
    type,
    hasDefault,
    optional: /\bRivetOptional\b/.test(attributes),
    omitted: attributes.match(CONDITIONAL_IGNORE)?.[1] ?? null,
    ignored: ALWAYS_IGNORED.test(attributes),
    converted: CONVERTER.test(attributes),
    line: file.lineMap().lineAt(offset),
    from: { file, offset: from },
  };
}

// A record's positional parameters.
function parametersOf(file, masked, open, close, declaration) {
  return topLevelParts(masked.slice(open + 1, close), open + 1).map((part) => {
    const attributes = part.text.match(ATTRIBUTES)[0];
    const declared = part.text.slice(attributes.length);
    const equals = defaultAt(declared);
    const signature = (equals < 0 ? declared : declared.slice(0, equals)).trim();
    const name = signature.match(/([A-Za-z_]\w*)$/)?.[1] ?? "?";
    // A parameter list doesn't see the record's nested types (CS0246), so its types are looked up from the declaration.
    return member(file, attributes, name, signature.slice(0, -name.length), part.offset + part.text.length - part.text.trimStart().length, declaration, equals >= 0);
  });
}

// An auto-property's accessor list (`get; init;`, `get; private set;`): every accessor bodiless.
const AUTO_ACCESSORS = /^(?:\s*(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal)\s+)*(?:get|set|init)\s*;)+\s*$/;

// The public instance property one member header declares (`[attrs] public required T Name`), or null for a
// field, method, constructor, indexer, event, operator or nested type. `accessors` is its accessor list, or
// null for an expression-bodied (computed) property.
function propertyOf(file, header, offset, accessors) {
  const text = header.replace(/^[ \t]*#.*$/gm, (line) => " ".repeat(line.length));
  const attributes = text.match(ATTRIBUTES)[0];
  const signature = text.slice(attributes.length).trim();
  if (!signature || /[(=]/.test(signature) || /\bthis\s*\[/.test(signature) || /\b(?:class|struct|interface|enum|record|delegate|event|operator|const|fixed)\b/.test(signature)) return null;
  const name = signature.match(/(?<![.\w])([A-Za-z_]\w*)$/)?.[1];
  if (!name) return null;
  const words = signature.slice(0, -name.length).trim().split(/\s+/);
  const modifiers = [];
  while (MEMBER_MODIFIERS.has(words[0])) modifiers.push(words.shift());
  if (!modifiers.includes("public") || modifiers.includes("static") || !words.length) return null;
  const start = offset + text.length - text.trimStart().length;
  // An abstract property is each subtype's to declare; an expression-bodied one is computed, never left unset.
  // A builder can leave out a public auto-property it sets with `init`/`set`; an override is the base's member.
  const settable = accessors !== null && AUTO_ACCESSORS.test(accessors) && /(?:^|[;\]\s])(?:set|init)\s*;/.test(accessors) &&
    !/\b(?:private|protected|internal)\s+(?:set|init)\b/.test(accessors) && !modifiers.includes("override");
  return {
    ...member(file, attributes, name, words.join(" "), start, start, false),
    field: accessors !== null && !modifiers.includes("abstract"), settable, required: modifiers.includes("required"), initializer: null,
  };
}

// The properties declared directly in a type body (`{ … }` between open and close), not in its nested types.
function propertiesOf(file, masked, open, close) {
  const properties = [];
  let start = open + 1;
  for (let index = open + 1; index < close; index++) {
    const character = masked[index];
    if (character === "(" || character === "[") {
      index = Math.max(index, matchingCSharpDelimiter(masked, index));
    } else if (character === "{") {
      const end = matchingCSharpDelimiter(masked, index);
      if (end < 0) break;
      const header = masked.slice(start, index);
      // A brace inside an initializer or expression body (`= new() { … };`, `=> new X { … }.Y;`) is not a member
      // body; a parameter default (`Describe(int indent = 0) { … }`) is no initializer.
      let bare = header.slice(header.match(ATTRIBUTES)[0].length);
      while (bare !== (bare = bare.replace(/\([^()]*\)/g, "")));
      if (/(?<![=!<>])=(?!=)/.test(bare)) { index = end; continue; }
      const property = propertyOf(file, header, start, masked.slice(index + 1, end));
      index = end;
      if (property) {
        properties.push(property);
        // An auto-property initializer runs to its own semicolon.
        const rest = masked.slice(end + 1, close).match(/^\s*=/);
        if (rest) {
          const from = end + 1 + rest[0].length;
          for (index = from; index < close && masked[index] !== ";"; index++) {
            if ("([{".includes(masked[index])) index = Math.max(index, matchingCSharpDelimiter(masked, index));
          }
          property.initializer = masked.slice(from, index).trim();
        }
      }
      start = index + 1;
    } else if (character === ";") {
      const header = masked.slice(start, index);
      const arrow = header.indexOf("=>");
      if (arrow >= 0) {
        const property = propertyOf(file, header.slice(0, arrow), start, null);
        if (property) properties.push(property);
      }
      start = index + 1;
    }
  }
  return properties;
}

// The class, struct or record declared at `offset` in a non-test file: its serialized members, whether it is a
// positional record, whether it is a partial part, and the cases its [JsonDerivedType] attributes name; null
// for an interface or enum. A type a [JsonConverter] writes is marked `converted`, with nothing else read.
function payloadTypeAt(context, file, offset) {
  if (isTest(context, file)) return null;
  const masked = context.csharp.mask(file);
  const head = masked.slice(offset).match(/^(class|struct|record(?:\s+(?:class|struct))?)\s+([A-Za-z_]\w*)\s*/);
  if (!head) return null;
  // The attribute lists before the declaration, back to the previous member or type boundary.
  const lead = masked.slice(Math.max(masked.lastIndexOf(";", offset), masked.lastIndexOf("}", offset), masked.lastIndexOf("{", offset)) + 1, offset);
  const before = masked.slice(Math.max(0, offset - 200), offset).match(/(?:\b[a-z]+\s+)*$/)[0];
  if (CONVERTER.test(lead)) return { name: head[2], file, offset, converted: true, partial: /\bpartial\b/.test(before), members: [], derived: [] };
  let cursor = offset + head[0].length;
  if (masked[cursor] === "<") {
    const close = matchingCSharpDelimiter(masked, cursor);
    if (close < 0) return null;
    cursor = close + 1;
  }
  while (/\s/.test(masked[cursor] ?? "")) cursor++;
  let members = [], positional = false;
  if (masked[cursor] === "(") {
    const close = matchingCSharpDelimiter(masked, cursor);
    if (close < 0) return null;
    // A class's primary constructor parameters are not serialized members; a record's positional ones are.
    if (head[1].startsWith("record")) { positional = true; members = parametersOf(file, masked, cursor, close, offset); }
    cursor = close + 1;
  }
  for (; cursor < masked.length && !"{;".includes(masked[cursor]); cursor++) {
    if ("([".includes(masked[cursor])) cursor = Math.max(cursor, matchingCSharpDelimiter(masked, cursor));
  }
  const body = masked[cursor] === "{" ? cursor : -1;
  if (body >= 0) {
    const close = matchingCSharpDelimiter(masked, body);
    if (close >= 0) members = [...members, ...propertiesOf(file, masked, body, close)];
  }
  // A type's own attributes see its nested types (`[JsonDerivedType(typeof(Case))]` on a union base), so a case
  // is looked up from inside the body when there is one.
  const derived = [...lead.matchAll(/\bJsonDerivedType\s*\(\s*typeof\s*\(([^()]*)\)/g)].map((match) => [
    match[1].replace(/\s+/g, ""),
    { file, offset: body >= 0 ? body + 1 : offset - lead.length + match.index },
  ]);
  return {
    name: head[2],
    kind: head[1].split(/\s+/)[0],
    file,
    offset,
    positional,
    partial: /\bpartial\b/.test(before),
    members,
    derived,
  };
}

// Payload types parsed on demand at their declarations, memoized by file and declaration offset.
function payloadTypes(context) {
  const parsed = new Map();
  return (declaration) => {
    const key = `${declaration.file.path}:${declaration.offset}`;
    if (!parsed.has(key)) parsed.set(key, payloadTypeAt(context, declaration.file, declaration.offset));
    return parsed.get(key);
  };
}

// The request and response type names each Define.<Verb><…> declares, each with where it's written, plus
// the typed responses a [RivetContract] adds with .Returns<T>(status) (ErrorResponse among them).
function declaredPayloads(context) {
  const requests = [], responses = [];
  for (const file of context.csharp.csharpFiles) {
    if (isTest(context, file)) continue;
    const masked = context.csharp.mask(file);
    for (const match of masked.matchAll(/\bDefine\s*\.\s*(?:Get|Post|Put|Patch|Delete)\s*</g)) {
      const open = match.index + match[0].length - 1;
      const close = matchingCSharpDelimiter(masked, open, "<", ">");
      if (close < 0) continue;
      const parts = topLevelParts(masked.slice(open + 1, close), 0).map((part) => part.text);
      if (parts.length === 2) identifiers(parts[0]).forEach((name) => requests.push([name, { file, offset: open }]));
      identifiers(parts.at(-1)).forEach((name) => responses.push([name, { file, offset: open }]));
    }
    for (const match of masked.matchAll(/\.\s*Accepts\s*</g)) {
      const open = match.index + match[0].length - 1;
      const close = matchingCSharpDelimiter(masked, open, "<", ">");
      if (close >= 0) identifiers(masked.slice(open + 1, close)).forEach((name) => requests.push([name, { file, offset: open }]));
    }
    if (!/\[\s*RivetContract\b/.test(masked)) continue;
    for (const match of masked.matchAll(/\.\s*Returns\s*</g)) {
      const open = match.index + match[0].length - 1;
      const close = matchingCSharpDelimiter(masked, open, "<", ">");
      if (close >= 0) identifiers(masked.slice(open + 1, close)).forEach((name) => responses.push([name, { file, offset: open }]));
    }
  }
  return { requests, responses };
}

// The payload type a type name refers to from where it's written, by the compiler's lookup: one declaration, or
// the merged parts of a partial type; null when it's outside the scan, ambiguous, or not a class, struct or record.
function resolve(context, typeAt, merged, name, from) {
  const resolved = context.csharp.resolveType(name, from.file, from.offset);
  const parts = [...new Set((resolved?.declarations ?? []).map(typeAt).filter(Boolean))];
  // A [JsonConverter] on any part writes the whole type.
  if (parts.some((part) => part.converted)) return null;
  if (parts.length <= 1) return parts[0] ?? null;
  if (!parts.every((part) => part.partial)) return null;
  if (!merged.has(resolved.fullName)) {
    const site = parts.find((part) => part.positional) ?? parts[0];
    merged.set(resolved.fullName, { ...site, positional: parts.some((part) => part.positional), members: parts.flatMap((part) => part.members), derived: parts.flatMap((part) => part.derived) });
  }
  return merged.get(resolved.fullName);
}

// Every payload type reachable from the given [type name, referrer] roots through the types of its serialized
// members (positional parameters and public properties) and the cases a polymorphic base names.
function closure(context, typeAt, merged, roots) {
  const reached = new Set();
  const queue = [...roots];
  while (queue.length) {
    const [name, from] = queue.pop();
    const type = resolve(context, typeAt, merged, name, from);
    if (!type || reached.has(type) || isErrorResponse(type)) continue;
    reached.add(type);
    for (const member of type.members) {
      if (!member.ignored && !member.converted) queue.push(...identifiers(member.type).map((child) => [child, member.from]));
    }
    queue.push(...type.derived);
  }
  return reached;
}

// A response record parameter with a default (or [RivetOptional]) lets a builder leave the field out
// and still compile; the gap only shows at runtime in the client. Required positional parameters
// make the compiler find every builder, so a response whose fields are properties is the same gap. A
// conditional [JsonIgnore] drops the field from the JSON, so the client sees it as optional too, and a global
// DefaultIgnoreCondition does that to every field of every response.
const rv027 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-027", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const typeAt = payloadTypes(context), merged = new Map();
    const { requests, responses } = declaredPayloads(context);
    const requestTypes = closure(context, typeAt, merged, requests);
    for (const type of closure(context, typeAt, merged, responses)) {
      const alsoRequest = requestTypes.has(type) ? " (it's a request type too)" : "";
      // A [JsonIgnore] member never reaches the client.
      const members = type.members.filter((member) => !member.ignored);
      // A type without property fields (`record Stages;`, a union base whose cases are nested records, abstract
      // or computed properties only) has nothing to leave out.
      if (!type.positional && members.some((member) => member.field)) {
        const shape = type.kind === "record" ? "a record whose fields are properties" : `a ${type.kind} with properties`;
        // A required or constructor-set property can't be left out, but positional is still the house shape.
        const reason = members.some((member) => member.field && member.settable && !member.required)
          ? ", so a builder can leave a field out and still compile"
          : "; response records take every field positionally";
        context.report({
          severity: "warn",
          path: type.file.path,
          line: type.file.lineMap().lineAt(type.offset),
          message: `Response type ${type.name} is ${shape}${reason} — declare it as a positional record${alsoRequest}`,
          docRef: payloadRef,
        });
      }
      // A body property that redeclares a positional parameter and reads it (`public string Name { get; init; } =
      // Name.Trim();`) is still set by the constructor; one that never reads it leaves it unset (CS8907).
      const parameters = new Set(members.filter((member) => !("field" in member)).map((member) => member.name));
      for (const member of type.positional ? members : []) {
        if (!member.settable || (parameters.has(member.name) && new RegExp(`(?<![\\w.@])${member.name}(?!\\w)`).test(member.initializer ?? ""))) continue;
        const problem = member.required
          ? "is a required body property, but response records take every field positionally"
          : "is set in the record body, so a builder can leave it out and still compile";
        context.report({
          severity: "warn",
          path: member.from.file.path,
          line: member.line,
          message: `${type.name}.${member.name} ${problem} — move it into the parameter list${alsoRequest}`,
          docRef: payloadRef,
        });
      }
      for (const member of members) {
        if (!member.hasDefault && !member.optional) continue;
        const problem = member.hasDefault && member.optional
          ? "has a default and is [RivetOptional] on a response, so a builder can leave it out and the client type marks it optional though the server always sends it — remove both"
          : member.hasDefault
            ? "has a default on a response, so a builder can leave it out and still compile — remove the default"
            : "is [RivetOptional] on a response, so the client type marks it optional though the server always sends it — drop the attribute";
        context.report({
          severity: "warn",
          path: member.from.file.path,
          line: member.line,
          message: `${type.name}.${member.name} ${problem}${alsoRequest}`,
          docRef: payloadRef,
        });
      }
      for (const member of members) {
        if (!member.omitted) continue;
        const when = member.omitted === "WhenWritingNull" ? "when it is null" : "when it holds its type's default (null, 0, false…)";
        context.report({
          severity: "warn",
          path: member.from.file.path,
          line: member.line,
          message: `${type.name}.${member.name} is [JsonIgnore(Condition = ${member.omitted})] on a response, so the server drops it from the JSON ${when} and the client sees the field as optional — remove the attribute so it is always sent${alsoRequest}`,
          docRef: payloadRef,
        });
      }
    }
    // A serializer-wide setting strips responses only in the host's JSON options, in a project that declares Rivet
    // responses or references one that does; an adapter's own JsonSerializerOptions or a tool's serializes
    // something else.
    const projects = context.dotnetProjects;
    const serving = new Set(responses.map(([, from]) => projects.nearestProject(from.file)?.path ?? null));
    const servesResponses = (file) => {
      const project = projects.nearestProject(file);
      return serving.has(project?.path ?? null) || Boolean(project && projects.referencedProjects(project).some((value) => serving.has(value.path)));
    };
    for (const file of context.csharp.csharpFiles) {
      if (isTest(context, file) || !servesResponses(file)) continue;
      const masked = context.csharp.mask(file);
      const calls = [...masked.matchAll(HOST_JSON_OPTIONS)].map((host) => {
        const open = host.index + host[0].length - 1;
        return [open, matchingCSharpDelimiter(masked, open)];
      });
      // A Configure method's body: its braces, or its expression up to the `;`.
      const methods = [...masked.matchAll(CONFIGURE_METHOD)].map((method) => {
        const open = method.index + method[0].length - 1;
        return [open, method[1] === "{" ? matchingCSharpDelimiter(masked, open) : masked.indexOf(";", open)];
      });
      const hosts = [...calls, ...methods].filter(([, close]) => close >= 0);
      for (const match of masked.matchAll(GLOBAL_DROPPING)) {
        if (!hosts.some(([open, close]) => open < match.index && match.index < close)) continue;
        const dropped = match[1] === "WhenWritingNull" ? "every null field" : "every field holding its type's default (null, 0, false…)";
        context.report({
          severity: "warn",
          path: file.path,
          line: file.lineMap().lineAt(match.index),
          message: `DefaultIgnoreCondition = ${match[1]} in the host's JSON options drops ${dropped} from every response, so the client sees all of them as optional — remove it so every field is always sent`,
          docRef: payloadRef,
        });
      }
    }
  },
});

export const rvResponseRules = Object.freeze([rv027]);
