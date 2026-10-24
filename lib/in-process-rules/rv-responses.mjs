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
const isErrorResponse = (record) => record.name === "ErrorResponse";

// Positional records declared in non-test backend code, by file and declaration offset.
function positionalRecords(context) {
  const records = new Map();
  for (const file of context.csharp.csharpFiles) {
    const classification = context.csharp.classify(file);
    if (classification.testPath || classification.testFileName) continue;
    const masked = context.csharp.mask(file);
    for (const match of masked.matchAll(/\brecord\s+(?:class\s+|struct\s+)?([A-Za-z_]\w*)\s*(<[^>(]*>)?\s*\(/g)) {
      const open = match.index + match[0].length - 1;
      const close = matchingCSharpDelimiter(masked, open, "(", ")");
      if (close < 0) continue;
      const parameters = topLevelParts(masked.slice(open + 1, close), open + 1).map((part) => {
        const attributes = part.text.match(/^\s*(?:\[[^\]]*\]\s*)*/)[0];
        const declaration = part.text.slice(attributes.length);
        const equals = defaultAt(declaration);
        const signature = (equals < 0 ? declaration : declaration.slice(0, equals)).trim();
        const name = signature.match(/([A-Za-z_]\w*)$/)?.[1] ?? "?";
        return {
          name,
          type: signature.slice(0, -name.length),
          hasDefault: equals >= 0,
          optional: /\bRivetOptional\b/.test(attributes),
          omitted: attributes.match(/\bJsonIgnore\s*\(\s*Condition\s*=\s*(?:[\w.]+\.)?JsonIgnoreCondition\s*\.\s*(WhenWritingNull|WhenWritingDefault)\b/)?.[1] ?? null,
          line: file.lineMap().lineAt(part.offset + part.text.length - part.text.trimStart().length),
        };
      });
      records.set(`${file.path}:${match.index}`, { name: match[1], file, offset: match.index, parameters });
    }
  }
  return records;
}

// The request and response type names each Define.<Verb><…> declares, each with where it's written, plus
// the typed responses a [RivetContract] adds with .Returns<T>(status) (ErrorResponse among them).
function declaredPayloads(context) {
  const requests = [], responses = [];
  for (const file of context.csharp.csharpFiles) {
    const classification = context.csharp.classify(file);
    if (classification.testPath || classification.testFileName) continue;
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

// The positional record a type name refers to from where it's written, by the compiler's lookup; null when
// it's outside the scan, ambiguous, or not a positional record.
function resolve(context, records, name, from) {
  const declarations = context.csharp.resolveType(name, from.file, from.offset)?.declarations ?? [];
  const found = [...new Set(declarations.map((declaration) => records.get(`${declaration.file.path}:${declaration.offset}`)).filter(Boolean))];
  return found.length === 1 ? found[0] : null;
}

// Every record reachable from the given [type name, referrer] roots through record parameter types.
function closure(context, records, roots) {
  const reached = new Set();
  const queue = [...roots];
  while (queue.length) {
    const [name, from] = queue.pop();
    const record = resolve(context, records, name, from);
    if (!record || reached.has(record) || isErrorResponse(record)) continue;
    reached.add(record);
    for (const parameter of record.parameters) queue.push(...identifiers(parameter.type).map((child) => [child, { file: record.file, offset: record.offset }]));
  }
  return reached;
}

// A response record parameter with a default (or [RivetOptional]) lets a builder leave the field out
// and still compile; the gap only shows at runtime in the client. Required positional parameters
// make the compiler find every builder. A conditional [JsonIgnore] drops the field from the JSON, so the
// client sees it as optional too.
const rv027 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-027", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
  analyze(context) {
    const records = positionalRecords(context);
    const { requests, responses } = declaredPayloads(context);
    const requestRecords = closure(context, records, requests);
    for (const record of closure(context, records, responses)) {
      const alsoRequest = requestRecords.has(record) ? " (it's a request type too)" : "";
      for (const parameter of record.parameters) {
        if (!parameter.hasDefault && !parameter.optional) continue;
        const problem = parameter.hasDefault && parameter.optional
          ? "has a default and is [RivetOptional] on a response, so a builder can leave it out and the client type marks it optional though the server always sends it — remove both"
          : parameter.hasDefault
            ? "has a default on a response, so a builder can leave it out and still compile — remove the default"
            : "is [RivetOptional] on a response, so the client type marks it optional though the server always sends it — drop the attribute";
        context.report({
          severity: "warn",
          path: record.file.path,
          line: parameter.line,
          message: `${record.name}.${parameter.name} ${problem}${alsoRequest}`,
          docRef: payloadRef,
        });
      }
      for (const parameter of record.parameters) {
        if (!parameter.omitted) continue;
        const when = parameter.omitted === "WhenWritingNull" ? "when it is null" : "when it holds its type's default (null, 0, false…)";
        context.report({
          severity: "warn",
          path: record.file.path,
          line: parameter.line,
          message: `${record.name}.${parameter.name} is [JsonIgnore(Condition = ${parameter.omitted})] on a response, so the server drops it from the JSON ${when} and the client sees the field as optional — remove the attribute so it is always sent${alsoRequest}`,
          docRef: payloadRef,
        });
      }
    }
  },
});

export const rvResponseRules = Object.freeze([rv027]);
