import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { Capability, planCapabilities, createRuleDescriptor, defineRepositoryRule } from "../lib/engine/contracts.mjs";
import { createRepositoryContext } from "../lib/engine/repository-context.mjs";
import { createRepositorySnapshot } from "../lib/engine/repository-snapshot.mjs";
import { isTestDirectory, isTestFileName, maskCSharpText, matchingCSharpDelimiter } from "../lib/engine/dotnet-analysis.mjs";

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

test("C# balanced delimiter matching supports nested generic and block shapes", () => {
  const generic = "RouteDefinition<List<FormDto>>";
  assert.equal(matchingCSharpDelimiter(generic, generic.indexOf("<"), "<", ">"), generic.length - 1);
  const block = "{ Call(() => new[] { 1 }); }";
  assert.equal(matchingCSharpDelimiter(block, 0, "{", "}"), block.length - 1);
});

test("C# ownership classifies transport contracts, published contracts, and module presentation", () => {
  const f = fixture(new Map([
    ["api/App.csproj", "<Project />"],
    ["api/Contracts/Forms/FormsContract.cs", "class FormsContract {}"],
    ["api/Modules/Forms/Contracts/FormSummary.cs", "record FormSummary;"],
    ["api/Modules/Forms/FormsController.cs", "class FormsController {}"],
  ]), [Capability.CSHARP]);
  const classify = (file) => f.context.csharp.classify(f.context.file(file));
  assert.deepEqual({ contract: classify("api/Contracts/Forms/FormsContract.cs").contract, owner: classify("api/Contracts/Forms/FormsContract.cs").contractOwner }, { contract: "transport", owner: "Forms" });
  assert.deepEqual({ contract: classify("api/Modules/Forms/Contracts/FormSummary.cs").contract, owner: classify("api/Modules/Forms/Contracts/FormSummary.cs").contractOwner }, { contract: "published", owner: "Forms" });
  assert.equal(classify("api/Modules/Forms/FormsController.cs").presentation, true);
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
    ...["Attestation", "Latest", "Contest", "ArchitectureTesting", "api.tests", "orders-test", "Orders_test"].flatMap((name) => [[`names/${name}/${name}.csproj`, "<Project />"], [`names/${name}/A.cs`, "class A {}"]]),
  ]), [Capability.DOTNET_PROJECTS]);
  const evidence = (file) => f.context.dotnetProjects.testEvidence(f.context.file(file));
  assert.equal(evidence("meta/A.cs").projectMetadata, true);
  assert.equal(evidence("named/A.cs").projectName, true);
  assert.equal(evidence("tests/Path.cs").path, true);
  assert.equal(evidence("src/NamedTests.cs").fileName, true);
  assert.equal(evidence("production/A.cs").projectName, false);
  assert.equal(evidence("production/A.cs").projectNameContainsTest, true);
  // A capitalised `Test`, or `test` after `.`, `-` or `_`; never `test` inside a word.
  for (const name of ["Attestation", "Latest", "Contest"]) assert.equal(evidence(`names/${name}/A.cs`).projectNameContainsTest, false, name);
  for (const name of ["ArchitectureTesting", "api.tests", "orders-test", "Orders_test"]) assert.equal(evidence(`names/${name}/A.cs`).projectNameContainsTest, true, name);
});

