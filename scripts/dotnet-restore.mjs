import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Every SDK-style project under a folder: a `.csproj` whose <Project> has an Sdk attribute. A stub such as <Project/>
// has no Restore target.
function sdkProjects(directory) {
  const found = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!["bin", "obj", "node_modules", ".git"].includes(entry.name)) walk(full);
      } else if (entry.name.endsWith(".csproj") && /<Project\b[^>]*\sSdk\s*=/.test(fs.readFileSync(full, "utf8"))) {
        found.push(full);
      }
    }
  };
  walk(directory);
  return found;
}

// The facts tool reports a project whose restore output (`project.assets.json`) is missing and reads none of its files:
// it opens with no error, but names from its packages don't bind. So every project a test hands to Plumb is restored
// first. Throws on any failed restore.
export function restoreProjects(directory) {
  for (const project of sdkProjects(directory)) {
    const result = spawnSync("dotnet", ["restore", project, "--nologo"], { encoding: "utf8" });
    if (result.error || result.status !== 0) {
      throw new Error(`dotnet restore failed for ${project}: ${result.error?.message ?? ""}${result.stdout ?? ""}${result.stderr ?? ""}`);
    }
  }
}
