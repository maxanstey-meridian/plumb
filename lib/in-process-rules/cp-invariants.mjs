import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import { createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { maskCSharpText } from "../engine/dotnet-analysis.mjs";
import { hasSegment, report, textOf } from "./helpers.mjs";

// Each module's invariants.yaml names the code that enforces a rule (`owner`) and the test or check
// that proves it (`proof`). Those names rot silently when code is renamed or deleted, so validate
// the strict YAML schema and check every listed symbol/path against the whole repository's code.
// Lexical: a type exists when a code file declares it, and its member when a file declaring the
// type has the member's name; anything nothing declares (a SQL trigger, table or column, an
// analyzer id, a test method) exists when each dotted part appears as a whole word in a code file.
// A C# comment never counts, so a deleted member it still mentions is reported. Existence is
// judged against the whole repository, not the run's scope, so narrowing a run only loses findings.

const docRef = "rules/invariants/give-every-invariant-entry-an-id-and-five-fields.md";
const ID = String.raw`[A-Z]+(?:-[A-Z]+)*-\d{3}`;
const RULE_ID = new RegExp(`\\b${ID}\\b`, "g");
const ONLY_RULE_ID = new RegExp(`^${ID}$`);
const ALLOWED_ENTRY_KEYS = new Set(["id", "title", "rule", "why", "owner", "proof", "accepts", "related"]);
const REQUIRED_TEXT_KEYS = ["title", "rule", "why"];
const SYMBOL_LIST_KEYS = ["owner", "proof"];
const NON_BARE_SYMBOL = /\s|[()<>]/;
// Words that mark an ID-shaped word as prose, not a rule ID, when appearing anywhere before its number
// (`HMAC-SHA-256` too).
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
// The distinct matches of a pattern in text, or of one of its groups.
const distinct = (text, pattern, group = 0) => new Set(Array.from(text.matchAll(pattern), (match) => match[group]));
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
    // Exclude invariants.yaml from tokenization so its own citations never keep deleted symbols alive.
    if (NOT_CODE.test(file.name) || file.name === "invariants.yaml") continue;
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

// What is wrong with a cited bare symbol or path, or nothing. A path, or a name with a file's extension,
// must match exactly one file by the end of its path, so a name that repeats is cited by more of its path;
// a path may instead name a folder. A name with another lower-case ending may be a file (`app.bicep`) or a
// name (`area.status`), so any file with that path will do. `Type.Member…` is checked by the files that
// declare Type (its further parts usually live on the member's own type); anything else by each dotted part
// appearing in the code. A `…Tests` name is a test class, so something must declare it.
function problem(name, index) {
  if (name.endsWith("/")) return folderExists(name.slice(0, -1), index) ? null : ", which isn't in the repository";
  if (name.includes("/") || FILE_NAME.test(name)) {
    const count = filesEnding(name, index);
    if (count === 1 || (count === 0 && name.includes("/") && folderExists(name, index))) return null;
    return count ? `, which matches ${count} files — cite more of its path` : ", which isn't in the repository";
  }
  if (/\.[a-z]\w*$/.test(name) && filesEnding(name, index)) return null;
  if (PLATFORM.test(name)) return null;
  const [head, member, ...rest] = name.split(".");
  const declarers = index.declarers.get(head);
  const found = declarers
    ? (!member || [...declarers].some((file) => index.wordsByPath.get(file.path).has(member))) && rest.every((part) => index.words.has(part))
    : !head.endsWith("Tests") && name.split(".").every((part) => index.words.has(part));
  return found ? null : ", which isn't in the code";
}

const oneLine = (text) => String(text).split(/\r?\n/)[0].replace(/\t+/g, " ").trim();

const lineAt = (file, textLength, offset) => {
  if (!Number.isInteger(offset) || offset < 0) return 1;
  return file.lineMap().lineAt(Math.min(offset, textLength));
};

const nodeLine = (file, textLength, node, fallback = 1) => {
  const offset = node?.range?.[0];
  return Number.isInteger(offset) ? lineAt(file, textLength, offset) : fallback;
};

function parseInvariantsFile(context, file, defined) {
  const text = textOf(file);
  const textLength = text.length;
  const lineOf = (node, fallback = 1) => nodeLine(file, textLength, node, fallback);
  const document = parseDocument(text);
  const references = [];

  if (document.errors.length) {
    for (const error of document.errors) {
      const detail = oneLine(error.message ?? "invalid YAML").replace(/:$/, "");
      report(context, "error", file.path, lineAt(file, textLength, error.pos?.[0]), `invalid YAML: ${detail}`, docRef);
    }
    return references;
  }

  if (!isMap(document.contents)) {
    report(context, "error", file.path, lineOf(document.contents), "invariants.yaml must be a YAML mapping with a top-level `invariants` list", docRef);
    return references;
  }

  let invariantsPair = null;
  for (const pair of document.contents.items) {
    if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
      report(context, "error", file.path, lineOf(pair.key), "unknown top-level key — only `invariants` is allowed", docRef);
      continue;
    }
    if (pair.key.value === "invariants") {
      invariantsPair = pair;
    } else {
      report(context, "error", file.path, lineOf(pair.key), `unknown top-level key \`${oneLine(pair.key.value)}\` — only \`invariants\` is allowed`, docRef);
    }
  }

  if (!invariantsPair) {
    report(context, "error", file.path, 1, "missing top-level `invariants` list", docRef);
    return references;
  }

  if (!isSeq(invariantsPair.value)) {
    report(context, "error", file.path, lineOf(invariantsPair.key), "`invariants` must be a non-empty list of invariant entries", docRef);
    return references;
  }

  if (!invariantsPair.value.items.length) {
    report(context, "error", file.path, lineOf(invariantsPair.key), "`invariants` must not be empty — define at least one invariant", docRef);
    return references;
  }

  for (const entry of invariantsPair.value.items) {
    const entryLine = lineOf(entry);
    if (!isMap(entry)) {
      report(context, "error", file.path, entryLine, "each entry in `invariants` must be a mapping", docRef);
      continue;
    }

    const fields = new Map();
    for (const pair of entry.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") {
        report(context, "error", file.path, lineOf(pair.key, entryLine), "unknown key — allowed keys are id, title, rule, why, owner, proof, accepts, related", docRef);
        continue;
      }
      const key = pair.key.value;
      if (!ALLOWED_ENTRY_KEYS.has(key)) {
        report(context, "error", file.path, lineOf(pair.key, entryLine), `unknown key \`${oneLine(key)}\` — allowed keys are id, title, rule, why, owner, proof, accepts, related`, docRef);
        continue;
      }
      fields.set(key, pair);
    }

    let validId = null;
    const idPair = fields.get("id");
    if (!idPair) {
      report(context, "error", file.path, entryLine, "invariant entry is missing required `id`", docRef);
    } else if (!isScalar(idPair.value) || typeof idPair.value.value !== "string" || !ONLY_RULE_ID.test(idPair.value.value)) {
      const shown = isScalar(idPair.value) && idPair.value.value != null ? oneLine(idPair.value.value) : "";
      const subject = shown ? `\`${shown}\`` : "`id`";
      report(context, "error", file.path, lineOf(idPair.key, entryLine), `${subject} isn't a valid rule ID — expected \`[A-Z]+(?:-[A-Z]+)*-\\d{3}\``, docRef);
    } else {
      validId = idPair.value.value;
      const idLine = lineOf(idPair.key, entryLine);
      const first = defined.get(validId);
      if (first) {
        report(context, "error", file.path, idLine, `${validId} is already defined in ${first.path}:${first.line} — a rule ID is unique across the repository`, docRef);
      } else {
        defined.set(validId, { path: file.path, line: idLine });
      }
    }

    const label = validId ?? "invariant entry";

    for (const key of REQUIRED_TEXT_KEYS) {
      const pair = fields.get(key);
      if (!pair) {
        report(context, "error", file.path, entryLine, `${label} is missing required \`${key}\``, docRef);
        continue;
      }
      const keyLine = lineOf(pair.key, entryLine);
      if (!isScalar(pair.value) || typeof pair.value.value !== "string" || !pair.value.value.trim()) {
        report(context, "error", file.path, keyLine, `${label} \`${key}\` must be a non-empty string`, docRef);
        continue;
      }
      if (key === "rule" || key === "why") {
        for (const id of distinct(pair.value.value, RULE_ID)) {
          if (id !== validId) references.push({ kind: "inline", id, line: keyLine });
        }
      }
    }

    const acceptsPair = fields.get("accepts");
    if (acceptsPair) {
      const keyLine = lineOf(acceptsPair.key, entryLine);
      if (!isScalar(acceptsPair.value) || typeof acceptsPair.value.value !== "string" || !acceptsPair.value.value.trim()) {
        report(context, "error", file.path, keyLine, `${label} \`accepts\` must be a non-empty string`, docRef);
      } else {
        for (const id of distinct(acceptsPair.value.value, RULE_ID)) {
          if (id !== validId) references.push({ kind: "inline", id, line: keyLine });
        }
      }
    }

    const relatedPair = fields.get("related");
    if (relatedPair) {
      const keyLine = lineOf(relatedPair.key, entryLine);
      if (!isSeq(relatedPair.value) || !relatedPair.value.items.length) {
        report(context, "error", file.path, keyLine, `${label} \`related\` must be a non-empty list of cross-module rule IDs`, docRef);
      } else {
        for (const item of relatedPair.value.items) {
          const itemLine = lineOf(item, keyLine);
          if (!isScalar(item) || typeof item.value !== "string" || !ONLY_RULE_ID.test(item.value)) {
            const shown = isScalar(item) && item.value != null ? oneLine(item.value) : "";
            const subject = shown ? `entry \`${shown}\`` : "entry";
            report(context, "error", file.path, itemLine, `${label} \`related\` ${subject} isn't a valid rule ID — expected \`[A-Z]+(?:-[A-Z]+)*-\\d{3}\``, docRef);
          } else {
            references.push({ kind: "related", id: item.value, ownerId: validId, line: itemLine });
          }
        }
      }
    }

    for (const field of SYMBOL_LIST_KEYS) {
      const pair = fields.get(field);
      if (!pair) {
        const guidance = field === "owner" ? "the enforcing boundary symbols or paths" : "the tests or checks that fail if it breaks";
        report(context, "error", file.path, entryLine, `${label} is missing required \`${field}\` — list ${guidance}`, docRef);
        continue;
      }
      const keyLine = lineOf(pair.key, entryLine);
      if (!isSeq(pair.value) || !pair.value.items.length) {
        report(context, "error", file.path, keyLine, `${label} \`${field}\` must be a non-empty list of bare symbol or path strings`, docRef);
        continue;
      }
      for (const item of pair.value.items) {
        const itemLine = lineOf(item, keyLine);
        if (!isScalar(item) || typeof item.value !== "string" || !item.value.trim()) {
          report(context, "error", file.path, itemLine, `${label} \`${field}\` entry must be a non-empty string`, docRef);
          continue;
        }
        if (NON_BARE_SYMBOL.test(item.value)) {
          report(context, "error", file.path, itemLine, `${field} entry \`${oneLine(item.value)}\` must be a bare symbol or path without whitespace, call parentheses, or generic brackets`, docRef);
          continue;
        }
        references.push({ kind: "symbol", field, name: item.value, line: itemLine });
      }
    }
  }

  return references;
}

