#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(HOME, "fixtures");
const PLUMB = path.join(HOME, "plumb");

function run(rule, fixture) {
    const selected = rule === "MER-BE-005" ? ["MER-BE-003", "MER-BE-004", "MER-BE-005"] : [rule];
    const findings = selected.flatMap((id) => {
        const result = spawnSync(PLUMB, [path.join(FIXTURES, rule, fixture), "--rule", id, "--ci", "--json"], { encoding: "utf8" });
        assert.ok([0, 1].includes(result.status), result.stderr);
        return JSON.parse(result.stdout);
    });
    return findings.map((finding) =>
        `${finding.rule}\t${finding.severity}\t${finding.location}\t${finding.message}\t${finding.docRef}`).join("\n");
}

test("MER-BE-001 applies forbidden global usings to a backend containing Domain", () => {
    assert.equal(run("MER-BE-001", "good"), "");
    assert.match(run("MER-BE-001", "bad"), /MER-BE-001\terror\tGlobalUsings\.cs:1\t/);
});

test("MER-BE-005 prevents Common from depending on feature-owned namespaces", () => {
    assert.equal(run("MER-BE-005", "good"), "");
    const output = run("MER-BE-005", "bad");
    assert.match(output, /^MER-BE-003\t.*Common\/UsesFeatureInternals\.cs:1\t/m);
    assert.match(output, /^MER-BE-004\t.*Common\/UsesFeatureInternals\.cs:2\t/m);
    assert.match(output, /^MER-BE-005\t.*Common\/UsesFeatureInternals\.cs:3\t/m);
    assert.match(output, /^MER-BE-005\t.*Common\/UsesFeatureInternals\.cs:4\t/m);
});

test("MER-BE-005 rejects sibling published Contracts in Domain but permits Application and integration consumers", () => {
    assert.equal(run("MER-BE-005", "good"), "");
    assert.match(run("MER-BE-005", "bad"), /^MER-BE-005\t.*Modules\/Auth\/Domain\/UsesFormsContract\.cs:1\t/m);
});

test("MER-BE-006 propagates consumers through real nested declaration bodies", () => {
    const output = run("MER-BE-006", "good");
    for (const type of ["SubmissionAudit", "SubmissionState", "SubmissionDetails", "SubmissionItem"]) {
        assert.doesNotMatch(output, new RegExp(`Common type ${type} `));
    }
});

test("MER-BE-006 counts a module only where a name it writes resolves to the Common type", () => {
    // Users declares its own Paging: a namesake, not a consumer of Acme.Common.Paging.
    assertFindings("MER-BE-006", "bad", [
        ["Common/Paging.cs:0", "Common type Paging is referenced only by module Forms"],
        ["Common/SlugRules.cs:0", "Common type SlugRules is referenced only by module Forms"],
    ]);
    const findings = scan("MER-BE-006", {
        "Common/Money.cs": "namespace Acme.Common;\npublic sealed record Money(decimal Amount);\npublic sealed record Rate(Money PerHour);\n",
        "Common/Clock.cs": "namespace Acme.Common;\npublic static class Clock { public static int Now => 0; }\n",
        // A using, an alias and a `using static` each make a consumer; a comment and a string do not.
        "Modules/Billing/Invoice.cs": "using Acme.Common;\nnamespace Acme.Modules.Billing;\npublic sealed record Invoice(Money Total);\n",
        "Modules/Payroll/Payslip.cs": "using Cash = Acme.Common.Money;\nusing static Acme.Common.Clock;\nnamespace Acme.Modules.Payroll;\npublic sealed record Payslip(Cash Net);\n",
        "Modules/Rota/Shift.cs": "namespace Acme.Modules.Rota;\n// Rate and Clock live in Common.\npublic sealed record Shift(string Note = \"Rate\");\n",
        // Rate's only consumer is Rota, through a qualified name; Rate names Money, so Rota consumes Money too.
        "Modules/Rota/Pay.cs": "namespace Acme.Modules.Rota;\npublic sealed record Pay(Acme.Common.Rate Rate);\n",
    });
    assert.deepEqual(findings.map((finding) => finding.replace(/ — review.*/, "")).sort(), [
        "Common/Clock.cs:0\tCommon type Clock is referenced only by module Payroll",
        "Common/Money.cs:0\tCommon type Rate is referenced only by module Rota",
    ]);
});

test("MER-BE-007 reports the domain type a port's name resolves to, not a namesake", () => {
    // good: IFormLister's FormSnapshot is the Ports namespace's own record, despite the Forms.Domain using.
    assert.equal(run("MER-BE-007", "good"), "");
    assertFindings("MER-BE-007", "bad", [["api/Common/Ports/IConfirmReader.cs:5", "Common port exposes module-owned domain type FormSnapshot"]]);
    const findings = scan("MER-BE-007", {
        "api/Modules/Forms/Domain/FormSnapshot.cs": "namespace App.Modules.Forms.Domain;\npublic sealed record FormSnapshot(string Id);\npublic enum Status { Draft }\n",
        "api/Common/Status.cs": "namespace App.Common;\npublic enum Status { Open }\n",
        // The parent namespace's Status is Common's; the qualified FormSnapshot is the domain's, past a comment naming it.
        "api/Common/Ports/IFormReader.cs": "namespace App.Common.Ports;\n// FormSnapshot is a domain type.\npublic interface IFormReader\n{\n    Status Status();\n" +
            "    App.Modules.Forms.Domain.FormSnapshot Read();\n}\n",
    });
    assert.deepEqual(findings.map((finding) => finding.replace(/ — inline.*/, "")), [
        "api/Common/Ports/IFormReader.cs:6\tCommon port exposes module-owned domain type FormSnapshot",
    ]);
});

// A *Tests.cs file in a production project is production code: BE-024 reads it like its neighbours.
test("MER-BE-024 flags ambient time in a *Tests.cs file of a production project", () => {
    const locations = [...run("MER-BE-024", "bad").matchAll(/^MER-BE-024\t\w+\t(\S+)/gm)].map((match) => match[1]);
    assert.ok(locations.includes("Modules/Orders/Application/CreateOrder.cs:3"), locations.join("\n"));
    assert.ok(locations.includes("Modules/Orders/Application/CreateOrderTests.cs:3"), locations.join("\n"));
});