test("one using parse with offsets serves the resolver and MER-BE-018: every C# directive form and every <Using> item form", () => {
  const props = '<Project>\n  <!-- <ItemGroup><Using Include="Commented.Out" /></ItemGroup> -->\n  <ItemGroup />\n' +
    "  <ItemGroup Label=\"a > b\">\n    <Using\n      Include=\"App.One; global::App.Two\" Alias='Two' />\n    <Using Include=\"App.Statics\" Static=\"true\" />\n" +
    "    <Using Include=\"App.ItemTest\" Condition=\" 'TRUE' == '$(IsTestProject)' \" />\n    <Using Include=\"App.NotTest\" Condition=\"'$(IsTestProject)' != 'true'\" />\n  </ItemGroup>\n" +
    "  <ItemGroup Condition=\"'$(IsTestProject)'=='true'\">\n    <Using Include=\"App.GroupTest\" />\n  </ItemGroup>\n</Project>\n";
  const usings = "global using System; global using static App.Statics.Clock;\nglobal using Wire =\n    global::App.Wire.Page<App.Wire.Item>;\n" +
    "using App.One; // using App.Commented;\nnamespace App.Code { using App.Inner; }\nclass Run { void M() { using var stream = Open(); using (Open()) { } } }\n";
  const f = fixture(new Map([
    ["Directory.Build.props", props],
    ["api/Api.csproj", "<Project />"],
    ["api/Usings.cs", usings],
    ["api/Item.cs", "namespace App.Wire;\npublic sealed record Page<T>(T Item);\npublic sealed record Item(int A);\n"],
    ["api/ItemTest.cs", "namespace App.ItemTest;\npublic sealed record OnlyTests(int A);\n"],
    ["api/GroupTest.cs", "namespace App.GroupTest;\npublic sealed record GroupOnly(int A);\n"],
    ["api/NotTest.cs", "namespace App.NotTest;\npublic sealed record Production(int A);\n"],
    ["tests/Api.Tests/Api.Tests.csproj", '<Project><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup></Project>'],
    ["tests/Api.Tests/Uses.cs", "namespace Tests;\npublic sealed record Uses(int A);\n"],
  ]), [Capability.CSHARP, Capability.DOTNET_PROJECTS]);
  const { csharp } = f.context;
  const file = (name) => csharp.csharpFiles.find((value) => value.path === name) ?? f.context.file(name);
  const source = file("api/Usings.cs");
  assert.deepEqual(csharp.usings(source).map(({ global, static: isStatic, alias, target, text }) => [global, isStatic, alias, target, text]), [
    [true, false, null, "System", "global using System"],
    [true, true, null, "App.Statics.Clock", "global using static App.Statics.Clock"],
    [true, false, "Wire", "App.Wire.Page<App.Wire.Item>", "global using Wire = global::App.Wire.Page<App.Wire.Item>"],
    [false, false, null, "App.One", "using App.One"],
    [false, false, null, "App.Inner", "using App.Inner"],
  ]);
  const split = csharp.usings(source)[2];
  assert.deepEqual([source.lineMap().lineAt(split.offset), source.lineMap().lineAt(split.end - 1)], [2, 3]);

  const items = csharp.projectUsings(file("Directory.Build.props"));
  assert.deepEqual(items.map(({ include, target, alias, static: isStatic, testOnly }) => [include, target, alias, isStatic, testOnly]), [
    ["App.One", "App.One", "Two", false, false],
    ["global::App.Two", "App.Two", "Two", false, false],
    ["App.Statics", "App.Statics", null, true, false],
    ["App.ItemTest", "App.ItemTest", null, false, true],
    ["App.NotTest", "App.NotTest", null, false, false],
    ["App.GroupTest", "App.GroupTest", null, false, true],
  ]);
  // A multi-line item is located at its `<Using`.
  assert.deepEqual(items.map((item) => file("Directory.Build.props").lineMap().lineAt(item.offset)), [5, 5, 7, 8, 9, 12]);

  // The resolver reads the same parse: a generic alias names the generic type, and test-only <Using> items reach
  // test projects only.
  const at = (from, name) => csharp.resolveType(name, from, from.text().length - 1)?.fullName ?? null;
  assert.equal(at(source, "Wire"), "App.Wire.Page");
  assert.equal(at(file("api/Item.cs"), "Production"), "App.NotTest.Production");
  for (const name of ["OnlyTests", "GroupOnly"]) assert.equal(at(file("api/Item.cs"), name), null, name);
  const tests = file("tests/Api.Tests/Uses.cs");
  for (const name of ["OnlyTests", "GroupOnly", "Production"]) assert.notEqual(at(tests, name), null, name);
});

