#!/usr/bin/env node
// MER-RV-002 — route literals are forbidden within a contract-bearing project.
// Program.cs bootstrap endpoints remain MER-RV-008's responsibility.
// DOC: rivet.md#practical-rules
import fs from "node:fs";
import path from "node:path";
import { csharpFiles, isTestSource, lineAt, maskCSharp, nearestProject } from "./_lib/csharp-scan.mjs";

const root = path.resolve(process.argv[2] || "");
if (!fs.existsSync(root)) process.exit(2);
const projects = new Map();
for (const file of csharpFiles(root)) {
  const project = nearestProject(root, file);
  if (isTestSource(root, file, project)) continue;
  if (!projects.has(project)) projects.set(project, []);
  projects.get(project).push(file);
}

for (const files of projects.values()) {
  const contractBearing = files.some((file) => /\[RivetContract\b[^\]]*\]/.test(maskCSharp(fs.readFileSync(file, "utf8"))));
  if (!contractBearing) continue;
  for (const file of files) {
    if (path.basename(file) === "Program.cs") continue;
    const source = maskCSharp(fs.readFileSync(file, "utf8"), { preserveStringDelimiters: true });
    const pattern = /(?:\[Http(?:Get|Post|Put|Delete|Patch)|\.Map(?:Get|Post|Put|Delete|Patch))\(\s*(?:@|\$)*"/g;
    for (const match of source.matchAll(pattern)) {
      console.log(`MER-RV-002\terror\t${path.relative(root, file)}:${lineAt(source, match.index)}\tliteral route in a contract-bearing project — use the contract route (e.g. [HttpPost(XContract.CreateRoute)] / Contract.X.Route)\trivet.md#practical-rules`);
    }
  }
}