// A test project's files are test code wherever its folders sit (ArchitectureTesting/Modules/…), by its metadata.
test("BE's layer, module-shape, style and placement rules exempt a test project's files by project metadata, not only by test folder or file names", () => {
    const rules = ["MER-BE-001", "MER-BE-002", "MER-BE-003", "MER-BE-004", "MER-BE-005", "MER-BE-007", "MER-BE-008", "MER-BE-009",
        "MER-BE-010", "MER-BE-011", "MER-BE-012", "MER-BE-013", "MER-BE-014", "MER-BE-016", "MER-BE-017", "MER-BE-020", "MER-BE-021",
        "MER-BE-022", "MER-BE-023", "MER-BE-024", "MER-BE-030", "MER-BE-031", "MER-BE-032", "MER-BE-042", "MER-BE-051", "MER-BE-052",
        "MER-BE-053", "MER-BE-054", "MER-BE-055", "MER-BE-060"];
    for (const rule of rules) {
        const files = (project) => Object.fromEntries(fs.readdirSync(path.join(FIXTURES, rule, "bad"), { recursive: true })
            .filter((file) => fs.statSync(path.join(FIXTURES, rule, "bad", file)).isFile() && !file.endsWith(".csproj"))
            .map((file) => [`ArchitectureTesting/${file}`, fs.readFileSync(path.join(FIXTURES, rule, "bad", file), "utf8")])
            .concat([["ArchitectureTesting/ArchitectureTesting.csproj", project]]));
        assert.notDeepEqual(scan(rule, files('<Project Sdk="Microsoft.NET.Sdk" />\n')), [], rule);
        assert.deepEqual(scan(rule, files('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup></Project>\n')), [], rule);
    }
});

const testProject = (references = "") => `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup><ItemGroup>${references}</ItemGroup></Project>\n`;

// A test beside a module's code exercises the Common type; it doesn't make that module a second owner.
test("MER-BE-006 leaves a test project under another module out of a Common type's consumers", () => {
    assert.deepEqual(scan("MER-BE-006", {
        "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
        "api/Common/Paging.cs": "namespace Acme.Common;\npublic sealed record Paging(int Page, int Size);\n",
        "api/Modules/Forms/FormsQuery.cs": "using Acme.Common;\nnamespace Acme.Modules.Forms;\npublic sealed record FormsQuery(Paging Paging);\n",
        "api/Modules/Users/Specs/Specs.csproj": testProject('<ProjectReference Include="../../../Api.csproj" />'),
        "api/Modules/Users/Specs/PagingSpecs.cs": "using Acme.Common;\nnamespace Acme.Specs;\npublic sealed class PagingSpecs { public Paging Sample { get; } = new(1, 20); }\n",
    }), ["api/Common/Paging.cs:0\tCommon type Paging is referenced only by module Forms — review ownership; move it only if Forms truly owns it"]);
});

// A test double named like an entity, in a test project's Modules/Forms/Domain/, doesn't make Forms the entity's owner.
test("MER-BE-060 takes an entity's owner only from production Domain code", () => {
    assert.deepEqual(scan("MER-BE-060", {
        // Sorts before api/ either way, so it would be the first Domain match.
        "acceptance/Acceptance.csproj": testProject(),
        "acceptance/Modules/Forms/Domain/Form.cs": "namespace Acceptance.Modules.Forms.Domain;\npublic sealed class Form { }\n",
        "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
        "api/Modules/Users/Domain/Form.cs": "namespace A.Modules.Users.Domain;\npublic sealed class Form { public int Id { get; set; } }\n",
        "api/Modules/Users/Infrastructure/Persistence/FormEntityConfiguration.cs": "namespace A.Modules.Users.Infrastructure.Persistence;\npublic sealed class FormEntityConfiguration : IEntityTypeConfiguration<Form>\n{\n    public void Configure(EntityTypeBuilder<Form> builder) { }\n}\n",
    }), []);
});

test("MER-BE-009 detects each System IServiceProvider spelling after masking comments and strings", () => {
    assert.equal(run("MER-BE-009", "good"), "");
    const output = run("MER-BE-009", "bad");
    assert.equal((output.match(/^MER-BE-009\t/gm) || []).length, 3);
});

test("MER-BE-021 exempts Brighter Command subclasses without exempting unrelated command classes", () => {
    assert.equal(run("MER-BE-021", "good"), "");
    const output = run("MER-BE-021", "bad");
    assert.equal((output.match(/^MER-BE-021\t/gm) || []).length, 2);
    assert.match(output, /LegacyOrderCommand\.cs:1\tmessage and data shapes/);
});

test("MER-BE-022 ignores masked braces and rejects nested generic CancellationToken mentions", () => {
    assert.equal(run("MER-BE-022", "good"), "");
    const output = run("MER-BE-022", "bad");
    assert.match(output, /CreateXUseCase\.cs:5\tExecuteAsync must take a CancellationToken/);
    assert.match(output, /CreateXUseCase\.cs:9\tUseCase class must declare ExecuteAsync/);
});

test("MER-BE-040 inspects only repository interface bodies and points at the method declaration", () => {
    assert.equal(run("MER-BE-040", "good"), "");
    assert.match(run("MER-BE-040", "bad"), /IOrderRepository\.cs:3\tread-shaped repository return/);
});

test("published contracts reject module internals while allowing published dependencies", () => {
    assert.equal(run("MER-BE-016", "good"), "");
    const output = run("MER-BE-016", "bad");
    assert.equal((output.match(/^MER-BE-016\t/gm) || []).length, 4);
    assert.match(output, /FormsModels\.cs:1\t.*Modules\.Forms\.Domain/);
    assert.match(output, /FormSummary\.cs:1\t.*Modules\.Forms\.Infrastructure/);
});

test("Common feature directories cannot shadow module owners", () => {
    assert.equal(run("MER-BE-017", "good"), "");
    assert.match(run("MER-BE-017", "bad"), /Common\/Forms\/FormSummary\.cs:0\tCommon\/Forms shadows Modules\/Forms/);
});

test("controllers cannot depend on other controllers", () => {
    assert.equal(run("MER-BE-032", "good"), "");
    assert.match(run("MER-BE-032", "bad"), /OrdersController\.cs:2\tOrdersController depends on OrderLinesController/);
});

