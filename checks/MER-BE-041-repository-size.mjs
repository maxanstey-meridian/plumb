#!/usr/bin/env node
// MER-BE-041 — a repository port with more than ten methods has too many responsibilities.
// DOC: backend-pa-vsa.md#ports-and-adapters
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "");
if (!fs.existsSync(root)) process.exit(2);

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["bin", "obj", "node_modules"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.name.endsWith(".cs") && /[\\/]Modules[\\/][^\\/]+[\\/]Application[\\/]Ports[\\/]/.test(full)) yield full;
  }
}

function matchingBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

for (const file of files(root)) {
  const text = fs.readFileSync(file, "utf8");
  for (const declaration of text.matchAll(/\binterface\s+(I\w*Repository)\b[^{}]*\{/g)) {
    const open = declaration.index + declaration[0].lastIndexOf("{");
    const close = matchingBrace(text, open);
    if (close < 0) continue;
    const body = text.slice(open + 1, close);
    const count = [...body.matchAll(/\b\w+\s*\([^;{}]*\)\s*;/gs)].length;
    if (count <= 10) continue;
    const line = text.slice(0, declaration.index).split("\n").length;
    const rel = path.relative(root, file).split(path.sep).join("/");
    console.log(`MER-BE-041\tinfo\t${rel}:${line}\t${declaration[1]} has ${count} methods; split repository responsibilities above ten signatures\tbackend-pa-vsa.md#ports-and-adapters`);
  }
}
