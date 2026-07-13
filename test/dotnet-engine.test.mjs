import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Capability, planCapabilities, createRuleDescriptor, defineRepositoryRule } from "../lib/engine/contracts.mjs";
import { createRepositoryContext } from "../lib/engine/repository-context.mjs";
import { createRepositorySnapshot } from "../lib/engine/repository-snapshot.mjs";
import { maskCSharpText } from "../lib/engine/dotnet-analysis.mjs";

function fixture(source, requirements) {
  const inventory = { root: "/repo", mode: "test", files: [...source.keys()] };
  const snapshot = createRepositorySnapshot(inventory, { readFile(file) { return source.get(file.slice("/repo/".length).replaceAll(path.sep, "/")); } });
  const rule = defineRepositoryRule({ descriptor: createRuleDescriptor({ id: "MER-TO-901", source: "test" }), requirements, analyze() {} });
  return { snapshot, context: createRepositoryContext(snapshot, planCapabilities([rule])).context };
}

test("C# masks preserve offsets and lines for comments and literal forms", () => {
  const source = "var a = \"text\"; // comment\r\nvar b = @\"x\"\"y\";\nvar c = \"\"\"raw\ntext\"\"\";\nvar d = '\\n';";
  const masked = maskCSharpText(source);
  assert.equal(masked.length, source.length);
  assert.equal(masked.replace(/[^\n]/g, "").length, source.replace(/[^\n]/g, "").length);
  assert.match(masked, /var a =/);
  assert.doesNotMatch(masked, /text|comment|raw/);
  const delimiters = maskCSharpText('MapGet("/literal", Handler);', { preserveStringDelimiters: true });
  assert.match(delimiters, /MapGet\("\s+", Handler\)/);
});

