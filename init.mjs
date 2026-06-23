// plumb init — the Meridian project composer.
//
//   plumb init <dir> [--name <project-name>] [--ts-backend | --dotnet-backend | --no-api] [--force]
//
// init = compose, don't generate:
//   --ts-backend (default)  rivet-ts `scaffold`           — Hono api + Nuxt ui + contracts
//   --dotnet-backend        rivet-ts `scaffold --no-api`  + golden's .NET api as a renamed
//                           template (apps/api + apps/api.tests + global.json), plumb's
//                           canonical dotnet .editorconfig, and a dotnet Taskfile
//   --no-api                rivet-ts `scaffold --no-api`  — Nuxt ui + contracts only
//
// Every variant finishes: git init + first commit, then plumb — init's own
// self-test. This lives in plumb because plumb defines doctrine-perfect; init
// scaffolds a repo that passes by construction. The no-fixer ruling still
// holds: plumb never FIXES a repo it checks — it may only CREATE a fresh one
// (create ≠ fix). Settled design: SCAFFOLDER_PLAN.md in rivet-ts.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = os.homedir();
const PLUMB_DIR = path.dirname(fileURLToPath(import.meta.url));
const PLUMB = path.join(PLUMB_DIR, "plumb");
const RIVET_TS_ROOT = process.env.MERIDIAN_RIVET_TS ?? path.join(HOME, "Sites", "medway", "rivet-ts");
const GOLDEN_ROOT = process.env.MERIDIAN_GOLDEN ?? path.join(HOME, "Sites", "golden");

const usage = () => {
  console.error(
    [
      "Usage:",
      "  plumb init <dir> [--name <project-name>] [--ts-backend | --dotnet-backend | --no-api] [--force]",
    ].join("\n"),
  );
  process.exit(1);
};

const fail = (message) => {
  console.error(`plumb init: ${message}`);
  process.exit(1);
};

const toKebab = (value) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

const toPascal = (value) =>
  toKebab(value)
    .split("-")
    .filter(Boolean)
    .map((segment) => segment[0].toUpperCase() + segment.slice(1))
    .join("");

