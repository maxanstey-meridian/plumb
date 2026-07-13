import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";

const source = "in-process/dotnet-rules.mjs";
const architectureRef = "testing-philosophy.md#architecture-boundaries";
const mocksRef = "testing-philosophy.md#mocks";
const choreographyRef = "testing-philosophy.md#application--use-case-behaviour";
const doublesRef = "testing-philosophy.md#test-doubles";
const substrateRef = "testing-philosophy.md#test-substrate";
const toolsRef = "tools.md#default-stack-1";

const segments = (file) => file.split("/");
const hasSegment = (file, names) => segments(file).some((segment) => names.has(segment));
const under = (file, directory) => !directory || file.startsWith(`${directory}/`);
const parent = (directory) => {
  const index = directory.lastIndexOf("/");
  return index < 0 ? "" : directory.slice(0, index);
};

function report(context, severity, path, line, message, docRef) {
  context.report({ severity, path, line, message, docRef });
}

function sanitize(sourceText) {
  let output = "", state = "code", quote = "";
  for (let index = 0; index < sourceText.length; index++) {
    const current = sourceText[index], next = sourceText[index + 1];
    if (state === "line") {
      if (current === "\n") { state = "code"; output += current; }
      else output += " ";
      continue;
    }
    if (state === "block") {
      if (current === "*" && next === "/") { output += "  "; index++; state = "code"; }
      else output += current === "\n" ? "\n" : " ";
      continue;
    }
    if (state === "raw") {
      if (sourceText.startsWith(quote, index)) {
        output += " ".repeat(quote.length);
        index += quote.length - 1;
        state = "code";
        quote = "";
      } else output += current === "\n" ? "\n" : " ";
      continue;
    }
    if (state === "quote") {
      if (current === "\\") { output += "  "; index++; }
      else if (current === quote) { output += " "; state = "code"; quote = ""; }
      else output += current === "\n" ? "\n" : " ";
      continue;
    }
    if (current === "/" && next === "/") { output += "  "; index++; state = "line"; }
    else if (current === "/" && next === "*") { output += "  "; index++; state = "block"; }
    else if (sourceText.startsWith('"""', index)) {
      quote = sourceText.slice(index).match(/^"{3,}/)[0];
      output += " ".repeat(quote.length);
      index += quote.length - 1;
      state = "raw";
    } else if (current === '"' || current === "'" || current === "`") {
      output += " ";
      state = "quote";
      quote = current;
    } else output += current;
  }
  return output;
}

function analyzerReference(sourceText) {
  const xml = sourceText.replace(/<!--[\s\S]*?-->/g, "");
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

function commandLikePlumb(sourceText) {
  return sourceText.split(/\r?\n/).some((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^(?:#|\/\/)/.test(trimmed)) return false;
    return /(?:^|\brun:\s*|\bscript:\s*|"[^"]+"\s*:\s*")(?:(?:pnpm\s+exec|npx)\s+)?(?:[^\s"']*\/)?plumb(?:\s+(?:check|\.\.?\/|[^#\s"']+)|["']?\s*$)/.test(trimmed);
  });
}

function testSourceForArchitecture(file, projects) {
  if (/(?:^|\/)[^/]*tests?(?:\/|$)/i.test(file.path) || /Tests?\.cs$/i.test(file.name)) return true;
  return projects.some((project) => under(file.path, project.directory) && file.path !== project.path && /tests?/i.test(project.name));
}

function firstCallLine(masked, method) {
  const pattern = new RegExp(`\\b${method}\\s*\\(`);
  const lines = masked.split(/\r?\n/);
  const index = lines.findIndex((line) => pattern.test(line));
  return index < 0 ? null : index + 1;
}

const excludedBuildPath = (file) => hasSegment(file, new Set(["obj", "bin"]));
const hasTestDirectorySuffix = (file) => segments(file).slice(0, -1).some((segment) => /[Tt]ests$/.test(segment));

export const dotnetRules = Object.freeze([
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TE-001", source }),
    requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
    analyze(context) {
      const projects = context.dotnetProjects.projects();
      if (!projects.length) return;
      const directories = new Set();
      for (const file of context.files) {
        const parts = segments(file.directory);
        for (let index = 0; index < parts.length; index++) {
          if (parts[index] === "Modules") directories.add(parts.slice(0, index + 1).join("/"));
        }
      }
      if (!directories.size) return;
      const applicable = new Set();
      for (const directory of directories) {
        const owner = projects
          .filter((project) => under(directory, project.directory) && directory !== project.directory)
          .sort((left, right) => right.directory.length - left.directory.length)[0];
        if (owner) applicable.add(owner.path);
      }

      let repositoryEnforced = false;
      for (const file of context.files) {
        if (file.path.endsWith(".cs")) {
          const code = context.csharp.mask(file);
          const archUnitUse = /\b(?:ArchRuleDefinition\s*\.|new\s+ArchLoader\s*\()/.test(code) && /\.Check\s*\(/.test(code);
          const netArchUse = /\bTypes\.(?:InCurrentDomain|InAssembly|InAssemblies)\s*\(/.test(code) && /\.GetResult\s*\(/.test(code);
          if (testSourceForArchitecture(file, projects) && (archUnitUse || netArchUse)) repositoryEnforced = true;
          continue;
        }
        const automation = /\/(?:\.github|\.gitlab|scripts|tasks)\//.test(`/${file.path}`) || /^(?:Makefile|Taskfile\.ya?ml)$/.test(file.name);
        if (automation && commandLikePlumb(file.text())) repositoryEnforced = true;
      }

      for (const projectPath of applicable) {
        const project = context.dotnetProjects.project(projectPath);
        const hasAnalyzer = [project.file, ...context.dotnetProjects.propsFor(project)].some((file) => analyzerReference(file.text()));
        if (!repositoryEnforced && !hasAnalyzer) {
          report(context, "warn", project.path, 1, ".NET Modules project has no mechanical architecture enforcement — use Meridian.Analyzers, ArchUnitNET/NetArchTest, architecture tests, or invoke plumb in CI/tasks", architectureRef);
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TE-002", source }),
    requirements: [Capability.CSHARP],
    analyze(context) {
      for (const file of context.files) {
        if (!/\.(?:cs|ts)$/.test(file.path) || hasSegment(file.path, new Set(["obj", "bin", "node_modules"]))) continue;
        if (!(/Tests\.cs$/.test(file.path) || hasTestDirectorySuffix(file.path) ||
          /\.(?:spec|test)\.ts$/.test(file.path) || file.path.includes("__tests__"))) continue;
        const count = file.text().match(/Substitute\.For<|\bvi\.mock\s*\(/g)?.length ?? 0;
        if (count > 5) {
          report(context, "info", file.path, 0, `${count} mock constructions in one test file — review whether a hand-rolled fake would better represent the dominant collaborator`, mocksRef);
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TE-003", source }),
    requirements: [Capability.CSHARP],
    analyze(context) {
      const patterns = [
        /\bReceived\.InOrder\s*\(/,
        /\bnew\s+MockSequence\s*\(/,
        /\.InSequence\s*\(/,
        /\b(?:VerifySequence|VerifyInOrder|verifyOrder)\s*\(/,
        /\bInOrder\s*\.\s*Verify\s*\(/,
      ];
      for (const file of context.files) {
        if (!/\.(?:cs|ts|js)$/.test(file.path) ||
          !(/Tests?\.cs$/.test(file.path) || hasSegment(file.path, new Set(["Test", "Tests", "test", "tests"])) || /\.(?:spec|test)\.(?:ts|js)$/.test(file.path))) continue;
        const masked = file.path.endsWith(".cs") ? context.csharp.mask(file) : sanitize(file.text());
        for (const [index, line] of masked.split("\n").entries()) {
          if (patterns.some((pattern) => pattern.test(line))) {
            report(context, "warn", file.path, index + 1, "ordered interaction assertion couples the test to choreography — assert the observable outcome instead", choreographyRef);
          }
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TE-005", source }),
    requirements: [Capability.CSHARP],
    analyze(context) {
      for (const file of context.files) {
        if (!/\.(?:cs|ts)$/.test(file.path) || hasSegment(file.path, new Set(["obj", "bin", "node_modules"]))) continue;
        if (!(/Tests\.cs$/.test(file.path) || hasTestDirectorySuffix(file.path) || hasSegment(file.path, new Set(["TestSupport"])) ||
          file.path.includes("__tests__") || /\.(?:spec|test)\.ts$/.test(file.path))) continue;
        for (const [index, line] of file.text().split("\n").entries()) {
          if (/\b(?:class|record)\s+(?:Mock|Stub)[A-Z]\w*/.test(line)) {
            report(context, "warn", file.path, index + 1, "test doubles are Fake*/InMemory*/Inline* — Mock*/Stub* is the wrong vocabulary for a hand-rolled double", doublesRef);
          }
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TE-007", source }),
    requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS],
    analyze(context) {
      const projects = context.dotnetProjects.projects();
      const projectsByDirectory = new Map();
      for (const project of projects) {
        if (!projectsByDirectory.has(project.directory)) projectsByDirectory.set(project.directory, []);
        projectsByDirectory.get(project.directory).push(project);
      }
      const isTestFile = (file) => {
        if (hasSegment(file.path, new Set(["Test", "Tests", "test", "tests"]))) return true;
        let directory = file.directory;
        while (true) {
          if ((projectsByDirectory.get(directory) ?? []).some((project) => /(?:Test|test)/.test(project.name))) return true;
          if (!directory) return false;
          directory = parent(directory);
        }
      };
      const csharpFiles = context.csharp.csharpFiles.filter((file) => !excludedBuildPath(file.path));
      for (const file of csharpFiles) {
        if (!isTestFile(file)) continue;
        const line = firstCallLine(context.csharp.mask(file), "UseInMemoryDatabase");
        if (line !== null) {
          report(context, "error", file.path, line, "EF InMemory provider in integration tests — use the production database engine through Testcontainers, or fake the port when the adapter is not under test", substrateRef);
        }
      }

      const postgres = (project) => [project, ...context.dotnetProjects.referencedProjects(project)]
        .some((candidate) => /<PackageReference\b[^>]*\bInclude\s*=\s*["'](?:Npgsql\.EntityFrameworkCore\.PostgreSQL|Npgsql)["']/.test(candidate.xml));
      for (const project of projects) {
        if (excludedBuildPath(project.path) || !(project.path.includes("Tests") || hasSegment(project.path, new Set(["Tests", "tests"]))) || !postgres(project)) continue;
        for (const file of csharpFiles) {
          if (!under(file.path, project.directory) || file.path === project.path) continue;
          const line = firstCallLine(context.csharp.mask(file), "UseSqlite");
          if (line !== null) {
            report(context, "error", file.path, line, "SQLite test database does not match the referenced production Postgres provider — exercise relational behavior against Postgres through Testcontainers", substrateRef);
          }
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TE-008", source }),
    requirements: [Capability.CSHARP],
    analyze(context) {
      for (const file of context.files) {
        if (!/\.(?:cs|ts)$/.test(file.path) || !(/Tests?\.cs$/.test(file.path) ||
          hasSegment(file.path, new Set(["Test", "Tests", "test", "tests"])) || /\.(?:spec|test)\.ts$/.test(file.path))) continue;
        if (/(?:^|\/)TestSupport\/[^/]+\//.test(file.path)) continue;
        if (file.path.endsWith(".ts")) {
          for (const [index, line] of sanitize(file.text()).split("\n").entries()) {
            const match = line.match(/^export\s+(?:default\s+)?(?:class|const|function)\s+((?:Fake|InMemory|Inline)[A-Z]\w*)\b/);
            if (match && !match[1].endsWith("Tests")) {
              report(context, "info", file.path, index + 1, `top-level test double ${match[1]} lives outside TestSupport/<Module> — move reusable doubles to the owning module's test support`, doublesRef);
            }
          }
          continue;
        }
        const lines = context.csharp.mask(file).split("\n");
        const blockNamespace = /^\s*namespace\s+[\w.]+\s*(?:\n\s*)?\{/m.test(lines.join("\n"));
        const topDepth = blockNamespace ? 1 : 0;
        let depth = 0;
        for (const [index, line] of lines.entries()) {
          const match = line.match(/^\s*(?:(?:public|internal)\s+)?(?:sealed\s+)?(?:class|record)\s+((?:Fake|InMemory|Inline)[A-Z]\w*)\b/);
          if (match && !match[1].endsWith("Tests") && depth === topDepth) {
            report(context, "info", file.path, index + 1, `top-level test double ${match[1]} lives outside TestSupport/<Module> — move reusable doubles to the owning module's test support`, doublesRef);
          }
          for (const character of line) {
            if (character === "{") depth++;
            else if (character === "}") depth = Math.max(0, depth - 1);
          }
        }
      }
    },
  }),
  defineRepositoryRule({
    descriptor: createRuleDescriptor({ id: "MER-TO-011", source }),
    requirements: [Capability.DOTNET_PROJECTS],
    analyze(context) {
      for (const project of context.dotnetProjects.projects()) {
        if (hasSegment(project.path, new Set(["obj", "bin", "node_modules"]))) continue;
        const enabled = (property) => {
          const local = context.dotnetProjects.projectProperty(project, property);
          const state = local === undefined ? context.dotnetProjects.nearestInheritedProperty(project, property) : local;
          return state?.toLowerCase() === "enable";
        };
        if (!enabled("Nullable")) report(context, "error", project.path, 0, "enable nullable reference types", toolsRef);
        if (!enabled("ImplicitUsings")) report(context, "warn", project.path, 0, "enable implicit usings (Meridian tooling default)", toolsRef);
      }
    },
  }),
]);
