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
// A heading whose text starts with an ID-shaped word, its level, and what follows the ID. At level 2 it heads a rule
// whatever follows (`## BILL-001: Title`, `## BILL-001 — Title`, `## BILL-001 Title`), unless the ID starts with a
// NOT_RULE word and no colon follows it (`## SHA-256 Hashes`): `## ISO-001: Title` is a rule whatever its prefix.
const ID_HEADING = new RegExp(`^(#{1,6})\\s+(${ID})\\b(.*)`);
// What follows the ID in a heading that gives the rule no title.
const NO_TITLE = /^\s*[:—–-]?\s*$/;
// A level-2 heading in the `## ID: Title` form whose number isn't three digits (`## BILL-01: Title`), so its ID
// isn't read as one; without the colon (`## SHA-1 Notes`) it is an ordinary heading.
const MISNUMBERED = /^##\s+([A-Z]+(?:-[A-Z]+)*-\d+):/;
const HEADING = /^#{1,6}\s/;
// Every heading ends a field, but only a level 1 or 2 heading ends a rule; a `### Notes` subheading is part of it.
const SECTION = /^#{1,2}\s/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const RULE_ID = new RegExp(`\\b${ID}\\b`, "g");
const ONLY_RULE_ID = new RegExp(`^${ID}$`);
// Words that mark an ID-shaped word as prose, not a rule ID: a reference with one of them anywhere before its number
// (`HMAC-SHA-256` too), or a level-2 heading whose ID starts with one and has no colon after it.
const NOT_RULE = new Set([
  "SHA", // SHA-256, a hash
  "AES", // AES-256, a cipher
  "RFC", // RFC-822, an internet standard
  "ISO", // ISO-639, a standard
  "MER", // MER-BE-005, plumb's own rule IDs
  "D", // D-012, a decision record in docs/decisions/, as Casebridge names them
  "ADR", // ADR-003, an architecture decision record
  "HTTP", // HTTP-409, a status
]);
const prose = (id) => id.split("-").slice(0, -1).some((part) => NOT_RULE.has(part));
// A heading is judged on its first word only: a rule family may hold a listed word (`## FORM-D-001 Title`), and a
// heading wrongly read as a rule is reported for its missing fields, while one wrongly read as prose is skipped silently.
const proseHeading = (id) => NOT_RULE.has(id.split("-")[0]);
// The distinct matches of a pattern on a line, or of one of its groups.
const distinct = (line, pattern, group = 0) => new Set(Array.from(line.matchAll(pattern), (match) => match[group]));
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
  const misnumbered = [];
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
    const [, hashes, own, after] = ID_HEADING.exec(line) ?? [];
    // A rule ID or name cited more than once on a line is one reference, so it is reported once.
    for (const id of distinct(line, RULE_ID)) if (id !== own) references.push({ id, line: at });
    if (hashes === "##" && (!proseHeading(own) || after.startsWith(":"))) {
      rule = { id: own, line: at, titled: !NO_TITLE.test(after), fields: new Set() };
      rules.push(rule);
      field = null;
      continue;
    }
    if (HEADING.test(line)) {
      if (own && hashes !== "##") misheaded.push({ id: own, level: hashes.length, line: at });
      const number = !own && MISNUMBERED.exec(line)?.[1];
      if (number) misnumbered.push({ id: number, line: at });
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
      for (const name of distinct(line, CODE_NAME, 1)) {
        // A rule ID in code style is a rule reference, which the scan above already checks.
        if (!ONLY_RULE_ID.test(name)) references.push({ name, field, line: at });
      }
    }
  }
  return { rules, references, misheaded, misnumbered };
}

export const cpInvariantRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-CP-002", source: "in-process/cp-invariants.mjs" }),
    analyze(context) {
      const files = context.files.filter((file) => file.name === "INVARIANTS.md" && indexed(file));
      if (!files.length) return;
      const parsed = files.map((file) => ({ file, ...parse(file) }));
      const defined = new Map();
      for (const { file, rules, misnumbered } of parsed) {
        // A file whose every entry is headed at another level would otherwise pass with nothing checked.
        if (!rules.length) report(context, "error", file.path, 1, "defines no rule — head each one `## ID: Title` so its Owner and Proof are checked", docRef);
        for (const { id, line } of misnumbered) {
          report(context, "error", file.path, line, `${id} isn't a rule ID, so this heading isn't read as a rule — a rule ID ends in a hyphen and three digits`, docRef);
        }
        for (const rule of rules) {
          if (!rule.titled) report(context, "error", file.path, rule.line, `${rule.id} has no title — head it \`## ${rule.id}: Title\``, docRef);
          const first = defined.get(rule.id);
          if (first) report(context, "error", file.path, rule.line, `${rule.id} is already defined in ${first.path}:${first.line} — a rule ID is unique across the repository`, docRef);
          else defined.set(rule.id, { path: file.path, line: rule.line });
          for (const field of ["Owner", "Proof"]) {
            if (!rule.fields.has(field)) report(context, "error", file.path, rule.line, `${rule.id} has no ${field} — name ${field === "Owner" ? "the one place that enforces it" : "the test that fails if it is broken"}`, docRef);
          }
        }
      }
      // Every ID-shaped word is a rule reference, so a rule that is renamed or removed leaves no citation of it
      // unreported, even when it was the only rule with its prefix; only an undefined word with a NOT_RULE part
      // before its number is prose, so a defined `ISO-001` is cited like any rule.
      const unknown = (id) => !defined.has(id) && !prose(id);
      let index;
      for (const { file, references, misheaded } of parsed) {
        // The same goes for a heading at another level that starts with an ID: `### BILL-002 depends on this` names a
        // defined rule and `### SHA-256` is prose, while `### BILL-004: Title` is a rule headed at a level that isn't
        // read, or a reference to a rule that is gone.
        for (const { id, level, line } of misheaded) {
          if (unknown(id)) report(context, "error", file.path, line, `${id} is headed at level ${level} and no rule defines it: head a rule \`## ${id}: Title\`, or drop the reference`, docRef);
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
