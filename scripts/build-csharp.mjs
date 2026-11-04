import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Capability } from "../lib/engine/contracts.mjs";
import { inProcessRules } from "../lib/in-process-rules/index.mjs";
import { TOOL_STAMP, toolSourceHash } from "../lib/engine/csharp-facts.mjs";
import { restoreProjects } from "./dotnet-restore.mjs";

// pnpm build:csharp: builds the C# facts tool, then restores the fixtures of every rule that reads its facts. An
// unrestored project opens with no error, but the names from its packages don't bind, so the tool reports it as not
// restored and reads none of its files. A rule that moves onto the facts gets its fixtures restored with no list to
// keep. A consumer's repository is never restored by Plumb.
const home = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const build = spawnSync("dotnet", ["build", path.join(home, "dotnet", "Plumb.CSharpFacts"), "-c", "Release", "--nologo"], { stdio: "inherit" });
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

// The stamp the capability checks: the sources this build compiled.
const tool = path.join(home, "dotnet", "Plumb.CSharpFacts");
fs.writeFileSync(path.join(tool, "bin", "Release", "net10.0", TOOL_STAMP), toolSourceHash(tool));

const restored = new Set();
for (const rule of inProcessRules) {
  if (!rule.requirements.includes(Capability.CSHARP_FACTS)) continue;
  for (const id of rule.descriptor.ids) {
    const fixtures = path.join(home, "fixtures", id);
    if (restored.has(fixtures) || !fs.existsSync(fixtures)) continue;
    restored.add(fixtures);
    restoreProjects(fixtures);
  }
}
