import { createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { hasSegment, report } from "./helpers.mjs";

// Each INVARIANTS.md names the code that enforces a rule (Owner) and the test that proves it
// (Proof). Those names rot silently when code is renamed or deleted, so check each still exists.
// Lexical: a type exists when a code file declares it, and its member when a file declaring the
// type has the member's name; anything nothing declares (a SQL trigger, table or column, an
// analyzer id) exists when each dotted part appears as a whole word in a code file.

const docRef = "invariants-and-concurrency.md#recording-invariants";
const HEADING = /^## ([A-Z]+(?:-[A-Z]+)*-\d{3}):/;
const RULE_ID = /\b[A-Z]+(?:-[A-Z]+)*-\d{3}\b/g;
const FIELD = /^\*\*(\w+):\*\*/;
const CODE_NAME = /`([A-Za-z][\w./-]*)`/g;
const WORD = /[A-Za-z_]\w*(?:-\w+)*/g;
const DECLARATION = /\b(?:class|interface|record|struct|enum|type)\s+([A-Z]\w*)/g;
// A cited name ending in one of these can only be a file; another lower-case ending (`app.bicep`) is
// a file when one has that path, and otherwise a name (`session.FormVersionId` reads the same way).
const FILE_NAME = /\.(?:feature|ts|tsx|mts|js|mjs|vue|cs|csproj|props|targets|sql|json|ya?ml|txt|sh)$/;
// The platform's namespaces, which the repository uses but never declares.
const PLATFORM = /^(?:System|Microsoft)\./;
const NOT_CODE = /\.(?:md|png|jpe?g|gif|ico|webp|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp[34]|dll|exe|so|dylib|db|sqlite|snk|pfx|lock)$/i;

function codeIndex(context) {
  const words = new Set();
  const declarers = new Map();
  for (const file of context.files) {
    if (NOT_CODE.test(file.name) || hasSegment(file.path, "node_modules")) continue;
    let text;
    try { text = file.text(); } catch { continue; }
    if (text.includes("\0")) continue;
    for (const [word] of text.matchAll(WORD)) {
      words.add(word);
      for (const part of word.split("-")) words.add(part);
    }
    for (const [, name] of text.matchAll(DECLARATION)) {
      if (!declarers.has(name)) declarers.set(name, new Set());
      declarers.get(name).add(file);
    }
  }
  return { words, declarers, memberWords: new Map() };
}

function wordsOf(index, file) {
  if (!index.memberWords.has(file.path)) index.memberWords.set(file.path, new Set(file.text().match(WORD) ?? []));
  return index.memberWords.get(file.path);
}

function fileExists(name, context) {
  const path = name.replace(/\/$/, "");
  return context.files.some((file) => {
    const full = `/${file.path}`;
    return full.endsWith(`/${path}`) || full.includes(`/${path}/`);
  });
}

// A path or file by the end of its path; `Type.Member…` by the files that declare Type; anything else
// by each dotted part appearing in the code. A Proof names its test (a `…Tests` class or method, a
// file); its other code names explain what the test checks, and are not themselves checked.
function exists(name, field, context, index) {
  if (name.includes("/") || FILE_NAME.test(name)) return fileExists(name, context);
  if (/\.[a-z]\w*$/.test(name) && fileExists(name, context)) return true;
  const [head, ...members] = name.split(".");
  if (field === "Proof" && !head.endsWith("Tests")) return true;
  if (PLATFORM.test(name)) return true;
  const declarers = index.declarers.get(head);
  if (declarers) return members.every((member) => [...declarers].some((file) => wordsOf(index, file).has(member)));
  if (field === "Proof") return false;
  return name.split(".").every((part) => index.words.has(part));
}

function parse(file) {
  const rules = [];
  const references = [];
  const lines = file.text().split("\n");
  let rule = null, field = null;
  for (const [index, line] of lines.entries()) {
    const heading = HEADING.exec(line);
    if (heading) {
      rule = { id: heading[1], line: index + 1, fields: new Set() };
      rules.push(rule);
      field = null;
      continue;
    }
    if (line.startsWith("#")) { rule = null; field = null; continue; }
    const marker = FIELD.exec(line);
    if (marker) {
      field = marker[1];
      rule?.fields.add(field);
    }
    for (const [id] of line.matchAll(RULE_ID)) references.push({ id, line: index + 1 });
    if (rule && (field === "Owner" || field === "Proof")) {
      for (const [, name] of line.matchAll(CODE_NAME)) references.push({ name, field, line: index + 1 });
    }
  }
  return { rules, references };
}

export const cpInvariantRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-CP-002", source: "in-process/cp-invariants.mjs" }),
    analyze(context) {
      const files = context.files.filter((file) => file.name === "INVARIANTS.md" && !hasSegment(file.path, "node_modules"));
      if (!files.length) return;
      const parsed = files.map((file) => ({ file, ...parse(file) }));
      const defined = new Map();
      for (const { file, rules } of parsed) {
        for (const rule of rules) {
          const first = defined.get(rule.id);
          if (first) report(context, "error", file.path, rule.line, `${rule.id} is already defined in ${first.path}:${first.line} — a rule ID is unique across the repository`, docRef);
          else defined.set(rule.id, { path: file.path, line: rule.line });
          for (const field of ["Owner", "Proof"]) {
            if (!rule.fields.has(field)) report(context, "error", file.path, rule.line, `${rule.id} has no **${field}:** — name ${field === "Owner" ? "the one place that enforces it" : "the test that fails if it is broken"}`, docRef);
          }
        }
      }
      let index;
      for (const { file, references } of parsed) {
        for (const reference of references) {
          if (reference.id) {
            if (!defined.has(reference.id)) report(context, "error", file.path, reference.line, `refers to rule ${reference.id}, which no INVARIANTS.md defines`, docRef);
            continue;
          }
          index ??= codeIndex(context);
          if (!exists(reference.name, reference.field, context, index)) {
            report(context, "error", file.path, reference.line, `**${reference.field}:** cites \`${reference.name}\`, which no longer exists in the code`, docRef);
          }
        }
      }
    },
  }),
]);