export const cpInvariantRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-CP-002", source: "in-process/cp-invariants.mjs" }),
    analyze(context) {
      const legacyFiles = context.files.filter((file) => file.name === "INVARIANTS.md" && indexed(file));
      for (const file of legacyFiles) {
        report(context, "error", file.path, 1, "legacy INVARIANTS.md is no longer supported — migrate to invariants.yaml", docRef);
      }

      const files = context.files.filter((file) => file.name === "invariants.yaml" && indexed(file));
      if (!files.length) return;

      const defined = new Map();
      const parsed = files.map((file) => ({ file, references: parseInvariantsFile(context, file, defined) }));
      const unknownInline = (id) => !defined.has(id) && !prose(id);
      let index;

      for (const { file, references } of parsed) {
        for (const reference of references) {
          if (reference.kind === "inline") {
            if (unknownInline(reference.id)) {
              report(context, "error", file.path, reference.line, `refers to rule ${reference.id}, which no invariants.yaml defines`, docRef);
            }
            continue;
          }
          if (reference.kind === "related") {
            if (reference.id === reference.ownerId) {
              report(context, "error", file.path, reference.line, `\`related\` cites ${reference.id}, which is this entry's own ID — \`related\` is for cross-module rule IDs`, docRef);
            } else if (!defined.has(reference.id)) {
              report(context, "error", file.path, reference.line, `\`related\` refers to rule ${reference.id}, which no invariants.yaml defines`, docRef);
            } else if (defined.get(reference.id).path === file.path) {
              report(context, "error", file.path, reference.line, `\`related\` cites ${reference.id}, which is defined in the same file — \`related\` is for cross-module rule IDs`, docRef);
            }
            continue;
          }
          index ??= codeIndex(context.repositoryFiles.filter(indexed));
          const wrong = problem(reference.name, index);
          if (wrong) report(context, "error", file.path, reference.line, `${reference.field} cites \`${reference.name}\`${wrong}`, docRef);
        }
      }
    },
  }),
]);
