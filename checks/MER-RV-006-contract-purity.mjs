#!/usr/bin/env node
// MER-RV-006 — Rivet contracts are pure static declarations, not behavior containers.
// DOC: rivet.md#two-ways-in
import fs from "node:fs";
import path from "node:path";
import { csharpFiles, isTestSource, lineAt, maskCSharp } from "./_lib/csharp-scan.mjs";

const root = path.resolve(process.argv[2] || "");
if (!fs.existsSync(root)) process.exit(2);
const emit = (file, line, message) => console.log(`MER-RV-006\twarn\t${path.relative(root, file)}:${line}\t${message}\trivet.md#two-ways-in`);
const depthAt = (source, end) => {
  let depth = 0;
  for (let index = 0; index < end; index++) {
    if (source[index] === "{") depth++;
    else if (source[index] === "}") depth--;
  }
  return depth;
};

for (const file of csharpFiles(root)) {
  if (isTestSource(root, file)) continue;
  const source = maskCSharp(fs.readFileSync(file, "utf8"));
  const declaration = /\[RivetContract\b[^\]]*\]\s*((?:(?:public|internal|private|protected|abstract|sealed|static|partial)\s+)*)class\s+[A-Za-z_]\w*Contract\b[^\{]*\{/g;
  for (const match of source.matchAll(declaration)) {
    if (!/\bstatic\b/.test(match[1])) emit(file, lineAt(source, match.index), "[RivetContract] must annotate a static contract declaration");
    const open = match.index + match[0].lastIndexOf("{");
    let end = open + 1;
    for (let depth = 1; end < source.length && depth > 0; end++) {
      if (source[end] === "{") depth++;
      else if (source[end] === "}") depth--;
    }
    const body = source.slice(open + 1, end - 1);
    const bodyLine = lineAt(source, open + 1);
    const reported = new Set();
    const method = /(?:^|[;}])(\s*(?:(?:public|internal|private|protected|static|async|virtual|override|sealed|new|unsafe|extern|partial)\s+)*(?:[\w:<>,.?\[\]]+\s+)+[A-Za-z_]\w*\s*)\(/gms;
    for (const member of body.matchAll(method)) {
      if (depthAt(body, member.index + member[0].indexOf(member[1])) !== 0) continue;
      const start = member.index + member[0].indexOf(member[1]) + member[1].search(/\S/);
      const line = bodyLine + lineAt(body, start) - 1;
      reported.add(line);
      emit(file, line, "[RivetContract] classes may contain only const strings and static readonly RouteDefinition fields");
    }
    for (const [offset, lineSource] of body.split(/\r?\n/).entries()) {
      if (!/^\s*(?:public|internal|private|protected)\s+(?:static\s+)?(?!const\s+string\b)(?:readonly\s+|const\s+)?[\w:<>,.?\[\]]+\s+\w+\s*(?:=>|=|;|\{\s*(?:get|set|init)\b)/.test(lineSource) ||
          /\bstatic\s+readonly\s+.*RouteDefinition/.test(lineSource)) continue;
      const line = bodyLine + offset;
      if (!reported.has(line)) emit(file, line, "[RivetContract] classes may contain only const strings and static readonly RouteDefinition fields");
    }
  }
}