export const runInit = (rest) => {
  if (rest.length === 0) usage();

  let outDir;
  let projectName;
  let force = false;
  let backend = "ts";
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--ts-backend") { backend = "ts"; continue; }
    if (arg === "--dotnet-backend") { backend = "dotnet"; continue; }
    if (arg === "--no-api") { backend = "none"; continue; }
    if (arg === "--force") { force = true; continue; }
    if (arg === "--name") { projectName = rest[++index]; continue; }
    if (arg.startsWith("--")) fail(`unknown argument: ${arg}`);
    if (outDir) usage();
    outDir = arg;
  }
  if (!outDir) usage();

  outDir = path.resolve(outDir);
  projectName ??= path.basename(outDir);
  const pascalName = toPascal(projectName);
  const packageScope = `@${toKebab(projectName) || "rivet-app"}`;

  const scaffoldCli = path.join(RIVET_TS_ROOT, "dist", "interfaces", "cli", "main.js");
  if (!fs.existsSync(scaffoldCli)) {
    fail(
      `rivet-ts CLI not found at ${scaffoldCli} — clone/build rivet-ts there or set MERIDIAN_RIVET_TS.`,
    );
  }

  /* ─── 1. scaffold the TS workspace ─────────────────────────────────────────── */

  const scaffoldArgs = ["scaffold", "--out", outDir, "--name", projectName];
  if (backend !== "ts") scaffoldArgs.push("--no-api");
  if (force) scaffoldArgs.push("--force");

  console.log(`plumb init: scaffolding ${projectName} into ${outDir} (${backend}-backend)`);
  const scaffold = spawnSync(process.execPath, [scaffoldCli, ...scaffoldArgs], { stdio: "inherit" });
  if (scaffold.status !== 0) process.exit(scaffold.status ?? 1);

  /* ─── 2. dotnet backend: compose golden's api template ─────────────────────── */

  if (backend === "dotnet") {
    if (!fs.existsSync(path.join(GOLDEN_ROOT, "apps", "api"))) {
      fail(`golden exemplar not found at ${GOLDEN_ROOT} — set MERIDIAN_GOLDEN.`);
    }

    const SKIP_DIRS = new Set(["obj", "bin", "node_modules"]);
    const rename = (value) => value.replaceAll("Golden", pascalName);

    const copyTemplate = (fromDir, toDir) => {
      fs.mkdirSync(toDir, { recursive: true });
      for (const entry of fs.readdirSync(fromDir, { withFileTypes: true })) {
        if (entry.name === ".DS_Store") continue;
        const fromPath = path.join(fromDir, entry.name);
        const toPath = path.join(toDir, rename(entry.name));
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name)) copyTemplate(fromPath, toPath);
        } else {
          fs.writeFileSync(toPath, rename(fs.readFileSync(fromPath, "utf8")));
        }
      }
    };

    console.log(`plumb init: composing .NET api from ${GOLDEN_ROOT} (Golden → ${pascalName})`);
    copyTemplate(path.join(GOLDEN_ROOT, "apps", "api"), path.join(outDir, "apps", "api"));
    copyTemplate(path.join(GOLDEN_ROOT, "apps", "api.tests"), path.join(outDir, "apps", "api.tests"));
    fs.copyFileSync(path.join(GOLDEN_ROOT, "global.json"), path.join(outDir, "global.json"));

    // Analyzers on in the api csproj (TO-012) — golden carries these now; the
    // injection only fires if a future template copy loses them.
    const apiCsprojPath = path.join(outDir, "apps", "api", `${pascalName}.Api.csproj`);
    const apiCsproj = fs.readFileSync(apiCsprojPath, "utf8");
    if (!apiCsproj.includes("EnforceCodeStyleInBuild")) {
      fs.writeFileSync(
        apiCsprojPath,
        apiCsproj.replace(
          "    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>",
          [
            "    <TreatWarningsAsErrors>true</TreatWarningsAsErrors>",
            "    <EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild>",
            "    <AnalysisLevel>latest-recommended</AnalysisLevel>",
          ].join("\n"),
        ),
      );
    }

    // CSharpier via the dotnet tool manifest (TO-014) — config-free by doctrine.
    fs.mkdirSync(path.join(outDir, ".config"), { recursive: true });
    fs.writeFileSync(
      path.join(outDir, ".config", "dotnet-tools.json"),
      `${JSON.stringify(
        {
          version: 1,
          isRoot: true,
          tools: {
            csharpier: { version: "1.2.6", commands: ["csharpier"], rollForward: false },
            // The published v2-generation Rivet CLI (>= 0.35.0, RV-026 cutoff).
            "dotnet-rivet": { version: "0.35.0", commands: ["dotnet-rivet"], rollForward: false },
          },
        },
        null,
        2,
      )}\n`,
    );

    // plumb's canonical dotnet .editorconfig is the golden base TO-012 enforces;
    // an exact copy passes by construction.
    const dotnetEditorconfig = path.join(PLUMB_DIR, "configs", "editorconfig.dotnet");
    if (fs.existsSync(dotnetEditorconfig)) {
      fs.copyFileSync(dotnetEditorconfig, path.join(outDir, ".editorconfig"));
    } else {
      console.error("plumb init: plumb's editorconfig.dotnet not found; kept the TS one.");
    }

    // The Taskfile owns the dotnet pipeline (mirrors golden's, parameterized).
    fs.writeFileSync(
      path.join(outDir, "Taskfile.yml"),
      [
        'version: "3"',
        "",
        "tasks:",
        "  install:",
        "    desc: Install workspace dependencies",
        "    cmds:",
        "      - pnpm install",
        "",
        "  dev:",
        "    desc: Run the Nuxt frontend",
        "    cmds:",
        `      - pnpm --filter ${packageScope}/ui dev`,
        "",
        "  api:run:",
        "    desc: Run the .NET backend",
        "    cmds:",
        `      - dotnet run --project ./apps/api/${pascalName}.Api.csproj`,
        "",
        "  api:test:",
        "    desc: Run .NET backend tests",
        "    cmds:",
        `      - dotnet test ./apps/api.tests/${pascalName}.Api.Tests.csproj`,
        "",
        "  generate:",
        "    desc: Regenerate the contracts package from the .NET API (openapi.json → schema.d.ts)",
        "    cmds:",
        "      - dotnet tool restore",
        "      # The CLI loads the project through MSBuild — its packages must be restored.",
        `      - dotnet restore ./apps/api/${pascalName}.Api.csproj`,
        `      - dotnet tool run dotnet-rivet -- --project ./apps/api/${pascalName}.Api.csproj --output ./packages/contracts/generated`,
        `      - pnpm --filter ${packageScope}/contracts exec openapi-typescript ./generated/openapi.json -o ./generated/schema.d.ts`,
        "",
        "  test:",
        "    desc: Run every test suite",
        "    cmds:",
        "      - task: api:test",
        "",
        "  plumb:",
        "    desc: Check the repo against Meridian doctrine",
        "    cmds:",
        "      - ~/Sites/plumb/plumb .",
        "",
      ].join("\n"),
    );
  }

  /* ─── 3. git init + first commit ───────────────────────────────────────────── */

  if (!fs.existsSync(path.join(outDir, ".git"))) {
    try {
      execFileSync("git", ["init", "-q"], { cwd: outDir });
      execFileSync("git", ["add", "-A"], { cwd: outDir });
      execFileSync("git", ["commit", "-qm", `plumb init: ${projectName}`], { cwd: outDir });
      console.log("plumb init: git repository initialised with the first commit.");
    } catch {
      console.error("plumb init: git init/commit failed (no git identity?) — continuing.");
    }
  }

  /* ─── 4. plumb — init's self-test ──────────────────────────────────────────── */

  if (fs.existsSync(PLUMB)) {
    console.log("plumb init: running plumb...");
    const plumb = spawnSync(PLUMB, [outDir], { stdio: "inherit" });
    if (plumb.status !== 0) {
      fail("fresh scaffold has plumb findings — this is a scaffolder bug; see SCAFFOLDER_PLAN.md.");
    }
  } else {
    console.error(`plumb init: plumb not found at ${PLUMB}; doctrine self-test skipped.`);
  }

  const next =
    backend === "dotnet"
      ? `  cd ${outDir}\n  task install\n  task generate\n  task api:run & task dev`
      : backend === "none"
        ? `  cd ${outDir}\n  point task generate at your API\n  task install && task dev`
        : `  cd ${outDir}\n  task install\n  task dev`;
  console.log(`\nDone. Next:\n${next}`);
};