test("enclosing types and type references come from the resolver's scan", () => {
  const f = fixture(new Map([
    ["api/Ids.cs", "namespace App.Ids\n{\n    public static class Outer<T> where T : class\n    {\n        public sealed record Done(int A);\n" +
      "        public static class Inner\n        {\n            public const string AId = \"a\";\n        }\n        public const string BId = \"b\";\n    }\n}\n"],
    ["api/Refs.cs", "using App.Ids;\nnamespace App.Refs;\npublic sealed record Refs(global::App.Ids.Outer<Refs>.Inner Value, List<Outer<Refs>> Items)\n{\n" +
      "    public int Count => Items?.Count ?? this.Value.ToString().Length; // Outer in a comment\n}\n"],
  ]), [Capability.CSHARP]);
  const { csharp } = f.context;
  const ids = f.context.file("api/Ids.cs"), text = ids.text();
  assert.deepEqual(csharp.enclosingTypes(ids, text.indexOf("AId")), ["Outer", "Inner"]);
  assert.deepEqual(csharp.enclosingTypes(ids, text.indexOf("BId")), ["Outer"]);
  // A type's own parameter list is outside its body.
  assert.deepEqual(csharp.enclosingTypes(ids, text.indexOf("int A")), ["Outer"]);
  assert.deepEqual(csharp.enclosingTypes(ids, 0), []);

  const refs = f.context.file("api/Refs.cs");
  const written = csharp.typeReferences(refs).map((reference) => reference.written);
  // Each segment of a dotted name, no declared names (the namespace, the record), no member accesses, no comments.
  for (const name of ["App", "App.Ids", "global::App.Ids.Outer", "Refs", "List", "Outer", "Items", "Value"]) assert.ok(written.includes(name), name);
  for (const name of ["App.Refs", "ToString", "Length"]) assert.ok(!written.includes(name), name);
  assert.equal(written.filter((name) => name === "Refs").length, 2);
  assert.equal(written.filter((name) => name === "Outer").length, 1);
  const reference = csharp.typeReferences(refs).find((value) => value.written === "global::App.Ids.Outer");
  assert.equal(refs.text().slice(reference.offset, reference.offset + 5), "Outer");
  assert.equal(csharp.resolveType(reference.written, refs, reference.offset)?.fullName, "App.Ids.Outer");
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

test("project properties use only the nearest visible Directory.Build.props and project overrides", () => {
  const f = fixture(new Map([
    ["Directory.Build.props", '<Project><PropertyGroup><Nullable>disable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>'],
    ["src/Directory.Build.props", '<Project><PropertyGroup Condition="x"><Nullable>ignored</Nullable></PropertyGroup><PropertyGroup><Nullable>enable</Nullable></PropertyGroup></Project>'],
    ["src/App/App.csproj", '<Project><PropertyGroup><ImplicitUsings>disable</ImplicitUsings></PropertyGroup></Project>'],
  ]), [Capability.DOTNET_PROJECTS]);
  const project = f.context.dotnetProjects.projects()[0];
  assert.equal(f.context.dotnetProjects.propsFor(project), f.context.dotnetProjects.propsFor(project));
  assert.deepEqual(f.context.dotnetProjects.propsFor(project).map((file) => file.path), ["src/Directory.Build.props"]);
  assert.equal(f.context.dotnetProjects.projectProperty(project, "Nullable"), undefined);
  assert.equal(f.context.dotnetProjects.nearestInheritedProperty(project, "ImplicitUsings"), undefined);
  assert.equal(f.context.dotnetProjects.nearestInheritedProperty(project, "Nullable"), "enable");
  assert.equal(f.context.dotnetProjects.projectProperty(project, "ImplicitUsings"), "disable");
  assert.equal(f.snapshot.counters.directoryBuildPropsParses, 1);
});

test("project references follow host case semantics", { skip: process.platform !== "darwin" && process.platform !== "win32" }, () => {
  const f = fixture(new Map([
    ["src/App/App.csproj", '<Project><ItemGroup><ProjectReference Include="../DATA/DATA.csproj" /></ItemGroup></Project>'],
    ["src/Data/Data.csproj", "<Project />"],
  ]), [Capability.DOTNET_PROJECTS]);
  assert.deepEqual(f.context.dotnetProjects.referencedProjects("src/App/App.csproj").map((project) => project.path), ["src/Data/Data.csproj"]);
});

test("test directories are tests/test segments, separated or PascalCase *Tests suffixes outside Modules/; test file names end Test(s).cs", () => {
  const testDirectories = ["tests", "Tests", "test", "Orders.Tests", "integration-tests", "unit_tests", "IntegrationTests", "App.IntegrationTests", "Foo.UnitTests"];
  // Inside Modules/, Contracts/ or Common/ a *Tests folder is a feature name, not a test project.
  const otherDirectories = ["Contests", "Latest", "Modules/LabTests", "Contracts/LabTests", "Modules/Lab/Application/BloodTests"];
  const f = fixture(new Map([...testDirectories, ...otherDirectories].map((segment) => [`api/${segment}/Orders.cs`, "class Orders {}"])), [Capability.CSHARP]);
  for (const [segments, expected] of [[testDirectories, true], [otherDirectories, false]]) {
    for (const segment of segments) {
      const parts = ["api", ...segment.split("/")];
      assert.equal(isTestDirectory(parts.at(-1), parts.slice(0, -1)), expected, segment);
      const classification = f.context.csharp.classify(f.context.file(`api/${segment}/Orders.cs`));
      assert.equal(classification.testPath, expected, segment);
      assert.equal(classification.testFileName, false, segment);
    }
  }
  for (const name of ["OrdersTests.cs", "OrderTest.cs", "IntegrationTests.cs", "LabTests.cs"]) assert.equal(isTestFileName(name), true, name);
  for (const name of ["Contests.cs", "Latest.cs", "tests.cs", "OrdersTests.cs.bak", "Testing.cs"]) assert.equal(isTestFileName(name), false, name);
  // Inside the backend tree a *Test.cs name is production code (a connection test, a lab test).
  assert.equal(isTestFileName("GovUkPayConnectionTest.cs", ["api", "Modules", "Payments", "Infrastructure"]), false);
  assert.equal(isTestFileName("OrdersTests.cs", ["tests", "Api.Tests"]), true);
});

// TE rules read test source through the same definitions as classify(): a separated `Orders.Tests` folder
// is tests, a `Contests` folder, a `LabTests` feature or a `*ConnectionTest.cs` inside Modules/ is not; a
// TypeScript test tree is the top-level test/, tests/ or e2e/ of its frontend root or package.json folder.
test("TE rules agree with the shared C# and frontend test-source definitions", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-te-"));
  const mocks = "vi.mock('a'); vi.mock('b'); vi.mock('c'); vi.mock('d'); vi.mock('e'); vi.mock('f');\n";
  const files = {
    "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web" />\n',
    "api/Contests/MockJudge.cs": "class MockJudge {}\n",
    "api/Modules/LabTests/Application/MockResult.cs": "class MockResult {}\n",
    "api/Modules/Payments/Infrastructure/GovUkPayConnectionTest.cs": "class MockGateway {}\n",
    "tests/Orders.UnitTests/MockClock.cs": "class MockClock {}\n",
    "api/Orders.Tests/CheckoutSpec.cs": "Received.InOrder(() => {});\n",
    "ui/nuxt.config.ts": "export default defineNuxtConfig({ ssr: false });\n",
    "ui/app/utils/tests/order.ts": mocks,
    "ui/e2e/checkout.ts": mocks,
    // A monorepo package's own test/ is tests; a routes/test/ feature folder in a package is app code.
    "packages/shared/package.json": "{}\n",
    "packages/shared/test/util.ts": mocks,
    "node-api/package.json": "{}\n",
    "node-api/routes/test/start.ts": mocks,
  };
  try {
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), content);
    }
    const plumb = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "plumb");
    const locations = (rule) => {
      const result = spawnSync(plumb, [root, "--rule", rule, "--ci", "--json"], { encoding: "utf8" });
      assert.ok([0, 1].includes(result.status), result.stderr);
      return JSON.parse(result.stdout).map((finding) => finding.location).sort();
    };
    assert.deepEqual(locations("MER-TE-005"), ["tests/Orders.UnitTests/MockClock.cs:1"]);
    assert.deepEqual(locations("MER-TE-003"), ["api/Orders.Tests/CheckoutSpec.cs:1"]);
    assert.deepEqual(locations("MER-TE-002"), ["packages/shared/test/util.ts:0", "ui/e2e/checkout.ts:0"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("C# type names resolve the way the compiler looks them up: nested types, namespaces and parents, usings, aliases", () => {
  const f = fixture(new Map([
    ["api/Api.csproj", '<Project Sdk="Microsoft.NET.Sdk.Web"><ItemGroup><Using Include="App.Shared" /><Using Include="App.Wire" Alias="Wire" /><Using Include="App.Statics" Static="true" /></ItemGroup></Project>'],
    ["api/Contracts/Orders/OrderModels.cs", "namespace App.Contracts.Orders;\npublic sealed record OrderDto(Guid Id);\n"],
    ["api/Modules/Orders/Contracts/OrderDto.cs", "namespace App.Modules.Orders.Contracts;\npublic sealed record OrderDto(Guid Id, int Version = 1);\npublic sealed record OnlyHere(int A);\n"],
    ["api/Modules/Billing/Contracts/OnlyHere.cs", "namespace App.Modules.Billing.Contracts\n{\n    public sealed record OnlyHere(int B);\n}\n"],
    ["api/Common/Paging.cs", "namespace App;\npublic sealed record Paging(int Page);\n"],
    ["api/Shared/Money.cs", "namespace App.Shared;\npublic readonly record struct Money(decimal Amount);\n"],
    ["api/Wire/Envelope.cs", "namespace App.Wire;\npublic sealed record Envelope(int A);\n"],
    ["api/Outer.cs", "namespace App.Contracts.Orders;\npublic static class Outer\n{\n    public sealed record Inner(int A);\n    public sealed record UsesInner(Inner Value);\n}\npublic sealed record Inner(int B);\n"],
    ["api/Noise.cs", "namespace App.Noise;\npublic static class Noise\n{\n    static void Run<T>(List<OrderDto> records) where T : class\n    {\n        foreach (var record in records) { }\n    }\n}\n"],
    ["api/Nested.cs", "namespace App.Contracts.Orders;\npublic sealed record Shipment(IReadOnlyList<Parcel> Parcels)\n{\n    public sealed record Parcel(int Weight);\n}\n" +
      "public sealed record Crate(IReadOnlyList<Box> Boxes)\n{\n    public sealed record Box(int Size);\n}\npublic sealed record Box(int Size = 0);\n"],
    ["api/Pragma.cs", "#nullable enable\nrecord Loose(int A);\n#region Response record types\n#endregion\n"],
    ["api/Shadow.cs", "using Inner = App.Wire.Envelope;\nusing Paging = App.Wire.Envelope;\nusing Envelopes = App.Wire.Envelope[];\nnamespace App.Contracts.Orders;\n" +
      "public static class Shadow\n{\n    public sealed record Inner(int A);\n    public sealed record UsesInner(Inner Value);\n}\npublic sealed record UsesPaging(Paging P, Envelopes E);\n"],
    ["api/Usings.cs", "global using App.Globals;\n"],
    ["api/Globals/Flag.cs", "namespace App.Globals;\npublic sealed record Flag(bool On);\n"],
    ["Directory.Build.props", '<Project><ItemGroup><Using Include="App.Props" /></ItemGroup></Project>'],
    ["api/Props/Setting.cs", "namespace App.Props;\npublic sealed record Setting(int A);\n"],
    ["api/Referrer.cs",
      "using App.Modules.Orders.Contracts;\nusing App.Modules.Billing.Contracts;\nusing Published = App.Modules.Orders.Contracts;\nusing Dto = App.Contracts.Orders.OrderDto;\n" +
      "namespace App.Contracts.Orders.Deep;\npublic sealed record Referrer(OrderDto A);\n"],
  ]), [Capability.CSHARP, Capability.DOTNET_PROJECTS]);
  const { csharp } = f.context;
  const file = (name) => csharp.csharpFiles.find((value) => value.path === name);
  const referrer = file("api/Referrer.cs"), at = referrer.text().indexOf("public sealed record Referrer");
  const resolved = (name, from = referrer, offset = at) => csharp.resolveType(name, from, offset)?.fullName ?? null;

  // A parent namespace (App.Contracts.Orders) wins over a using of the same short name.
  assert.equal(resolved("OrderDto"), "App.Contracts.Orders.OrderDto");
  assert.equal(resolved("Paging"), "App.Paging");
  assert.equal(resolved("App.Modules.Orders.Contracts.OrderDto"), "App.Modules.Orders.Contracts.OrderDto");
  assert.equal(resolved("global::App.Modules.Orders.Contracts.OrderDto"), "App.Modules.Orders.Contracts.OrderDto");
  assert.equal(resolved("Published.OrderDto"), "App.Modules.Orders.Contracts.OrderDto");
  assert.equal(resolved("Dto"), "App.Contracts.Orders.OrderDto");
  // Project-level <Using>, plain and aliased; a Static one imports no types. A `global using` in any of the
  // project's files and a <Using> in its Directory.Build.props reach it too.
  assert.equal(resolved("Money"), "App.Shared.Money");
  assert.equal(resolved("Wire.Envelope"), "App.Wire.Envelope");
  assert.equal(resolved("Flag"), "App.Globals.Flag");
  assert.equal(resolved("Setting"), "App.Props.Setting");
  // A declaration after a preprocessor line, with no modifier, is still a declaration; a keyword on the
  // preprocessor line itself declares nothing.
  assert.equal(resolved("Loose"), "Loose");
  assert.equal(resolved("types"), null);
  // Two usings bring the same name in: CS0104, so ambiguous.
  assert.equal(resolved("OnlyHere"), null);
  assert.equal(resolved("Guid"), null);
  // A nested type wins inside its outer type; outside, the namespace's own Inner.
  const outer = file("api/Outer.cs");
  assert.equal(resolved("Inner", outer, outer.text().indexOf("UsesInner")), "App.Contracts.Orders.Outer.Inner");
  assert.equal(resolved("Inner", outer, outer.text().lastIndexOf("record Inner")), "App.Contracts.Orders.Inner");
  // A file's aliases come after enclosing types and every enclosing namespace's own members; an array alias
  // names its element type.
  const shadow = file("api/Shadow.cs");
  assert.equal(resolved("Inner", shadow, shadow.text().indexOf("UsesInner")), "App.Contracts.Orders.Shadow.Inner");
  assert.equal(resolved("Paging", shadow, shadow.text().indexOf("UsesPaging")), "App.Paging");
  assert.equal(resolved("Envelopes", shadow, shadow.text().indexOf("UsesPaging")), "App.Wire.Envelope");
  // A positional record's parameter list is outside its body, so it doesn't see its nested types (CS0246): an
  // unqualified Parcel there finds nothing, and Box finds the namespace's own Box.
  const nested = file("api/Nested.cs");
  assert.equal(resolved("Parcel", nested, nested.text().indexOf("record Shipment")), null);
  assert.equal(resolved("Box", nested, nested.text().indexOf("record Crate")), "App.Contracts.Orders.Box");
  // `where T : class` and `var record in` declare nothing.
  assert.equal(resolved("App.Noise.Noise.where"), null);
  assert.equal(resolved("App.Noise.Noise.in"), null);
});

test("C# type names prefer the declaration in the referrer's project closure", () => {
  const f = fixture(new Map([
    ["one/One.csproj", "<Project />"],
    ["one/OrderDto.cs", "namespace App.Contracts;\npublic sealed record OrderDto(int A);\n"],
    ["one/Uses.cs", "namespace App.Contracts;\npublic sealed record Uses(OrderDto A);\n"],
    ["two/Two.csproj", "<Project />"],
    ["two/OrderDto.cs", "namespace App.Contracts;\npublic sealed record OrderDto(int B);\n"],
    // An unreferenced project's App.Manifest sits in a parent namespace, but the referrer's own using wins.
    ["one/Shared/Manifest.cs", "namespace App.Shared;\npublic sealed record Manifest(string? Returns = null);\n"],
    ["one/UsesManifest.cs", "using App.Shared;\nnamespace App.Contracts;\npublic sealed record UsesManifest(Manifest M);\n"],
    ["two/Manifest.cs", "namespace App;\npublic sealed record Manifest(int X);\n"],
    // Only an unreferenced project declares Remote: the whole scan is the fallback.
    ["two/Remote.cs", "namespace App.Contracts;\npublic sealed record Remote(int X);\n"],
    // Two of one/'s usings bring Clash in (CS0104); two/'s App.Clash must not win through the fallback.
    ["one/Left/Clash.cs", "namespace App.Left;\npublic sealed record Clash(int A);\n"],
    ["one/Right/Clash.cs", "namespace App.Right;\npublic sealed record Clash(int B);\n"],
    ["one/UsesClash.cs", "using App.Left;\nusing App.Right;\nnamespace App.Contracts;\npublic sealed record UsesClash(Clash C);\n"],
    ["two/Clash.cs", "namespace App;\npublic sealed record Clash(int C);\n"],
  ]), [Capability.CSHARP, Capability.DOTNET_PROJECTS]);
  const { csharp } = f.context;
  const file = (name) => csharp.csharpFiles.find((value) => value.path === name);
  const uses = file("one/Uses.cs");
  const result = csharp.resolveType("OrderDto", uses, uses.text().indexOf("record Uses"));
  assert.deepEqual(result.declarations.map((declaration) => declaration.file.path), ["one/OrderDto.cs"]);
  const manifest = file("one/UsesManifest.cs");
  assert.equal(csharp.resolveType("Manifest", manifest, manifest.text().indexOf("record UsesManifest"))?.fullName, "App.Shared.Manifest");
  assert.equal(csharp.resolveType("Remote", uses, uses.text().indexOf("record Uses"))?.fullName, "App.Contracts.Remote");
  const clash = file("one/UsesClash.cs");
  assert.equal(csharp.resolveType("Clash", clash, clash.text().indexOf("record UsesClash")), null);
});
