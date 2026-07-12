#!/usr/bin/env node
// MER-RV-007 — ToResult/ToActionResult conversion has one owning extension class/site.
// Generic and non-generic overloads in that class are intentionally allowed.
// DOC: rivet.md#bridge-extensions
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(process.argv[2] || "");
if (!fs.existsSync(root)) process.exit(2);
const ownersByProject = new Map();

function* files(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["bin", "obj", "node_modules"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (entry.name.endsWith(".cs")) yield full;
  }
}

function nearestProject(file) {
  let dir = path.dirname(file);
  while (dir.startsWith(root)) {
    const project = fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".csproj"))
      .map((entry) => path.join(dir, entry.name))
      .sort()[0];
    if (project) return project;
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return root;
}

for (const file of files(root)) {
  const text = fs.readFileSync(file, "utf8");
  const namespace = text.match(/\bnamespace\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*[;{]/)?.[1] ?? "";
  const classes = [...text.matchAll(/\b((?:(?:public|internal|private|protected|static|sealed|abstract|partial)\s+)*)class\s+(\w+)\b/g)];
  for (let i = 0; i < classes.length; i++) {
    const start = classes[i].index;
    const end = classes[i + 1]?.index ?? text.length;
    if (!/\bstatic\s+[\w<>,.?\[\]]+\s+To(?:Action)?Result(?:<[^>]+>)?\s*\(\s*this\s+(?:global::)?(?:\w+\.)*RivetResult(?:\s*<[^()]+>)?\b/.test(text.slice(start, end))) continue;
    const project = nearestProject(file);
    if (!ownersByProject.has(project)) ownersByProject.set(project, new Map());
    const partial = /\bpartial\b/.test(classes[i][1]);
    const key = partial ? `${namespace}.${classes[i][2]}` : `${namespace}.${classes[i][2]}:${file}:${start}`;
    if (!ownersByProject.get(project).has(key)) {
      ownersByProject.get(project).set(key, { file, name: classes[i][2], line: text.slice(0, start).split("\n").length });
    }
  }
}

for (const ownerMap of ownersByProject.values()) {
  const owners = [...ownerMap.values()];
  if (owners.length <= 1) continue;
  for (const owner of owners) {
    const rel = path.relative(root, owner.file).split(path.sep).join("/");
    console.log(`MER-RV-007\twarn\t${rel}:${owner.line}\tToResult/ToActionResult conversion must have one owning extension class; found ${owners.length} owners\trivet.md#bridge-extensions`);
  }
}
