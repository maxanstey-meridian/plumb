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

const identifiers = (text) => [...text.matchAll(/[A-Za-z_]\w*/g)].map((match) => match[0]);

// Positional records declared in non-test backend code, by name.
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
          line: file.lineMap().lineAt(part.offset + part.text.length - part.text.trimStart().length),
        };
      });
      const list = records.get(match[1]) ?? [];
      list.push({ name: match[1], file, parameters });
      records.set(match[1], list);
    }
  }
  return records;
}

// The request and response type names each Define.<Verb><…> declares.
function declaredPayloads(context) {
  const requests = new Set(), responses = new Set();
  for (const file of context.csharp.csharpFiles) {
    const classification = context.csharp.classify(file);
    if (classification.testPath || classification.testFileName) continue;
    const masked = context.csharp.mask(file);
    for (const match of masked.matchAll(/\bDefine\s*\.\s*(?:Get|Post|Put|Patch|Delete)\s*</g)) {
      const open = match.index + match[0].length - 1;
      const close = matchingCSharpDelimiter(masked, open, "<", ">");
      if (close < 0) continue;
      const parts = topLevelParts(masked.slice(open + 1, close), 0).map((part) => part.text);
      if (parts.length === 2) identifiers(parts[0]).forEach((name) => requests.add(name));
      identifiers(parts.at(-1)).forEach((name) => responses.add(name));
    }
    for (const match of masked.matchAll(/\.\s*Accepts\s*</g)) {
      const open = match.index + match[0].length - 1;
      const close = matchingCSharpDelimiter(masked, open, "<", ">");
      if (close >= 0) identifiers(masked.slice(open + 1, close)).forEach((name) => requests.add(name));
    }
  }
  return { requests, responses };
}

// Every record reachable from the given type names through record parameter types.
function closure(records, names) {
  const reached = new Set();
  const queue = [...names];
  while (queue.length) {
    const name = queue.pop();
    if (reached.has(name) || !records.has(name)) continue;
    reached.add(name);
    for (const record of records.get(name)) for (const parameter of record.parameters) queue.push(...identifiers(parameter.type));
  }
  return reached;
}

// A response record parameter with a default (or [RivetOptional]) lets a builder leave the field out
// and still compile; the gap only shows at runtime in the client. Required positional parameters
// make the compiler find every builder.
const rv027 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-RV-027", source }),
  requirements: [Capability.CSHARP],
  analyze(context) {
    const records = positionalRecords(context);
    const { requests, responses } = declaredPayloads(context);
    const requestRecords = closure(records, requests);
    for (const name of closure(records, responses)) {
      const alsoRequest = requestRecords.has(name) ? " (it's a request type too)" : "";
      for (const record of records.get(name)) {
        for (const parameter of record.parameters) {
          if (!parameter.hasDefault && !parameter.optional) continue;
          const what = parameter.hasDefault ? "has a default" : "is [RivetOptional]";
          context.report({
            severity: "warn",
            path: record.file.path,
            line: parameter.line,
            message: `${name}.${parameter.name} ${what} on a response, so a builder can leave it out and still compile — make it a required positional parameter${alsoRequest}`,
            docRef: payloadRef,
          });
        }
      }
    }
  },
});

export const rvResponseRules = Object.freeze([rv027]);
