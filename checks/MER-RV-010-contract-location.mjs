#!/usr/bin/env node
// MER-RV-010 — contracts live in top-level Contracts/{Module}/, never inside Modules/.
// DOC: rivet.md#contract-location
import fs from "node:fs";
import path from "node:path";
import { csharpFiles, isTestSource, maskCSharp, nearestProject } from "./_lib/csharp-scan.mjs";

const root = path.resolve(process.argv[2] || "");
if (!fs.existsSync(root)) process.exit(2);
for (const file of csharpFiles(root)) {
  const project = nearestProject(root, file);
  if (isTestSource(root, file, project)) continue;
  const source = maskCSharp(fs.readFileSync(file, "utf8"));
  if (!/\[RivetContract\b[^\]]*\]/.test(source)) continue;
  const base = project === root ? root : path.dirname(project);
  const relativeProject = path.relative(base, file).split(path.sep).join("/");
  if (!/^Contracts\/[^/]+\/[^/]+\.cs$/.test(relativeProject)) {
    console.log(`MER-RV-010\terror\t${path.relative(root, file)}:0\tcontract classes live directly in top-level Contracts/{Module}/\trivet.md#contract-location`);
  }
}
