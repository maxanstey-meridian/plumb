#!/usr/bin/env node
// MER-BE-061 to 064 over temp repositories, through the CLI. Each case is a module pair or a claims file in a shared
// repository: a repository is written and restored once, on the first case that needs it, and the cases that don't
// conflict share it. Needs the .NET 10 SDK and the built facts tool (pnpm build:csharp).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { restoreProjects } from "../scripts/dotnet-restore.mjs";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUMB = path.join(HOME, "plumb");
const FIXTURES = path.join(HOME, "fixtures");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-module-order-"));
after(() => fs.rmSync(scratch, { recursive: true, force: true }));

const CLAIMS = ".plumb-modules.json";
const lazy = (build) => {
  let value;
  return () => (value ??= build());
};

const project = (extra = "", properties = "") => `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>${properties}
  </PropertyGroup>${extra}
</Project>
`;

// A repository on disk, restored. `files` maps a relative path to its text.
function build(name, files, { restore = true } = {}) {
  const root = path.join(scratch, name);
  for (const [relative, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), content);
  }
  if (restore) restoreProjects(root);
  return root;
}

// What one rule ID reports over a repository: `{ location, message }`, sorted, and the CLI's whole result. A run that
// is degraded exits 2 under --ci, so a case that expects findings can't pass on a skipped analysis.
function run(root, id, { expectDegraded = false } = {}) {
  const result = spawnSync(PLUMB, [root, "--rule", id, "--json", "--no-baseline", "--ci"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  assert.ok(expectDegraded ? result.status === 2 : [0, 1].includes(result.status), `${id} exited ${result.status}: ${result.stderr}`);
  const findings = JSON.parse(result.stdout).map((finding) => ({ location: finding.location, message: finding.message, rule: finding.rule }));
  findings.sort((left, right) => left.location.localeCompare(right.location) || left.message.localeCompare(right.message));
  return { findings, locations: findings.map((finding) => finding.location), result };
}

const claims = (root, text) => fs.writeFileSync(path.join(root, CLAIMS), text);
const noClaims = (root) => fs.rmSync(path.join(root, CLAIMS), { force: true });
const lineOf = (text, needle) => {
  const index = text.split("\n").findIndex((line) => line.includes(needle));
  assert.notEqual(index, -1, `${needle} is not in:\n${text}`);
  return index + 1;
};

// ---- pieces of a repository ----

const contract = (module) => ({ [`api/Modules/${module}/Contracts/${module}Thing.cs`]: `namespace App.Modules.${module}.Contracts;\npublic sealed record ${module}Thing(int Id);\n` });
const backEdge = (from, to) => ({
  [`api/Modules/${from}/Application/Back${to}.cs`]: `using App.Modules.${to}.Contracts;\nnamespace App.Modules.${from}.Application;\npublic sealed class Back${to}(${to}Thing thing);\n`,
});
const entity = (module) => ({ [`api/Modules/${module}/Domain/${module}Entity.cs`]: `namespace App.Modules.${module}.Domain;\npublic sealed class ${module}Entity { public int Id { get; set; } }\n` });
const back = (x, y) => ({ ...contract(x), ...contract(y), ...backEdge(y, x) });

// Where a case's finding sits: the module's file and the line holding `needle`.
const spot = (files, file, needle) => `${file}:${lineOf(files[file], needle)}`;

// ---- kinds of fact: each pair closes a loop through one kind of reference ----

const kindFiles = lazy(() => {
  const files = { "api/Api.csproj": project('\n  <ItemGroup>\n    <ProjectReference Include="../other/Other.csproj" />\n  </ItemGroup>'), "other/Other.csproj": project() };
  Object.assign(files, back("RelA", "RelB"), back("QualA", "QualB"), back("InfA", "InfB"), back("RootA", "RootB"), back("SpreadC", "SpreadA"), back("XA", "XB"));
  Object.assign(files, backEdge("SpreadB", "SpreadC"), contract("SpreadB"), entity("RootB"), back("GlobB", "GlobA"));
  // A using static of a type: the module is the type's, not a namespace's.
  Object.assign(files, back("TypeA", "TypeB"));
  files["api/Modules/TypeB/Contracts/TypeBStatics.cs"] = "namespace App.Modules.TypeB.Contracts;\npublic static class TypeBStatics { public static int Count => 1; }\n";
  files["api/Modules/TypeA/Application/Use.cs"] = "using static App.Modules.TypeB.Contracts.TypeBStatics;\nnamespace App.Modules.TypeA.Application;\npublic sealed class Use\n{\n    public int Total => Count;\n}\n";
  // An alias of a framework type closed over another module's type: the directive is the reference (the alias is never used).
  Object.assign(files, back("AliasA", "AliasB"));
  files["api/Modules/AliasA/Application/UseAlias.cs"] = "using Bag = System.Collections.Generic.List<App.Modules.AliasB.Contracts.AliasBThing>;\nnamespace App.Modules.AliasA.Application;\npublic sealed class UseAlias;\n";
  // A name a global using elsewhere brings in: the edge is the name, in a file with no using.
  files["api/GlobalUsings.cs"] = "global using App.Modules.GlobA.Contracts;\n";
  files["api/Modules/GlobB/Application/Use.cs"] = "namespace App.Modules.GlobB.Application;\npublic sealed class Use(GlobAThing thing);\n";
  // A relative using inside a namespace block.
  files["api/Modules/RelA/Application/UseB.cs"] = "namespace App.Modules.RelA.Application\n{\n    using RelB.Contracts;\n    public sealed class UseB(RelBThing thing);\n}\n";
  // A partly qualified name, found through the enclosing namespace.
  files["api/Modules/QualA/Application/UseB.cs"] = "namespace App.Modules.QualA.Application;\npublic sealed class UseB(QualB.Contracts.QualBThing thing);\n";
  // A name found through the enclosing namespace, with no using.
  files["api/Modules/EncB/Contracts/EncBThing.cs"] = "namespace App.Modules;\npublic sealed record EncBThing(int Id);\n";
  files["api/Modules/EncA/Application/UseB.cs"] = "namespace App.Modules.EncA.Application;\npublic sealed class UseB(EncBThing thing);\n";
  Object.assign(files, contract("EncA"), backEdge("EncB", "EncA"));
  // An inferred type: no InfB name is written in Use.cs.
  files["api/Modules/InfA/Application/Ports/IInfPort.cs"] = "using App.Modules.InfB.Contracts;\nnamespace App.Modules.InfA.Application.Ports;\npublic interface IInfPort { InfBThing Latest(); }\n";
  files["api/Modules/InfA/Application/Use.cs"] = "using App.Modules.InfA.Application.Ports;\nnamespace App.Modules.InfA.Application;\npublic sealed class Use(IInfPort port)\n{\n    public int Run()\n    {\n        var thing = port.Latest();\n        return thing.Id;\n    }\n}\n";
  // An extension call: the static class sits in an enclosing namespace, so no using names it.
  files["api/Modules/ExtB/Contracts/ExtBExtensions.cs"] = "namespace App.Modules;\npublic static class ExtBExtensions { public static int Shout(this string value) => value.Length; }\n";
  files["api/Modules/ExtA/Application/Use.cs"] = "namespace App.Modules.ExtA.Application;\npublic sealed class Use\n{\n    public int Run() => \"x\".Shout();\n}\n";
  Object.assign(files, contract("ExtA"), backEdge("ExtB", "ExtA"));
  // A member of the persistence root that reads another module's data.
  files["api/Stubs/EfCore.cs"] = "namespace Microsoft.EntityFrameworkCore\n{\n    public class DbContext { }\n    public class DbSet<T> where T : class { public IEnumerable<T> Rows() => []; }\n}\n";
  files["api/Persistence/AppDbContext.cs"] = "using App.Modules.RootB.Domain;\nusing Microsoft.EntityFrameworkCore;\nnamespace App.Persistence;\npublic sealed class AppDbContext : DbContext\n{\n    public DbSet<RootBEntity> RootBRows { get; } = new();\n    public int CountRootB() => RootBRows.Rows().Count();\n}\n";
  files["api/Modules/RootA/Infrastructure/Repo.cs"] = "using App.Persistence;\nnamespace App.Modules.RootA.Infrastructure;\npublic sealed class Repo(AppDbContext db)\n{\n    public int Total() => db.CountRootB();\n}\n";
  // A namespace two modules declare types in.
  files["api/Modules/SpreadA/Contracts/SpreadAThing.cs"] = "namespace App.Shared.Spread;\npublic sealed record SpreadAThing(int Id);\n";
  files["api/Modules/SpreadB/Contracts/SpreadBThing.cs"] = "namespace App.Shared.Spread;\npublic sealed record SpreadBThing(int Id);\n";
  files["api/Modules/SpreadC/Application/UseSpread.cs"] = "using App.Shared.Spread;\nnamespace App.Modules.SpreadC.Application;\npublic sealed class UseSpread;\n";
  // A module of another backend root, in a project this one references: still MER-BE-005, and no edge in this root.
  files["other/Modules/XB/Application/Ports/IXbPort.cs"] = "namespace Other.Modules.XB.Application.Ports;\npublic interface IXbPort { }\n";
  files["api/Modules/XA/Application/Use.cs"] = "using Other.Modules.XB.Application.Ports;\nnamespace App.Modules.XA.Application;\npublic sealed class Use(IXbPort port);\n";
  return { root: build("kinds", files), files };
});

test("MER-BE-062 finds a loop through each kind of reference: a relative using, a partly qualified and an enclosing name, an inferred type, an extension call, and a root member", () => {
  const { root, files } = kindFiles();
  const { locations, findings } = run(root, "MER-BE-062");
  // Every loop edge and nothing else: the other backend root's XA → XB and the root-less Modules/ file add none.
  assert.deepEqual(locations, [
    "api/Modules/AliasA/Application/UseAlias.cs:1",
    "api/Modules/AliasB/Application/BackAliasA.cs:1",
    "api/Modules/EncA/Application/UseB.cs:2",
    "api/Modules/EncB/Application/BackEncA.cs:1",
    "api/Modules/ExtA/Application/Use.cs:4",
    "api/Modules/ExtB/Application/BackExtA.cs:1",
    "api/Modules/GlobA/Application/BackGlobB.cs:1",
    "api/Modules/GlobB/Application/Use.cs:2",
    "api/Modules/InfA/Application/Ports/IInfPort.cs:1",
    "api/Modules/InfA/Application/Use.cs:7",
    "api/Modules/InfB/Application/BackInfA.cs:1",
    "api/Modules/QualA/Application/UseB.cs:2",
    "api/Modules/QualB/Application/BackQualA.cs:1",
    "api/Modules/RelA/Application/UseB.cs:3",
    "api/Modules/RelB/Application/BackRelA.cs:1",
    "api/Modules/RootA/Infrastructure/Repo.cs:5",
    "api/Modules/RootB/Application/BackRootA.cs:1",
    "api/Modules/SpreadA/Application/BackSpreadC.cs:1",
    "api/Modules/SpreadB/Application/BackSpreadC.cs:1",
    "api/Modules/SpreadC/Application/UseSpread.cs:1",
    "api/Modules/SpreadC/Application/UseSpread.cs:1",
    "api/Modules/TypeA/Application/Use.cs:1",
    "api/Modules/TypeB/Application/BackTypeA.cs:1",
  ]);
  const expected = [
    ["AliasA", "AliasB", spot(files, "api/Modules/AliasA/Application/UseAlias.cs", "using Bag")],
    ["RelA", "RelB", spot(files, "api/Modules/RelA/Application/UseB.cs", "using RelB.Contracts")],
    ["QualA", "QualB", spot(files, "api/Modules/QualA/Application/UseB.cs", "QualB.Contracts.QualBThing")],
    ["EncA", "EncB", spot(files, "api/Modules/EncA/Application/UseB.cs", "EncBThing")],
    ["InfA", "InfB", spot(files, "api/Modules/InfA/Application/Ports/IInfPort.cs", "using App.Modules.InfB")],
    ["InfA", "InfB", spot(files, "api/Modules/InfA/Application/Use.cs", "var thing")],
    ["ExtA", "ExtB", spot(files, "api/Modules/ExtA/Application/Use.cs", "Shout")],
    ["RootA", "RootB", spot(files, "api/Modules/RootA/Infrastructure/Repo.cs", "db.CountRootB")],
    ["GlobB", "GlobA", spot(files, "api/Modules/GlobB/Application/Use.cs", "GlobAThing")],
    ["TypeA", "TypeB", spot(files, "api/Modules/TypeA/Application/Use.cs", "using static")],
  ];
  for (const [from, to, location] of expected) {
    const found = findings.filter((finding) => finding.location === location);
    assert.equal(found.length, 1, `${location}: ${JSON.stringify(found)}`);
    assert.match(found[0].message, new RegExp(`^modules ${from} and ${to} are in a loop \\(${from} → ${to} → ${from}\\)`), location);
  }
  // The root member is a route, with the root-member fix, and the inferred type is a direct reference.
  assert.match(findings.find((finding) => finding.location.endsWith("Repo.cs:5")).message, /through App\.Persistence\.AppDbContext\.CountRootB \(api\/Persistence\/AppDbContext\.cs\)/);
  assert.match(findings.find((finding) => finding.location.endsWith("Repo.cs:5")).message, /stop calling App\.Persistence\.AppDbContext\.CountRootB from module RootA: it reads RootB's data/);
  assert.doesNotMatch(findings.find((finding) => finding.location.endsWith("InfA/Application/Use.cs:7")).message, /through/);
  // The back edges are the loops' other halves.
  for (const [x, y] of [["RelA", "RelB"], ["QualA", "QualB"], ["InfA", "InfB"], ["RootA", "RootB"]]) assert.ok(locations.includes(`api/Modules/${y}/Application/Back${x}.cs:1`), `${y} → ${x}`);
  // A using of a namespace spread over two modules is a hit for each.
  const spread = findings.filter((finding) => finding.location === "api/Modules/SpreadC/Application/UseSpread.cs:1");
  assert.deepEqual(spread.map((finding) => finding.message.match(/^modules (\w+) and (\w+)/).slice(1, 3).join(">")), ["SpreadC>SpreadA", "SpreadC>SpreadB"]);
  // A module of another backend root makes no edge.
  assert.ok(!locations.some((location) => location.includes("XA/Application/Use.cs")), locations.join("\n"));
});

test("a file directly under Modules/ that names a module type is no module's code: the run completes and it adds no edge", () => {
  const files = {
    "api/Api.csproj": project(),
    ...back("RegA", "RegB"),
    "api/Modules/RegA/Application/UseB.cs": "using App.Modules.RegB.Contracts;\nnamespace App.Modules.RegA.Application;\npublic sealed class UseB(RegBThing thing);\n",
    "api/Modules/RegB/Contracts/RegBHelper.cs": "namespace App.Modules.RegB.Contracts;\npublic static class RegBHelper { public static int Count() => 1; }\n",
    "api/Modules/RegA/RegARoot.cs": "namespace App.Modules.RegA;\npublic sealed class RegARoot;\n",
    "api/Modules/ModuleRegistration.cs": "using App.Modules.RegA;\nusing App.Modules.RegA.Contracts;\nnamespace App.Modules;\npublic static class ModuleRegistration\n{\n    public static int Total() => App.Modules.RegB.Contracts.RegBHelper.Count();\n}\n",
  };
  const root = build("registration", files);
  const { locations } = run(root, "MER-BE-062");
  assert.deepEqual(locations, [
    "api/Modules/RegA/Application/UseB.cs:1",
    "api/Modules/RegB/Application/BackRegA.cs:1",
  ]);
  // Its using of a module's root-namespace type is outside-module code: not module "ModuleRegistration.cs" reaching in.
  for (const id of ["MER-BE-003", "MER-BE-004", "MER-BE-005"]) {
    assert.deepEqual(run(root, id).locations.filter((location) => location.includes("ModuleRegistration.cs")), [], id);
  }
});

test("a reference into a module of another backend root is MER-BE-005 and makes no loop edge", () => {
  const { root } = kindFiles();
  const { findings } = run(root, "MER-BE-005");
  assert.deepEqual(findings.map((finding) => finding.location), ["api/GlobalUsings.cs:1", "api/Modules/XA/Application/Use.cs:1"]);
  assert.match(findings[0].message, /^global using of GlobA\.Contracts puts module GlobA in every file of the project/);
  assert.match(findings[1].message, /^module XA must not use XB\.Application internals/);
});

test("a global using in build output under a module is no hit, while the same line in an ordinary module file is MER-BE-005", () => {
  const files = {
    "api/Api.csproj": project(),
    ...contract("Forms"),
    "api/Modules/Cases/Application/Globals.cs": "global using App.Modules.Forms.Contracts;\nnamespace App.Modules.Cases.Application;\npublic sealed class Globals;\n",
    "api/Modules/Cases/obj/Debug/Cases.GlobalUsings.g.cs": "global using App.Modules.Forms.Contracts;\nnamespace App.Modules.Cases.Generated;\npublic sealed class Generated;\n",
  };
  const root = build("build-output-global", files);
  // Without a git repository the scan skips obj/ itself; in one that doesn't ignore it, the folder is read.
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  const { locations } = run(root, "MER-BE-005");
  assert.deepEqual(locations, ["api/Modules/Cases/Application/Globals.cs:1"]);
});

test("MER-BE-007 skips build output under Common/Ports, while the same port in an ordinary file is reported", () => {
  const port = (name) => `using App.Modules.Forms.Domain;\nnamespace App.Common.Ports;\npublic interface ${name}\n{\n    FormsEntity Read();\n}\n`;
  const files = {
    "api/Api.csproj": project(),
    ...entity("Forms"),
    "api/Common/Ports/IFormsReader.cs": port("IFormsReader"),
    "api/Common/Ports/obj/Debug/IGeneratedReader.cs": port("IGeneratedReader"),
  };
  const root = build("build-output-port", files);
  // Without a git repository the scan skips obj/ itself; in one that doesn't ignore it, the folder is read.
  assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
  assert.equal(spawnSync("git", ["add", "-A"], { cwd: root }).status, 0);
  const { locations } = run(root, "MER-BE-007");
  assert.deepEqual(locations, ["api/Common/Ports/IFormsReader.cs:5"]);
});

test("a namespace one module declares across layers is a hit for each layer, so a using of it reaches the Domain types", () => {
  const files = {
    "api/Api.csproj": project(),
    "api/Modules/Forms/Contracts/FormsThing.cs": "namespace App.Forms;\npublic sealed record FormsThing(int Id);\n",
    "api/Modules/Forms/Domain/FormsEntity.cs": "namespace App.Forms;\npublic sealed class FormsEntity { public int Id { get; set; } }\n",
    "api/Modules/Auth/Application/Use.cs": "using App.Forms;\nnamespace App.Modules.Auth.Application;\npublic sealed class Use;\n",
  };
  const { findings } = run(build("spread-layers", files), "MER-BE-003");
  assert.deepEqual(findings.map((finding) => finding.location), ["api/Modules/Auth/Application/Use.cs:1"]);
  assert.match(findings[0].message, /^module Auth must not use Forms\.Domain/);
});

// A global using is about the module, so a namespace the module declares across layers is still one finding per line.
const wholeModule = "global using of Forms puts module Forms in every file of the project — use it only in the files that need it";
const flatGlobalFiles = lazy(() => ({
  "api/Api.csproj": project('\n  <ItemGroup>\n    <Using Include="App.Forms" />\n  </ItemGroup>'),
  "api/Modules/Forms/Contracts/FormsThing.cs": "namespace App.Forms;\npublic sealed record FormsThing(int Id);\n",
  "api/Modules/Forms/Domain/FormsEntity.cs": "namespace App.Forms;\npublic sealed class FormsEntity { public int Id { get; set; } }\n",
  "api/Modules/Forms/Application/FormsService.cs": "namespace App.Forms;\npublic sealed class FormsService;\n",
  // The second line names a namespace of one layer only, in the nested spelling, so its one segment is named.
  "api/Modules/Forms/Application/Globals.cs": "global using App.Forms;\nglobal using App.Modules.Forms.Contracts;\nnamespace App.Modules.Forms.Application;\npublic sealed class Globals;\n",
  "api/Modules/Forms/Contracts/Nested.cs": "namespace App.Modules.Forms.Contracts;\npublic sealed record Nested(int Id);\n",
}));

const flatGlobalRoot = lazy(() => build("flat-global", flatGlobalFiles()));

test("a global using of a namespace the module declares across three layers is one MER-BE-005 for the module, with no segment", () => {
  const root = flatGlobalRoot();
  const found = ["MER-BE-003", "MER-BE-004", "MER-BE-005"].flatMap((id) => run(root, id).findings).filter((finding) => finding.location === "api/Modules/Forms/Application/Globals.cs:1");
  assert.deepEqual(found.map((finding) => [finding.rule, finding.message]), [["MER-BE-005", wholeModule]]);
});

test("a global using of a namespace that one layer of the module declares names that segment, once", () => {
  const found = run(flatGlobalRoot(), "MER-BE-005").findings.filter((finding) => finding.location === "api/Modules/Forms/Application/Globals.cs:2");
  assert.deepEqual(found.map((finding) => finding.message), ["global using of Forms.Contracts puts module Forms in every file of the project — use it only in the files that need it"]);
});

test("an MSBuild <Using> of a namespace the module declares across layers is one MER-BE-005 at the item, with no segment", () => {
  const files = flatGlobalFiles();
  const found = run(flatGlobalRoot(), "MER-BE-005").findings.filter((finding) => finding.location.startsWith("api/Api.csproj:"));
  assert.deepEqual(found.map((finding) => [finding.location, finding.message]), [[`api/Api.csproj:${lineOf(files["api/Api.csproj"], "<Using")}`, wholeModule]]);
});

test("a using of a namespace imports only the types in it: the layers of types in sub-namespaces below are not hit", () => {
  const files = {
    "api/Api.csproj": project(),
    "api/Modules/Forms/FormsModule.cs": "namespace App.Forms;\npublic sealed class FormsModule;\n",
    "api/Modules/Forms/Domain/Form.cs": "namespace App.Forms.Domain;\npublic sealed class Form { public int Id { get; set; } }\n",
    "api/Modules/Forms/Infrastructure/FormsDb.cs": "namespace App.Forms.Infrastructure;\npublic sealed class FormsDb;\n",
    "api/Modules/Auth/Application/Use.cs": "using App.Forms;\nnamespace App.Modules.Auth.Application;\npublic sealed class Use;\n",
  };
  const root = build("ancestor-namespace", files);
  const own = run(root, "MER-BE-005");
  assert.deepEqual(own.locations, ["api/Modules/Auth/Application/Use.cs:1"]);
  assert.match(own.findings[0].message, /^module Auth must not use Forms's root namespace types/);
  for (const id of ["MER-BE-003", "MER-BE-004"]) assert.deepEqual(run(root, id).locations, [], id);
});

test("a using of a namespace with no type of the module in it is one hit for the module, from the first path's layer", () => {
  const files = {
    "api/Api.csproj": project(),
    "api/Modules/Billing/Domain/Invoice.cs": "namespace App.Billing.Domain;\npublic sealed class Invoice { public int Id { get; set; } }\n",
    "api/Modules/Billing/Application/Charge.cs": "namespace App.Billing.Application;\npublic sealed class Charge;\n",
    "api/Modules/Auth/Application/Use.cs": "using App.Billing;\nnamespace App.Modules.Auth.Application;\npublic sealed class Use;\n",
  };
  const root = build("ancestor-only", files);
  // Of Billing's layers the first path is Application/Charge.cs, so the one hit is the Application one.
  const found = ["MER-BE-003", "MER-BE-004", "MER-BE-005"].flatMap((id) => run(root, id).findings);
  assert.deepEqual(found.map((finding) => [finding.rule, finding.location]), [["MER-BE-005", "api/Modules/Auth/Application/Use.cs:1"]]);
  assert.match(found[0].message, /^module Auth must not use Billing\.Application internals/);
});

// A namespace above the modules holds a host type too, so it is shared by the app and names no module: a using of it
// imports the host's types and reaches no module's. The one real hit is the control that the rules still run.
const sharedNamespaceFiles = (projectText) => ({
  "api/Api.csproj": projectText,
  "api/Host.cs": "namespace App;\npublic sealed class Host;\n",
  ...entity("Forms"),
  ...entity("Billing"),
  "api/Modules/Forms/Application/FormsUse.cs": "using App;\nusing App.Modules;\nnamespace App.Modules.Forms.Application;\npublic sealed class FormsUse;\n",
  "api/Modules/Billing/Application/BillingUse.cs": "namespace App.Modules.Billing.Application;\npublic sealed class BillingUse;\n",
});

const noModuleFindings = (root) => ["MER-BE-003", "MER-BE-004", "MER-BE-005"].flatMap((id) => run(root, id).findings.map((finding) => [finding.rule, finding.location, finding.message]));

test("a global using, a Common using, and a module's using of a namespace shared by the modules and the host name no module", () => {
  const files = {
    ...sharedNamespaceFiles(project()),
    "api/GlobalUsings.cs": "global using App;\n",
    "api/Common/Shared.cs": "using App;\nusing App.Modules;\nnamespace App.Common;\npublic sealed class Shared;\n",
    // The control: a using that does name a Billing type, so the rules are running over these files.
    "api/Modules/Forms/Application/Reach.cs": "using App.Modules.Billing.Domain;\nnamespace App.Modules.Forms.Application;\npublic sealed class Reach;\n",
  };
  const root = build("shared-namespace-using", files);
  assert.deepEqual(noModuleFindings(root), [
    ["MER-BE-003", "api/Modules/Forms/Application/Reach.cs:1", "module Forms must not use Billing.Domain — consume a published contract or define a required port"],
  ]);
});

test("an MSBuild <Using> of a namespace shared by the modules and the host names no module", () => {
  const files = {
    ...sharedNamespaceFiles(project('\n  <ItemGroup>\n    <Using Include="App" />\n    <Using Include="App.Modules" />\n  </ItemGroup>')),
    "api/Modules/Forms/Application/Reach.cs": "using App.Modules.Billing.Domain;\nnamespace App.Modules.Forms.Application;\npublic sealed class Reach;\n",
  };
  const root = build("shared-namespace-item", files);
  assert.deepEqual(noModuleFindings(root), [
    ["MER-BE-003", "api/Modules/Forms/Application/Reach.cs:1", "module Forms must not use Billing.Domain — consume a published contract or define a required port"],
  ]);
});

test("a global using under nested backend roots is judged once, by the root that classifies the file, and a host file no root classifies is one finding", () => {
  const files = {
    "App.csproj": project(),
    ...Object.fromEntries(Object.entries(contract("Alpha")).map(([file, text]) => [file.replace("api/", ""), text])),
    "api/Modules/Beta/Contracts/BetaThing.cs": "namespace App.Modules.Beta.Contracts;\npublic sealed record BetaThing(int Id);\n",
    ...entity("Beta"),
    "api/Modules/Gamma/Application/Globals.cs": "global using App.Modules.Beta.Contracts;\nnamespace App.Modules.Gamma.Application;\npublic sealed class Globals;\n",
    "api/Modules/Gamma/Application/DomainGlobals.cs": "global using App.Modules.Beta.Domain;\nnamespace App.Modules.Gamma.Application;\npublic sealed class DomainGlobals;\n",
    "api/Modules/Gamma/Domain/GammaEntity.cs": "global using App.Modules.Beta.Contracts;\nnamespace App.Modules.Gamma.Domain;\npublic sealed class GammaEntity { public int Id { get; set; } }\n",
    // No backend root classifies a host file outside Modules/, Common/, and Contracts/, so every root's pass reads it.
    "api/GlobalUsings.cs": "global using App.Modules.Beta.Domain;\n",
  };
  const root = build("nested-roots-global", files);
  const found = Object.fromEntries(["MER-BE-003", "MER-BE-004", "MER-BE-005"].map((id) => [id, run(root, id).findings.map((finding) => [finding.location, finding.message])]));
  const message = (id, location) => found[id].filter(([where]) => where === location).map(([, text]) => text);

  // A Domain target from a module file: the inner root's finding with the module as owner, and no "outside module" one.
  assert.deepEqual(message("MER-BE-003", "api/Modules/Gamma/Application/DomainGlobals.cs:1"), [
    "module Gamma must not use Beta.Domain — consume a published contract or define a required port",
  ]);
  // A Domain target from a host file read by both passes: one finding, with no module as owner.
  assert.deepEqual(message("MER-BE-003", "api/GlobalUsings.cs:1"), [
    "module outside module must not use Beta.Domain — consume a published contract or define a required port",
  ]);
  assert.deepEqual(found["MER-BE-003"].map(([where]) => where), ["api/GlobalUsings.cs:1", "api/Modules/Gamma/Application/DomainGlobals.cs:1"]);
  assert.deepEqual(found["MER-BE-004"], []);
  // Gamma Application's Contracts global is the one project-wide finding; Gamma Domain's gets the Domain message only.
  assert.deepEqual(message("MER-BE-005", "api/Modules/Gamma/Application/Globals.cs:1"), [
    "global using of Beta.Contracts puts module Beta in every file of the project — use it only in the files that need it",
  ]);
  assert.deepEqual(message("MER-BE-005", "api/Modules/Gamma/Domain/GammaEntity.cs:1"), [
    "module Gamma Domain must not use Beta.Contracts — published contracts are for Application and integration consumers",
  ]);
  assert.deepEqual(found["MER-BE-005"].map(([where]) => where), ["api/Modules/Gamma/Application/Globals.cs:1", "api/Modules/Gamma/Domain/GammaEntity.cs:1"]);
});

// ---- claims ----

const claimsFiles = lazy(() => {
  const files = { "api/Api.csproj": project() };
  const uses = (module, targets, extra = "") => {
    const usings = targets.map((target) => `using App.Modules.${target}.Contracts;\n`).join("");
    const parameters = targets.map((target) => `${target}Thing ${target.toLowerCase()}`).join(", ");
    files[`api/Modules/${module}/Application/Use.cs`] = `${usings}namespace App.Modules.${module}.Application;\n${extra}public sealed class Use(${parameters});\n`;
  };
  for (const module of ["Cases", "CaseTypes", "Connectors", "Forms", "Audit", "Notes"]) Object.assign(files, contract(module));
  // Cases uses CaseTypes twice, so its first reference is the using on line 1.
  uses("Cases", ["CaseTypes", "Connectors", "Forms", "Audit"], "");
  files["api/Modules/OnlyTests/Tests/CheckOnly.cs"] = "namespace App.Modules.OnlyTests.Tests;\npublic sealed class CheckOnly;\n";
  files["api/Modules/Cases/Application/Second.cs"] = "using App.Modules.CaseTypes.Contracts;\nnamespace App.Modules.Cases.Application;\npublic sealed class Second(CaseTypesThing again, CaseTypesThing twice);\n";
  uses("CaseTypes", ["Connectors"]);
  uses("Connectors", ["Cases", "CaseTypes"]);
  uses("Forms", ["Connectors", "Audit", "Notes"]);
  uses("Audit", ["Forms"]);
  uses("Notes", ["Audit", "Connectors"]);
  // LoopA claims to depend on LoopC, so LoopC → LoopA is against the claims. Without that edge the other four still loop,
  // by the longer way round: 062's loop is found in what is left, not in the whole graph.
  for (const module of ["LoopA", "LoopB", "LoopC", "LoopD"]) Object.assign(files, contract(module));
  uses("LoopA", ["LoopB"]);
  uses("LoopB", ["LoopC"]);
  uses("LoopC", ["LoopA", "LoopD"]);
  uses("LoopD", ["LoopA"]);
  // LoopX → LoopY and LoopP → LoopQ are both against the claims, and LoopX's loop back runs through LoopP → LoopQ: 061's
  // loop is found in the whole graph. Taking both away leaves LoopY → LoopP and LoopQ → LoopX, which loop with nothing.
  for (const module of ["LoopX", "LoopY", "LoopP", "LoopQ"]) Object.assign(files, contract(module));
  uses("LoopX", ["LoopY"]);
  uses("LoopY", ["LoopP"]);
  uses("LoopP", ["LoopQ"]);
  uses("LoopQ", ["LoopX"]);
  return { root: build("claims", files), files };
});

const CLAIMED = `{
  "modules": {
    "Cases": { "CaseTypes": "a typed Case takes its rules from its Case type version" },
    "CaseTypes": { "Connectors": "a Case type's stage actions run connector operations" },
    "LoopA": { "LoopC": "a LoopA keeps its rules only with a LoopC" },
    "LoopY": { "LoopX": "a LoopY keeps its rules only with a LoopX" },
    "LoopQ": { "LoopP": "a LoopQ keeps its rules only with a LoopP" }
  }
}
`;

test("a reference against the claims is MER-BE-061 and a reference through the transitive claims is fine", () => {
  const { root } = claimsFiles();
  claims(root, CLAIMED);
  const { findings } = run(root, "MER-BE-061");
  // Cases → Connectors runs through CaseTypes and is fine; Connectors → Cases is its reverse.
  assert.deepEqual(findings.map((finding) => finding.location), ["api/Modules/Connectors/Application/Use.cs:1", "api/Modules/Connectors/Application/Use.cs:2", "api/Modules/LoopC/Application/Use.cs:1", "api/Modules/LoopP/Application/Use.cs:1", "api/Modules/LoopX/Application/Use.cs:1"]);
  // 061's loop is found in the whole graph, against-the-claims edges included: LoopC → LoopA → LoopB → LoopC, and
  // LoopX → LoopY → LoopP → LoopQ → LoopX, which runs through LoopP → LoopQ, itself against the claims.
  assert.match(findings[2].message, /^module LoopC must not depend on LoopA: .* \(loop LoopC → LoopA → LoopB → LoopC\) —/);
  assert.match(findings[4].message, /^module LoopX must not depend on LoopY: .* \(loop LoopX → LoopY → LoopP → LoopQ → LoopX\) —/);
  assert.match(findings[0].message, /^module Connectors must not depend on Cases: \.plumb-modules\.json claims Cases depends on Connectors, directly or through other claims \(loop Connectors → Cases → Connectors\) — define a consumer-owned required port in Connectors and bridge it at the host, or move a genuinely shared type to Common$/);
  assert.match(findings[1].message, /^module Connectors must not depend on CaseTypes: .*\(loop Connectors → CaseTypes → Connectors\)/);
});

test("an undecided edge is MER-BE-062 only inside a loop that is left once the edges against the claims are removed", () => {
  const { root } = claimsFiles();
  claims(root, CLAIMED);
  const { findings, locations } = run(root, "MER-BE-062");
  // Forms, Audit, and Notes loop among themselves. Cases → Forms and Forms → Connectors would close a loop only through
  // Connectors → Cases, which is against the claims; Cases → Audit and Notes → Connectors loop with nothing.
  assert.deepEqual(locations, [
    "api/Modules/Audit/Application/Use.cs:1",
    "api/Modules/Forms/Application/Use.cs:2",
    "api/Modules/Forms/Application/Use.cs:3",
    "api/Modules/LoopA/Application/Use.cs:1",
    "api/Modules/LoopB/Application/Use.cs:1",
    "api/Modules/LoopC/Application/Use.cs:2",
    "api/Modules/LoopD/Application/Use.cs:1",
    "api/Modules/Notes/Application/Use.cs:1",
  ]);
  const loops = Object.fromEntries(findings.map((finding) => [finding.location, finding.message.match(/^modules (\w+) and (\w+) are in a loop \(([^)]*)\)/).slice(1, 4)]));
  assert.deepEqual(loops["api/Modules/Audit/Application/Use.cs:1"], ["Audit", "Forms", "Audit → Forms → Audit"]);
  assert.deepEqual(loops["api/Modules/Forms/Application/Use.cs:2"], ["Forms", "Audit", "Forms → Audit → Forms"]);
  // LoopA → LoopB's shortest loop in the whole graph is LoopA → LoopB → LoopC → LoopA, through the edge against the claims;
  // 062 names the shortest one in what is left, the longer way round through LoopD.
  assert.deepEqual(loops["api/Modules/LoopA/Application/Use.cs:1"], ["LoopA", "LoopB", "LoopA → LoopB → LoopC → LoopD → LoopA"]);
  // 062's loop is found in what is left once the edges against the claims are gone: Notes → Audit → Forms → Notes.
  assert.deepEqual(loops["api/Modules/Forms/Application/Use.cs:3"], ["Forms", "Notes", "Forms → Notes → Audit → Forms"]);
  assert.deepEqual(loops["api/Modules/Notes/Application/Use.cs:1"], ["Notes", "Audit", "Notes → Audit → Forms → Notes"]);
  assert.match(findings[0].message, /if Audit can't keep its rules without Forms, add that claim with its reason; if not, replace this reference with a consumer-owned required port bridged at the host$/);
});

test("one finding per edge and file, at the file's first reference, however many references the file has", () => {
  const { root } = claimsFiles();
  noClaims(root);
  const { locations } = run(root, "MER-BE-062");
  // Cases uses CaseTypes in Use.cs (a using and a parameter) and in Second.cs (a using and two parameters): one
  // finding per file, at the using, not one per use.
  assert.deepEqual(locations.filter((location) => location.includes("/Cases/Application/")), [
    "api/Modules/Cases/Application/Second.cs:1",
    "api/Modules/Cases/Application/Use.cs:1",
    "api/Modules/Cases/Application/Use.cs:2",
    "api/Modules/Cases/Application/Use.cs:3",
    "api/Modules/Cases/Application/Use.cs:4",
  ]);
});

test("claims that loop are dropped with one MER-BE-063, so the edge they would have decided is MER-BE-062", () => {
  const { root } = claimsFiles();
  claims(root, '{\n  "modules": {\n    "LoopA": { "LoopB": "a" },\n    "LoopB": { "LoopA": "b" }\n  }\n}\n');
  const problems = run(root, "MER-BE-063");
  assert.deepEqual(problems.locations, [".plumb-modules.json:3"]);
  assert.match(problems.findings[0].message, /^\.plumb-modules\.json claims a loop \(LoopA → LoopB → LoopA\) — remove the claim that's false; every claim among these modules is ignored$/);
  // Kept, LoopA → LoopB would be against LoopB's claim; dropped, it is an undecided edge in a loop.
  assert.deepEqual(run(root, "MER-BE-061").findings, []);
  assert.ok(run(root, "MER-BE-062").locations.includes("api/Modules/LoopA/Application/Use.cs:1"));
});

test("an undecided edge outside any loop is quiet", () => {
  const { root } = claimsFiles();
  claims(root, CLAIMED);
  const { locations } = run(root, "MER-BE-062");
  // Cases → Audit (Use.cs:4) loops with nothing.
  assert.ok(!locations.includes("api/Modules/Cases/Application/Use.cs:4"), locations.join("\n"));
  assert.ok(!locations.some((location) => location.startsWith("api/Modules/Cases/")), locations.join("\n"));
});

test("claims text that won't parse is one MER-BE-063 at line 1, and the loops are still MER-BE-062", () => {
  const { root } = claimsFiles();
  claims(root, '{ "modules": ');
  const invalid = run(root, "MER-BE-063");
  assert.equal(invalid.findings.length, 1);
  assert.match(invalid.findings[0].location, /^\.plumb-modules\.json:1$/);
  assert.match(invalid.findings[0].message, /^\.plumb-modules\.json isn't valid JSON \(.*\) — fix the syntax; no claims apply until then$/);
  const loops = run(root, "MER-BE-062");
  assert.ok(loops.locations.includes("api/Modules/Connectors/Application/Use.cs:1"), loops.locations.join("\n"));
  assert.equal(run(root, "MER-BE-061").findings.length, 0);
});

test("a duplicate key is a MER-BE-063 at the second key, and both copies are ignored", () => {
  const { root } = claimsFiles();
  claims(root, '{\n  "modules": {\n    "Cases": { "CaseTypes": "a" },\n    "Cases": { "CaseTypes": "b" },\n    "CaseTypes": { "Connectors": "c" }\n  }\n}\n');
  const duplicate = run(root, "MER-BE-063");
  assert.deepEqual(duplicate.locations, [".plumb-modules.json:4"]);
  assert.match(duplicate.findings[0].message, /^\.plumb-modules\.json lists module Cases twice — keep one entry; the claims of both are ignored$/);
  // Cases' claim is gone, so Cases → CaseTypes is undecided in the loop Cases → CaseTypes → Connectors → Cases.
  assert.ok(run(root, "MER-BE-062").locations.includes("api/Modules/Cases/Application/Use.cs:1"));
});

test("each way the claims file can be wrong is one MER-BE-063 at its key, and says what happens to the claim", () => {
  const bad = run(path.join(FIXTURES, "MER-BE-063", "bad"), "MER-BE-063");
  assert.deepEqual(bad.findings.map((finding) => [finding.location.replace(".plumb-modules.json:", ""), finding.message.replace(".plumb-modules.json ", "")]), [
    ["3", "names module Billing, which has no Modules/Billing folder — remove it or fix the name; its claims are dropped"],
    ["6", "claims a loop (Cases → Forms → Cases) — remove the claim that's false; every claim among these modules is ignored"],
    ["7", "claims Cases depends on itself — remove the claim"],
    ["9", "claims Cases → Records with no reason — give the domain fact that makes the first need the second; the claim is dropped"],
    ["16", "claims Records → People twice — keep one; both are ignored"],
  ].sort((left, right) => left[0].localeCompare(right[0])));
  assert.deepEqual(run(path.join(FIXTURES, "MER-BE-063", "good"), "MER-BE-063").findings, []);
});

test("a claims file with a wrong shape is one MER-BE-063 and no claim applies", () => {
  const { root } = claimsFiles();
  for (const [text, line, message] of [
    ["[]", 1, /^\.plumb-modules\.json must be a JSON object with a "modules" map — no claims apply until it is$/],
    ['{ "modules": [] }', 1, /^\.plumb-modules\.json needs a "modules" object mapping each module to the modules it depends on — add it; no claims apply until then$/],
    ['{\n  "modules": {},\n  "version": 1\n}\n', 3, /^\.plumb-modules\.json has the unknown top-level key "version" — only "modules" is read: remove it; no claims apply until then$/],
    ['{\n  "modules": {},\n  "modules": {}\n}\n', 3, /^\.plumb-modules\.json has the key "modules" twice — keep one; no claims apply until then$/],
    ['{ "modules": { "Cases": null } }', 1, /^\.plumb-modules\.json has null for Cases, not an object of claims — give "Module": "reason" claims; this entry is skipped$/],
    ['{ "modules": { "Cases": [] } }', 1, /^\.plumb-modules\.json has array for Cases, not an object of claims — give "Module": "reason" claims; this entry is skipped$/],
  ]) {
    claims(root, text);
    const { findings } = run(root, "MER-BE-063");
    assert.equal(findings.length, 1, text);
    assert.equal(findings[0].location, `.plumb-modules.json:${line}`, text);
    assert.match(findings[0].message, message, text);
  }
  // A BOM before the JSON doesn't make it invalid, and its offsets still give the key's line. "Nowhere", the reported
  // key, starts at column 0 of line 4, so an offset one short lands on line 3's newline.
  claims(root, '﻿{\n"modules": {\n"Cases": {\n"Nowhere": "x"\n}\n}\n}\n');
  const bom = run(root, "MER-BE-063").findings;
  assert.deepEqual(bom.map((finding) => finding.location), [".plumb-modules.json:4"]);
  assert.match(bom[0].message, /^\.plumb-modules\.json names module Nowhere, which has no Modules\/Nowhere folder — remove it or fix the name; the claim is dropped$/);
  claims(root, '{\n  "modules": {\n    "Cases": { "Nowhere": "x", "OnlyTests": "y" }\n  }\n}\n');
  const { findings } = run(root, "MER-BE-063");
  // A folder that holds only test code is no module.
  assert.deepEqual(findings.map((finding) => finding.location), [".plumb-modules.json:3", ".plumb-modules.json:3"]);
  assert.match(findings[0].message, /^\.plumb-modules\.json names module Nowhere, which has no Modules\/Nowhere folder — remove it or fix the name; the claim is dropped$/);
  assert.match(findings[1].message, /^\.plumb-modules\.json names module OnlyTests, which has no Modules\/OnlyTests folder — remove it or fix the name; the claim is dropped$/);
});

// ---- routes: code outside the modules that a module uses and that uses another module ----

const routeFiles = lazy(() => {
  const files = { "api/Api.csproj": project() };
  const pair = (x, y) => Object.assign(files, back(x, y));
  const host = (file, text) => { files[`api/Infrastructure/${file}.cs`] = `using App.Modules.${text.module}.Contracts;\nnamespace App.Infrastructure;\n${text.body}\n`; };
  const xFile = (x, name, body, usings = "") => { files[`api/Modules/${x}/Application/${name}.cs`] = `${usings}namespace App.Modules.${x}.Application;\n${body}\n`; };

  files["api/Stubs/EfCore.cs"] = `namespace Microsoft.EntityFrameworkCore
{
    public class DbContext
    {
        public virtual int Save() => 0;
        protected virtual void OnModelCreating(ModelBuilder modelBuilder) { }
    }
    public class DbSet<T> where T : class { public IEnumerable<T> Rows() => []; }
    public class ModelBuilder { public Metadata.Builders.EntityTypeBuilder<T> Entity<T>() where T : class => new(); }
}
namespace Microsoft.EntityFrameworkCore.Metadata.Builders { public class EntityTypeBuilder<T> where T : class { } }
namespace Microsoft.EntityFrameworkCore.Infrastructure
{
    [AttributeUsage(AttributeTargets.Class)]
    public sealed class DbContextAttribute(Type contextType) : Attribute { }
}
`;

  // Through one host type, through a chain of two, and through a host extension member.
  pair("HostX", "HostY");
  host("HostBridge", { module: "HostY", body: "public sealed class HostBridge { public HostYThing? Thing { get; set; } }" });
  xFile("HostX", "UseBridge", "public sealed class UseBridge\n{\n    public HostBridge Bridge { get; } = new();\n}", "using App.Infrastructure;\n");
  pair("ChainX", "ChainY");
  host("ChainOne", { module: "ChainY", body: "public sealed class ChainOne { public ChainTwo Two { get; } = new(); }" });
  files["api/Infrastructure/ChainTwo.cs"] = "using App.Modules.ChainY.Contracts;\nnamespace App.Infrastructure;\npublic sealed class ChainTwo { public ChainYThing? Thing { get; set; } }\n";
  xFile("ChainX", "UseChain", "public sealed class UseChain\n{\n    public ChainOne One { get; } = new();\n}", "using App.Infrastructure;\n");
  pair("ExtX", "ExtY");
  host("ExtBridge", { module: "ExtY", body: "public static class ExtBridge\n{\n    public static int Pull(this string value)\n    {\n        ExtYThing? thing = null;\n        return thing is null ? value.Length : 0;\n    }\n}" });
  xFile("ExtX", "UseExt", "public sealed class UseExt\n{\n    public int Run() => \"x\".Pull();\n}", "using App.Infrastructure;\n");
  // Through a transport-contract type, and through a Common type that uses a host type.
  pair("TransX", "TransY");
  files["api/Contracts/Things/ThingMapper.cs"] = "using App.Modules.TransY.Contracts;\nnamespace App.Contracts.Things;\npublic static class ThingMapper\n{\n    public static int Zero()\n    {\n        TransYThing? thing = null;\n        return thing is null ? 0 : thing.Id;\n    }\n}\n";
  xFile("TransX", "UseMapper", "public sealed class UseMapper\n{\n    public int Run() => ThingMapper.Zero();\n}", "using App.Contracts.Things;\n");
  pair("ComX", "ComY");
  files["api/Common/ComClock.cs"] = "using App.Infrastructure;\nnamespace App.Common;\npublic sealed class ComClock { public ComHost Host { get; } = new(); }\n";
  host("ComHost", { module: "ComY", body: "public sealed class ComHost { public ComYThing? Thing { get; set; } }" });
  xFile("ComX", "UseClock", "public sealed class UseClock\n{\n    public ComClock Clock { get; } = new();\n}", "using App.Common;\n");
  // A type-level miss: an enum beside a class that uses a module is no route.
  pair("MissX", "MissY");
  host("MissFilter", { module: "MissY", body: "public enum MissKey { Id }\npublic sealed class MissFilter { public MissYThing? Thing { get; set; } }" });
  xFile("MissX", "UseKey", "public sealed class UseKey\n{\n    public MissKey Key => MissKey.Id;\n}", "using App.Infrastructure;\n");
  // A class taking the DbContext as a primary-constructor parameter, or attributed with it, is still a route.
  pair("CtorX", "CtorY");
  host("CtorLinks", { module: "CtorY", body: "using App.Persistence;\npublic sealed class CtorLinks(AppDbContext db) { public CtorYThing? Thing { get; set; } }" });
  xFile("CtorX", "UseLinks", "public sealed class UseLinks\n{\n    public CtorLinks Links { get; } = new(null!);\n}", "using App.Infrastructure;\n");
  pair("AttrX", "AttrY");
  host("AttrLinks", { module: "AttrY", body: "using App.Persistence;\nusing Microsoft.EntityFrameworkCore.Infrastructure;\n[DbContext(typeof(AppDbContext))]\npublic sealed class AttrLinks { public AttrYThing? Thing { get; set; } }" });
  xFile("AttrX", "UseLinks", "public sealed class UseLinks\n{\n    public AttrLinks Links { get; } = new();\n}", "using App.Infrastructure;\n");
  // The persistence root: its type, partial, reached through an in-source base class and an interface, is no route.
  pair("NoX", "NoY");
  Object.assign(files, entity("NoY"));
  xFile("NoX", "UseRoot", "public sealed class UseRoot(AppDbContext db, IAppDbContext port, AppDbContextBase baseDb);", "using App.Persistence;\n");
  // A member of the root that reads another module's data is a route, whoever calls it.
  for (const name of ["Mem", "Outer", "Help", "Set", "If", "Ovr"]) { pair(`${name}X`, `${name}Y`); Object.assign(files, entity(`${name}Y`)); }
  xFile("MemX", "UseRoot", "public sealed class UseRoot(AppDbContext db)\n{\n    public int Run() => db.CountMem();\n}", "using App.Persistence;\n");
  xFile("OuterX", "UseRoot", "public sealed class UseRoot(AppDbContext db)\n{\n    public int Run() => db.OuterCount();\n}", "using App.Persistence;\n");
  files["api/Infrastructure/DbHelper.cs"] = "using App.Persistence;\nnamespace App.Infrastructure;\npublic sealed class DbHelper(AppDbContext db) { public int Count() => db.CountHelp(); }\n";
  xFile("HelpX", "UseHelper", "public sealed class UseHelper\n{\n    public DbHelper Helper { get; } = new(null!);\n}", "using App.Infrastructure;\n");
  // A module reading a DbSet itself is a direct reference to its entity, whatever route the member also gives.
  xFile("SetX", "UseRoot", "public sealed class UseRoot(AppDbContext db)\n{\n    public object Run() => db.SetRows;\n}", "using App.Persistence;\n");
  xFile("IfX", "UseRoot", "public sealed class UseRoot(IAppDbContext db)\n{\n    public int Run() => db.CountIf();\n}", "using App.Persistence;\n");
  // The root's override of a virtual member is the root's own code: calling the base member routes nowhere.
  xFile("OvrX", "UseRoot", "public sealed class UseRoot(AppDbContext db)\n{\n    public int Run() => db.Save();\n}", "using App.Persistence;\n");
  files["api/Persistence/AppDbContextBase.cs"] = "using Microsoft.EntityFrameworkCore;\nnamespace App.Persistence;\npublic abstract class AppDbContextBase : DbContext { }\n";
  files["api/Persistence/IAppDbContext.cs"] = "namespace App.Persistence;\npublic interface IAppDbContext { int CountIf(); }\n";
  files["api/Persistence/AppDbContext.cs"] = `using App.Modules.HelpY.Domain;
using App.Modules.IfY.Domain;
using App.Modules.MemY.Domain;
using App.Modules.OuterY.Domain;
using App.Modules.OvrY.Domain;
using App.Modules.SetY.Domain;
using Microsoft.EntityFrameworkCore;
namespace App.Persistence;
public partial class AppDbContext : AppDbContextBase, IAppDbContext
{
    public DbSet<HelpYEntity> HelpRows { get; } = new();
    public DbSet<IfYEntity> IfRows { get; } = new();
    public DbSet<MemYEntity> MemRows { get; } = new();
    public DbSet<OuterYEntity> OuterRows { get; } = new();
    public DbSet<OvrYEntity> OvrRows { get; } = new();
    public DbSet<SetYEntity> SetRows { get; } = new();
    public int CountMem() => MemRows.Rows().Count();
    public int OuterCount() => InnerCount();
    int InnerCount() => OuterRows.Rows().Count();
    public int CountHelp() => HelpRows.Rows().Count();
    public int CountIf() => IfRows.Rows().Count();
    public override int Save() { var n = OvrRows.Rows().Count(); return n; }
}
`;
  files["api/Persistence/AppDbContext.Model.cs"] = "using App.Modules.NoY.Domain;\nusing Microsoft.EntityFrameworkCore;\nnamespace App.Persistence;\npublic partial class AppDbContext\n{\n    protected override void OnModelCreating(ModelBuilder modelBuilder) { modelBuilder.Entity<NoYEntity>(); }\n}\n";
  // A file with a derived and a direct reference to one module: the finding is at the direct one.
  pair("BothX", "BothY");
  host("BothBridge", { module: "BothY", body: "public sealed class BothBridge { public BothYThing? Thing { get; set; } }" });
  xFile("BothX", "UseBoth", "public sealed class UseBoth\n{\n    public BothBridge Bridge { get; } = new();\n    public App.Modules.BothY.Contracts.BothYThing? Direct { get; set; }\n}", "using App.Infrastructure;\n");
  return { root: build("routes", files), files };
});

// The whole MER-BE-062 result over the routes repository: each pair's two edges, bar MissX, NoX, and OvrX, which make no route.
const ROUTE_LOCATIONS = [
  "api/Modules/AttrX/Application/UseLinks.cs:5",
  "api/Modules/AttrY/Application/BackAttrX.cs:1",
  "api/Modules/BothX/Application/UseBoth.cs:6",
  "api/Modules/BothY/Application/BackBothX.cs:1",
  "api/Modules/ChainX/Application/UseChain.cs:5",
  "api/Modules/ChainY/Application/BackChainX.cs:1",
  "api/Modules/ComX/Application/UseClock.cs:5",
  "api/Modules/ComY/Application/BackComX.cs:1",
  "api/Modules/CtorX/Application/UseLinks.cs:5",
  "api/Modules/CtorY/Application/BackCtorX.cs:1",
  "api/Modules/ExtX/Application/UseExt.cs:5",
  "api/Modules/ExtY/Application/BackExtX.cs:1",
  "api/Modules/HelpX/Application/UseHelper.cs:5",
  "api/Modules/HelpY/Application/BackHelpX.cs:1",
  "api/Modules/HostX/Application/UseBridge.cs:5",
  "api/Modules/HostY/Application/BackHostX.cs:1",
  "api/Modules/IfX/Application/UseRoot.cs:5",
  "api/Modules/IfY/Application/BackIfX.cs:1",
  "api/Modules/MemX/Application/UseRoot.cs:5",
  "api/Modules/MemY/Application/BackMemX.cs:1",
  "api/Modules/OuterX/Application/UseRoot.cs:5",
  "api/Modules/OuterY/Application/BackOuterX.cs:1",
  "api/Modules/SetX/Application/UseRoot.cs:5",
  "api/Modules/SetY/Application/BackSetX.cs:1",
  "api/Modules/TransX/Application/UseMapper.cs:5",
  "api/Modules/TransY/Application/BackTransX.cs:1",
];

const route = (files, x, file, needle) => spot(files, `api/Modules/${x}X/Application/${file}.cs`, needle);

test("a route through host code, a chain of two host types, a host extension member, a transport-contract type, or a Common type is a derived finding with its fix", () => {
  const { root, files } = routeFiles();
  const { findings, locations } = run(root, "MER-BE-062");
  assert.deepEqual(locations, ROUTE_LOCATIONS);
  const at = (location) => findings.find((finding) => finding.location === location)?.message;
  assert.match(at(route(files, "Host", "UseBridge", "HostBridge Bridge")), /^modules HostX and HostY are in a loop \(HostX → HostY → HostX\) through App\.Infrastructure\.HostBridge \(api\/Infrastructure\/HostBridge\.cs\), and \.plumb-modules\.json doesn't say whether HostX depends on HostY — if HostX can't keep its rules without HostY, add that claim with its reason; if not, stop using App\.Infrastructure\.HostBridge from module HostX: register it at the host, or move what App\.Infrastructure\.HostBridge needs from HostY behind a consumer-owned port$/);
  assert.match(at(route(files, "Chain", "UseChain", "ChainOne One")), /through App\.Infrastructure\.ChainOne \(api\/Infrastructure\/ChainOne\.cs\) → App\.Infrastructure\.ChainTwo \(api\/Infrastructure\/ChainTwo\.cs\), and/);
  assert.match(at(route(files, "Ext", "UseExt", "Pull")), /through App\.Infrastructure\.ExtBridge \(api\/Infrastructure\/ExtBridge\.cs\)/);
  assert.match(at(route(files, "Trans", "UseMapper", "Zero")), /through App\.Contracts\.Things\.ThingMapper \(api\/Contracts\/Things\/ThingMapper\.cs\), and .*; if not, stop using App\.Contracts\.Things\.ThingMapper from module TransX: move what TransX uses from it into TransX's own transport mapping, or into Common if it's genuinely shared$/);
  assert.match(at(route(files, "Com", "UseClock", "ComClock Clock")), /through App\.Common\.ComClock \(api\/Common\/ComClock\.cs\) → App\.Infrastructure\.ComHost \(api\/Infrastructure\/ComHost\.cs\), and .*; if not, move what reaches ComY out of shared type App\.Common\.ComClock: Common names no module, directly or through host code$/);
  // A host type that takes the DbContext in its primary constructor, or is attributed with it, is a route like any other.
  assert.match(at(route(files, "Ctor", "UseLinks", "CtorLinks Links")), /through App\.Infrastructure\.CtorLinks \(api\/Infrastructure\/CtorLinks\.cs\)/);
  assert.match(at(route(files, "Attr", "UseLinks", "AttrLinks Links")), /through App\.Infrastructure\.AttrLinks \(api\/Infrastructure\/AttrLinks\.cs\)/);
});

test("a type-level miss and the persistence root's type make no route", () => {
  const { root, files } = routeFiles();
  const { locations } = run(root, "MER-BE-062");
  // The enum MissKey sits beside a class that uses MissY, and the root's type, partial, through its base class and
  // its interface, is named by NoX while the root's model names NoY's entity. MissY → MissX and NoY → NoX are acyclic.
  assert.ok(!locations.includes(route(files, "Miss", "UseKey", "MissKey Key")), locations.join("\n"));
  assert.ok(!locations.some((location) => /\/(?:Miss|No)X\//.test(location)), locations.join("\n"));
  assert.ok(!locations.some((location) => /\/(?:Miss|No)Y\//.test(location)), locations.join("\n"));
});

test("a module calling a root member that reads another module's data is a route through that member; the root's override is not", () => {
  const { root, files } = routeFiles();
  const { findings, locations } = run(root, "MER-BE-062");
  assert.deepEqual(locations, ROUTE_LOCATIONS);
  const at = (location) => findings.find((finding) => finding.location === location)?.message;
  const fix = (name, member, x, y) => new RegExp(`through App\\.Persistence\\.AppDbContext\\.${member} \\(api\\/Persistence\\/AppDbContext\\.cs\\), and .*; if not, stop calling ${name.replaceAll(".", "\\.")}\\.${member} from module ${x}: it reads ${y}'s data, so move that query into ${y} and reach it through a consumer-owned required port$`);
  assert.match(at(route(files, "Mem", "UseRoot", "db.CountMem")), fix("App.Persistence.AppDbContext", "CountMem", "MemX", "MemY"));
  // A root method that calls another: OuterCount calls InnerCount, which reads OuterY's rows.
  assert.match(at(route(files, "Outer", "UseRoot", "db.OuterCount")), /through App\.Persistence\.AppDbContext\.OuterCount \(api\/Persistence\/AppDbContext\.cs\) → App\.Persistence\.AppDbContext\.InnerCount \(api\/Persistence\/AppDbContext\.cs\), and/);
  // A host helper calling a root method routes through it too.
  assert.match(at(route(files, "Help", "UseHelper", "DbHelper Helper")), /through App\.Infrastructure\.DbHelper \(api\/Infrastructure\/DbHelper\.cs\) → App\.Persistence\.AppDbContext\.CountHelp \(api\/Persistence\/AppDbContext\.cs\), and/);
  // A call through the root's interface leads to the root's member of that name.
  assert.match(at(route(files, "If", "UseRoot", "db.CountIf")), /through App\.Persistence\.AppDbContext\.CountIf \(api\/Persistence\/AppDbContext\.cs\), and .* stop calling App\.Persistence\.IAppDbContext\.CountIf from module IfX/);
  // Save is virtual: a call binds the stub's member, not the root's override, which reads OvrY's rows.
  assert.ok(!locations.some((location) => location.includes("/OvrX/")), locations.join("\n"));
});

test("a module reading a DbSet gives one direct finding, and a file with a direct and a derived reference gives one at the direct", () => {
  const { root, files } = routeFiles();
  const { findings } = run(root, "MER-BE-062");
  const set = findings.filter((finding) => finding.location.includes("/SetX/"));
  assert.deepEqual(set.map((finding) => finding.location), [route(files, "Set", "UseRoot", "db.SetRows")]);
  assert.doesNotMatch(set[0].message, /through/);
  const both = findings.filter((finding) => finding.location.includes("/BothX/"));
  assert.deepEqual(both.map((finding) => finding.location), [route(files, "Both", "UseBoth", "Direct")]);
  assert.doesNotMatch(both[0].message, /through/);
});

test("a derived edge against the claims is MER-BE-061 with its route", () => {
  const { root, files } = routeFiles();
  claims(root, '{ "modules": { "HostY": { "HostX": "a Y keeps its rules only with X" } } }\n');
  const { findings } = run(root, "MER-BE-061");
  noClaims(root);
  assert.deepEqual(findings.map((finding) => finding.location), [route(files, "Host", "UseBridge", "HostBridge Bridge")]);
  assert.match(findings[0].message, /^module HostX must not depend on HostY through App\.Infrastructure\.HostBridge \(api\/Infrastructure\/HostBridge\.cs\): \.plumb-modules\.json claims HostY depends on HostX, directly or through other claims \(loop HostX → HostY → HostX\) — stop using App\.Infrastructure\.HostBridge from module HostX: register it at the host, or move what App\.Infrastructure\.HostBridge needs from HostY behind a consumer-owned port$/);
});

// ---- tables ----

const tableFiles = lazy(() => {
  const files = { "api/Api.csproj": project() };
  files["api/Stubs/EfCore.cs"] = `namespace Microsoft.EntityFrameworkCore
{
    public class ModelBuilder
    {
        public ModelBuilder HasDefaultSchema(string? schema) => this;
        public ModelBuilder Entity(string name, Action<Metadata.Builders.EntityTypeBuilder> build) => this;
    }
    public static class RelationalEntityTypeBuilderExtensions
    {
        public static Metadata.Builders.EntityTypeBuilder<T> ToTable<T>(this Metadata.Builders.EntityTypeBuilder<T> builder, string name) where T : class => builder;
        public static Metadata.Builders.EntityTypeBuilder<T> ToTable<T>(this Metadata.Builders.EntityTypeBuilder<T> builder, string name, string? schema) where T : class => builder;
        public static Metadata.Builders.EntityTypeBuilder<T> ToView<T>(this Metadata.Builders.EntityTypeBuilder<T> builder, string name) where T : class => builder;
        public static Metadata.Builders.EntityTypeBuilder<T> ToView<T>(this Metadata.Builders.EntityTypeBuilder<T> builder, string name, string? schema) where T : class => builder;
        public static Metadata.Builders.EntityTypeBuilder ToTable(this Metadata.Builders.EntityTypeBuilder builder, string name) => builder;
    }
}
namespace Microsoft.EntityFrameworkCore.Metadata.Builders
{
    public class EntityTypeBuilder { }
    public class EntityTypeBuilder<T> : EntityTypeBuilder where T : class { }
}
namespace Microsoft.EntityFrameworkCore.Infrastructure { public abstract class ModelSnapshot { } }
`;
  // The default schemas of the host: a name with no schema is compared under both, so ToTable("invoices") and
  // ToView("invoices", "app") are one table.
  files["api/Persistence/Model.cs"] = "using Microsoft.EntityFrameworkCore;\nnamespace App.Persistence;\npublic sealed class Model { public void Build(ModelBuilder modelBuilder) { modelBuilder.HasDefaultSchema(\"app\"); modelBuilder.HasDefaultSchema(\"archive\"); } }\n";
  const mapping = (module, entityName, call, extra = "") => {
    files[`api/Modules/${module}/Domain/${entityName}.cs`] = `namespace App.Modules.${module}.Domain;\n${extra}public sealed class ${entityName} { public int Id { get; set; } }\n`;
    files[`api/Modules/${module}/Infrastructure/${entityName}Configuration.cs`] = `using App.Modules.${module}.Domain;\nusing Microsoft.EntityFrameworkCore;\nusing Microsoft.EntityFrameworkCore.Metadata.Builders;\nnamespace App.Modules.${module}.Infrastructure;\npublic sealed class ${entityName}Configuration\n{\n    public void Configure(EntityTypeBuilder<${entityName}> builder)\n    {\n        builder.${call};\n    }\n}\n`;
  };
  // A ToView of another module's table, whose module uses the other back, closes a loop.
  mapping("Forms", "FormEntity", 'ToTable("forms")');
  mapping("Submissions", "FormRef", 'ToView("forms")');
  Object.assign(files, back("Submissions", "Forms"));
  // Two modules both own one table.
  mapping("LedgerOne", "AccountOne", 'ToTable("accounts")');
  mapping("LedgerTwo", "AccountTwo", 'ToTable("accounts")');
  // A view no module owns, and a mapping in host code, are quiet.
  mapping("Audit", "AuditRow", 'ToView("audit_log")');
  files["api/Persistence/HostMapping.cs"] = "using App.Modules.Forms.Domain;\nusing Microsoft.EntityFrameworkCore;\nusing Microsoft.EntityFrameworkCore.Metadata.Builders;\nnamespace App.Persistence;\npublic sealed class HostMapping { public void Configure(EntityTypeBuilder<FormEntity> builder) { builder.ToView(\"forms\"); } }\n";
  // A schema-qualified table is told apart from the same name in another schema.
  mapping("SchemaOne", "ItemOne", 'ToTable("items", "a")');
  mapping("SchemaTwo", "ItemTwo", 'ToTable("items", "b")');
  mapping("SchemaThree", "ItemThree", 'ToView("items", "a")');
  // With HasDefaultSchema("app"), a name with no schema and the same name in "app" are one table.
  mapping("Billing", "InvoiceEntity", 'ToTable("invoices")');
  mapping("Reporting", "InvoiceRow", 'ToView("invoices", "app")');
  // A [Table] attribute owns a table like ToTable.
  mapping("Books", "BookRow", 'ToView("not_books")', '[System.ComponentModel.DataAnnotations.Schema.Table("books", Schema = "app")]\n');
  mapping("Shelf", "ShelfRow", 'ToView("books")');
  // A table with no mapping in module code is owned through the migrations snapshot.
  files["api/Modules/Orders/Domain/OrderEntity.cs"] = "namespace App.Modules.Orders.Domain;\npublic sealed class OrderEntity { public int Id { get; set; } }\n";
  files["api/Migrations/AppSnapshot.cs"] = "using Microsoft.EntityFrameworkCore;\nusing Microsoft.EntityFrameworkCore.Infrastructure;\nnamespace App.Migrations;\npublic sealed class AppSnapshot : ModelSnapshot\n{\n    public void Build(ModelBuilder modelBuilder)\n    {\n        modelBuilder.Entity(\"App.Modules.Orders.Domain.OrderEntity\", b => { b.ToTable(\"orders\"); });\n    }\n}\n";
  mapping("Dispatch", "OrderRef", 'ToView("orders")');
  // A ToTable in module code does not hide the snapshot's owner: Shipping owns shipments through the snapshot, and
  // Courier's ToTable("shipments") makes a second owner.
  files["api/Modules/Shipping/Domain/ShipmentEntity.cs"] = "namespace App.Modules.Shipping.Domain;\npublic sealed class ShipmentEntity { public int Id { get; set; } }\n";
  files["api/Migrations/AppSnapshot.cs"] = files["api/Migrations/AppSnapshot.cs"].replace("b.ToTable(\"orders\"); });", "b.ToTable(\"orders\"); });\n        modelBuilder.Entity(\"App.Modules.Shipping.Domain.ShipmentEntity\", b => { b.ToTable(\"shipments\"); });");
  mapping("Courier", "CourierRow", 'ToTable("shipments")');
  // With two host defaults, a ToView of another module's unqualified table is still one finding.
  mapping("Stock", "StockRow", 'ToTable("stock")');
  mapping("Picking", "PickRow", 'ToView("stock")');
  // A module that declares a default schema of its own maps into it, not into another module's or the host's: the same
  // unqualified name in two such modules is two tables.
  for (const [module, schema] of [["Alpha", "alpha"], ["Beta", "beta"]]) {
    mapping(module, `${module}Setting`, 'ToTable("settings")');
    files[`api/Modules/${module}/Infrastructure/${module}Context.cs`] = `using Microsoft.EntityFrameworkCore;\nnamespace App.Modules.${module}.Infrastructure;\npublic sealed class ${module}Context { public void Build(ModelBuilder modelBuilder) { modelBuilder.HasDefaultSchema("${schema}"); } }\n`;
  }
  return { root: build("tables", files), files };
});

test("a module mapping another module's table is MER-BE-064, whatever the mapping, schema, or owner's kind", () => {
  const { root, files } = tableFiles();
  const { findings, locations } = run(root, "MER-BE-064");
  const table = (module, entityName) => spot(files, `api/Modules/${module}/Infrastructure/${entityName}Configuration.cs`, "builder.To");
  assert.deepEqual(locations, [
    table("Courier", "CourierRow"),
    table("Dispatch", "OrderRef"),
    table("LedgerOne", "AccountOne"),
    table("LedgerTwo", "AccountTwo"),
    table("Picking", "PickRow"),
    table("Reporting", "InvoiceRow"),
    table("SchemaThree", "ItemThree"),
    table("Shelf", "ShelfRow"),
    table("Submissions", "FormRef"),
  ]);
  const at = (location) => findings.find((finding) => finding.location === location).message;
  const read = "read it through a consumer-owned required port bridged at the host, or";
  assert.equal(at(table("Submissions", "FormRef")), `module Submissions maps Forms's table app.forms — ${read} Forms's published contract`);
  assert.equal(at(table("Reporting", "InvoiceRow")), `module Reporting maps Billing's table app.invoices — ${read} Billing's published contract`);
  assert.equal(at(table("SchemaThree", "ItemThree")), `module SchemaThree maps SchemaOne's table a.items — ${read} SchemaOne's published contract`);
  assert.equal(at(table("Shelf", "ShelfRow")), `module Shelf maps Books's table app.books — ${read} Books's published contract`);
  assert.equal(at(table("Dispatch", "OrderRef")), `module Dispatch maps Orders's table app.orders — ${read} Orders's published contract`);
  assert.equal(at(table("Picking", "PickRow")), `module Picking maps Stock's table app.stock — ${read} Stock's published contract`);
  assert.equal(at(table("Courier", "CourierRow")), "table app.shipments is mapped by modules Courier and Shipping (with ToTable or [Table]) — one module owns a table; the other reads it through a port or a published contract");
  assert.equal(at(table("LedgerOne", "AccountOne")), "table app.accounts is mapped by modules LedgerOne and LedgerTwo (with ToTable or [Table]) — one module owns a table; the other reads it through a port or a published contract");
  assert.equal(at(table("LedgerTwo", "AccountTwo")), at(table("LedgerOne", "AccountOne")));
});

test("a mapping of another module's table is an edge, so MER-BE-062 finds the loop it closes", () => {
  const { root, files } = tableFiles();
  const { findings } = run(root, "MER-BE-062");
  const location = spot(files, "api/Modules/Submissions/Infrastructure/FormRefConfiguration.cs", "builder.ToView");
  const found = findings.filter((finding) => finding.location === location);
  assert.equal(found.length, 1, JSON.stringify(findings));
  assert.match(found[0].message, /^modules Submissions and Forms are in a loop \(Submissions → Forms → Submissions\) and \.plumb-modules\.json doesn't say whether Submissions depends on Forms — if Submissions can't keep its rules without Forms, add that claim with its reason; if not, read Forms's table through a consumer-owned required port bridged at the host, or Forms's published contract$/);
  // A table two modules both own has no owner, so it adds no edge; a view nobody maps with ToTable adds none either.
  assert.ok(!findings.some((finding) => /Ledger|Audit|HostMapping/.test(finding.location)), JSON.stringify(findings));
});

// ---- a project that fails to load ----

test("a file whose project failed to load gives no findings, and the run is degraded", () => {
  const files = {
    // Well-formed XML that MSBuild refuses (MSB4067), so the project loads for nothing.
    "api/Api.csproj": project("\n  <Bogus />"),
    ...back("A", "B"),
    "api/Modules/A/Application/UseB.cs": "using App.Modules.B.Contracts;\nnamespace App.Modules.A.Application;\npublic sealed class UseB(BThing thing);\n",
  };
  const root = build("failed", files, { restore: false });
  const degraded = run(root, "MER-BE-062", { expectDegraded: true });
  assert.deepEqual(degraded.findings, []);
  assert.match(degraded.result.stderr, /^plumb: C# facts incomplete for api\/Api\.csproj: /m);
});

// ---- the fixtures' bad trees: exact findings ----

// A bad fixture's sources copied to a throwaway repository and restored (the fixture keeps no obj/ or bin/ of its own).
function fixtureRepo(name, id) {
  const root = path.join(scratch, name);
  fs.cpSync(path.join(FIXTURES, id, "bad"), root, { recursive: true, filter: (source) => !/[\\/](?:obj|bin)$/.test(source) });
  restoreProjects(root);
  return root;
}
const located = (findings) => findings.map((finding) => `${finding.location} ${finding.message}`).sort();
const askClaim = (from, to) => `.plumb-modules.json doesn't say whether ${from} depends on ${to} — if ${from} can't keep its rules without ${to}, add that claim with its reason; if not,`;
const bridge = "replace this reference with a consumer-owned required port bridged at the host";

test("MER-BE-061/bad: the one reference against the claim Cases → CaseTypes is a single finding, at PublishCheck.cs", () => {
  const root = fixtureRepo("fixture-061", "MER-BE-061");
  assert.deepEqual(located(run(root, "MER-BE-061").findings), [
    "api/Modules/CaseTypes/Application/PublishCheck.cs:1 module CaseTypes must not depend on Cases: .plumb-modules.json claims Cases depends on CaseTypes, directly or through other claims (loop CaseTypes → Cases → CaseTypes) — define a consumer-owned required port in CaseTypes and bridge it at the host, or move a genuinely shared type to Common",
  ]);
});

test("MER-BE-061/bad without its claims file: the two references of the loop are MER-BE-062, one on each edge, and nothing is MER-BE-061", () => {
  const root = fixtureRepo("fixture-061-unclaimed", "MER-BE-061");
  noClaims(root);
  assert.deepEqual(run(root, "MER-BE-061").findings, []);
  assert.deepEqual(located(run(root, "MER-BE-062").findings), [
    `api/Modules/CaseTypes/Application/PublishCheck.cs:1 modules CaseTypes and Cases are in a loop (CaseTypes → Cases → CaseTypes) and ${askClaim("CaseTypes", "Cases")} ${bridge}`,
    `api/Modules/Cases/Application/OpenCase.cs:1 modules Cases and CaseTypes are in a loop (Cases → CaseTypes → Cases) and ${askClaim("Cases", "CaseTypes")} ${bridge}`,
  ].sort());
});

test("MER-BE-062/bad: each of the five loops reports every one of its edges, by the route that closes it", () => {
  const root = fixtureRepo("fixture-062", "MER-BE-062");
  const modules = "api/Modules";
  assert.deepEqual(located(run(root, "MER-BE-062").findings), [
    // Loop 1, Cases → Forms → Records → Cases through Contracts usings, Records → Cases a name written in full (line 4).
    // Each edge is reported with the shortest loop it closes, so Cases → Forms reads as the loop with Forms → Cases.
    `${modules}/Cases/Application/OpenCase.cs:1 modules Cases and Forms are in a loop (Cases → Forms → Cases) and ${askClaim("Cases", "Forms")} ${bridge}`,
    `${modules}/Forms/Application/ListForms.cs:1 modules Forms and Records are in a loop (Forms → Records → Cases → Forms) and ${askClaim("Forms", "Records")} ${bridge}`,
    `${modules}/Records/Application/ListRecords.cs:4 modules Records and Cases are in a loop (Records → Cases → Forms → Records) and ${askClaim("Records", "Cases")} ${bridge}`,
    // Loop 2, People → Records (a Contracts using) and Records → People through the host type RecordLinks.
    `${modules}/People/Application/PersonRecords.cs:1 modules People and Records are in a loop (People → Records → People) and ${askClaim("People", "Records")} ${bridge}`,
    `${modules}/Records/RecordsModule.cs:7 modules Records and People are in a loop (Records → People → Records) through App.Infrastructure.RecordLinks (api/Infrastructure/RecordLinks.cs), and ${askClaim("Records", "People")} stop using App.Infrastructure.RecordLinks from module Records: register it at the host, or move what App.Infrastructure.RecordLinks needs from People behind a consumer-owned port`,
    // Loop 3, Billing → Ledger through an inferred type (Reconcile.cs, `var entry = ledger.Latest()`; ILedgerPort.cs is the
    // same edge by the Ledger using in the port) and Ledger → Billing through a Contracts using.
    `${modules}/Billing/Application/Ports/ILedgerPort.cs:1 modules Billing and Ledger are in a loop (Billing → Ledger → Billing) and ${askClaim("Billing", "Ledger")} ${bridge}`,
    `${modules}/Billing/Application/Reconcile.cs:10 modules Billing and Ledger are in a loop (Billing → Ledger → Billing) and ${askClaim("Billing", "Ledger")} ${bridge}`,
    `${modules}/Ledger/Application/Settle.cs:1 modules Ledger and Billing are in a loop (Ledger → Billing → Ledger) and ${askClaim("Ledger", "Billing")} ${bridge}`,
    // Loop 4, Ledger → Billing through the persistence root's member LatestInvoiceTotal (Billing → Ledger is loop 3's edge).
    `${modules}/Ledger/Infrastructure/LedgerRepository.cs:8 modules Ledger and Billing are in a loop (Ledger → Billing → Ledger) through App.Persistence.AppDbContext.LatestInvoiceTotal (api/Persistence/AppDbContext.cs), and ${askClaim("Ledger", "Billing")} stop calling App.Persistence.AppDbContext.LatestInvoiceTotal from module Ledger: it reads Billing's data, so move that query into Billing and reach it through a consumer-owned required port`,
    // Loop 5, Cases → Forms through Common/Clock.cs → the host type Calendar → Forms, and Forms → Cases through a Contracts using.
    `${modules}/Cases/Application/Schedule.cs:7 modules Cases and Forms are in a loop (Cases → Forms → Cases) through App.Common.Clock (api/Common/Clock.cs) → App.Infrastructure.Calendar (api/Infrastructure/Calendar.cs), and ${askClaim("Cases", "Forms")} move what reaches Forms out of shared type App.Common.Clock: Common names no module, directly or through host code`,
    `${modules}/Forms/Application/CaseLinks.cs:1 modules Forms and Cases are in a loop (Forms → Cases → Forms) and ${askClaim("Forms", "Cases")} ${bridge}`,
  ].sort());
});

test("MER-BE-064/bad: the ToView of a table another module maps with ToTable is the one finding, naming the table and its owner", () => {
  const root = fixtureRepo("fixture-064", "MER-BE-064");
  assert.deepEqual(located(run(root, "MER-BE-064").findings), [
    "api/Modules/Submissions/Infrastructure/CrossModuleRefs.cs:11 module Submissions maps Forms's table forms — read it through a consumer-owned required port bridged at the host, or Forms's published contract",
  ]);
});
