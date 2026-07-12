#!/usr/bin/env node
// MER-BE-040 — review read-shaped projections returned from repository ports.
// DOC: backend-pa-vsa.md#cqrs-lite
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

for (const file of files(root)) {
  const text = fs.readFileSync(file, "utf8");
  const masked = text.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*/g,
    (value) => value.replace(/[^\r\n]/g, " "));
  const interfaces = /\binterface\s+I\w*Repository\b[^\{]*\{/g;
  for (const declaration of masked.matchAll(interfaces)) {
    const open = declaration.index + declaration[0].lastIndexOf("{");
    let depth = 1, end = open + 1;
    while (end < masked.length && depth) {
      if (masked[end] === "{") depth++;
      else if (masked[end] === "}") depth--;
      end++;
    }
    const body = masked.slice(open + 1, end - 1);
    const signature = /(?:^|[{};])\s*([\w<>,.?\[\]\s]+)\s+((?:Get|List|Find|Search|Read|Query)\w*)\s*\([^;{}]*\)\s*;/gms;
    for (const match of body.matchAll(signature)) {
      const returnType = match[1].replace(/\s+/g, " ").trim();
      if (!/\b[A-Za-z_]\w*(?:Dto|Row|View|Projection)\b|\bPaged(?:Result|List|Response)?\s*</.test(returnType)) continue;
      const methodOffset = open + 1 + match.index + match[0].indexOf(match[2]);
      const line = text.slice(0, methodOffset).split("\n").length;
      const rel = path.relative(root, file).split(path.sep).join("/");
      console.log(`MER-BE-040\twarn\t${rel}:${line}\tread-shaped repository return (${returnType}) merits review; prefer a focused query port when this is a projection\tbackend-pa-vsa.md#cqrs-lite`);
    }
  }
}
