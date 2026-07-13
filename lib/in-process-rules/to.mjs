import { Capability, createConfigParser, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { hasSegment, pathDepth, report, under } from "./helpers.mjs";

const toolsLintRef = "tools.md#linting-and-formatting";

function parseIni(source) {
  const sections = Object.create(null);
  let current = "";
  sections[current] = Object.create(null);
  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const section = line.match(/^\[(.+)\]$/);
    if (section) {
      current = section[1];
      sections[current] ??= Object.create(null);
      continue;
    }
    const equals = line.indexOf("=");
    if (equals > 0) sections[current][line.slice(0, equals).trim()] = line.slice(equals + 1).trim();
  }
  return sections;
}

export const iniParser = createConfigParser("editorconfig-ini", parseIni);

function covers(golden, actual) {
  if (Array.isArray(golden)) return Array.isArray(actual) && JSON.stringify(golden) === JSON.stringify(actual);
  if (golden && typeof golden === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    return Object.entries(golden).every(([key, value]) => Object.hasOwn(actual, key) && covers(value, actual[key]));
  }
  return golden === actual || (Array.isArray(actual) && actual[0] === golden);
}

function missingPaths(golden, actual, prefix = "") {
  const missing = [];
  for (const [key, value] of Object.entries(golden)) {
    const property = prefix ? `${prefix}.${key}` : key;
    if (!actual || typeof actual !== "object" || !Object.hasOwn(actual, key)) missing.push(property);
    else if (value && typeof value === "object" && !Array.isArray(value) && actual[key] && typeof actual[key] === "object" && !Array.isArray(actual[key])) missing.push(...missingPaths(value, actual[key], property));
    else if (!covers(value, actual[key])) missing.push(property);
  }
  return missing;
}

const rank = { error: 3, warning: 2, suggestion: 1, silent: 0, none: 0 };
function tightens(repositoryValue, goldenValue) {
  const split = (value) => {
    if (Object.hasOwn(rank, value)) return ["", value];
    const match = value.match(/^(.*):(error|warning|suggestion|silent|none)$/);
    return match ? [match[1], match[2]] : null;
  };
  const repository = split(repositoryValue), golden = split(goldenValue);
  return repository && golden && repository[0] === golden[0] && rank[repository[1]] >= rank[golden[1]];
}

