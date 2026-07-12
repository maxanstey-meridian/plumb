#!/usr/bin/env node
// MER-TE-008 — reusable exported/top-level test doubles live under
// TestSupport/<Module>. C# declarations are classified by brace depth so nested
// private doubles are not mistaken for block-namespace top-level types.
// DOC: testing-philosophy.md#test-doubles
import fs from "node:fs";
import path from "node:path";
import { walkFiles } from "./_lib/fs-scan.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);
const placement = /[\\/]TestSupport[\\/][^\\/]+[\\/]/;
const emit = (file, line, name) => console.log(`MER-TE-008\tinfo\t${path.relative(root, file)}:${line}\ttop-level test double ${name} lives outside TestSupport/<Module> — move reusable doubles to the owning module's test support\ttesting-philosophy.md#test-doubles`);
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

for (const file of walkFiles(root, root, { filter: (name) => /\.(cs|ts)$/.test(name) })) {
  if (!/(?:Tests?\.cs$|[\\/][Tt]ests?[\\/]|\.(?:spec|test)\.ts$)/.test(file) || placement.test(file)) continue;
  const source = fs.readFileSync(file, "utf8");
  if (file.endsWith(".ts")) {
    const lines = sanitize(source).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/^export\s+(?:default\s+)?(?:class|const|function)\s+((?:Fake|InMemory|Inline)[A-Z]\w*)\b/);
      if (match && !match[1].endsWith("Tests")) emit(file, i + 1, match[1]);
    }
    continue;
  }
  const lines = sanitize(source).split("\n");
  const blockNamespace = /^\s*namespace\s+[\w.]+\s*(?:\n\s*)?\{/m.test(lines.join("\n"));
  const topDepth = blockNamespace ? 1 : 0;
  let depth = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(/^\s*(?:(?:public|internal)\s+)?(?:sealed\s+)?(?:class|record)\s+((?:Fake|InMemory|Inline)[A-Z]\w*)\b/);
    if (match && !match[1].endsWith("Tests") && depth === topDepth) emit(file, i + 1, match[1]);
    for (const char of line) {
      if (char === "{") depth++;
      else if (char === "}") depth = Math.max(0, depth - 1);
    }
  }
}