test("C# source and masks are cached by visible file and mode", () => {
  const f = fixture(new Map([["src/A.cs", "class A {}"]]), [Capability.CSHARP]);
  const file = f.context.file("src/A.cs");
  assert.equal(f.context.csharp.source(file), "class A {}");
  assert.equal(f.context.csharp.source(file), "class A {}");
  assert.equal(f.context.csharp.mask(file), "class A {}");
  assert.equal(f.context.csharp.mask(file), "class A {}");
  assert.equal(f.context.csharp.mask(file, { preserveStringDelimiters: true }), "class A {}");
  assert.throws(() => f.context.csharp.mask({ path: "src/A.cs" }), /not a visible C# source/);
  assert.equal(f.snapshot.counters.csharpTextReads, 1);
  assert.equal(f.snapshot.counters.csharpMasks, 2);
  assert.equal(f.snapshot.counters.textReads, 1);
});

test("C# and project indexes contain only visible inventory files and choose projects deterministically", () => {
  const f = fixture(new Map([
    ["src/A.csproj", "<Project />"],
    ["src/B.csproj", "<Project />"],
    ["src/Visible.cs", "class Visible {}"],
  ]), [Capability.CSHARP, Capability.DOTNET_PROJECTS]);
  assert.deepEqual(f.context.csharp.csharpFiles.map((file) => file.path), ["src/Visible.cs"]);
  assert.deepEqual(f.context.dotnetProjects.projectFiles.map((file) => file.path), ["src/A.csproj", "src/B.csproj"]);
  assert.equal(f.context.dotnetProjects.nearestProject(f.context.file("src/Visible.cs")).path, "src/A.csproj");
  const classification = f.context.csharp.classify(f.context.file("src/Visible.cs"));
  assert.equal(f.context.csharp.classify(f.context.file("src/Visible.cs")), classification);
  assert.equal(f.snapshot.counters.csharpClassifications, 1);
});

test("test evidence keeps project metadata, project name, path, and filename signals separate", () => {
  const f = fixture(new Map([
    ["meta/App.csproj", '<Project><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" /></ItemGroup></Project>'],
    ["meta/A.cs", "class A {}"],
    ["named/App.Tests.csproj", "<Project />"],
    ["named/A.cs", "class A {}"],
    ["tests/Path.cs", "class A {}"],
    ["src/NamedTests.cs", "class A {}"],
    ["production/Testament.csproj", "<Project />"],
    ["production/A.cs", "class A {}"],
  ]), [Capability.DOTNET_PROJECTS]);
  const evidence = (file) => f.context.dotnetProjects.testEvidence(f.context.file(file));
  assert.equal(evidence("meta/A.cs").projectMetadata, true);
  assert.equal(evidence("named/A.cs").projectName, true);
  assert.equal(evidence("tests/Path.cs").path, true);
  assert.equal(evidence("src/NamedTests.cs").fileName, true);
  assert.equal(evidence("production/A.cs").projectName, false);
  assert.equal(evidence("production/A.cs").projectNameContainsTest, true);
});

test("project ownership, test evidence, references, cycles, and providers share one parse", () => {
  const f = fixture(new Map([
    ["src/App/App.csproj", '<Project><ItemGroup><ProjectReference Include="../Data/Data.csproj" /></ItemGroup></Project>'],
    ["src/App/A.cs", "class A {}"],
    ["src/Data/Data.csproj", '<Project><ItemGroup><ProjectReference Include="../App/App.csproj" /><PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" /></ItemGroup></Project>'],
    ["tests/App.Tests/App.Tests.csproj", '<Project><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" /></ItemGroup></Project>'],
    ["tests/App.Tests/ATests.cs", "class ATests {}"],
  ]), [Capability.CSHARP, Capability.DOTNET_PROJECTS]);
  const projects = f.context.dotnetProjects.projects();
  assert.equal(projects.length, 3);
  assert.equal(f.context.dotnetProjects.nearestProject(f.context.file("src/App/A.cs")).path, "src/App/App.csproj");
  assert.equal(f.context.dotnetProjects.testEvidence(f.context.file("tests/App.Tests/ATests.cs")).projectMetadata, true);
  assert.deepEqual(f.context.dotnetProjects.referencedProjects("src/App/App.csproj").map((project) => project.path), ["src/Data/Data.csproj"]);
  assert.equal(f.context.dotnetProjects.referencedProjects("src/App/App.csproj").some((project) => project.packages.some((item) => item.include.includes("Npgsql"))), true);
  f.context.dotnetProjects.projects();
  assert.equal(f.snapshot.counters.dotnetProjectParses, 3);
  assert.equal(f.snapshot.counters.dotnetProjectGraphBuilds, 1);
});

test("effective properties follow visible Directory.Build.props ancestry and project overrides", () => {
  const f = fixture(new Map([
    ["Directory.Build.props", '<Project><PropertyGroup><Nullable>disable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>'],
    ["src/Directory.Build.props", '<Project><PropertyGroup Condition="x"><Nullable>ignored</Nullable></PropertyGroup><PropertyGroup><Nullable>enable</Nullable></PropertyGroup></Project>'],
    ["src/App/App.csproj", '<Project><PropertyGroup><ImplicitUsings>disable</ImplicitUsings></PropertyGroup></Project>'],
  ]), [Capability.DOTNET_PROJECTS]);
  const project = f.context.dotnetProjects.projects()[0];
  assert.equal(f.context.dotnetProjects.propsFor(project), f.context.dotnetProjects.propsFor(project));
  assert.equal(f.context.dotnetProjects.effectiveProperty(project, "Nullable"), "enable");
  assert.equal(f.context.dotnetProjects.effectiveProperty(project, "ImplicitUsings"), "disable");
  assert.equal(f.context.dotnetProjects.projectProperty(project, "Nullable"), undefined);
  assert.equal(f.context.dotnetProjects.nearestInheritedProperty(project, "ImplicitUsings"), undefined);
  assert.equal(f.snapshot.counters.directoryBuildPropsParses, 2);
});

test("project references follow host case semantics", { skip: process.platform !== "darwin" && process.platform !== "win32" }, () => {
  const f = fixture(new Map([
    ["src/App/App.csproj", '<Project><ItemGroup><ProjectReference Include="../DATA/DATA.csproj" /></ItemGroup></Project>'],
    ["src/Data/Data.csproj", "<Project />"],
  ]), [Capability.DOTNET_PROJECTS]);
  assert.deepEqual(f.context.dotnetProjects.referencedProjects("src/App/App.csproj").map((project) => project.path), ["src/Data/Data.csproj"]);
});
