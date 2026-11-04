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
import { isTestDirectory, isTestFileName, isTestPath, maskCSharpText, matchingCSharpDelimiter } from "../lib/engine/dotnet-analysis.mjs";

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

test("C# masks keep an interpolated string's hole as code and its text, format clause, and escaped braces as text", () => {
  // [source, masked, masked with keepStrings, masked with preserveStringDelimiters]
  const cases = [
    // A hole's code, and a string in a hole, which no longer ends the outer string.
    ['$"x {Pdf.Listed(u.Chars)}."', '$    Pdf.Listed(u.Chars)   ', '$ x  Pdf.Listed(u.Chars) . ', '$"   Pdf.Listed(u.Chars)  "'],
    ['$"a {Foo("b")} c"; D', '$    Foo(   )    ; D', '$ a  Foo( b )  c ; D', '$"   Foo(" ")   "; D'],
    // A nested interpolated string, with a string in its own hole, and a comment in a hole.
    ['$"{F(/* c */ a)} {G($"in {H("s")}")}"', '$  F(        a)   G($     H(   )  )  ', '$  F(        a)   G($ in  H( s )  )  ', '$" F(        a)   G($"    H(" ") ") "'],
    ['$"{x // c\n}"; Y', '$  x     \n  ; Y', '$  x     \n  ; Y', '$" x     \n "; Y'],
    // Escaped braces are text; the first of each pair is blanked like an escape backslash.
    ['$"{{lit}} {X} }}"', '$          X     ', '$  {lit }  X   } ', '$"         X    "'],
    // A format clause after a top-level `:` is text; an alignment's expression, a parenthesised conditional, `::`, a
    // named argument, and a lambda's initializer braces are code. The alignment's `,` is blanked like the hole's
    // braces, so it splits no call around the string: F(...) here has one argument at its top level.
    ['$"{x:N2} {y,10} {z,-5:D3}"', '$  x      y 10   z -5     ', '$  x N2   y 10   z -5 D3  ', '$" x      y 10   z -5    "'],
    ['F($"{a,10}")', 'F($  a 10  )', 'F($  a 10  )', 'F($" a 10 ")'],
    ['$"{(a ? b : c)} {global::M(q: 1)}"', '$  (a ? b : c)   global::M(q: 1)  ', '$  (a ? b : c)   global::M(q: 1)  ', '$" (a ? b : c)   global::M(q: 1) "'],
    ['$"{xs.Select(x => new { A = x }).Count()}"', '$  xs.Select(x => new { A = x }).Count()  ', '$  xs.Select(x => new { A = x }).Count()  ', '$" xs.Select(x => new { A = x }).Count() "'],
    // A character literal's brace, in a hole, doesn't close it.
    ["$\"{'}'}\" W", "$        W", "$   }    W", '$"     " W'],
    // Verbatim either way round: a backslash is text and `""` an escaped quote.
    ['@$"a\\{X}"" b"; C', '@$    X      ; C', '@$ a\\ X    b ; C', '@$"   X     "; C'],
    ['$@"a\\{X}"" b"; C', '$@    X      ; C', '$@ a\\ X    b ; C', '$@"   X     "; C'],
    // Raw strings: one `$` opens a hole on one brace; with `$$` fewer than two braces are text, and of three the
    // first is text. A raw string without `$` has no holes.
    ['$"""a {X} "b" """; C', '$      X         ; C', '$   a  X  "b"    ; C', '$      X         ; C'],
    ['$$"""{a} {{X}} {{{Y}}}"""', '$$         X      Y      ', '$$   {a}   X   {  Y  }   ', '$$         X      Y      '],
    ['"""raw {x}"""; Z', '             ; Z', '   raw {x}   ; Z', '             ; Z'],
    // `@"""` is a verbatim string opening with an escaped quote, not a raw one.
    ['@"""x"; @class', '@     ; @class', '@   x ; @class', '@"   "; @class'],
    // A directive's line is code, so a quote in its free text opens no literal; a `//` on it is a comment.
    ["#region A's\nX", "#region A's\nX", "#region A's\nX", "#region A's\nX"],
    ["  #error Don't // it's \"x\"\r\nclass A { char c = 'x'; }", "  #error Don't            \r\nclass A { char c =    ; }", "  #error Don't            \r\nclass A { char c =  x ; }", "  #error Don't            \r\nclass A { char c =    ; }"],
    // After a byte-order mark it's still first on its line; an unpaired quote stays code; a comment's astral
    // character keeps the length (two UTF-16 units, two blanks).
    ["\uFEFF#region A's\nX", "\uFEFF#region A's\nX", "\uFEFF#region A's\nX", "\uFEFF#region A's\nX"],
    ['#error Say "hi\nX', '#error Say "hi\nX', '#error Say "hi\nX', '#error Say "hi\nX'],
    ["#region Launch // \u{1F680} go\nclass A {}", "#region Launch         \nclass A {}", "#region Launch         \nclass A {}", "#region Launch         \nclass A {}"],
    // A quoted file name (`#line`, `#pragma checksum`) is a string, and a `//` in it starts no comment.
    ['#line 1 "A.cs"', '#line 1       ', '#line 1  A.cs ', '#line 1 "    "'],
    ['#line 1 "a//b.cs" // c', '#line 1               ', '#line 1  a//b.cs      ', '#line 1 "       "     '],
    // A `#` first on a line inside a string is text.
    ["@\"a\n#b's\"; C", "@  \n     ; C", "@ a\n#b's ; C", "@\" \n    \"; C"],
  ];
  for (const [source, masked, kept, delimited] of cases) {
    for (const [options, expected] of [[{}, masked], [{ keepStrings: true }, kept], [{ preserveStringDelimiters: true }, delimited]]) {
      const actual = maskCSharpText(source, options);
      assert.equal(actual.length, source.length, `${source} ${JSON.stringify(options)}`);
      assert.equal(actual, expected, `${source} ${JSON.stringify(options)}`);
    }
  }
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

test("a project is test code by a test folder's name rule or a test framework package, not by `test` inside a word", () => {
  const project = (packages) => `<Project><ItemGroup>${packages.map((name) => `<PackageReference Include="${name}" />`).join("")}</ItemGroup></Project>`;
  const f = fixture(new Map([
    ...["Contest", "Latest", "Attest", "App.Tests", "api-tests", "IntegrationTests", "Api.E2ETests"].flatMap((name) => [[`names/${name}/${name}.csproj`, "<Project />"], [`names/${name}/A.cs`, "class A {}"]]),
    // A PascalCase `…Tests` inside the backend tree is a feature name, as for folders.
    ["api/Modules/Lab/LabTests.csproj", "<Project />"],
    ["api/Modules/Lab/A.cs", "class A {}"],
    // A per-module project named after its own `…Tests` feature is production.
    ["api/Modules/LabTests/Acme.LabTests.csproj", "<Project />"],
    ["api/Modules/LabTests/Domain/Panel.cs", "class Panel {}"],
    ["tunit/Checks.csproj", project(["TUnit"])],
    ["tunit/A.cs", "class A {}"],
    ["xunit3/Checks.csproj", project(["xunit.v3"])],
    ["xunit3/A.cs", "class A {}"],
    ["xunit3mtp/Checks.csproj", project(["xunit.v3.mtp-v2"])],
    ["xunit3mtp/A.cs", "class A {}"],
    // MSTest.Sdk sets IsTestProject itself, with no package reference.
    ["mstestsdk/Checks.csproj", '<Project Sdk="MSTest.Sdk/3.6.0"><PropertyGroup><TargetFramework>net9.0</TargetFramework></PropertyGroup></Project>'],
    ["mstestsdk/A.cs", "class A {}"],
    ["mstestsdkelement/Checks.csproj", '<Project><Sdk Name="MSTest.Sdk" Version="3.6.0" /></Project>'],
    ["mstestsdkelement/A.cs", "class A {}"],
    ["helpers/Checks.csproj", project(["xunit.abstractions", "xunit.v3.assert", "NUnit3TestAdapter.Extras", "TUnitLike"])],
    ["helpers/A.cs", "class A {}"],
  ]), [Capability.DOTNET_PROJECTS]);
  const evidence = (file) => f.context.dotnetProjects.testEvidence(f.context.file(file));
  for (const name of ["Contest", "Latest", "Attest"]) assert.equal(evidence(`names/${name}/A.cs`).test, false, name);
  for (const name of ["App.Tests", "api-tests", "IntegrationTests", "Api.E2ETests"]) assert.equal(evidence(`names/${name}/A.cs`).projectName, true, name);
  assert.equal(evidence("api/Modules/Lab/A.cs").test, false);
  assert.equal(evidence("api/Modules/LabTests/Domain/Panel.cs").test, false);
  assert.equal(evidence("tunit/A.cs").projectMetadata, true);
  assert.equal(evidence("tunit/A.cs").test, true);
  assert.equal(evidence("xunit3/A.cs").test, true);
  assert.equal(evidence("xunit3mtp/A.cs").projectMetadata, true);
  assert.equal(evidence("mstestsdk/A.cs").projectMetadata, true);
  assert.equal(evidence("mstestsdkelement/A.cs").projectMetadata, true);
  assert.equal(evidence("helpers/A.cs").test, false);
});

test("one using parse with offsets serves the rules that read it: every C# directive form and every <Using> item form", () => {
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

test("test directories are tests/test segments, separated *Tests suffixes, PascalCase *Tests outside Modules/; test file names end Test(s).cs", () => {
  const testDirectories = ["tests", "Tests", "test", "Orders.Tests", "integration-tests", "unit_tests", "IntegrationTests", "App.IntegrationTests", "Foo.UnitTests",
    // An acronym or digit before `Tests`; a separated name is a test project even inside the backend tree.
    "E2ETests", "Api.E2ETests", "App.UITests", "App.APITests", "Api.V2Tests", "Modules/Orders/Orders.UnitTests", "Common/Common.Tests",
    // Only the feature folder right under Modules/ names a feature's project; a nested IntegrationTests folder doesn't.
    "Modules/Orders/IntegrationTests/Orders.IntegrationTests"];
  // Inside Modules/, Contracts/ or Common/ a *Tests folder is a feature name, not a test project.
  // A separated name ending in its own feature folder's name is that feature's project.
  const otherDirectories = ["Contests", "Latest", "Modules/LabTests", "Contracts/LabTests", "Modules/Lab/Application/BloodTests", "Modules/LabTests/Acme.Modules.LabTests"];
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
  for (const [filePath, expected] of [
    ["tests/Api.E2ETests/OrdersFlow.cs", true],
    ["App.UITests/Pages/Home.cs", true],
    ["src/Modules/Orders/Orders.UnitTests/PlaceOrder.cs", true],
    ["src/Modules/Orders/Orders-IntegrationTests/PlaceOrder.cs", true],
    ["src/Modules/LabTests/Domain/Panel.cs", false],
    ["src/Modules/Lab/Application/BloodTests/Order.cs", false],
    ["src/Contests/Entry.cs", false],
    ["src/Latest/Feed.cs", false],
  ]) assert.equal(isTestPath(filePath), expected, filePath);
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

test("C# declarations: nested types, bodyless records, attribute starts, constraint keywords, block and file-scoped namespaces, kinds, modifiers and parents", async () => {
  const { csharpDeclarations } = await import("../lib/engine/csharp-types.mjs");
  const shape = (text) => {
    const { types, namespaces } = csharpDeclarations(maskCSharpText(text));
    return {
      types: types.map(({ name, kind, modifiers, parent, start, offset, end, namespace }) => ({ name, kind, modifiers, parent, head: text.slice(start, offset), text: text.slice(start, end), namespace })),
      namespaces: namespaces.map(({ fullName, start, end }) => ({ fullName, text: text.slice(start, end) })),
    };
  };
  // A type's own attribute starts its range; an [assembly:] attribute belongs to the file. `where T : class`
  // declares nothing, a nested type follows the type around it, and a bodyless record ends at its `;`.
  const block = [
    '[assembly: InternalsVisibleTo("Tests")]',
    "[Serializable]",
    "public sealed class Top { }",
    "namespace App.Orders",
    "{",
    "    public sealed class Outer<T> where T : class",
    "    {",
    "        public sealed record Inner(int A);",
    "        [Obsolete] private struct Deep { }",
    "    }",
    "}",
    "",
  ].join("\n");
  const outer = block.slice(block.indexOf("    public sealed class Outer") + 4, block.lastIndexOf("    }\n}") + 5);
  assert.deepEqual(shape(block), {
    types: [
      { name: "Top", kind: "class", modifiers: ["public", "sealed"], parent: -1, head: "[Serializable]\npublic sealed ", text: "[Serializable]\npublic sealed class Top { }", namespace: "" },
      { name: "Outer", kind: "class", modifiers: ["public", "sealed"], parent: -1, head: "public sealed ", text: outer, namespace: "App.Orders" },
      { name: "Inner", kind: "record", modifiers: ["public", "sealed"], parent: 1, head: "public sealed ", text: "public sealed record Inner(int A);", namespace: "App.Orders" },
      { name: "Deep", kind: "struct", modifiers: ["private"], parent: 1, head: "[Obsolete] private ", text: "[Obsolete] private struct Deep { }", namespace: "App.Orders" },
    ],
    namespaces: [{ fullName: "App.Orders", text: block.slice(block.indexOf("namespace"), block.lastIndexOf("}")) }],
  });
  // A file-scoped namespace runs to the end of the file. A record struct is a record, a type may have no access
  // modifier or a `file` one, and a preprocessor line's words are no modifiers.
  const fileScoped = "namespace App.Shipping;\n\npublic record Parcel(string Name);\npublic class Box { }\nreadonly record struct Tag(int A);\nfile sealed class Local { }\n" +
      "public ref struct Cursor { }\n#region private\nsealed class Regioned { }\n#endregion\n";
  assert.deepEqual(shape(fileScoped), {
    types: [
      { name: "Parcel", kind: "record", modifiers: ["public"], parent: -1, head: "public ", text: "public record Parcel(string Name);", namespace: "App.Shipping" },
      { name: "Box", kind: "class", modifiers: ["public"], parent: -1, head: "public ", text: "public class Box { }", namespace: "App.Shipping" },
      { name: "Tag", kind: "record", modifiers: ["readonly"], parent: -1, head: "readonly ", text: "readonly record struct Tag(int A);", namespace: "App.Shipping" },
      { name: "Local", kind: "class", modifiers: ["file", "sealed"], parent: -1, head: "file sealed ", text: "file sealed class Local { }", namespace: "App.Shipping" },
      { name: "Cursor", kind: "struct", modifiers: ["public", "ref"], parent: -1, head: "public ref ", text: "public ref struct Cursor { }", namespace: "App.Shipping" },
      { name: "Regioned", kind: "class", modifiers: ["sealed"], parent: -1, head: "sealed ", text: "sealed class Regioned { }", namespace: "App.Shipping" },
    ],
    namespaces: [{ fullName: "App.Shipping", text: fileScoped }],
  });
});
