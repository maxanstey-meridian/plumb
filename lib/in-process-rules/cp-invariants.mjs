import { createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { maskCSharpText } from "../engine/dotnet-analysis.mjs";
import { hasSegment, report, textOf } from "./helpers.mjs";

// Each INVARIANTS.md names the code that enforces a rule (Owner) and the test that proves it
// (Proof). Those names rot silently when code is renamed or deleted, so check each still exists (a Proof's
// lower-case names may describe what its test checks, so only its paths, upper-case names, `…Tests` heads, and
// names with a lower-case ending, which may be files, are).
// Lexical: a type exists when a code file declares it, and its member when a file declaring the
// type has the member's name; anything nothing declares (a SQL trigger, table or column, an
// analyzer id, a test method) exists when each dotted part appears as a whole word in a code file.
// A C# comment never counts, so a deleted member it still mentions is reported. Existence is
// judged against the whole repository, not the run's scope, so narrowing a run only loses findings.

const docRef = "invariants-and-concurrency.md#recording-invariants";
const ID = String.raw`[A-Z]+(?:-[A-Z]+)*-\d{3}`;
const RULE_HEADING = new RegExp(`^## (${ID}):`);
// A heading whose text starts with a rule ID but isn't written `## ID: Title`, so it isn't read as a rule.
const ID_HEADING = new RegExp(`^#{1,6}\\s+(${ID})\\b`);
const HEADING = /^#{1,6}\s/;
// Every heading ends a field, but only a level 1 or 2 heading ends a rule; a `### Notes` subheading is part of it.
const SECTION = /^#{1,2}\s/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE_ID = new RegExp(`\\b${ID}\\b`, "g");
const ONLY_RULE_ID = new RegExp(`^${ID}$`);
// A rule ID's family is the ID without its number: BILL for BILL-009.
const family = (id) => id.replace(/-\d{3}$/, "");
const FIELD = /^\*\*(\w+):\*\*/;
// The name in front of any call or generic arguments: `Area.Freeze()` and `Repo<Gone>` cite `Area.Freeze` and `Repo`.
const CODE_NAME = /`([A-Za-z][\w./-]*)(?:\([^`]*\)|<[^`]*>)?`/g;
const WORD = /[A-Za-z_]\w*(?:-\w+)*/g;
const DECLARATION = /\b(?:class|interface|record|struct|enum|type)\s+([A-Z]\w*)/g;
// A cited name ending in one of these can only be a file.
const FILE_NAME = /\.(?:feature|ts|tsx|mts|js|mjs|vue|cs|csproj|props|targets|sql|json|ya?ml|txt|sh)$/;
// The platform's namespaces, which the repository uses but never declares.
const PLATFORM = /^(?:System|Microsoft)\./;
const NOT_CODE = /\.(?:md|png|jpe?g|gif|ico|webp|pdf|zip|gz|tgz|woff2?|ttf|otf|eot|mp[34]|dll|exe|so|dylib|db|sqlite|snk|pfx|lock)$/i;

// Installed packages repeat other files, so they neither keep a name alive nor count as a file. .NET build output
// (bin/, obj/) is git-ignored or skipped by the inventory already, and a tracked bin/ holds real scripts.
const indexed = (file) => !hasSegment(file.path, "node_modules");

function tokens(text) {
  const words = new Set();
  for (const [word] of text.matchAll(WORD)) {
    words.add(word);
    for (const part of word.split("-")) words.add(part);
  }
  return words;
}

function codeIndex(files) {
  const words = new Set();
  const wordsByPath = new Map();
  const declarers = new Map();
  for (const file of files) {
    if (NOT_CODE.test(file.name)) continue;
    let text = textOf(file);
    if (text.includes("\0")) continue;
    if (file.name.endsWith(".cs")) text = maskCSharpText(text, { keepStrings: true });
    const fileWords = tokens(text);
    wordsByPath.set(file.path, fileWords);
    for (const word of fileWords) words.add(word);
    for (const [, name] of text.matchAll(DECLARATION)) {
      if (!declarers.has(name)) declarers.set(name, new Set());
      declarers.get(name).add(file);
    }
  }
  return { files, words, wordsByPath, declarers };
}

// The files a cited path names by the end of their path, and whether it names a folder.
const filesEnding = (path, index) => index.files.filter((file) => `/${file.path}`.endsWith(`/${path}`)).length;
const folderExists = (path, index) => index.files.some((file) => `/${file.path}`.includes(`/${path}/`));

// What is wrong with a cited name, or nothing. A path, or a name with a file's extension, must match exactly one
// file by the end of its path, so a name that repeats is cited by more of its path; a path may instead name a
// folder. A name with another lower-case ending may be a file (`app.bicep`, each module's own `INVARIANTS.md`)
// or a name (`area.status`), so any file with that path will do. `Type.Member…` is checked by the files that
// declare Type (its further parts usually live on the member's own type); anything else by each dotted part
// appearing in the code. A `…Tests` name is a test class, so something must declare it. A Proof cites its test by
// a file, a path, a `…Tests` class, or a name that starts upper-case (a test method, `Type.Member`); any other
// name that starts lower-case and has no lower-case ending describes what the test checks (`current_timestamp`,
// `now()`), so it isn't checked. A lower-case name with a lower-case ending (`smoke.ps1`) may be a file, so it is.
// An Owner's lower-case names are code (a SQL trigger, table or policy), so they are all checked.
function problem(name, field, index) {
  if (name.endsWith("/")) return folderExists(name.slice(0, -1), index) ? null : ", which isn't in the repository";
  if (name.includes("/") || FILE_NAME.test(name)) {
    const count = filesEnding(name, index);
    if (count === 1 || (count === 0 && name.includes("/") && folderExists(name, index))) return null;
    return count ? `, which matches ${count} files — cite more of its path` : ", which isn't in the repository";
  }
  if (/\.[a-z]\w*$/.test(name) && filesEnding(name, index)) return null;
  if (field === "Proof" && /^[a-z]/.test(name) && !/\.[a-z]\w*$/.test(name) && !name.split(".")[0].endsWith("Tests")) return null;
  if (PLATFORM.test(name)) return null;
  const [head, member, ...rest] = name.split(".");
  const declarers = index.declarers.get(head);
  const found = declarers
    ? (!member || [...declarers].some((file) => index.wordsByPath.get(file.path).has(member))) && rest.every((part) => index.words.has(part))
    : !head.endsWith("Tests") && name.split(".").every((part) => index.words.has(part));
  return found ? null : ", which isn't in the code";
}

function parse(file) {
  const rules = [];
  const references = [];
  const misheaded = [];
  let rule = null, field = null, fence = null;
  for (const [index, line] of file.lineMap().lines.entries()) {
    const at = index + 1;
    // A fenced block is an example: nothing in it is a heading, a field, a name or a rule ID.
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      if (marker?.[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (marker) { fence = marker; continue; }
    const heading = RULE_HEADING.exec(line);
    const unread = heading ? null : ID_HEADING.exec(line);
    const own = heading?.[1] ?? unread?.[1];
    for (const [id] of line.matchAll(RULE_ID)) if (id !== own) references.push({ id, line: at });
    if (heading) {
      rule = { id: heading[1], line: at, fields: new Set() };
      rules.push(rule);
      field = null;
      continue;
    }
    if (HEADING.test(line)) {
      if (unread) misheaded.push({ id: unread[1], line: at });
      field = null;
      if (SECTION.test(line)) rule = null;
      continue;
    }
    const label = FIELD.exec(line);
    if (label) {
      field = label[1];
      rule?.fields.add(field);
    }
    if (rule && (field === "Owner" || field === "Proof")) {
      for (const [, name] of line.matchAll(CODE_NAME)) {
        // A rule ID in code style is a rule reference, which the scan above already checks.
        if (!ONLY_RULE_ID.test(name)) references.push({ name, field, line: at });
      }
    }
  }
  return { rules, references, misheaded };
}

export const cpInvariantRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-CP-002", source: "in-process/cp-invariants.mjs" }),
    analyze(context) {
      const files = context.files.filter((file) => file.name === "INVARIANTS.md" && indexed(file));
      if (!files.length) return;
      const parsed = files.map((file) => ({ file, ...parse(file) }));
      const defined = new Map();
      for (const { file, rules } of parsed) {
        // A file whose every entry is headed another way would otherwise pass with nothing checked.
        if (!rules.length) report(context, "error", file.path, 1, "defines no rule — head each one `## ID: Title` so its Owner and Proof are checked", docRef);
        for (const rule of rules) {
          const first = defined.get(rule.id);
          if (first) report(context, "error", file.path, rule.line, `${rule.id} is already defined in ${first.path}:${first.line} — a rule ID is unique across the repository`, docRef);
          else defined.set(rule.id, { path: file.path, line: rule.line });
          for (const field of ["Owner", "Proof"]) {
            if (!rule.fields.has(field)) report(context, "error", file.path, rule.line, `${rule.id} has no ${field} — name ${field === "Owner" ? "the one place that enforces it" : "the test that fails if it is broken"}`, docRef);
          }
        }
      }
      // An ID-shaped token is a rule reference only in a family the repository's rules use (BILL in BILL-009), so
      // `SHA-256` or a plumb rule ID is prose, while a wrong number in a known family is still reported.
      const families = new Set([...defined.keys()].map(family));
      const unknown = (id) => families.has(family(id)) && !defined.has(id);
      let index;
      for (const { file, references, misheaded } of parsed) {
        // The same goes for a heading that starts with an ID: `### BILL-002 depends on this` names a defined rule and
        // `## SHA-256 Hashes` names no rule, while `## BILL-004 — Title` is a rule written so it isn't read.
        for (const { id, line } of misheaded) {
          if (unknown(id)) report(context, "error", file.path, line, `${id}'s heading isn't read as a rule — write it as \`## ${id}: Title\` so the rule is checked`, docRef);
        }
        for (const reference of references) {
          if (reference.id) {
            if (unknown(reference.id)) {
              report(context, "error", file.path, reference.line, `refers to rule ${reference.id}, which no INVARIANTS.md defines`, docRef);
            }
            continue;
          }
          index ??= codeIndex(context.repositoryFiles.filter(indexed));
          const wrong = problem(reference.name, reference.field, index);
          if (wrong) report(context, "error", file.path, reference.line, `${reference.field} cites \`${reference.name}\`${wrong}`, docRef);
        }
      }
    },
  }),
]);