test("read-shaped repository methods warn on recognized persistence mutations", () => {
    assert.equal(run("MER-BE-042", "good"), "");
    assert.match(run("MER-BE-042", "bad"), /EfOrderRepository\.cs:6\tFindAsync performs a persistence mutation/);
});

test("each recognized FluentValidation validator owns an error code", () => {
    assert.equal(run("MER-BE-055", "good"), "");
    const output = run("MER-BE-055", "bad");
    assert.match(output, /AuthValidator\.cs:\d+\tNotEmpty has no WithErrorCode/);
    assert.match(output, /AuthValidator\.cs:\d+\tMust has no WithErrorCode/);
    assert.equal((output.match(/^MER-BE-055\t/gm) || []).length, 3);
});

test("Rivet authoring rules ignore comments, strings, and compiler fixtures", () => {
    for (const rule of ["MER-RV-001", "MER-RV-002", "MER-RV-006", "MER-RV-010"]) {
        assert.equal(run(rule, "good"), "", `${rule} reported fixture text as application code`);
        assert.match(run(rule, "bad"), new RegExp(`^${rule}\\t`, "m"));
    }
});

test("MER-RV-006 finds multiline implicit-private behavior only in the attributed contract", () => {
    assert.equal(run("MER-RV-006", "good"), "");
    const output = run("MER-RV-006", "bad");
    assert.equal((output.match(/^MER-RV-006\t/gm) || []).length, 2);
    assert.match(output, /OrdersContract\.cs:4\t.*may contain only/);
});

