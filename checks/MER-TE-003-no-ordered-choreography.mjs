#!/usr/bin/env node
// MER-TE-003 — tests assert outcomes, not collaborator call choreography.
// Comments and string/character literals are erased before API matching.
// DOC: testing-philosophy.md#application--use-case-behaviour
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);
const patterns = [
  /\bReceived\.InOrder\s*\(/,
  /\bnew\s+MockSequence\s*\(/,
  /\.InSequence\s*\(/,
  /\b(?:VerifySequence|VerifyInOrder|verifyOrder)\s*\(/,
  /\bInOrder\s*\.\s*Verify\s*\(/,
];
const sanitize = (source) => {
  let out = "", state = "code", quote = "";
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (state === "line") { if (c === "\n") { state = "code"; out += c; } else out += " "; continue; }
    if (state === "block") { if (c === "*" && n === "/") { out += "  "; i++; state = "code"; } else out += c === "\n" ? "\n" : " "; continue; }
    if (state === "raw") { if (source.startsWith(quote, i)) { out += " ".repeat(quote.length); i += quote.length - 1; state = "code"; quote = ""; } else out += c === "\n" ? "\n" : " "; continue; }
    if (state === "quote") { if (c === "\\") { out += "  "; i++; } else if (c === quote) { out += " "; state = "code"; quote = ""; } else out += c === "\n" ? "\n" : " "; continue; }
    if (c === "/" && n === "/") { out += "  "; i++; state = "line"; }
    else if (c === "/" && n === "*") { out += "  "; i++; state = "block"; }
    else if (source.startsWith('"""', i)) { quote = source.slice(i).match(/^"{3,}/)[0]; out += " ".repeat(quote.length); i += quote.length - 1; state = "raw"; }
    else if (c === '"' || c === "'" || c === "`") { out += " "; state = "quote"; quote = c; }
    else out += c;
  }
  return out;
};

for (const file of walkFiles(root, root, { filter: (name) => /\.(cs|ts|js)$/.test(name) })) {
  if (!/(?:Tests?\.cs$|[\\/][Tt]ests?[\\/]|\.(?:spec|test)\.(?:ts|js)$)/.test(file)) continue;
  const lines = sanitize(fs.readFileSync(file, "utf8")).split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!patterns.some((pattern) => pattern.test(lines[i]))) continue;
    console.log(`MER-TE-003\twarn\t${path.relative(root, file)}:${i + 1}\tordered interaction assertion couples the test to choreography — assert the observable outcome instead\ttesting-philosophy.md#application--use-case-behaviour`);
  }
}