export const toRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TO-001", source: "in-process/to.mjs" }),
    requirements: [Capability.TEXT],
    analyze(context) {
      const packageJson = context.file("package.json");
      if (!packageJson) return;
      let packageText = "";
      try { packageText = packageJson.text(); } catch {}
      if (!/"packageManager"\p{White_Space}*:\p{White_Space}*"pnpm/u.test(packageText)) report(context, "warn", "package.json", 0, "pin pnpm via the packageManager field", "tools.md#default-stack");
      for (const file of context.files) {
        if (!["package-lock.json", "yarn.lock"].includes(file.name) || hasSegment(file.path, "node_modules") || pathDepth(file.path) >= 3) continue;
        report(context, "warn", file.path, 0, "non-pnpm lockfile — pnpm is the Meridian tooling default", "tools.md#default-stack");
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TO-002", source: "in-process/to.mjs" }),
    requirements: [Capability.JSON],
    analyze(context) {
      const files = context.files.filter((file) => pathDepth(file.path) <= 8);
      if (!files.some((file) => file.name === "package.json") || !files.some((file) => /\.(?:ts|vue)$/.test(file.name) && !file.name.endsWith(".d.ts"))) return;
      const ox = files.filter((file) => file.name === ".oxlintrc.json");
      const fmt = files.filter((file) => file.name === ".oxfmtrc.json");
      const competing = files.filter((file) => /^\.prettierrc(?:\..*)?$/.test(file.name) || file.name === "biome.json");
      for (const [kind, name, input, configs] of [["oxlint", ".oxlintrc.json", "oxlintrc", ox], ["oxfmt", ".oxfmtrc.json", "oxfmtrc", fmt]]) {
        const golden = JSON.parse(context.staticText(input));
        if (!configs.length) {
          report(context, "warn", name, 0, `no ${name} found — TS repos carry the ${kind} base config (golden: ~/Sites/plumb/configs/${input}.json)`, toolsLintRef);
          continue;
        }
        for (const config of configs) {
          const parsed = config.json();
          if (!parsed.ok) { report(context, "warn", config.path, 1, "unparseable JSON — cannot verify against the golden base", toolsLintRef); continue; }
          for (const property of missingPaths(golden, parsed.value)) report(context, "warn", config.path, 1, `missing or diverging from golden base: "${property}" — repos extend the base, never contradict it`, toolsLintRef);
        }
      }
      for (const config of competing) report(context, "warn", config.path, 0, "competing formatter/linter config — the stack is oxlint + oxfmt (eslint only as the Vue layer)", toolsLintRef);
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TO-005", source: "in-process/to.mjs" }),
    requirements: [Capability.TEXT],
    analyze(context) {
      const vueUnder = (directory) => context.files.some((file) => under(file.path, directory) && file.name.endsWith(".vue") && !["node_modules", ".nuxt", "dist"].some((segment) => hasSegment(file.path, segment)));
      let layerPresent = false, vueConfigSeen = false;
      for (const config of context.files) {
        if (hasSegment(config.path, "node_modules") || hasSegment(config.path, ".nuxt") || pathDepth(config.path) >= 4) continue;
        if (!/^(?:eslint\.config\.(?:mjs|js|ts)|\.eslintrc.*)$/.test(config.name)) continue;
        if (vueUnder(config.directory)) {
          vueConfigSeen = true;
          let source = "";
          try { source = config.text(); } catch {}
          if (/@nuxt\/eslint|eslint-plugin-vue|withNuxt/.test(source)) layerPresent = true;
          else report(context, "warn", config.path, 1, "eslint config does not reference the Vue layer (@nuxt/eslint / eslint-plugin-vue) — that layer is eslint's only job here", toolsLintRef);
        } else report(context, "warn", config.path, 0, "eslint config in an app with no .vue files — oxlint owns non-Vue linting; remove the eslint layer", toolsLintRef);
      }
      if (vueUnder("") && !layerPresent && !vueConfigSeen) report(context, "warn", "eslint.config.mjs", 0, "repo has .vue files but no Vue-layer eslint config — oxlint cannot lint Vue templates; add the @nuxt/eslint layer", toolsLintRef);
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TO-010", source: "in-process/to.mjs" }),
    requirements: [Capability.TEXT],
    analyze(context) {
      if (!context.files.some((file) => file.name.endsWith(".csproj") && !hasSegment(file.path, "obj") && !hasSegment(file.path, "node_modules"))) return;
      const global = context.files.find((file) => file.name === "global.json" && !hasSegment(file.path, "node_modules") && pathDepth(file.path) < 3);
      if (!global) { report(context, "warn", ".", 0, "no global.json — pin the SDK (.NET 10, rollForward latestFeature)", "tools.md#default-stack-1"); return; }
      let source = "";
      try { source = global.text(); } catch {}
      if (!source.includes('"10.')) report(context, "warn", global.path, 0, "global.json does not pin the Meridian .NET 10 default", "tools.md#default-stack-1");
      if (!source.includes("latestFeature")) report(context, "warn", global.path, 0, "set rollForward to latestFeature", "tools.md#default-stack-1");
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TO-012", source: "in-process/to.mjs" }),
    requirements: [Capability.BASIC_CONFIG],
    analyze(context) {
      const files = context.files.filter((file) => pathDepth(file.path) <= 8);
      const projects = files.filter((file) => file.name.endsWith(".csproj"));
      if (!projects.length) return;
      const configs = files.filter((file) => file.name === ".editorconfig");
      const goldenResult = context.staticConfig("editorconfig", iniParser);
      if (!goldenResult.ok) throw goldenResult.error;
      if (!configs.length) report(context, "warn", ".editorconfig", 0, "no .editorconfig in a .NET repo — it is the style/analyzer authority (golden: ~/Sites/plumb/configs/editorconfig.dotnet)", "tools.md#formatting-and-analyzers");
      else {
        let best = null;
        for (const config of configs) {
          const parsed = config.config(iniParser);
          if (!parsed.ok) continue;
          const gaps = [];
          for (const [section, values] of Object.entries(goldenResult.value)) {
            const actualSection = parsed.value[section];
            for (const [key, value] of Object.entries(values)) {
              if (!actualSection || !Object.hasOwn(actualSection, key)) gaps.push(`[${section}] ${key}`);
              else if (actualSection[key] !== value && !tightens(actualSection[key], value)) gaps.push(`[${section}] ${key} = ${actualSection[key]} (golden: ${value})`);
            }
          }
          if (!best || gaps.length < best.gaps.length) best = { config, gaps };
        }
        if (best) {
          for (const gap of best.gaps.slice(0, 20)) report(context, "warn", best.config.path, 1, `missing or diverging from the golden .editorconfig: ${gap}`, "tools.md#formatting-and-analyzers");
          if (best.gaps.length > 20) report(context, "warn", best.config.path, 1, `…and ${best.gaps.length - 20} more golden .editorconfig lines missing`, "tools.md#formatting-and-analyzers");
        }
      }
      const analyzerFiles = files.filter((file) => file.name.endsWith(".csproj") || file.name === "Directory.Build.props");
      if (!analyzerFiles.some((file) => {
        try { return /EnforceCodeStyleInBuild|AnalysisLevel/.test(file.text()); }
        catch { return false; }
      })) report(context, "warn", projects[0].path, 1, "analyzers not enabled — set EnforceCodeStyleInBuild (or AnalysisLevel) in the csproj or Directory.Build.props", "tools.md#formatting-and-analyzers");
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TO-014", source: "in-process/to.mjs" }),
    requirements: [Capability.TEXT],
    analyze(context) {
      if (!context.files.some((file) => file.name.endsWith(".csproj") && !hasSegment(file.path, "obj") && !hasSegment(file.path, "node_modules"))) return;
      const candidates = context.files.filter((file) => (file.name.endsWith(".csproj") || ["Directory.Build.props", "Directory.Packages.props", "dotnet-tools.json"].includes(file.name)) && !["obj", "bin", ".git"].some((segment) => hasSegment(file.path, segment)));
      if (!candidates.some((file) => {
        try { return /csharpier/i.test(file.text()); }
        catch { return false; }
      })) report(context, "warn", ".config/dotnet-tools.json", 0, "CSharpier not wired — add CSharpier.MsBuild to the project (or a dotnet tool manifest) so formatting is enforced at build", "tools.md#formatting-and-analyzers");
    },
  }),
]);
