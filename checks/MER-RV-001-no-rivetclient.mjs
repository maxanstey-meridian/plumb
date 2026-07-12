#!/usr/bin/env node
// MER-RV-001 — "[RivetClient] is the shortcut mode... not the house-style default for serious APIs"
// DOC: rivet.md#two-ways-in
import fs from "node:fs";
import path from "node:path";
import { csharpFiles, isTestSource, lineAt, maskCSharp } from "./_lib/csharp-scan.mjs";

const root = path.resolve(process.argv[2] || "");
if (!fs.existsSync(root)) process.exit(2);
for (const file of csharpFiles(root)) {
  if (isTestSource(root, file)) continue;
  const source = maskCSharp(fs.readFileSync(file, "utf8"));
  for (const match of source.matchAll(/\[RivetClient\b[^\]]*\]/g)) {
    console.log(`MER-RV-001\twarn\t${path.relative(root, file)}:${lineAt(source, match.index)}\tprefer an explicit [RivetContract] contract class — [RivetClient] is the shortcut mode\trivet.md#two-ways-in`);
  }
}