test("MER-RV-007 flags every app-written RivetResult extension named like an adapter or returning an HTTP result, and app code whose one statement copies RivetActionResult's StatusCode or Value into a result or the response, by the type it's declared in, and leaves Rivet's own adapters, helpers that call them, filters that only read it, tests and mentions in comments, strings or attributes", () => {
    // Good: result filters that log or record the adapter's status in an app's own AuditResult/ValidationResult
    // or audit.Results, and set context.Result in a statement of their own; an attribute's typeof() on a
    // controller that calls Problem() elsewhere; another project's own `record Adapted` beside App's global alias
    // of that name; a Verification/ project whose <IsTestProject> alone makes it test code; a pattern's `{ }` that
    // ends no member, a named argument's label, a reassigned local and a lambda parameter that shadows one; and
    // helpers and a nested reader handing back the adapter's output only to a log. Also: the `new` modifier on an
    // indexer, which constructs nothing; a call that picks the overload returning no read; a block- or
    // expression-bodied local function, a typed lambda, one of several lambda parameters and a lambda's own local
    // that shadow the local; and a local whose block ends before another block or a loop declares its name again.
    assert.equal(run("MER-RV-007", "good"), "");
    const output = run("MER-RV-007", "bad");
    const locations = [...output.matchAll(/^MER-RV-007\twarn\t(\S+)/gm)].map((match) => match[1]).sort();
    assert.deepEqual(locations, [
        // A top-level statement under the file's own alias.
        "Host/Program.cs:5",
        // A plain static helper that copies the adapter's output into an ObjectResult.
        "Modules/Common/AdapterStatus.cs:1",
        // Straight off a cast, in the statement that builds the result.
        "Modules/Common/CastRelay.cs:4",
        // `where T : class where U : struct` declares no type named "where".
        "Modules/Common/ConstrainedRelay.cs:2",
        // Bridges that call the adapter and rebuild its output or hand-write the error path, and a ToResult
        // namesake returning object. The bridges' RivetActionResult casts add no third finding.
        "Modules/Common/FunctionResultExtensions.cs:1",
        "Modules/Common/FunctionResultExtensions.cs:1",
        // ToHttpResult returning IResult, and Respond returning ValueTask<HttpResults.Ok<T>>.
        "Modules/Common/HttpResultExtensions.cs:1",
        // A namespace block's alias, used in that namespace and in one nested in it.
        "Modules/Common/NestedAliases.cs:14",
        "Modules/Common/NestedAliases.cs:6",
        "Modules/Common/ResultExtensions.Actions.cs:1",
        "Modules/Common/ResultExtensions.cs:1",
        // An app's own `namespace Rivet.Shims`: only `Rivet` itself is Rivet's.
        "Modules/Common/RivetNamedShim.cs:4",
        // The app namespace after a `namespace Rivet { }` block; the shim itself is Rivet's.
        "Modules/Common/Shims.cs:12",
        // A record after a class, its reference in the record's parameter list.
        "Modules/Common/WrapperRecord.cs:9",
        // A property's `get =>` that returns a read, called into a result.
        "Modules/Orders/AccessorStatus.cs:4",
        // The adapter's output under a using alias; the alias line itself builds no result.
        "Modules/Orders/AliasedRelay.cs:6",
        // An anonymous object's braces inside the arguments end no member.
        "Modules/Orders/AnonymousRelay.cs:4",
        // A local assigned from a read after its declaration.
        "Modules/Orders/AssignedStatus.cs:4",
        // A block helper's `return` of a read, called into a local that builds the result.
        "Modules/Orders/BodyHelper.cs:4",
        // A bridge class, then a struct that copies the adapter's output: one finding each.
        "Modules/Orders/BridgeThenStruct.cs:1",
        "Modules/Orders/BridgeThenStruct.cs:7",
        // A local bound to `new RivetActionResult(…)`.
        "Modules/Orders/ConstructedAdapter.cs:4",
        // A controller deriving from the app's own base; the app's own result set on `ctx.Result`; a response
        // held in a local.
        "Modules/Orders/DerivedRelays.cs:21",
        "Modules/Orders/DerivedRelays.cs:33",
        "Modules/Orders/DerivedRelays.cs:6",
        // A pattern on a generic type, whose braces end no member.
        "Modules/Orders/GenericPattern.cs:4",
        // A switch arm's `when Allowed(status) =>`, which is no lambda taking status.
        "Modules/Orders/GuardedArm.cs:4",
        // A field that binds the adapter's output for every member.
        "Modules/Orders/HeldRelay.cs:4",
        // Copied through a local, then built into a result.
        "Modules/Orders/LocalCopyFilter.cs:4",
        // A nested reader hands the adapter's output back to the class around it, constructed in place or held
        // in a local.
        "Modules/Orders/NestedReader.cs:15",
        "Modules/Orders/NestedReader.cs:4",
        // Nested readers reached through a cast, a field, a grandchild's `new Mid.Leaf(a)` and a static call.
        "Modules/Orders/NestedReaders.cs:15",
        "Modules/Orders/NestedReaders.cs:26",
        "Modules/Orders/NestedReaders.cs:39",
        "Modules/Orders/NestedReaders.cs:4",
        // A shadowing lambda that ends at its argument's `,`, before the local is used.
        "Modules/Orders/NonLastLambda.cs:6",
        "Modules/Orders/OrderResultExtensions.cs:1",
        // The outer class's method, after a nested class.
        "Modules/Orders/OuterRelay.cs:3",
        // A property pattern's braces end no member.
        "Modules/Orders/PatternRelay.cs:4",
        // A property of the same type that returns a read, as an expression body or an auto-property's initializer.
        "Modules/Orders/PropertyHelper.cs:12",
        "Modules/Orders/PropertyHelper.cs:4",
        // A controller's `return Ok(a.Value);`.
        "Modules/Orders/RelayController.cs:4",
        // A result filter that sets Response.StatusCode and writes the value with WriteAsJsonAsync.
        "Modules/Orders/ResponseWritingFilter.cs:4",
        // An endpoint filter's `is global::Rivet.RivetActionResult` pattern rebuilt as Results.Json.
        "Modules/Orders/ResultStatusFilter.cs:4",
        // A sibling type's static helper that returns a read.
        "Modules/Orders/SiblingReader.cs:9",
        // A struct-only file: once, at the struct.
        "Modules/Orders/StatusCopy.cs:4",
        // An expression-bodied helper that returns a read.
        "Modules/Orders/StatusHelper.cs:4",
        // A target-typed `new(…)` declared as an ObjectResult, and one returned by a method declared to return one.
        "Modules/Orders/TargetTypedRelay.cs:14",
        "Modules/Orders/TargetTypedRelay.cs:4",
        // A typed Results<…> union, spaces in its generics.
        "Modules/Orders/TypedResultExtensions.cs:1",
        // A local reassigned from itself, assigned only on a condition, and redeclared only inside a lambda.
        "Modules/Orders/WindowEnds.cs:18",
        "Modules/Orders/WindowEnds.cs:34",
        "Modules/Orders/WindowEnds.cs:4",
        // A top-level statement in Program.cs, at its own line, and one calling a top-level local function that
        // returns a read.
        "Program.cs:3",
        "Program.cs:4",
        // The adapter's output under an alias only its own project's .csproj <Using> declares.
        "Relay/WrappedRelay.cs:4",
    ]);
    const copies = [...output.matchAll(/^MER-RV-007\twarn\t(\S+)\t(.+?) copies the StatusCode or Value of RivetActionResult/gm)].map((match) => `${match[1]} ${match[2]}`).sort();
    assert.deepEqual(copies, [
        "Host/Program.cs:5 This line",
        "Modules/Common/AdapterStatus.cs:1 AdapterStatus",
        "Modules/Common/CastRelay.cs:4 CastRelay",
        "Modules/Common/ConstrainedRelay.cs:2 ConstrainedRelay",
        "Modules/Common/NestedAliases.cs:14 InnerCopy",
        "Modules/Common/NestedAliases.cs:6 OuterCopy",
        "Modules/Common/RivetNamedShim.cs:4 Adapted",
        "Modules/Common/Shims.cs:12 Leak",
        "Modules/Common/WrapperRecord.cs:9 Wrapper",
        "Modules/Orders/AccessorStatus.cs:4 AccessorStatus",
        "Modules/Orders/AliasedRelay.cs:6 AliasedRelay",
        "Modules/Orders/AnonymousRelay.cs:4 AnonymousRelay",
        "Modules/Orders/AssignedStatus.cs:4 AssignedStatus",
        "Modules/Orders/BodyHelper.cs:4 BodyHelper",
        "Modules/Orders/BridgeThenStruct.cs:7 Relay",
        "Modules/Orders/ConstructedAdapter.cs:4 ConstructedAdapter",
        "Modules/Orders/DerivedRelays.cs:21 EnvelopeFilter",
        "Modules/Orders/DerivedRelays.cs:33 LocalResponseFilter",
        "Modules/Orders/DerivedRelays.cs:6 DerivedRelayController",
        "Modules/Orders/GenericPattern.cs:4 GenericPattern",
        "Modules/Orders/GuardedArm.cs:4 GuardedArm",
        "Modules/Orders/HeldRelay.cs:4 HeldRelay",
        "Modules/Orders/LocalCopyFilter.cs:4 LocalCopyFilter",
        "Modules/Orders/NestedReader.cs:15 NestedLocalReader",
        "Modules/Orders/NestedReader.cs:4 NestedReader",
        "Modules/Orders/NestedReaders.cs:15 CastNestedReader",
        "Modules/Orders/NestedReaders.cs:26 FieldNestedReader",
        "Modules/Orders/NestedReaders.cs:39 GrandchildReader",
        "Modules/Orders/NestedReaders.cs:4 StaticNestedReader",
        "Modules/Orders/NonLastLambda.cs:6 NonLastLambda",
        "Modules/Orders/OuterRelay.cs:3 OuterRelay",
        "Modules/Orders/PatternRelay.cs:4 PatternRelay",
        "Modules/Orders/PropertyHelper.cs:12 InitializedProperty",
        "Modules/Orders/PropertyHelper.cs:4 PropertyHelper",
        "Modules/Orders/RelayController.cs:4 RelayController",
        "Modules/Orders/ResponseWritingFilter.cs:4 ResponseWritingFilter",
        "Modules/Orders/ResultStatusFilter.cs:4 ResultStatusFilter",
        "Modules/Orders/SiblingReader.cs:9 SiblingReader",
        "Modules/Orders/StatusCopy.cs:4 StatusCopy",
        "Modules/Orders/StatusHelper.cs:4 StatusHelper",
        "Modules/Orders/TargetTypedRelay.cs:14 TargetTypedReturn",
        "Modules/Orders/TargetTypedRelay.cs:4 TargetTypedLocal",
        "Modules/Orders/WindowEnds.cs:18 ConditionalStatus",
        "Modules/Orders/WindowEnds.cs:34 LambdaLocalStatus",
        "Modules/Orders/WindowEnds.cs:4 ClampedStatus",
        "Program.cs:3 This line",
        "Program.cs:4 This line",
        "Relay/WrappedRelay.cs:4 WrappedRelay",
    ]);
    assert.match(output, /FunctionResultExtensions\.cs:1\tFunctionResultExtensions hand-writes an HTTP-result bridge off RivetResult \(ToResponse, Rebuild, ToHttp, OneArm\)/);
    assert.match(output, /FunctionResultExtensions\.cs:1\tFunctionResultExtensions declares its own ToResult off RivetResult, so a handler's call may bind to it instead of Rivet's first-party adapter — rename or delete it\trivet\.md#minimal-apis$/m);
    assert.match(output, /AdapterStatus\.cs:1\tAdapterStatus copies the StatusCode or Value of RivetActionResult, the output of Rivet's \.ToActionResult\(\) adapter, into an HTTP result or response of its own — a hand-written bridge; return \.ToResult\(\)\/\.ToActionResult\(\) directly \(in a filter, let Rivet write the response\), and at most read its StatusCode or Value\trivet\.md#controller-or-functions-aspnet-integration$/m);
    assert.match(output, /BridgeThenStruct\.cs:1\tStructBridgeExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /HttpResultExtensions\.cs:1\tHttpResultExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttpResult, Respond\) — delete it and use Rivet's first-party \.ToResult\(\)\/\.ToActionResult\(\) adapters\trivet\.md#minimal-apis$/m);
});

test("MER-RV-008 ignores MapGroup, reports handlers, and does not accept commented composition", () => {
    assert.equal(run("MER-RV-008", "good"), "");
    const output = run("MER-RV-008", "bad");
    assert.equal((output.match(/inline business endpoint handlers/g) || []).length, 3);
    assert.match(output, /Program\.cs:0\tProgram\.cs must compose MapOrdersEndpoints/);
});

test("MER-RV-009 accepts only ordinary or framework-qualified IEndpointRouteBuilder receivers", () => {
    assert.equal(run("MER-RV-009", "good"), "");
    assert.equal((run("MER-RV-009", "bad").match(/^MER-RV-009\t/gm) || []).length, 5);
});

test("Rivet route payload roots belong to their transport contract owner", () => {
    assert.equal(run("MER-RV-011", "good"), "");
    const output = run("MER-RV-011", "bad");
    assert.equal((output.match(/^MER-RV-011\t/gm) || []).length, 4);
    assert.match(output, /route payload CreateFormCommand/);
    assert.match(output, /route payload ModuleFormSummary/);
    assert.match(output, /route payload AuthError/);
    // A name also declared in an unimported namespace resolves through the using, so it's still judged.
    assert.match(output, /\tContracts\/Forms\/FormsContract\.cs:9\troute payload FormDraft is owned by Modules\/Forms\/Application\/FormDraft\.cs/);
});

test("MER-TE-001 evaluates each modular project and accepts analyzer ProjectReference wiring", () => {
    assert.equal(run("MER-TE-001", "good"), "");
    const output = run("MER-TE-001", "bad");
    assert.equal((output.match(/^MER-TE-001\t/gm) || []).length, 1);
    assert.match(output, /Unenforced\/Unenforced\.csproj:1/);
});

test("MER-TE-007 follows transitive ProjectReference paths to the production Npgsql provider", () => {
    assert.equal(run("MER-TE-007", "good"), "");
    assert.match(run("MER-TE-007", "bad"), /PostgresSqliteTests\.cs:4\tSQLite test database/);
});

// Every finding a rule's fixture reports: exact location, a message fragment, and nothing else.
function assertFindings(rule, fixture, expected) {
    const lines = run(rule, fixture).split("\n").filter(Boolean).map((line) => line.split("\t"));
    assert.equal(lines.length, expected.length, lines.map((line) => line.join("\t")).join("\n"));
    for (const [location, fragment] of expected) {
        assert.ok(lines.some(([id, , at, message]) => id === rule && at === location && message.includes(fragment)),
            `${rule} missing ${location} containing "${fragment}"`);
    }
}

test("MER-RV-003 bad reports exactly the unbound handlers, including a terminal only in a comment", () => {
    const unbound = "but the following handler block has no .Bind or terminal";
    assertFindings("MER-RV-003", "bad", [
        ["Modules/Orders/OrdersController.cs:20", `references MembersContract.List ${unbound}`],
        // A Map* call may take a field's runtime .Route.
        ["Modules/Orders/OrdersEndpoints.cs:4", `references OrdersContract.Create ${unbound}`],
        // Const-route handlers; test/rv003-const-routes.test.mjs pins their messages.
        ["Modules/Orders/OrdersController.cs:3", `references OrdersContract.CreateRoute ${unbound}`],
        ["Modules/Orders/OrdersController.cs:13", `references OrdersContract.ListRoute ${unbound}`],
        ["Modules/Orders/OrdersController.cs:26", `references OrdersContract.DraftRoute ${unbound}`],
        ["Modules/Orders/OrdersController.cs:29", `references OrdersContract.DraftRoute ${unbound}`],
        ["Modules/Orders/OrdersController.cs:36", `references MembersContract.InviteRoute ${unbound}`],
        ["Modules/Orders/OrdersController.cs:43", "handler is HttpDelete but OrdersContract.DraftRoute backs only Get and Put fields"],
        ["Modules/Orders/OrdersEndpoints.cs:9", `references OrdersContract.DraftRoute ${unbound}`],
    ]);
});

test("MER-BE-018 tells a module file declared in the transport namespace to move, and other uses to map at the edge", () => {
    assert.equal(run("MER-BE-018", "good"), "");
    assertFindings("MER-BE-018", "bad", [
        ["api/Modules/Orders/Application/OrderDtoExtensions.cs:1",
            "module Orders Application declares itself in the transport namespace App.Contracts.Orders — move it to Contracts/<Feature>/ or use the module's namespace"],
        ["api/Modules/Orders/Application/PlaceOrder/PlaceOrderUseCase.cs:1", "module Orders Application uses App.Contracts.Orders, the API's transport contract — map at the edge"],
        ["api/Modules/Orders/Domain/Order.cs:5", "module Orders Domain uses App.Contracts.Orders.OrderDto, the API's transport contract — map at the edge"],
        // Infrastructure returning transport DTOs: no legal caller can use them.
        ["api/Modules/Orders/Infrastructure/OrderReader.cs:1", "module Orders Infrastructure uses App.Contracts.Orders, the API's transport contract — map at the edge"],
        // Global usings (C# and MSBuild) put the transport contract in scope everywhere; System.* and comments are ignored.
        ["api/GlobalUsings.cs:2", "global using App.Contracts.Orders puts the API's transport contract in scope in every file of the project, modules included — remove it and add a file-level using in a controller, endpoint, request validator or transport mapper at the module root or under Contracts/ that needs it"],
        ["api/GlobalUsings.cs:3", "global using Wire = App.Contracts.Orders.OrderDto puts the API's transport contract in scope"],
        ["api/Api.csproj:5", "<Using Include=\"App.Contracts.Orders\"> puts the API's transport contract in scope"],
    ]);
});

test("MER-RV-027 follows transport namesakes and .Returns<T> payloads, checks PaginatedResponse, and flags defaults, [RivetOptional] and conditional [JsonIgnore]", () => {
    assert.equal(run("MER-RV-027", "good"), "");
    const contract = "api/Contracts/Orders/OrdersContract.cs";
    assertFindings("MER-RV-027", "bad", [
        // OrderDto is also declared in Modules/Orders/Application; the transport one is still checked.
        [`${contract}:36`, "OrderDto.Note has a default on a response"],
        [`${contract}:38`, "OrderLineDto.Quantity is [RivetOptional] on a response"],
        [`${contract}:38`, "OrderLineDto.Warehouse has a default and is [RivetOptional] on a response, so a builder can leave it out and the client type marks it optional though the server always sends it — remove both"],
        [`${contract}:40`, "OrderSettingsDto.ReminderDays has a default on a response, so a builder can leave it out and still compile — remove the default (it's a request type too)"],
        [`${contract}:43`, "PaginatedResponse.Total has a default on a response"],
        // .Returns<T>(status) payloads are responses; the .Returns<ErrorResponse> beside it stays exempt.
        [`${contract}:47`, "OrderConflictResponse.SubmittedAt is [JsonIgnore(Condition = WhenWritingNull)] on a response, so the server drops it from the JSON when it is null and the client sees the field as optional — remove the attribute so it is always sent"],
        [`${contract}:48`, "OrderConflictResponse.Attempts is [JsonIgnore(Condition = WhenWritingDefault)] on a response, so the server drops it from the JSON when it holds its type's default"],
        [`${contract}:49`, "OrderConflictResponse.Reason has a default on a response"],
        // An Orders response carries the Connectors module's published records (one fully qualified, one through
        // a using), so they're checked; the transport records of the same names aren't what it carries.
        ["api/Modules/Connectors/Contracts/ConnectorManifest.cs:4", "ConnectorManifest.Returns has a default on a response"],
        ["api/Modules/Connectors/Contracts/ConnectorManifest.cs:6", "ConnectorStep.Order has a default on a response"],
        // Responses whose fields are properties, and the attributes and defaults on those properties.
        ["api/Contracts/Orders/OrderSummaryContract.cs:17", "Response type OrderSummaryView is a class with properties, so a builder"],
        ["api/Contracts/Orders/OrderSummaryContract.cs:21", "OrderSummaryView.Note is [JsonIgnore(Condition = WhenWritingNull)] on a response"],
        ["api/Contracts/Orders/OrderSummaryContract.cs:24", "OrderSummaryView.Priority is [RivetOptional] on a response"],
        ["api/Contracts/Orders/OrderSummaryContract.cs:41", "OrderTotalsView.Currency has a default on a response"],
        ["api/Contracts/Orders/OrderSummaryContract.cs:46", "Response type OrderHistoryDto is a record whose fields are properties; response records take every field positionally"],
        ["api/Contracts/Orders/OrderSummaryContract.cs:50", "Entry.By has a default on a response"],
        ["api/Contracts/Orders/OrderSummaryContract.cs:54", "Response type OrderTagsView is a class with properties, so a builder"],
        ["api/Contracts/Orders/OrderSummaryContract.cs:61", "OrderTagsView.Colour is [RivetOptional] on a response"],
        // A DefaultIgnoreCondition in the host's JSON options drops fields from every response.
        ["api/Program.cs:5", "DefaultIgnoreCondition = WhenWritingNull in the host's JSON options drops every null field from every response"],
        ["api/Program.cs:8", "DefaultIgnoreCondition = WhenWritingDefault in the host's JSON options drops every field holding its type's default"],
        ["api/Program.cs:18", "DefaultIgnoreCondition = WhenWritingNull in the host's JSON options drops every null field from every response"],
        // Settable body properties on positional records, and union cases reached through [JsonDerivedType].
        ["api/Contracts/Orders/OrderEventsContract.cs:15", "OrderEventDto.Actor is set in the record body"],
        ["api/Contracts/Orders/OrderEventsContract.cs:17", "OrderEventDto.Sequence is a required body property"],
        ["api/Contracts/Orders/OrderEventsContract.cs:17", "OrderEventDto.Sequence is [RivetOptional] on a response"],
        ["api/Contracts/Orders/OrderEventsContract.cs:35", "Placed.Channel has a default and is [RivetOptional] on a response"],
        ["api/Contracts/Orders/OrderEventsContract.cs:42", "OrderCancelled.Reason has a default on a response"],
    ]);
});

// A throwaway repo holding only `files`, scanned for one rule (or with `args`).
function scan(rule, files, args = ["--rule", rule]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-backend-"));
    try {
        for (const [file, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), content);
        }
        const result = spawnSync(PLUMB, [root, ...args, "--ci", "--json"], { encoding: "utf8" });
        assert.ok([0, 1].includes(result.status), result.stderr);
        return JSON.parse(result.stdout).filter((finding) => !rule || finding.rule === rule).map((finding) => `${finding.location}\t${finding.message}`);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test("MER-RV-027 resolves a shared name by namespace, skips one two usings make ambiguous, and never flags ErrorResponse", () => {
    const findings = scan("MER-RV-027", {
        "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web" />\n',
        "api/Contracts/Orders/OrdersContract.cs":
            "using App.Modules.Orders.Contracts;\nusing App.Modules.Billing.Contracts;\nnamespace App.Contracts.Orders;\n" +
            "[RivetContract]\npublic static class OrdersContract\n{\n" +
            '    public static readonly RouteDefinition<OrderDto> Get = Define.Get<OrderDto>("/api/orders/{id}");\n' +
            '    public static readonly RouteDefinition<ImportResponse> Import = Define.Post<ImportResponse>("/api/orders/import");\n}\n' +
            "public sealed record OrderDto(Guid Id, string? Note = null);\n" +
            "public sealed record ImportResponse(int Imported, IReadOnlyList<ErrorResponse> Failures, Audit Audit);\n",
        // Same name, published by the Orders module: the contract's own namespace wins over the using.
        "api/Modules/Orders/Contracts/OrderDto.cs": "namespace App.Modules.Orders.Contracts;\npublic sealed record OrderDto(Guid Id, string Note, int Version = 1);\n" +
            "public sealed record Audit(string By, int Revision = 0);\n",
        // Audit comes in through both usings (CS0104): ambiguous, so neither is followed.
        "api/Modules/Billing/Contracts/Audit.cs": "namespace App.Modules.Billing.Contracts;\npublic sealed record Audit(string By, int Revision = 0);\n",
        // A canonical ErrorResponse outside Common/ is still BE-054's to judge, not RV-027's.
        "api/Contracts/Shared/ErrorResponse.cs":
            "namespace App.Contracts.Orders;\npublic sealed record ErrorResponse(string Code, string Message, IReadOnlyDictionary<string, string[]>? Errors = null);\n",
    });
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /^api\/Contracts\/Orders\/OrdersContract\.cs:10\tOrderDto\.Note has a default on a response/);
});

test("MER-RV-027 follows a positional record's parameter to the namespace's type, not its own nested namesake", () => {
    const findings = scan("MER-RV-027", {
        "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web" />\n',
        "api/Contracts/Orders/OrdersContract.cs":
            "namespace App.Contracts.Orders;\n[RivetContract]\npublic static class OrdersContract\n{\n" +
            '    public static readonly RouteDefinition<Shipment> Get = Define.Get<Shipment>("/api/shipments/{id}");\n}\n' +
            "public sealed record Shipment(IReadOnlyList<Parcel> Parcels)\n{\n    public sealed record Parcel(int Weight);\n}\n" +
            "public sealed record Parcel(int Weight = 0);\n",
    });
    assert.deepEqual(findings.map((finding) => finding.split(" on a response")[0]), ["api/Contracts/Orders/OrdersContract.cs:11\tParcel.Weight has a default"]);
});

test("MER-BE-018 says 'declares itself' only for the namespace name, not a using on the same line", () => {
    const findings = scan("MER-BE-018", {
        "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web" />\n',
        "api/Contracts/Orders/OrderModels.cs": "namespace App.Contracts.Orders;\npublic sealed record OrderDto(Guid Id);\n",
        "api/Modules/Orders/Application/Uses.cs": "namespace App.Modules.Orders.Application { using App.Contracts.Orders; }\n",
    });
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /Uses\.cs:1\tmodule Orders Application uses App\.Contracts\.Orders, the API's transport contract/);
});

test("MER-BE-018 reports a global using inside a module file once, as a global using", () => {
    const findings = scan("MER-BE-018", {
        "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web" />\n',
        "api/Contracts/Orders/OrderModels.cs": "namespace App.Contracts.Orders;\npublic sealed record OrderDto(Guid Id);\n",
        "api/Modules/Orders/Application/GlobalUsings.cs": "global using global::App.Contracts.Orders;\n",
        // A test project's global usings stay in the test project.
        "tests/Orders.Tests/Orders.Tests.csproj": '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><Using Include="App.Contracts.Orders" /></ItemGroup></Project>\n',
        "tests/Orders.Tests/Usings.cs": "global using App.Contracts.Orders;\n",
    });
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /^api\/Modules\/Orders\/Application\/GlobalUsings\.cs:1\tglobal using global::App\.Contracts\.Orders puts the API's transport contract in scope/);
});

test("MER-BE-018 reads every <Using> form and global using statement, and exempts test projects by metadata, test-only props and build output", () => {
    const findings = scan("MER-BE-018", {
        "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web">\n  <ItemGroup>\n    <Using\n      Include="System.Text.Json;App.Contracts.Orders" />\n  </ItemGroup>\n</Project>\n',
        "Directory.Build.props": '<Project>\n  <ItemGroup>\n    <Using Include="App.Contracts.Orders" />\n  </ItemGroup>\n' +
            "  <ItemGroup Condition=\"'$(IsTestProject)' == 'true'\">\n    <Using Include=\"App.Contracts.Orders\" />\n  </ItemGroup>\n" +
            // Only production projects take these.
            "  <ItemGroup Condition=\"'$(IsTestProject)' != 'true'\">\n    <Using Include=\"App.Contracts.Orders\" />\n  </ItemGroup>\n" +
            "  <ItemGroup>\n    <Using Include=\"App.Contracts.Orders\" Condition=\"'$(IsTestProject)' == 'false'\" />\n" +
            "    <Using Include=\"App.Contracts.Orders\" Condition=\" 'true' == '$(IsTestProject)' \" />\n" +
            "    <Using Include=\"App.Contracts.Orders\" Condition=\"'$(IsTestProject)' == true\" />\n  </ItemGroup>\n" +
            // A self-closing group has no body; the test-only group after it keeps its Condition.
            "  <ItemGroup />\n  <ItemGroup Condition=\"'$(IsTestProject)' == 'true' \">\n    <Using Include=\"App.Contracts.Orders\" />\n  </ItemGroup>\n</Project>\n",
        "api/Contracts/Orders/OrderModels.cs": "namespace App.Contracts.Orders;\npublic sealed record OrderDto(Guid Id);\npublic sealed record Page<T>(T Item);\n",
        "api/GlobalUsings.cs": "global using System; global using static App.Contracts.Orders.OrderDto;\nglobal using Wire = App.Contracts.Orders.Page<App.Contracts.Orders.OrderDto>;\nglobal using Dtos = App.Contracts.Orders.OrderDto[];\n",
        // SDK-generated build output repeats the project's usings.
        "api/obj/Debug/net10.0/Api.GlobalUsings.g.cs": "global using global::App.Contracts.Orders;\n",
        // A test project known only by its test SDK, not by its folder or file names.
        "src/Api.Specs/Api.Specs.csproj": '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.0.0" /></ItemGroup></Project>\n',
        "src/Api.Specs/Modules/Orders/Application/PlaceOrderSpec.cs": "global using App.Contracts.Orders;\n",
        // A production *Test.cs file inside a module is production code.
        "api/Modules/Payments/Infrastructure/GovUkPayConnectionTest.cs": "using App.Contracts.Orders;\n",
        // A global using split over lines is reported once, as a global using.
        "api/Modules/Orders/Application/Usings.cs": "global using Wire =\n    App.Contracts.Orders.OrderDto;\n",
    });
    assert.deepEqual(findings.map((finding) => finding.replace(/ puts the API's.*/, "")).sort(), [
        "Directory.Build.props:12\t<Using Include=\"App.Contracts.Orders\">",
        "Directory.Build.props:3\t<Using Include=\"App.Contracts.Orders\">",
        "Directory.Build.props:9\t<Using Include=\"App.Contracts.Orders\">",
        "api/Api.csproj:3\t<Using Include=\"App.Contracts.Orders\">",
        "api/GlobalUsings.cs:1\tglobal using static App.Contracts.Orders.OrderDto",
        "api/GlobalUsings.cs:2\tglobal using Wire = App.Contracts.Orders.Page<App.Contracts.Orders.OrderDto>",
        "api/GlobalUsings.cs:3\tglobal using Dtos = App.Contracts.Orders.OrderDto[]",
        "api/Modules/Orders/Application/Usings.cs:1\tglobal using Wire = App.Contracts.Orders.OrderDto",
        "api/Modules/Payments/Infrastructure/GovUkPayConnectionTest.cs:1\tmodule Payments Infrastructure uses App.Contracts.Orders, the API's transport contract — map at the edge (a controller, endpoint, request validator or transport mapper at the module root or under Contracts/) and keep the module on its own types",
    ]);
});

test("MER-RV-027 reads .Returns<T> only in a [RivetContract], and a conditional [JsonIgnore] beside [RivetOptional] is its own finding", () => {
    const findings = scan("MER-RV-027", {
        "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web" />\n',
        "api/Contracts/Orders/OrdersContract.cs":
            "[RivetContract]\npublic static class OrdersContract\n{\n" +
            '    public static readonly RouteDefinition Cancel = Define.Delete("/api/orders/{id}").Returns<CancelRefused>(409);\n}\n' +
            "public sealed record CancelRefused([property: RivetOptional, JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason);\n",
        // Not a Rivet contract: a mocking library's .Returns<T> names no response.
        "api/Modules/Orders/Infrastructure/ClockSetup.cs":
            "public static class ClockSetup { public static void Use(dynamic clock) => clock.Now().Returns<ClockReading>(1); }\n" +
            "public sealed record ClockReading(int Ticks = 0);\n",
    });
    assert.equal(findings.length, 2, findings.join("\n"));
    assert.ok(findings.some((finding) => /^api\/Contracts\/Orders\/OrdersContract\.cs:6\tCancelRefused\.Reason is \[RivetOptional\] on a response/.test(finding)), findings.join("\n"));
    assert.ok(findings.some((finding) => /^api\/Contracts\/Orders\/OrdersContract\.cs:6\tCancelRefused\.Reason is \[JsonIgnore\(Condition = WhenWritingNull\)\] on a response/.test(finding)), findings.join("\n"));
});

test("MER-TE-008 checks a TypeScript API's test/ tree and accepts doubles in its support/ folder", () => {
    assertFindings("MER-TE-008", "bad", [
        ["Tests/FakeClock.cs:3", "top-level test double FakeClock lives outside TestSupport/<Module>"],
        ["api/test/orders/fake-quote-store.ts:2", "exported test double FakeQuoteStore is outside the test tree's support/ folder — move reusable doubles into that support/ folder"],
    ]);
    const findings = scan("MER-TE-008", {
        // A workspace root is not the package these tests belong to.
        "package.json": '{ "workspaces": ["api"] }\n',
        "api/package.json": "{}\n",
        "api/test/orders/support/fake-clock.ts": "export class FakeClock {}\n",
        "api/tests/fake-mailer.ts": "export class FakeMailer {}\n",
        // src/test/ is app code, not a test tree.
        "api/src/test/fake-seed.ts": "export class FakeSeed {}\n",
    });
    assert.deepEqual(findings.map((finding) => finding.split("\t")[0]), ["api/tests/fake-mailer.ts:1"]);
});

test("a repo whose only tests sit in a TypeScript test/ tree gets the TE pack in a full run", () => {
    const findings = scan("MER-TE-008", {
        "api/package.json": "{}\n",
        "api/test/orders/fake-quote-store.ts": "export class FakeQuoteStore {}\n",
    }, []);
    assert.deepEqual(findings.map((finding) => finding.split("\t")[0]), ["api/test/orders/fake-quote-store.ts:1"]);
});

test("MER-FE-030 leaves a test support barrel alone and still flags an app re-export and a .d.ts shim", () => {
    const findings = scan("MER-FE-030", {
        "ui/nuxt.config.ts": "export default defineNuxtConfig({ ssr: false });\n",
        "ui/tests/support/index.ts": 'export * from "./fake-auth";\n',
        "ui/tests/support/fake-auth.ts": "export class FakeAuth {}\n",
        "ui/app/utils/index.ts": 'export * from "./money";\n',
        "ui/app/utils/money.ts": "export const money = 1;\n",
        // A hand-written declaration file is not test code.
        "ui/app/types/legacy.d.ts": 'export * from "../utils/money";\n',
    });
    assert.deepEqual(findings.map((finding) => finding.split("\t")[0]).sort(), ["ui/app/types/legacy.d.ts:1", "ui/app/utils/index.ts:1"]);
});

test("MER-TE-008 judges a single-package repo by its root package.json: only the top-level test tree is tests", () => {
    const findings = scan("MER-TE-008", {
        "package.json": "{}\n",
        "test/fake-clock.ts": "export class FakeClock {}\n",
        // lib/test/ and server/tests/ are app folders of the root package.
        "lib/test/fake-seed.ts": "export class FakeSeed {}\n",
        "server/tests/fake-mailer.ts": "export class FakeMailer {}\n",
    });
    assert.deepEqual(findings.map((finding) => finding.split("\t")[0]), ["test/fake-clock.ts:1"]);
});
