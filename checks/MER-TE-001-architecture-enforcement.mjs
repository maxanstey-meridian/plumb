#!/usr/bin/env node
// MER-TE-001 — .NET modular monoliths mechanically enforce architecture through
// Meridian.Analyzers, executable architecture-test APIs, or a CI/task plumb command.
// DOC: testing-philosophy.md#architecture-boundaries
import fs from "node:fs";
import path from "node:path";
import { walkDirs, walkFiles } from "./_lib/fs-scan.mjs";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);
const files = [...walkFiles(root, root, { filter: () => true })];
const moduleDirs = [...walkDirs(root, root, { filter: (name) => name === "Modules" })];
if (!moduleDirs.length || !files.some((f) => f.endsWith(".csproj"))) process.exit(0);
const projectFiles = files.filter((file) => file.endsWith(".csproj"));
const applicableProjects = moduleDirs.flatMap((moduleDir) => projectFiles
  .filter((project) => moduleDir.startsWith(path.dirname(project) + path.sep))
  .sort((a, b) => path.dirname(b).length - path.dirname(a).length)
  .slice(0, 1));

const withoutXmlComments = (source) => source.replace(/<!--[\s\S]*?-->/g, "");
const withoutCodeCommentsAndStrings = (source) => {
  let out = "", state = "code";
  for (let i = 0; i < source.length; i++) {
    const c = source[i], n = source[i + 1];
    if (state === "line") { if (c === "\n") { state = "code"; out += c; } else out += " "; continue; }
    if (state === "block") { if (c === "*" && n === "/") { out += "  "; i++; state = "code"; } else out += c === "\n" ? "\n" : " "; continue; }
    if (state === "string") { if (c === "\\") { out += "  "; i++; } else if (c === '"') { out += " "; state = "code"; } else out += c === "\n" ? "\n" : " "; continue; }
    if (state === "char") { if (c === "\\") { out += "  "; i++; } else if (c === "'") { out += " "; state = "code"; } else out += c === "\n" ? "\n" : " "; continue; }
    if (c === "/" && n === "/") { out += "  "; i++; state = "line"; }
    else if (c === "/" && n === "*") { out += "  "; i++; state = "block"; }
    else if (c === '"') { out += " "; state = "string"; }
    else if (c === "'") { out += " "; state = "char"; }
    else out += c;
  }
  return out;
};
const commandLikePlumb = (source) => source.split(/\r?\n/).some((line) => {
  const trimmed = line.trim();
  if (!trimmed || /^(?:#|\/\/)/.test(trimmed)) return false;
  return /(?:^|\brun:\s*|\bscript:\s*|"[^"]+"\s*:\s*")(?:(?:pnpm\s+exec|npx)\s+)?(?:[^\s"']*\/)?plumb(?:\s+(?:check|\.\.?\/|[^#\s"']+)|["']?\s*$)/.test(trimmed);
});
const isTestSource = (file) => {
  const relative = path.relative(root, file).split(path.sep).join("/");
  if (/(?:^|\/)[^/]*tests?(?:\/|$)/i.test(relative) || /Tests?\.cs$/i.test(path.basename(file))) return true;
  return projectFiles.some((project) => file.startsWith(path.dirname(project) + path.sep) && /tests?/i.test(path.basename(project)));
};

function analyzerReference(source) {
  const xml = withoutXmlComments(source);
  if (/<PackageReference\b[^>]*\bInclude\s*=\s*["']Meridian\.Analyzers["']/i.test(xml)) return true;
  for (const match of xml.matchAll(/<ProjectReference\b([^>]*)(?:\/>|>([\s\S]*?)<\/ProjectReference>)/gi)) {
    const attributes = match[1];
    const body = match[2] ?? "";
    const include = attributes.match(/\bInclude\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    const outputItemType = attributes.match(/\bOutputItemType\s*=\s*["']([^"']+)["']/i)?.[1] ??
      body.match(/<OutputItemType>\s*([^<]+)\s*<\/OutputItemType>/i)?.[1] ?? "";
    if (/(?:^|[\\/])Meridian\.Analyzers\.csproj$/i.test(include) && /^Analyzer$/i.test(outputItemType.trim())) return true;
  }
  return false;
}

function projectHasAnalyzer(project) {
  const sources = [project];
  let dir = path.dirname(project);
  while (dir === root || dir.startsWith(root + path.sep)) {
    const props = path.join(dir, "Directory.Build.props");
    if (fs.existsSync(props)) sources.push(props);
    if (dir === root) break;
    dir = path.dirname(dir);
  }
  return sources.some((file) => analyzerReference(fs.readFileSync(file, "utf8")));
}

let repositoryEnforced = false;
for (const file of files) {
  const base = path.basename(file);
  if (base.endsWith(".cs")) {
    const code = withoutCodeCommentsAndStrings(fs.readFileSync(file, "utf8"));
    const archUnitUse = /\b(?:ArchRuleDefinition\s*\.|new\s+ArchLoader\s*\()/.test(code) && /\.Check\s*\(/.test(code);
    const netArchUse = /\bTypes\.(?:InCurrentDomain|InAssembly|InAssemblies)\s*\(/.test(code) && /\.GetResult\s*\(/.test(code);
    if (isTestSource(file) && (archUnitUse || netArchUse)) repositoryEnforced = true;
    continue;
  }
  const automation = /[\/](?:\.github|\.gitlab|scripts|tasks)[\/]/.test(file) || /^(?:Makefile|Taskfile\.ya?ml)$/.test(base);
  if (automation && commandLikePlumb(fs.readFileSync(file, "utf8"))) repositoryEnforced = true;
}

for (const project of new Set(applicableProjects)) {
  if (repositoryEnforced || projectHasAnalyzer(project)) continue;
  console.log(`MER-TE-001\twarn\t${path.relative(root, project)}:1\t.NET Modules project has no mechanical architecture enforcement — use Meridian.Analyzers, ArchUnitNET/NetArchTest, architecture tests, or invoke plumb in CI/tasks\ttesting-philosophy.md#architecture-boundaries`);
}
