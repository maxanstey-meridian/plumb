import path from "node:path";
import { createRuleDescriptor, defineFileRule, defineRepositoryRule } from "../engine/contracts.mjs";
import { hasSegment, lineHits, pathDepth, report, under } from "./helpers.mjs";

const generatedHeader = (file) => {
  try { return /generated|do not edit/i.test(file.text().split("\n").slice(0, 5).join("\n")); }
  catch { return false; }
};
const rivetRef = "rivet.md#generated-output";
const rgWord = "\\p{Alphabetic}\\p{Mark}\\p{Decimal_Number}\\p{Connector_Punctuation}\\p{Join_Control}";
const configureRivet = new RegExp(`(?<![${rgWord}])configureRivet\\(`, "u");

const parseVersion = (value) => {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?$/.exec((value || "").trim().replace(/^[\^~]/, ""));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)] : null;
};
function compareVersion(version, floor) {
  if (!version) return false;
  for (let index = 0; index < Math.max(version.length, floor.length); index++) {
    const difference = (version[index] ?? 0) - (floor[index] ?? 0);
    if (difference) return difference < 0;
  }
  return false;
}

export const rvRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-RV-020", source: "in-process/rv.mjs" }),
    analyze(context) {
      for (const directory of context.rivet.v1Dirs) {
        for (const file of context.files) {
          if (!under(file.path, directory) || !file.path.endsWith(".ts") || file.path.endsWith(".d.ts")) continue;
          if (hasSegment(file.path, "build") || hasSegment(file.path, "dist")) continue;
          if (!generatedHeader(file)) report(context, "error", file.path, 1, "hand-written or header-stripped file inside generated output — generated dirs are read-only", "coding-philosophy.md#generated-code");
        }
      }
      const expected = new Set(["openapi.json", "schema.d.ts", "api.contract.json"]);
      for (const directory of context.rivet.v2Dirs) {
        for (const file of context.files) {
          if (!under(file.path, directory)) continue;
          if (!expected.has(file.name)) report(context, "error", file.path, 1, "hand-written file inside the v2 artifact dir — only openapi.json, api.contract.json + schema.d.ts belong here; the facade lives in src/", "coding-philosophy.md#generated-code");
          else if (file.name === "schema.d.ts" && !generatedHeader(file)) report(context, "error", file.path, 1, "schema.d.ts is missing its openapi-typescript header — generated artifacts are read-only, regenerate via the repo's task", "coding-philosophy.md#generated-code");
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-RV-021", source: "in-process/rv.mjs" }),
    analyze(context) {
      const markers = new Set(context.files.filter((file) => file.name === "package.json" || /^nuxt\.config\..*$/.test(file.name)).map((file) => file.directory));
      const groups = new Map();
      for (const file of context.files) {
        if (!file.path.endsWith(".ts") || /\.spec\./.test(file.name) || hasSegment(file.path, "generated") || hasSegment(file.path, "__tests__")) continue;
        for (const line of lineHits(file, configureRivet)) {
          if (file.lineMap().lines[line - 1].includes("function configureRivet")) continue;
          let directory = file.directory, app = "";
          while (directory) {
            if (markers.has(directory)) { app = directory; break; }
            const parent = path.posix.dirname(directory);
            directory = parent === "." ? "" : parent;
          }
          if (!groups.has(app)) groups.set(app, []);
          groups.get(app).push({ file, line });
        }
      }
      for (const hits of groups.values()) {
        for (const hit of hits) {
          if (hits.length > 1) report(context, "error", hit.file.path, hit.line, `configureRivet called ${hits.length} times in this app — bootstrap Rivet exactly once, in a plugin`, "frontend-pa-vsa.md#rivet-rules");
          else if (!hit.file.path.includes("plugins/")) report(context, "warn", hit.file.path, hit.line, "configureRivet should be called from a plugin at the app boundary", "frontend-pa-vsa.md#rivet-rules");
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-RV-025", source: "in-process/rv.mjs" }),
    analyze(context) {
      for (const directory of [...context.rivet.v1Dirs, ...context.rivet.v2Dirs]) {
        if (directory.split("/").includes("packages")) continue;
        report(context, "warn", directory, 0, "generated output lives in a workspace packages/contracts package, not inside the app — the package boundary makes read-only structural", rivetRef);
      }
    },
  }),
  defineFileRule({
    descriptor: createRuleDescriptor({ id: "MER-RV-026", source: "in-process/rv.mjs" }),
    files(file) {
      const name = file.split("/").at(-1);
      return pathDepth(file) <= 14 && (name.endsWith(".csproj") || name === "package.json");
    },
    analyze(file, context) {
      if (file.name.endsWith(".csproj")) {
        for (const [index, line] of file.lineMap().lines.entries()) {
          const match = line.match(/Include="Rivet\.Attributes"[^>]*Version="([^"]+)"/);
          if (match && compareVersion(parseVersion(match[1]), [0, 35, 0])) report(context, "warn", file.path, index + 1, `Rivet.Attributes ${match[1]} is v1 — migrate to the Rivet v2 generation (>= 0.35.0, openapi-typescript)`, rivetRef);
        }
        return;
      }
      const parsed = file.json();
      if (!parsed.ok) return;
      for (const block of ["dependencies", "devDependencies"]) {
        const raw = parsed.value?.[block]?.["rivet-ts"];
        if (raw && compareVersion(parseVersion(raw), [0, 11, 0])) report(context, "warn", file.path, 0, `rivet-ts ${raw} is v1 — migrate to the Rivet v2 generation (>= 0.11.0, openapi-typescript)`, rivetRef);
      }
    },
  }),
]);
