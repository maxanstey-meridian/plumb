#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { underModuleFolder } from "../lib/in-process-rules/be-csharp.mjs";
import { restoreProjects } from "../scripts/dotnet-restore.mjs";
import { rivetStubs } from "./helpers/rivet-stubs.mjs";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(HOME, "fixtures");
const PLUMB = path.join(HOME, "plumb");

// A package-free net10.0 project, as the rules that read C# facts need (`scan` restores it with `restore`).
const net10 = (properties = "", items = "") => `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable>${properties}</PropertyGroup>${items}</Project>\n`;

// A repository for a rule that reads C# facts: one restored net10.0 project over the files (an executable when it has
// top-level statements in Program.cs).
const scanOnFacts = (rule, files) =>
    scan(rule, { "App.csproj": net10("Program.cs" in files ? "<OutputType>Exe</OutputType>" : ""), ...files }, undefined, { restore: true });

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
    // A framework type is judged where it is used, however it came into scope: a global using in another file
    // (ILogger), or an alias (Ef.DbContext, which HEAD's text match saw only at the alias line).
    assertFindings("MER-BE-001", "bad", [
        ["GlobalUsings.cs:1", "remove this global using (Microsoft.Extensions.Logging)"],
        ["Modules/Users/Domain/AliasDependency.cs:1", "remove this reference (Microsoft.EntityFrameworkCore)"],
        ["Modules/Users/Domain/AliasDependency.cs:4", "remove this reference (Microsoft.EntityFrameworkCore.DbContext)"],
        ["Modules/Users/Domain/FullyQualifiedDependency.cs:4", "remove this reference (Microsoft.EntityFrameworkCore.DbContext)"],
        ["Modules/Users/Domain/FullyQualifiedDependency.cs:5", "remove this reference (Acme.Modules.Users.Application.Ports.IUserRepository)"],
        ["Modules/Users/Domain/GlobalUsingDependency.cs:4", "remove this reference (Microsoft.Extensions.Logging.ILogger)"],
        ["Modules/Users/Domain/User.cs:1", "remove this reference (Microsoft.EntityFrameworkCore)"],
        ["Modules/Users/Domain/User.cs:2", "remove this reference (Acme.Modules.Users.Application.Ports)"],
    ]);
});

test("MER-BE-002 reports each Infrastructure or transport framework an Application file uses, by using or by use", () => {
    assertFindings("MER-BE-002", "bad", [
        ["Modules/Users/Application/CreateUser/CreateUserUseCase.cs:1", "depend on a port instead (Acme.Modules.Users.Infrastructure)"],
        ["Modules/Users/Application/CreateUser/CreateUserUseCase.cs:2", "depend on a port instead (Microsoft.AspNetCore.Http)"],
        ["Modules/Users/Application/CreateUser/CreateUserUseCase.cs:3", "depend on a port instead (Npgsql)"],
    ]);
    // No using names the type: it comes in through the enclosing namespace, a global using, or the Web SDK's implicit usings.
    const web = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>\n';
    assert.deepEqual(scan("MER-BE-002", {
        "App.csproj": web,
        "Modules/Users/Infrastructure/UserStore.cs": "namespace Acme.Modules.Users.Infrastructure;\npublic sealed class UserStore { }\npublic sealed class Pool { }\n",
        "GlobalUsings.cs": "global using Acme.Modules.Users.Infrastructure;\n",
        "Modules/Users/Application/ByNamespace.cs": "namespace Acme.Modules.Users.Infrastructure.Tools;\npublic sealed class ByNamespace { public Pool? Pool { get; set; } }\n",
        "Modules/Users/Application/ByGlobalUsing.cs": "namespace Acme.Modules.Users.Application;\npublic sealed class ByGlobalUsing { public UserStore? Store { get; set; } }\n",
        "Modules/Users/Application/ByImplicitUsing.cs": "namespace Acme.Modules.Users.Application;\npublic sealed class ByImplicitUsing { public HttpContext? Context { get; set; } }\n",
    }, undefined, { restore: true }), [
        "Modules/Users/Application/ByGlobalUsing.cs:2\tApplication must not depend on Infrastructure or transport frameworks — depend on a port instead (Acme.Modules.Users.Infrastructure.UserStore)",
        "Modules/Users/Application/ByImplicitUsing.cs:2\tApplication must not depend on Infrastructure or transport frameworks — depend on a port instead (Microsoft.AspNetCore.Http.HttpContext)",
        "Modules/Users/Application/ByNamespace.cs:2\tApplication must not depend on Infrastructure or transport frameworks — depend on a port instead (Acme.Modules.Users.Infrastructure.Pool)",
    ]);
});

// Every dotted name a using holds is judged, a framework name inside its type arguments included, and a type named
// `Application` is a higher layer's by its full name.
test("MER-BE-001 judges a framework name inside a using's type arguments and a type named Application", () => {
    assert.deepEqual(scanOnFacts("MER-BE-001", {
        "Stubs/Ef.cs": "namespace Microsoft.EntityFrameworkCore;\npublic class DbContext { }\n",
        "Wire/Page.cs": "namespace Wire;\npublic sealed class Page<T> { }\n",
        "Modules/Users/Application.cs": "namespace Acme.Modules.Users;\npublic sealed class Application { }\n",
        "Modules/Users/Domain/Uses.cs": "using Paged = Wire.Page<Microsoft.EntityFrameworkCore.DbContext>;\nusing Acme.Modules.Users;\nnamespace Acme.Modules.Users.Domain;\n" +
            "public sealed class Uses { public Application? Owner { get; init; } }\n",
    }), [
        "Modules/Users/Domain/Uses.cs:1\tDomain depends on nothing outside itself — remove this reference (Microsoft.EntityFrameworkCore.DbContext)",
        "Modules/Users/Domain/Uses.cs:4\tDomain depends on nothing outside itself — remove this reference (Acme.Modules.Users.Application)",
    ]);
});

test("MER-BE-005 prevents Common from depending on feature-owned namespaces", () => {
    assert.equal(run("MER-BE-005", "good"), "");
    const output = run("MER-BE-005", "bad");
    assert.match(output, /^MER-BE-003\t.*Common\/UsesFeatureInternals\.cs:1\t/m);
    assert.match(output, /^MER-BE-004\t.*Common\/UsesFeatureInternals\.cs:2\t/m);
    assert.match(output, /^MER-BE-005\t.*Common\/UsesFeatureInternals\.cs:3\t/m);
    assert.match(output, /^MER-BE-005\t.*Common\/UsesFeatureInternals\.cs:4\t/m);
    // A name written in full, with no using, is judged where it is written.
    assert.match(output, /^MER-BE-005\t.*Modules\/Auth\/Application\/U\.cs:4\t/m);
});

// A global using puts the module in every file of its project: from a host file, even of a Contracts namespace,
// and from a module's own folder.
test("MER-BE-005 flags a global using of a module's namespace wherever it is written, a module's own included", () => {
    const output = run("MER-BE-005", "bad");
    assert.match(output, /^MER-BE-005\terror\tapi\/Integration\/GlobalUsings\.cs:1\tglobal using of Forms\.Contracts puts module Forms in every file of the project/m);
    assert.match(output, /^MER-BE-005\terror\tapi\/Modules\/Forms\/GlobalUsings\.cs:1\tglobal using of Forms\.Domain puts module Forms in every file of the project/m);
});

// An MSBuild <Using> item is a global using too: reported once at the project file's line; a test-only item is not.
test("MER-BE-005 flags an MSBuild <Using> of a module's namespace at the project file's line, and skips a test-only item", () => {
    const files = {
        "api/Api.csproj": net10("", `
  <ItemGroup>
    <Using Include="App.Modules.Forms.Contracts" />
    <Using Include="App.Modules.Forms.Domain" Condition="'$(IsTestProject)' == 'true'" />
  </ItemGroup>`),
        "api/Common/.keep": "",
        // A test project's own <Using> reaches only test code.
        "api/Modules/Forms/Checks/Forms.Checks.csproj": net10("<IsTestProject>true</IsTestProject>", '\n  <ItemGroup>\n    <Using Include="App.Modules.Forms.Domain" />\n  </ItemGroup>'),
        "api/Modules/Forms/Contracts/FormSummary.cs": "namespace App.Modules.Forms.Contracts;\npublic sealed record FormSummary(Guid Id);\n",
        "api/Modules/Forms/Domain/Form.cs": "namespace App.Modules.Forms.Domain;\npublic sealed class Form { }\n",
        // A module's root namespace has no layer segment, so its message says so.
        "api/Modules/Forms/FormsModule.cs": "namespace App.Modules.Forms;\npublic static class FormsModule { }\n",
        "api/Common/UsesRoot.cs": "using App.Modules.Forms;\nnamespace App.Common;\npublic sealed class UsesRoot;\n",
    };
    assert.deepEqual(scan("MER-BE-005", files, undefined, { restore: true }), [
        "api/Api.csproj:3\tglobal using of Forms.Contracts puts module Forms in every file of the project — use it only in the files that need it",
        "api/Common/UsesRoot.cs:1\tmodule outside module must not use Forms's root namespace types — publish a contract under Forms.Contracts or define a consumer-owned required port",
    ]);
});

test("MER-BE-005 rejects sibling published Contracts in Domain but permits Application and integration consumers", () => {
    assert.equal(run("MER-BE-005", "good"), "");
    assert.match(run("MER-BE-005", "bad"), /^MER-BE-005\t.*Modules\/Auth\/Domain\/UsesFormsContract\.cs:1\t/m);
});

test("MER-BE-006 propagates consumers through real nested declaration bodies and the transport contracts a module or the host references, and counts the host as a consumer", () => {
    const output = run("MER-BE-006", "good");
    // One module each, plus the host: Program.cs (ClientAddress), Middleware/ (RequestQuota), and Program.cs
    // through HostSettings, which names RetryWindow. HostSettings has only the host, which is no single owner. Forms
    // plus a transport contract's server: Rota through its contract class (ShiftWindow) and through a Conditions DTO
    // (RuleKind), Reference serving Contracts/ReferenceData (ListColumn), and the host serving Contracts/Health (BuildStamp).
    // Forms plus a consumer passed on by a type that is no candidate (QuotaLimit, through an *Exception Users throws) or
    // named in an attribute argument (ShiftSwap, in RotaEvent's [JsonDerivedType]).
    assert.equal(output, "");
});

test("MER-BE-006 counts a module only where a name it writes resolves to the Common type or to a transport contract naming it", () => {
    // Users declares its own Paging: a namesake, not a consumer of Acme.Common.Paging. A host test project's use of
    // RetryBudget, directly or through a contract it references, is not the host's. Rota serving its own wire keeps
    // RotaSlot Rota's, and makes WireColour, which only that wire names, Rota's; an unserved contract leaves Ledger Forms'.
    // A type with no access modifier is a candidate (Throttle); a private nested one is not (Lookup's Cache).
    assertFindings("MER-BE-006", "bad", [
        ["Common/Ledger.cs:0", "Common type Ledger is referenced only by module Forms"],
        ["Common/Lookup.cs:0", "Common type Lookup is referenced only by module Forms"],
        ["Common/Paging.cs:0", "Common type Paging is referenced only by module Forms"],
        ["Common/RetryBudget.cs:0", "Common type RetryBudget is referenced only by module Forms"],
        ["Common/RotaSlot.cs:0", "Common type RotaSlot is referenced only by module Rota"],
        ["Common/SlugRules.cs:0", "Common type SlugRules is referenced only by module Forms"],
        ["Common/Throttle.cs:0", "Common type Throttle is referenced only by module Forms"],
        ["Common/WireColour.cs:0", "Common type WireColour is referenced only by module Rota"],
    ]);
    const files = {
        "Common/Money.cs": "namespace Acme.Common;\npublic sealed record Money(decimal Amount);\npublic sealed record Rate(Money PerHour);\n",
        "Common/Clock.cs": "namespace Acme.Common;\npublic static class Clock { public static int Now => 0; }\n",
        // A using, an alias and a `using static` each make a consumer; a comment and a string do not.
        "Modules/Billing/Invoice.cs": "using Acme.Common;\nnamespace Acme.Modules.Billing;\npublic sealed record Invoice(Money Total);\n",
        // Payslip uses `Now`, so the `using static` makes Payroll a consumer of Clock: an unused directive makes none.
        "Modules/Payroll/Payslip.cs": "using Cash = Acme.Common.Money;\nusing static Acme.Common.Clock;\nnamespace Acme.Modules.Payroll;\npublic sealed record Payslip(Cash Net) { public int At => Now; }\n",
        "Modules/Rota/Shift.cs": "namespace Acme.Modules.Rota;\n// Rate and Clock live in Common.\npublic sealed record Shift(string Note = \"Rate\");\n",
        // Rate's only consumer is Rota, through a qualified name; Rate names Money, so Rota consumes Money too.
        "Modules/Rota/Pay.cs": "namespace Acme.Modules.Rota;\npublic sealed record Pay(Acme.Common.Rate Rate);\n",
        "Contracts/Rota/RotaContract.cs": "namespace Acme.Contracts.Rota;\npublic sealed record RotaPay(Acme.Common.Rate Rate);\n",
    };
    const serving = (module) => ({ [`Modules/${module}/RotaEndpoints.cs`]: `namespace Acme.Modules.${module};\npublic sealed class RotaEndpoints { public Acme.Contracts.Rota.RotaPay? Pay { get; set; } }\n` });
    // An unserved transport contract passes nothing on, and isn't the host.
    const findings = scanOnFacts("MER-BE-006", files);
    assert.deepEqual(findings.map((finding) => finding.replace(/ — review.*/, "")).sort(), [
        "Common/Clock.cs:0\tCommon type Clock is referenced only by module Payroll",
        "Common/Money.cs:0\tCommon type Rate is referenced only by module Rota",
    ]);
    // Rota serving its own contract adds no second consumer: Rate stays Rota's.
    assert.deepEqual(scanOnFacts("MER-BE-006", { ...files, ...serving("Rota") }), findings);
    // Payroll serving it consumes the Rate the contract names, so Rate is shared: whether the contract writes Rate, or
    // an alias of its own, and whether Payroll writes RotaPay or a global alias of it. A global using static of the
    // contract makes it, and so Rate, shared. Only Clock is left.
    const onlyClock = ["Common/Clock.cs:0\tCommon type Clock is referenced only by module Payroll"];
    const findingsOf = (extra) => scanOnFacts("MER-BE-006", { ...files, ...extra }).map((finding) => finding.replace(/ — review.*/, ""));
    assert.deepEqual(findingsOf(serving("Payroll")), onlyClock);
    assert.deepEqual(findingsOf({ ...serving("Payroll"),
        "Contracts/Rota/RotaContract.cs": "using Hourly = Acme.Common.Rate;\nnamespace Acme.Contracts.Rota;\npublic sealed record RotaPay(Hourly Rate);\n" }), onlyClock);
    assert.deepEqual(findingsOf({ "GlobalUsings.cs": "global using RotaApi = Acme.Contracts.Rota.RotaPay;\n",
        "Modules/Payroll/RotaUse.cs": "namespace Acme.Modules.Payroll;\npublic sealed record RotaUse(RotaApi? Pay);\n" }), onlyClock);
    assert.deepEqual(findingsOf({ "GlobalUsings.cs": "global using static Acme.Contracts.Rota.RotaPay;\n" }), onlyClock);
    // So does a <Using Static> item of the project, unless it is test-only.
    const usingItem = (attributes) => ({ "App.csproj": net10("", `<ItemGroup><Using Include="Acme.Contracts.Rota.RotaPay" Static="true"${attributes} /></ItemGroup>`) });
    assert.deepEqual(findingsOf(usingItem("")), onlyClock);
    assert.deepEqual(findingsOf(usingItem(` Condition="'$(IsTestProject)' == 'true'"`)), findings.map((finding) => finding.replace(/ — review.*/, "")));
    // A contract's own using static names the type for every declaration in its file: Rota serving it consumes Clock.
    assert.deepEqual(findingsOf({ ...serving("Rota"),
        "Contracts/Rota/RotaStamp.cs": "using static Acme.Common.Clock;\nnamespace Acme.Contracts.Rota;\npublic sealed record RotaStamp(int At) { public static RotaStamp Stamp() => new(Now); }\n",
        "Modules/Rota/RotaStamps.cs": "namespace Acme.Modules.Rota;\npublic sealed record RotaStamps(Acme.Contracts.Rota.RotaStamp Last);\n" }),
        ["Common/Money.cs:0\tCommon type Rate is referenced only by module Rota"]);
    // Inside a namespace block it reaches only that block: Rota serving the other block's DTO doesn't consume Clock.
    assert.deepEqual(findingsOf({ ...serving("Rota"),
        "Contracts/Rota/RotaStamp.cs": "namespace Acme.Contracts.Rota.Stamps { using static Acme.Common.Clock; public sealed record RotaStamp(int At) { public static RotaStamp Stamp() => new(Now); } }\n" +
            "namespace Acme.Contracts.Rota.Notes { public sealed record RotaNote(string Text); }\n",
        "Modules/Rota/RotaNotes.cs": "namespace Acme.Modules.Rota;\npublic sealed record RotaNotes(Acme.Contracts.Rota.Notes.RotaNote Last);\n" }),
        [...onlyClock, "Common/Money.cs:0\tCommon type Rate is referenced only by module Rota"]);
});

test("MER-BE-006 reads every part of a partial type, and never reports a type that moves with its file or outer type", () => {
    const findings = scanOnFacts("MER-BE-006", {
        "Common/Money.cs": "namespace Acme.Common;\npublic sealed record Money(decimal Amount);\n",
        // Settings' second part names Money, so Users, through Settings, is Money's second consumer.
        "Common/Settings.A.cs": "namespace Acme.Common;\npublic sealed partial class Settings { }\n",
        "Common/Settings.B.cs": "namespace Acme.Common;\npublic sealed partial class Settings { public Money? Floor { get; init; } }\n",
        // Only a protected internal nested type, of these, can be named outside Holder or its file.
        "Common/Holder.cs": "namespace Acme.Common;\npublic sealed class Holder\n{\n    protected sealed record Guarded(int A);\n" +
            "    protected internal sealed record Shared(int A);\n    private sealed class Inner { public sealed record Deep(int A); private Deep? deep; }\n" +
            "    private Guarded? guarded;\n    private Inner? inner;\n    public int Size() => new Local().GetHashCode();\n}\nfile sealed class Local { }\n",
        // A use inside a nested type is its outer type's too: Users, through Wrapper's nested Inner, is Rate's second consumer.
        "Common/Wrapper.cs": "namespace Acme.Common;\npublic sealed class Wrapper { public sealed record Inner(Rate Value); }\npublic sealed record Rate(int Value);\n",
        "Modules/Forms/Forms.cs": "namespace Acme.Modules.Forms;\ninternal sealed record Forms(Acme.Common.Settings Settings, Acme.Common.Money Money, " +
            "Acme.Common.Holder Holder, Acme.Common.Holder.Shared Shared, Acme.Common.Wrapper Wrapper, Acme.Common.Rate Rate);\n",
        "Modules/Users/Users.cs": "namespace Acme.Modules.Users;\npublic sealed record Users(Acme.Common.Settings Settings, Acme.Common.Wrapper Wrapper);\n",
    });
    assert.deepEqual(findings.map((finding) => finding.replace(/ — review.*/, "")).sort(), [
        "Common/Holder.cs:0\tCommon type Holder is referenced only by module Forms",
        "Common/Holder.cs:0\tCommon type Shared is referenced only by module Forms",
    ]);
});

// A file-local class is its own type beside a public one of the same name: the public type's access is its own, so a
// file-local namesake doesn't make it read as hidden, and a project item that names the public type never reaches the
// file-local one.
test("MER-BE-006 reports a public Common type used by one module as it would without a file-local class of the same name", () => {
    const files = {
        "Common/Gauge.cs": "namespace Acme.Common;\npublic sealed record Gauge(int Value);\n",
        "Modules/Forms/Reading.cs": "namespace Acme.Modules.Forms;\npublic sealed record Reading(Acme.Common.Gauge Gauge);\n",
    };
    const expected = ["Common/Gauge.cs:0\tCommon type Gauge is referenced only by module Forms"];
    const withoutNamesake = scanOnFacts("MER-BE-006", files).map((finding) => finding.replace(/ — review.*/, ""));
    assert.deepEqual(withoutNamesake, expected);
    // The file-local class is declared in a file that sorts before the public one's.
    const withNamesake = scanOnFacts("MER-BE-006", {
        ...files,
        "Common/A.Gauge.cs": "namespace Acme.Common;\nfile sealed class Gauge { public int Local { get; set; } }\n",
    }).map((finding) => finding.replace(/ — review.*/, ""));
    assert.deepEqual(withNamesake, expected);
    // A project `<Using Static>` of the public type makes the host its consumer, with a file-local namesake declared
    // beside it: the namesake doesn't break the host's path to the public type.
    assert.deepEqual(scanOnFacts("MER-BE-006", {
        ...files,
        "Common/Z.Gauge.cs": "namespace Acme.Common;\nfile sealed class Gauge { public int Local { get; set; } }\n",
        "App.csproj": net10("", '<ItemGroup><Using Include="Acme.Common.Gauge" Static="true" /></ItemGroup>'),
    }), []);
    // A project `<Using Static>` item can't name a file-local type, so it never makes the host a consumer of a Common
    // file-local class whose public namesake lives outside Common: the host doesn't pass on to Dial, which that class names.
    assert.deepEqual(scanOnFacts("MER-BE-006", {
        "Common/Dial.cs": "namespace Acme.Common;\npublic sealed record Dial(int Face);\n",
        "Common/Gauge.cs": "namespace Acme.Common;\nfile static class Gauge { public static Dial? Face; }\n",
        "Modules/Forms/Gauge.cs": "namespace Acme.Common;\npublic static class Gauge { public static int Value => 0; }\n",
        "Modules/Forms/Reading.cs": "namespace Acme.Modules.Forms;\npublic sealed record Reading(Acme.Common.Dial Dial);\n",
        "App.csproj": net10("", '<ItemGroup><Using Include="Acme.Common.Gauge" Static="true" /></ItemGroup>'),
    }).map((finding) => finding.replace(/ — review.*/, "")), ["Common/Dial.cs:0\tCommon type Dial is referenced only by module Forms"]);
});

test("MER-BE-006 counts a name in an interpolated string's hole, and never one in its text, a string in a hole, or a format clause", () => {
    const findings = scanOnFacts("MER-BE-006", {
        "Common/Clock.cs": "namespace Acme.Common;\npublic static class Clock { public static int Now => 0; }\n",
        "Common/Labels.cs": "namespace Acme.Common;\npublic static class Labels { public static string Of(int value) => \"\"; }\n",
        "Modules/Forms/Forms.cs": "namespace Acme.Modules.Forms;\npublic sealed class Forms { public string Show() => Acme.Common.Labels.Of(Acme.Common.Clock.Now); }\n",
        // Users names Clock only in holes, after a string in an earlier hole and in a raw `$$` hole; it names Labels
        // only as text: in a string in a hole, a format clause, `{{…}}`, and a raw `$$` string's single braces.
        "Modules/Users/Users.cs": "namespace Acme.Modules.Users;\npublic sealed class Users\n{\n" +
            "    public string Show(string name) => $\"{name.Replace(\"x\", \"Labels\")} at {Acme.Common.Clock.Now:Labels} {{Acme.Common.Labels}}\";\n" +
            "    public string Raw() => $$\"\"\"{Acme.Common.Labels} {{Acme.Common.Clock.Now}}\"\"\";\n}\n",
    });
    assert.deepEqual(findings.map((finding) => finding.replace(/ — review.*/, "")), [
        "Common/Labels.cs:0\tCommon type Labels is referenced only by module Forms",
    ]);
});

test("MER-BE-006 counts a call to a static class's extension member where the class's namespace is in scope, and never an enum member's name", () => {
    const findings = scanOnFacts("MER-BE-006", {
        "Common/Roles.cs": "namespace Acme.Common;\npublic enum Role { Admin, Member }\npublic static class RoleRules\n{\n" +
            "    public static bool IsAtLeast(this Role role, Role minimum) => role >= minimum;\n}\npublic sealed record Quota(int Limit);\n" +
            // Users' own Doubling class doesn't hide this one's extension method from it.
            "public static class Doubling { public static int Twice(this int value) => value * 2; }\n" +
            // StaffAccess, which both modules use, calls Grading's extension method, so Grading is shared.
            "public static class Grading { public static int Grade(this Role role) => (int)role; }\n" +
            "public static class StaffAccess { public static bool Allows(Role role) => role.Grade() > 0; }\n",
        // A C# 14 extension block's members are extension members too: an expression-bodied property, a property with
        // an accessor body, and a tuple-returning method on a tuple receiver.
        "Common/Lists/ListRules.cs": "namespace Acme.Common.Lists;\npublic static class ListRules\n{\n    extension(System.Collections.Generic.List<int> list)\n    {\n" +
            "        public bool Empty => list.Count == 0;\n        public bool Blank { get => list.Count == 0; }\n    }\n}\n",
        "Common/Spans/SpanRules.cs": "namespace Acme.Common.Spans;\npublic static class SpanRules\n{\n    extension((int Low, int High) span)\n    {\n" +
            "        public (int Low, int High) Around(int width) => (span.Low - width, span.High + width);\n    }\n}\n",
        "Common/Text/TextRules.cs": "namespace Acme.Common.Text;\npublic static class TextRules { public static string Shout(this string text) => text; }\n",
        // The host's only use of FormsSetup is an extension call, which makes Limit, its body's, shared too.
        "Common/Setup/FormsSetup.cs": "namespace Acme.Common.Setup;\npublic static class FormsSetup\n{\n" +
            "    public static T AddFormsLimits<T>(this T services) { _ = new Acme.Common.Limit(1); return services; }\n}\n",
        "Common/Limit.cs": "namespace Acme.Common;\npublic sealed record Limit(int Value);\n",
        "Program.cs": "using Acme.Common.Setup;\nvar services = new object();\nservices.AddFormsLimits();\n",
        "Modules/Forms/Forms.cs": "using Acme.Common;\nusing Acme.Common.Lists;\nusing Acme.Common.Spans;\nusing Acme.Common.Text;\nnamespace Acme.Modules.Forms;\n" +
            "public sealed class Forms { public Quota? Quota { get; init; } public Limit? Limit { get; init; } public System.Type Spans => typeof(SpanRules); " +
            "public bool Check(Role role, System.Collections.Generic.List<int> items) => " +
            "role.IsAtLeast(Role.Admin) && items.Empty && \"x\".Shout() != \"\" && 3.Twice() > role.Grade() && (1, 2).Around(3).Low < 0 && StaffAccess.Allows(role); }\n",
        // Users has no using for TextRules' namespace, so its own .Shout() is not TextRules'; its Quota is an enum member.
        "Modules/Users/Users.cs": "using Acme.Common;\nusing Acme.Common.Lists;\nusing Acme.Common.Spans;\nnamespace Acme.Modules.Users;\n" +
            "public enum UsersBlocker { Quota, Other }\npublic sealed class Doubling { }\n" +
            "public sealed class Users { public bool Check(Role role, System.Collections.Generic.List<int> items, Speaker speaker) => " +
            "role.IsAtLeast(Role.Member) && items.Blank && speaker.Shout() && 3.Twice() > 0 && (1, 2).Around(3).High > 0 && StaffAccess.Allows(role); }\n" +
            "public sealed class Speaker { public bool Shout() => true; }\n",
    });
    assert.deepEqual(findings.map((finding) => finding.replace(/ — review.*/, "")), [
        "Common/Roles.cs:0\tCommon type Quota is referenced only by module Forms",
        "Common/Text/TextRules.cs:0\tCommon type TextRules is referenced only by module Forms",
    ]);
});

test("MER-BE-006 counts a port's consumers for the DTOs its signatures name, and reports a DTO beside the port that it doesn't", () => {
    const findings = scanOnFacts("MER-BE-006", {
        "Common/Ports/IRateSource.cs": "namespace Acme.Common.Ports;\npublic interface IRateSource { RateQuote Quote(); }\n" +
            "public sealed record RateQuote(decimal Value);\npublic sealed record RateDraft(decimal Value);\n",
        "Modules/Forms/Forms.cs": "namespace Acme.Modules.Forms;\npublic sealed record Forms(Acme.Common.Ports.IRateSource Source, Acme.Common.Ports.RateQuote Last, " +
            "Acme.Common.Ports.RateDraft Draft);\n",
        // Users never writes RateQuote: it receives one through var.
        "Modules/Users/Users.cs": "namespace Acme.Modules.Users;\npublic sealed class Users(Acme.Common.Ports.IRateSource source) { public decimal Rate() { var quote = source.Quote(); return quote.Value; } }\n",
    });
    assert.deepEqual(findings.map((finding) => finding.replace(/ — review.*/, "")),
        ["Common/Ports/IRateSource.cs:0\tCommon type RateDraft is referenced only by module Forms"]);
});

test("MER-BE-007 reports the domain type a port's name resolves to, not a namesake", () => {
    // good: IFormLister's FormSnapshot is the Ports namespace's own record, despite the Forms.Domain using.
    assert.equal(run("MER-BE-007", "good"), "");
    assertFindings("MER-BE-007", "bad", [["api/Common/Ports/IConfirmReader.cs:5", "Common port exposes module-owned domain type FormSnapshot"]]);
    const findings = scanOnFacts("MER-BE-007", {
        "api/Modules/Forms/Domain/FormSnapshot.cs": "namespace App.Modules.Forms.Domain;\npublic sealed record FormSnapshot(string Id);\npublic enum Status { Draft }\n",
        "api/Common/Status.cs": "namespace App.Common;\npublic enum Status { Open }\n",
        // The parent namespace's Status is Common's; the qualified FormSnapshot is the domain's, past a comment naming it.
        "api/Common/Ports/IFormReader.cs": "namespace App.Common.Ports;\n// FormSnapshot is a domain type.\npublic interface IFormReader\n{\n    Status Status();\n" +
            // A second use below is not reported: the finding sits at the first use by position.
            "    App.Modules.Forms.Domain.FormSnapshot Read();\n    void Write(App.Modules.Forms.Domain.FormSnapshot snapshot);\n}\n",
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
        "MER-BE-053", "MER-BE-054", "MER-BE-055", "MER-BE-060", "MER-BE-067"];
    // The rules that read C# facts need a real net10.0 project, restored, and one that compiles: the copied files get the
    // project their fixture has (its SDK, implicit usings and nullable setting), as a test project of their own.
    const onFacts = new Set(["MER-BE-001", "MER-BE-002", "MER-BE-003", "MER-BE-004", "MER-BE-005", "MER-BE-007", "MER-BE-009", "MER-BE-016", "MER-BE-030", "MER-BE-031", "MER-BE-067"]);
    const fixtureProject = (rule) => {
        const file = fs.readdirSync(path.join(FIXTURES, rule, "bad"), { recursive: true }).find((name) => name.endsWith(".csproj") && !/(?:^|\/)(?:obj|bin)\//.test(name));
        return fs.readFileSync(path.join(FIXTURES, rule, "bad", file), "utf8");
    };
    for (const rule of rules) {
        const files = (project) => Object.fromEntries(fs.readdirSync(path.join(FIXTURES, rule, "bad"), { recursive: true })
            .filter((file) => !/(?:^|\/)(?:obj|bin)\//.test(file) && fs.statSync(path.join(FIXTURES, rule, "bad", file)).isFile() && !file.endsWith(".csproj"))
            .map((file) => [`ArchitectureTesting/${file}`, fs.readFileSync(path.join(FIXTURES, rule, "bad", file), "utf8")])
            .concat([["ArchitectureTesting/ArchitectureTesting.csproj", project]]));
        const facts = onFacts.has(rule);
        const options = { restore: facts };
        assert.notDeepEqual(scan(rule, files(facts ? fixtureProject(rule) : '<Project Sdk="Microsoft.NET.Sdk" />\n'), undefined, options), [], rule);
        assert.deepEqual(scan(rule, files(facts ? fixtureProject(rule).replace("</PropertyGroup>", "<IsTestProject>true</IsTestProject></PropertyGroup>") :'<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup></Project>\n'), undefined, options), [], rule);
    }
});

const testProject = (references = "") => net10("<IsTestProject>true</IsTestProject>", `<ItemGroup>${references}</ItemGroup>`);

// A test beside a module's code exercises the Common type; it doesn't make that module a second owner.
test("MER-BE-006 leaves a test project under another module out of a Common type's consumers", () => {
    assert.deepEqual(scan("MER-BE-006", {
        // The production project leaves the test project's folder to the test project.
        "api/Api.csproj": net10("", '<ItemGroup><Compile Remove="Modules/Users/Specs/**" /></ItemGroup>'),
        "api/Common/Paging.cs": "namespace Acme.Common;\npublic sealed record Paging(int Page, int Size);\n",
        "api/Modules/Forms/FormsQuery.cs": "using Acme.Common;\nnamespace Acme.Modules.Forms;\npublic sealed record FormsQuery(Paging Paging);\n",
        "api/Modules/Users/Specs/Specs.csproj": testProject('<ProjectReference Include="../../../Api.csproj" />'),
        "api/Modules/Users/Specs/PagingSpecs.cs": "using Acme.Common;\nnamespace Acme.Specs;\npublic sealed class PagingSpecs { public Paging Sample { get; } = new(1, 20); }\n",
        // Build output is neither a consumer nor a candidate. A git repository, so the inventory lists obj/ at all.
        "api/Modules/Users/obj/Debug/net10.0/Users.g.cs": "namespace Acme.Modules.Users;\npublic sealed record Generated(Acme.Common.Paging Paging);\n",
        "api/Common/obj/Debug/net10.0/Stamp.g.cs": "namespace Acme.Common;\npublic sealed record Stamp(int Value);\n",
        "api/Modules/Forms/FormsStamp.cs": "namespace Acme.Modules.Forms;\npublic sealed record FormsStamp(Acme.Common.Stamp Stamp);\n",
    }, undefined, { git: true, restore: true }), ["api/Common/Paging.cs:0\tCommon type Paging is referenced only by module Forms — review ownership; move it only if Forms truly owns it"]);
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
    // good: a module's own `IServiceProvider` is not System's.
    assert.equal(run("MER-BE-009", "good"), "");
    // A declaration, a call on a value of the type (CreateOrder.cs:5), and a parameter through an alias (AliasedOrder.cs:5).
    assertFindings("MER-BE-009", "bad", [
        ["Modules/Orders/Application/AliasedOrder.cs:5", "System.IServiceProvider hides dependencies"],
        ["Modules/Orders/Application/CreateOrder.cs:3", "System.IServiceProvider hides dependencies"],
        ["Modules/Orders/Application/CreateOrder.cs:5", "System.IServiceProvider hides dependencies"],
        ["Modules/Orders/Application/CreateOrder.cs:8", "System.IServiceProvider hides dependencies"],
        ["Modules/Orders/Application/CreateOrder.cs:12", "System.IServiceProvider hides dependencies"],
    ]);
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
    // The usings, then each module type a contract names with no `Modules.` written: FormsModels.cs:5 names three,
    // FormSummary.cs:3 one, and LeakyBillingContract.cs:3 a Domain type its using brought in.
    assertFindings("MER-BE-016", "bad", [
        ["Contracts/Forms/FormsModels.cs:1", "depends on App.Modules.Forms.Domain "],
        ["Contracts/Forms/FormsModels.cs:2", "depends on App.Modules.Forms.Application "],
        ["Contracts/Forms/FormsModels.cs:3", "depends on App.Modules.Forms "],
        ["Contracts/Forms/FormsModels.cs:5", "depends on App.Modules.Forms.Domain "],
        ["Contracts/Forms/FormsModels.cs:5", "depends on App.Modules.Forms.Application "],
        ["Contracts/Forms/FormsModels.cs:5", "depends on App.Modules.Forms.FormsController "],
        ["Modules/Billing/Contracts/LeakyBillingContract.cs:1", "depends on App.Modules.Billing.Domain "],
        ["Modules/Billing/Contracts/LeakyBillingContract.cs:3", "depends on App.Modules.Billing.Domain "],
        ["Modules/Forms/Contracts/FormSummary.cs:1", "depends on App.Modules.Forms.Infrastructure "],
        ["Modules/Forms/Contracts/FormSummary.cs:3", "depends on App.Modules.Forms.Infrastructure "],
    ]);
    // A using of a module's type (an alias or a `using static`) is flagged at the directive whether or not anything uses
    // it, unless the type is in a Contracts folder; a module type whose full name holds no `Modules.<X>` is named in full.
    assert.deepEqual(scanOnFacts("MER-BE-016", {
        "Modules/Forms/Domain/Form.cs": "namespace App.Modules.Forms.Domain;\npublic sealed record Form(string Title);\n",
        "Modules/Forms/Application/FormRules.cs": "namespace App.Modules.Forms.Application;\npublic static class FormRules { public static int Limit => 1; }\n",
        "Modules/Forms/Contracts/FormSummary.cs": "namespace App.Modules.Forms.Contracts;\npublic sealed record FormSummary(string Title);\n",
        "Modules/Forms/Domain/Loose.cs": "namespace Shared;\npublic sealed record Loose(int Id);\n",
        "Contracts/Forms/Aliased.cs": "using Stored = App.Modules.Forms.Domain.Form;\nnamespace App.Contracts.Forms;\npublic sealed record Aliased(string Id);\n",
        "Contracts/Forms/Statics.cs": "using static App.Modules.Forms.Application.FormRules;\nnamespace App.Contracts.Forms;\npublic sealed record Statics(string Id);\n",
        "Contracts/Forms/Published.cs": "using Summary = App.Modules.Forms.Contracts.FormSummary;\nnamespace App.Contracts.Forms;\npublic sealed record Published(Summary Value);\n",
        "Contracts/Forms/UsesLoose.cs": "using Shared;\nnamespace App.Contracts.Forms;\npublic sealed record UsesLoose(Loose Value);\n",
        // An alias of a framework type closed over a module's type names that type too; one closed over a published type doesn't.
        "Contracts/Forms/Bag.cs": "using Bag = System.Collections.Generic.List<App.Modules.Forms.Domain.Form>;\nnamespace App.Contracts.Forms;\npublic sealed record BagHolder(string Id);\n",
        "Contracts/Forms/PublishedBag.cs": "using Bag = System.Collections.Generic.List<App.Modules.Forms.Contracts.FormSummary>;\nnamespace App.Contracts.Forms;\npublic sealed record PublishedBag(string Id);\n",
    }), [
        "Contracts/Forms/Aliased.cs:1\tpublished transport contract depends on App.Modules.Forms.Domain — contracts are closed over published or genuinely shared types",
        "Contracts/Forms/Bag.cs:1\tpublished transport contract depends on App.Modules.Forms.Domain — contracts are closed over published or genuinely shared types",
        "Contracts/Forms/Statics.cs:1\tpublished transport contract depends on App.Modules.Forms.Application — contracts are closed over published or genuinely shared types",
        "Contracts/Forms/UsesLoose.cs:3\tpublished transport contract depends on Shared.Loose — contracts are closed over published or genuinely shared types",
    ]);
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

test("MER-RV-007 flags every app-written RivetResult extension named like an adapter or returning an HTTP result, and app code whose one statement copies RivetActionResult's StatusCode or Value into a result or the response, by the type it's declared in, and leaves Rivet's own adapters, helpers that call them, filters that only read it, test code other than its namesakes, and mentions in comments, strings or attributes", () => {
    // Good: result filters that log or record the adapter's status in an app's own AuditResult/ValidationResult or
    // audit.Results, and set context.Result in a statement of their own; an attribute's typeof() on a controller
    // that calls Problem() elsewhere; another project's own `record Adapted` beside App's global alias of that name;
    // a Verification/ project whose <IsTestProject> alone makes it test code, exempt from the bridge check (its
    // RivetResult helpers may write the adapter's output to the response or build a result of their own); a
    // pattern's `{ }` that ends no member, a named argument's label, a reassigned local and a lambda parameter that
    // shadows one; and helpers and a nested reader handing back the
    // adapter's output only to a log. Also: the `new` modifier on an indexer, which constructs nothing; a call that
    // picks the overload returning no read; a block- or expression-bodied local function, a typed lambda, one of
    // several lambda parameters and a lambda's own local that shadow the local; and a local whose block ends before
    // another block or a loop declares its name again. Also: a lambda with an explicit return type and a
    // where-constrained local function whose parameter shadows the local; a where-constrained local function's
    // return, which is not its method's; a member call hidden by a local function of its name; another type's
    // namesake qualified through its parent and a property named like a sibling; the `new` modifier on a method,
    // whose block's statements stay its own; and adapter helpers whose Match arms are async or declare their return
    // type, or that hold a where-constrained local function; and a RivetActionResult or RivetResult of the app's
    // own, under another qualifier, global:: alone or an alias of one (an extension off an alias of the app's
    // RivetResult is no bridge), or bare where the app's own type of that name is in scope (declared around the
    // code, or in its namespace in another file). Also: a qualifier or a receiver whose dot ends a line, which still
    // names another type's namesake or another object's member; a helper that adapts once, reads and logs the
    // adapter's output and returns the local holding it; helpers that set a filter context's Result to the adapter's
    // output or an app's own auditContext.Result or transactionContext.Result, then return the adapter's, or that
    // set it through the local holding the adapter's output; a nested type of a type around the code, which hides a
    // top-level one of its name; Match arms under a nullable type argument; a lambda's block in a logging statement,
    // whose result is the lambda's own; the adapter's output `?? throw`; aliases named RivetActionResult and
    // RivetResult bound to another project's types, to types declared in source (Stubs/Vendor.cs), or to types
    // outside the source (Microsoft.AspNetCore's, which the facts record only as external uses); and a returned local holding the
    // adapter's output that's declared before its one write, or first or last of several in a statement.
    assert.equal(run("MER-RV-007", "good"), "");
    const output = run("MER-RV-007", "bad");
    const locations = [...output.matchAll(/^MER-RV-007\twarn\t(\S+)/gm)].map((match) => match[1]).sort();
    assert.deepEqual(locations, [
        // A bridge off RivetResult under its project's `global using` alias, and the adapter's output under the
        // project's `global using` alias of Rivet's namespace.
        "Host/HostExtensions.cs:10",
        "Host/HostExtensions.cs:4",
        // A top-level statement under the file's own alias.
        "Host/Program.cs:5",
        // A plain static helper that copies the adapter's output into an ObjectResult.
        "Modules/Common/AdapterStatus.cs:1",
        // Bridges off RivetResult written under a file's alias of it: plain, global::-qualified, and of a closed
        // generic.
        "Modules/Common/AliasedResultExtensions.cs:14",
        "Modules/Common/AliasedResultExtensions.cs:20",
        "Modules/Common/AliasedResultExtensions.cs:8",
        // Straight off a cast, in the statement that builds the result.
        "Modules/Common/CastRelay.cs:4",
        // `where T : class where U : struct` declares no type named "where".
        "Modules/Common/ConstrainedRelay.cs:2",
        // Helpers that return the adapter but set a filter's result to something else, on every arm or one.
        "Modules/Common/FilterResultExtensions.cs:14",
        "Modules/Common/FilterResultExtensions.cs:4",
        // Bridges that call the adapter and rebuild its output or hand-write the error path, and a ToResult
        // namesake returning object. The bridges' RivetActionResult casts add no third finding.
        "Modules/Common/FunctionResultExtensions.cs:1",
        "Modules/Common/FunctionResultExtensions.cs:1",
        // ToHttpResult returning IResult, and Respond returning ValueTask<HttpResults.Ok<T>>.
        "Modules/Common/HttpResultExtensions.cs:1",
        // A namespace block's alias, used in that namespace and in one nested in it.
        "Modules/Common/NestedAliases.cs:14",
        "Modules/Common/NestedAliases.cs:6",
        // Bridges off RivetResult qualified by Rivet's namespace, with and without global::.
        "Modules/Common/QualifiedResultExtensions.cs:10",
        "Modules/Common/QualifiedResultExtensions.cs:4",
        "Modules/Common/ResultExtensions.Actions.cs:1",
        "Modules/Common/ResultExtensions.cs:1",
        // A returned local reassigned after the adapter's result, assigned it only in a lambda's block or on one
        // arm of a ?:, or written again by a deconstruction (through brackets and calls in its target too); a ??
        // whose other operand is returned, held in a local or directly; and a returned field another member writes.
        "Modules/Common/ReturnedNameExtensions.cs:15",
        "Modules/Common/ReturnedNameExtensions.cs:25",
        "Modules/Common/ReturnedNameExtensions.cs:35",
        "Modules/Common/ReturnedNameExtensions.cs:4",
        "Modules/Common/ReturnedNameExtensions.cs:46",
        "Modules/Common/ReturnedNameExtensions.cs:59",
        "Modules/Common/ReturnedNameExtensions.cs:68",
        "Modules/Common/ReturnedNameExtensions.cs:74",
        // An app's own `namespace Rivet.Shims`: only `Rivet` itself is Rivet's.
        "Modules/Common/RivetNamedShim.cs:4",
        // A file's alias of another type reaches only its own namespace block: in the next one the bare name is Rivet's.
        "Modules/Common/ScopedForeignAlias.cs:17",
        // The app namespace after a `namespace Rivet { }` block; the shim itself is Rivet's.
        "Modules/Common/Shims.cs:12",
        // Helpers that return the adapter on every path but write its output to the response, read bare, under an
        // alias, through a property pattern's binding, in an interpolated string's hole or through an extension
        // helper.
        "Modules/Common/StatusWriterExtensions.cs:18",
        "Modules/Common/StatusWriterExtensions.cs:29",
        "Modules/Common/StatusWriterExtensions.cs:39",
        "Modules/Common/StatusWriterExtensions.cs:50",
        "Modules/Common/StatusWriterExtensions.cs:7",
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
        // A declaration after `case 1:`, a `when` with a ?: of its own, a property pattern's label, a type pattern
        // with a nullable type argument and `default:`.
        "Modules/Orders/CaseLabels.cs:20",
        "Modules/Orders/CaseLabels.cs:36",
        "Modules/Orders/CaseLabels.cs:4",
        "Modules/Orders/CaseLabels.cs:52",
        "Modules/Orders/CaseLabels.cs:68",
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
        // A result built around a lambda's block, the read after the block: an expression body and a `return`.
        "Modules/Orders/LambdaArgumentResult.cs:10",
        "Modules/Orders/LambdaArgumentResult.cs:4",
        // Copied through a local, then built into a result.
        "Modules/Orders/LocalCopyFilter.cs:4",
        // An overload picked by its argument count (an interpolated string's alignment comma isn't one), and a
        // member's local function, returning a read.
        "Modules/Orders/MemberHelpers.cs:14",
        "Modules/Orders/MemberHelpers.cs:24",
        "Modules/Orders/MemberHelpers.cs:4",
        // A namesake written under a qualifier says nothing about the bare name beside it, which is still Rivet's.
        "Modules/Orders/MixedQualifiers.cs:11",
        // The adapter's output under a file's alias of Rivet's namespace, and a bridge off RivetResult qualified by
        // it through `::`.
        "Modules/Orders/NamespaceAliasRelay.cs:12",
        "Modules/Orders/NamespaceAliasRelay.cs:6",
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
        // The bare names under `using Rivet;`, where Billing's own RivetActionResult is out of scope and Tools'
        // global-namespace namesakes are in a project App doesn't reference: a copy and a bridge.
        "Modules/Orders/OutOfScopeNamesake.cs:13",
        "Modules/Orders/OutOfScopeNamesake.cs:7",
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
        // A nested reader called from its sibling, which the type around both declares.
        "Modules/Orders/SiblingNestedReader.cs:11",
        // A sibling type's helper that returns a read: static, bare, after a suffix of its namespace or after
        // global::; through an instance constructed in place or handed in; and in a ?:'s arm.
        "Modules/Orders/SiblingReader.cs:15",
        "Modules/Orders/SiblingReader.cs:21",
        "Modules/Orders/SiblingReader.cs:32",
        "Modules/Orders/SiblingReader.cs:38",
        "Modules/Orders/SiblingReader.cs:44",
        "Modules/Orders/SiblingReader.cs:9",
        // A spread's `..`, which is no member access: of a local, a member call, a sibling's static helper and a
        // nested reader bound to a name.
        "Modules/Orders/SpreadRelay.cs:14",
        "Modules/Orders/SpreadRelay.cs:29",
        "Modules/Orders/SpreadRelay.cs:35",
        "Modules/Orders/SpreadRelay.cs:4",
        // A struct-only file: once, at the struct.
        "Modules/Orders/StatusCopy.cs:4",
        // An expression-bodied helper that returns a read.
        "Modules/Orders/StatusHelper.cs:4",
        // A target-typed `new(…)` declared as an ObjectResult, and one returned by a method declared to return one,
        // a Task of one, a global::-qualified one or a conversion operator to one (global::-qualified too).
        "Modules/Orders/TargetTypedRelay.cs:14",
        "Modules/Orders/TargetTypedRelay.cs:23",
        "Modules/Orders/TargetTypedRelay.cs:33",
        "Modules/Orders/TargetTypedRelay.cs:39",
        "Modules/Orders/TargetTypedRelay.cs:4",
        "Modules/Orders/TargetTypedRelay.cs:49",
        // A typed Results<…> union, spaces in its generics.
        "Modules/Orders/TypedResultExtensions.cs:1",
        // A local reassigned from itself (after a lambda's block in its arguments or in an initializer's braces too),
        // assigned only on a condition (in an if's braces or after else), and redeclared only inside a lambda; and a
        // lambda's own local read from the adapter after the outer one, read off a cast, is followed.
        "Modules/Orders/WindowEnds.cs:106",
        "Modules/Orders/WindowEnds.cs:18",
        "Modules/Orders/WindowEnds.cs:34",
        "Modules/Orders/WindowEnds.cs:4",
        "Modules/Orders/WindowEnds.cs:46",
        "Modules/Orders/WindowEnds.cs:64",
        "Modules/Orders/WindowEnds.cs:77",
        "Modules/Orders/WindowEnds.cs:91",
        // A top-level statement in Program.cs, at its own line, one calling a top-level local function that returns
        // a read, one calling a static helper of a type in the same file and one calling an instance's.
        "Program.cs:3",
        "Program.cs:4",
        "Program.cs:5",
        "Program.cs:6",
        // The adapter's output under the project's .csproj <Using> alias of Rivet's namespace, and a bridge off
        // RivetResult under its alias of that.
        "Relay/RelayTerminalExtensions.cs:10",
        "Relay/RelayTerminalExtensions.cs:4",
        // The adapter's output under an alias only its own project's .csproj <Using> declares.
        "Relay/WrappedRelay.cs:4",
        // A ToResult namesake in test code: no bridge there, but it still shadows Rivet's adapter.
        "Verification/TestNamesakes.cs:4",
    ]);
    const copies = [...output.matchAll(/^MER-RV-007\twarn\t(\S+)\t(.+?) copies the StatusCode or Value of RivetActionResult/gm)].map((match) => `${match[1]} ${match[2]}`).sort();
    assert.deepEqual(copies, [
        "Host/HostExtensions.cs:10 NamespaceAliasedHostRelay",
        "Host/Program.cs:5 This line",
        "Modules/Common/AdapterStatus.cs:1 AdapterStatus",
        "Modules/Common/CastRelay.cs:4 CastRelay",
        "Modules/Common/ConstrainedRelay.cs:2 ConstrainedRelay",
        "Modules/Common/NestedAliases.cs:14 InnerCopy",
        "Modules/Common/NestedAliases.cs:6 OuterCopy",
        "Modules/Common/RivetNamedShim.cs:4 Adapted",
        "Modules/Common/ScopedForeignAlias.cs:17 PlainSend",
        "Modules/Common/Shims.cs:12 Leak",
        "Modules/Common/WrapperRecord.cs:9 Wrapper",
        "Modules/Orders/AccessorStatus.cs:4 AccessorStatus",
        "Modules/Orders/AliasedRelay.cs:6 AliasedRelay",
        "Modules/Orders/AnonymousRelay.cs:4 AnonymousRelay",
        "Modules/Orders/AssignedStatus.cs:4 AssignedStatus",
        "Modules/Orders/BodyHelper.cs:4 BodyHelper",
        "Modules/Orders/BridgeThenStruct.cs:7 Relay",
        "Modules/Orders/CaseLabels.cs:20 GuardedLabelStatus",
        "Modules/Orders/CaseLabels.cs:36 PatternLabelStatus",
        "Modules/Orders/CaseLabels.cs:4 CaseLabelStatus",
        "Modules/Orders/CaseLabels.cs:52 NullableLabelStatus",
        "Modules/Orders/CaseLabels.cs:68 DefaultLabelStatus",
        "Modules/Orders/ConstructedAdapter.cs:4 ConstructedAdapter",
        "Modules/Orders/DerivedRelays.cs:21 EnvelopeFilter",
        "Modules/Orders/DerivedRelays.cs:33 LocalResponseFilter",
        "Modules/Orders/DerivedRelays.cs:6 DerivedRelayController",
        "Modules/Orders/GenericPattern.cs:4 GenericPattern",
        "Modules/Orders/GuardedArm.cs:4 GuardedArm",
        "Modules/Orders/HeldRelay.cs:4 HeldRelay",
        "Modules/Orders/LambdaArgumentResult.cs:10 LambdaArgumentReturn",
        "Modules/Orders/LambdaArgumentResult.cs:4 LambdaArgumentJson",
        "Modules/Orders/LocalCopyFilter.cs:4 LocalCopyFilter",
        "Modules/Orders/MemberHelpers.cs:14 PickedOverloadStatus",
        "Modules/Orders/MemberHelpers.cs:24 AlignedOverloadStatus",
        "Modules/Orders/MemberHelpers.cs:4 MemberLocalStatus",
        "Modules/Orders/MixedQualifiers.cs:11 MixedQualifiers",
        "Modules/Orders/NamespaceAliasRelay.cs:6 NamespaceAliasRelay",
        "Modules/Orders/NestedReader.cs:15 NestedLocalReader",
        "Modules/Orders/NestedReader.cs:4 NestedReader",
        "Modules/Orders/NestedReaders.cs:15 CastNestedReader",
        "Modules/Orders/NestedReaders.cs:26 FieldNestedReader",
        "Modules/Orders/NestedReaders.cs:39 GrandchildReader",
        "Modules/Orders/NestedReaders.cs:4 StaticNestedReader",
        "Modules/Orders/NonLastLambda.cs:6 NonLastLambda",
        "Modules/Orders/OutOfScopeNamesake.cs:7 OutOfScopeNamesake",
        "Modules/Orders/OuterRelay.cs:3 OuterRelay",
        "Modules/Orders/PatternRelay.cs:4 PatternRelay",
        "Modules/Orders/PropertyHelper.cs:12 InitializedProperty",
        "Modules/Orders/PropertyHelper.cs:4 PropertyHelper",
        "Modules/Orders/RelayController.cs:4 RelayController",
        "Modules/Orders/ResponseWritingFilter.cs:4 ResponseWritingFilter",
        "Modules/Orders/ResultStatusFilter.cs:4 ResultStatusFilter",
        "Modules/Orders/SiblingNestedReader.cs:11 Inner",
        "Modules/Orders/SiblingReader.cs:15 NamespacedSiblingReader",
        "Modules/Orders/SiblingReader.cs:21 GlobalSiblingReader",
        "Modules/Orders/SiblingReader.cs:32 SiblingInstanceReader",
        "Modules/Orders/SiblingReader.cs:38 InjectedSiblingReader",
        "Modules/Orders/SiblingReader.cs:44 ConditionalSiblingReader",
        "Modules/Orders/SiblingReader.cs:9 SiblingReader",
        "Modules/Orders/SpreadRelay.cs:14 SpreadMemberRelay",
        "Modules/Orders/SpreadRelay.cs:29 SpreadStaticRelay",
        "Modules/Orders/SpreadRelay.cs:35 SpreadBoundRelay",
        "Modules/Orders/SpreadRelay.cs:4 SpreadLocalRelay",
        "Modules/Orders/StatusCopy.cs:4 StatusCopy",
        "Modules/Orders/StatusHelper.cs:4 StatusHelper",
        "Modules/Orders/TargetTypedRelay.cs:14 TargetTypedReturn",
        "Modules/Orders/TargetTypedRelay.cs:23 TargetTypedAsync",
        "Modules/Orders/TargetTypedRelay.cs:33 TargetTypedGlobal",
        "Modules/Orders/TargetTypedRelay.cs:39 AdaptedEnvelope",
        "Modules/Orders/TargetTypedRelay.cs:4 TargetTypedLocal",
        "Modules/Orders/TargetTypedRelay.cs:49 QualifiedAdaptedEnvelope",
        "Modules/Orders/WindowEnds.cs:106 CastFirstLambdaStatus",
        "Modules/Orders/WindowEnds.cs:18 ConditionalStatus",
        "Modules/Orders/WindowEnds.cs:34 LambdaLocalStatus",
        "Modules/Orders/WindowEnds.cs:4 ClampedStatus",
        "Modules/Orders/WindowEnds.cs:46 LambdaArgumentStatus",
        "Modules/Orders/WindowEnds.cs:64 InitializerLambdaStatus",
        "Modules/Orders/WindowEnds.cs:77 BracedConditionStatus",
        "Modules/Orders/WindowEnds.cs:91 ElseStatus",
        "Program.cs:3 This line",
        "Program.cs:4 This line",
        "Program.cs:5 This line",
        "Program.cs:6 This line",
        "Relay/RelayTerminalExtensions.cs:10 NamespaceAliasedRelay",
        "Relay/WrappedRelay.cs:4 WrappedRelay",
    ]);
    assert.match(output, /FunctionResultExtensions\.cs:1\tFunctionResultExtensions hand-writes an HTTP-result bridge off RivetResult \(ToResponse, Rebuild, ToHttp, OneArm\)/);
    assert.match(output, /FunctionResultExtensions\.cs:1\tFunctionResultExtensions declares its own ToResult off RivetResult, so a handler's call may bind to it instead of Rivet's first-party adapter — rename or delete it\trules\/rivet\/return-responses-through-rivets-terminals\.md$/m);
    assert.match(output, /AdapterStatus\.cs:1\tAdapterStatus copies the StatusCode or Value of RivetActionResult, the output of Rivet's \.ToActionResult\(\) adapter, into an HTTP result or response of its own — a hand-written bridge; return \.ToResult\(\)\/\.ToActionResult\(\) directly \(in a filter, let Rivet write the response\), and at most read its StatusCode or Value\trules\/rivet\/return-responses-through-rivets-terminals\.md$/m);
    assert.match(output, /AliasedResultExtensions\.cs:8\tAliasedResultExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /BridgeThenStruct\.cs:1\tStructBridgeExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /StatusWriterExtensions\.cs:7\tStatusWriterExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /StatusWriterExtensions\.cs:18\tAliasedStatusWriterExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /StatusWriterExtensions\.cs:29\tPatternStatusWriterExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /StatusWriterExtensions\.cs:39\tInterpolatedValueWriterExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /StatusWriterExtensions\.cs:50\tHelperStatusWriterExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /OutOfScopeNamesake\.cs:13\tOutOfScopeBridge hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /NamespaceAliasRelay\.cs:12\tNamespaceAliasExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /QualifiedResultExtensions\.cs:4\tQualifiedResultExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /QualifiedResultExtensions\.cs:10\tGlobalQualifiedResultExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /RelayTerminalExtensions\.cs:4\tRelayTerminalExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /HostExtensions\.cs:4\tHostTerminalExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
    assert.match(output, /TestNamesakes\.cs:4\tTestNamesakes declares its own ToResult off RivetResult, so a handler's call may bind to it instead of Rivet's first-party adapter — rename or delete it\trules\/rivet\/return-responses-through-rivets-terminals\.md$/m);
    assert.match(output, /HttpResultExtensions\.cs:1\tHttpResultExtensions hand-writes an HTTP-result bridge off RivetResult \(ToHttpResult, Respond\) — delete it and use Rivet's first-party \.ToResult\(\)\/\.ToActionResult\(\) adapters\trules\/rivet\/return-responses-through-rivets-terminals\.md$/m);
});

// `RivetResult<T>` binds as `Rivet.RivetResult`1`: Rivet's own type, even when the repo declares it in its source.
test("MER-RV-007 reads a generic RivetResult<T> declared in the repo as Rivet's, not the app's own", () => {
    const findings = scan("MER-RV-007", {
        "App.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><OutputType>Library</OutputType></PropertyGroup></Project>\n',
        "Rivet/RivetResult.cs": "namespace Rivet { public class RivetResult<T> { } }\n",
        "App/Bridge.cs": "using Microsoft.AspNetCore.Mvc;\nusing Rivet;\n\nnamespace App;\n\npublic static class Bridge\n{\n" +
            "    public static IActionResult ToActionResult<T>(this RivetResult<T> result) => new OkResult();\n}\n",
    }, undefined, { restore: true });
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /^App\/Bridge\.cs:6\tBridge hand-writes an HTTP-result bridge off RivetResult \(ToActionResult\)/);
});

// A type of the app hides Rivet's only at its own arity: a name with type arguments looks up only types of that arity.
// The compiler lists no use of a type's name inside its own declaration, so the type judged is what marks the bare name.
const SAME_NAME_PROJECT = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><OutputType>Library</OutputType></PropertyGroup></Project>\n';
test("MER-RV-007 reads Rivet's generic RivetResult<T> as Rivet's inside a non-generic app type of that name", () => {
    const bridge = scan("MER-RV-007", {
        "App.csproj": SAME_NAME_PROJECT,
        "Rivet/RivetResult.cs": "namespace Rivet { public class RivetResult<T> { } }\n",
        "App/RivetResult.cs": "using Microsoft.AspNetCore.Mvc;\nusing Rivet;\n\nnamespace App;\n\npublic static class RivetResult\n{\n" +
            "    public static IActionResult ToActionResult<T>(this RivetResult<T> result) => new OkResult();\n}\n",
    }, undefined, { restore: true });
    assert.equal(bridge.length, 1, bridge.join("\n"));
    assert.match(bridge[0], /^App\/RivetResult\.cs:6\tRivetResult hand-writes an HTTP-result bridge off RivetResult \(ToActionResult\)/);
});

test("MER-RV-007 reads Rivet's non-generic RivetActionResult as Rivet's inside a generic app type of that name", () => {
    const copy = scan("MER-RV-007", {
        "App.csproj": SAME_NAME_PROJECT,
        "Rivet/RivetActionResult.cs": "namespace Rivet { public sealed class RivetActionResult { public int StatusCode { get; } public object? Value { get; } } }\n",
        "App/RivetActionResult.cs": "using Microsoft.AspNetCore.Mvc;\nusing Rivet;\n\nnamespace App;\n\npublic sealed class RivetActionResult<T>\n{\n" +
            "    public IActionResult Send(RivetActionResult adapted) => new ObjectResult(adapted.Value) { StatusCode = adapted.StatusCode };\n}\n",
    }, undefined, { restore: true });
    assert.equal(copy.length, 1, copy.join("\n"));
    assert.match(copy[0], /^App\/RivetActionResult\.cs:6\tRivetActionResult copies the StatusCode or Value of RivetActionResult/);
});

// The same holds for a name the code writes and for an alias: an app type written bare binds the non-generic name only,
// and a using alias is found only for a name without type arguments, so Rivet's RivetResult<T> stays Rivet's.
test("MER-RV-007 reads Rivet's generic RivetResult<T> as Rivet's beside a bare use of the app's non-generic RivetResult", () => {
    const bridge = scan("MER-RV-007", {
        "App.csproj": SAME_NAME_PROJECT,
        "Rivet/RivetResult.cs": "namespace Rivet { public class RivetResult<T> { } }\n",
        "App/RivetResult.cs": "namespace App { public class RivetResult { } }\n",
        "App/Web/Bridges.cs": "using Microsoft.AspNetCore.Mvc;\nusing Rivet;\n\nnamespace App.Web;\n\npublic static class Bridges\n{\n" +
            "    public static IActionResult ToHttp<T>(this RivetResult<T> result, RivetResult legacy) => new OkResult();\n}\n",
    }, undefined, { restore: true });
    assert.equal(bridge.length, 1, bridge.join("\n"));
    assert.match(bridge[0], /^App\/Web\/Bridges\.cs:6\tBridges hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
});

test("MER-RV-007 reads Rivet's non-generic RivetActionResult as Rivet's beside a bare use of the app's generic RivetActionResult<T>", () => {
    const copy = scan("MER-RV-007", {
        "App.csproj": SAME_NAME_PROJECT,
        "Rivet/RivetActionResult.cs": "namespace Rivet { public sealed class RivetActionResult { public int StatusCode { get; } public object? Value { get; } } }\n",
        "App/RivetActionResult.cs": "namespace App { public sealed class RivetActionResult<T> { } }\n",
        "App/Web/Relay.cs": "using Microsoft.AspNetCore.Mvc;\nusing Rivet;\n\nnamespace App.Web;\n\npublic sealed class Relay\n{\n" +
            "    public IActionResult Send(RivetActionResult adapted, RivetActionResult<int> mine) => new ObjectResult(adapted.Value) { StatusCode = adapted.StatusCode };\n}\n",
    }, undefined, { restore: true });
    assert.equal(copy.length, 1, copy.join("\n"));
    assert.match(copy[0], /^App\/Web\/Relay\.cs:6\tRelay copies the StatusCode or Value of RivetActionResult/);
});

test("MER-RV-007 reads Rivet's generic RivetResult<T> as Rivet's beside a using alias named RivetResult", () => {
    const bridge = scan("MER-RV-007", {
        "App.csproj": SAME_NAME_PROJECT,
        "Rivet/RivetResult.cs": "namespace Rivet { public class RivetResult<T> { } }\n",
        "App/Bridges.cs": "using Microsoft.AspNetCore.Mvc;\nusing Rivet;\nusing RivetResult = System.Text.StringBuilder;\n\nnamespace App;\n\npublic static class Bridges\n{\n" +
            "    public static IActionResult ToHttp<T>(this RivetResult<T> result, RivetResult log) => new OkResult();\n}\n",
    }, undefined, { restore: true });
    assert.equal(bridge.length, 1, bridge.join("\n"));
    assert.match(bridge[0], /^App\/Bridges\.cs:7\tBridges hand-writes an HTTP-result bridge off RivetResult \(ToHttp\)/);
});

// A project whose Compile item puts bin/ files in its facts: a git repository lists bin/ at all, and the explicit
// Compile item compiles the file. Build output isn't the app's code, so a rule that judges files skips it.
const compiledBin = (using = "") => '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><OutputType>Library</OutputType></PropertyGroup>' +
    `<ItemGroup>${using}<Compile Include="bin/**/*.cs" /></ItemGroup></Project>\n`;

test("MER-RV-007 leaves a bridge in a bin/ folder alone, and reports the same bridge outside it", () => {
    const copy = (name) => "using Microsoft.AspNetCore.Mvc;\nusing Rivet;\n\nnamespace App;\n\n" +
        `public static class ${name}\n{\n    public static IActionResult Send(RivetActionResult adapted) => new ObjectResult(adapted.Value) { StatusCode = adapted.StatusCode };\n}\n`;
    const findings = scan("MER-RV-007", {
        "App.csproj": compiledBin(),
        "Rivet/RivetActionResult.cs": "namespace Rivet { public sealed class RivetActionResult { public int StatusCode { get; } public object? Value { get; } } }\n",
        "Relay/Copy.cs": copy("Copy"),
        "bin/Debug/BinCopy.cs": copy("BinCopy"),
    }, undefined, { git: true, restore: true });
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /^Relay\/Copy\.cs:6\tCopy copies the StatusCode or Value of RivetActionResult/);
});

// The skip is for judged files only: a global alias in a compiled bin/ file is a compiler fact that applies to the
// whole project, so a bridge written through it is still read as Rivet's.
test("MER-RV-007 reads a global alias in a bin/ folder as the compiler does", () => {
    const findings = scan("MER-RV-007", {
        "App.csproj": compiledBin(),
        "Rivet/RivetActionResult.cs": "namespace Rivet { public sealed class RivetActionResult { public int StatusCode { get; } public object? Value { get; } } }\n",
        "bin/Debug/Aliases.cs": "global using Adapted = Rivet.RivetActionResult;\n",
        "Relay/Copy.cs": "using Microsoft.AspNetCore.Mvc;\n\nnamespace App;\n\npublic static class Copy\n{\n    public static IActionResult Send(Adapted adapted) => new ObjectResult(adapted.Value) { StatusCode = adapted.StatusCode };\n}\n",
    }, undefined, { git: true, restore: true });
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /^Relay\/Copy\.cs:5\tCopy copies the StatusCode or Value of /);
});

test("MER-RV-003 leaves a const-route handler in a bin/ folder alone, and reports the same handler outside it", () => {
    const controller = (name) => `namespace App;\n\npublic sealed class ${name}Controller : ControllerBase\n{\n    [HttpGet(OrdersContract.GetRoute)]\n    public IActionResult Get(Guid id) => Ok(id);\n}\n`;
    const findings = scan("MER-RV-003", {
        "App.csproj": compiledBin('<Using Include="Microsoft.AspNetCore.Mvc" />'),
        ...rivetStubs(),
        "Contracts/Orders/OrdersContract.cs": 'namespace App;\n\npublic sealed record OrderDto;\n\n[RivetContract]\npublic static class OrdersContract\n{\n    public const string GetRoute = "/api/orders/{id}";\n\n    public static readonly RouteDefinition<OrderDto> Get = Define.Get<OrderDto>(GetRoute);\n}\n',
        "Modules/Orders/OrdersController.cs": controller("Orders"),
        "bin/Debug/BinOrdersController.cs": controller("BinOrders"),
    }, undefined, { git: true, restore: true });
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /^Modules\/Orders\/OrdersController\.cs:5\thandler route references OrdersContract\.GetRoute/);
});

test("MER-RV-011 leaves a transport contract in a bin/ folder alone, and reports the same contract outside it", () => {
    const contract = (name, payload) => `namespace App.Contracts.Orders;\n\n[RivetContract]\npublic static class ${name}\n{\n    public static readonly RouteDefinition<${payload}> Get = Define.Get<${payload}>("/api/${payload}");\n}\n`;
    const findings = scan("MER-RV-011", {
        "App.csproj": compiledBin(),
        ...rivetStubs(),
        "Contracts/Orders/OrdersContract.cs": contract("OrdersContract", "Line"),
        "bin/Debug/Contracts/Orders/BinContract.cs": contract("BinContract", "BinLine"),
        "Modules/Billing/Line.cs": "namespace App.Contracts.Orders;\n\npublic sealed record Line;\n",
        // A Modules folder under bin/ makes bin/Debug a backend root, so the contract there is a transport contract.
        "bin/Debug/Modules/Billing/BinLine.cs": "namespace App.Contracts.Orders;\n\npublic sealed record BinLine;\n",
    }, undefined, { git: true, restore: true });
    assert.deepEqual(findings, ["Contracts/Orders/OrdersContract.cs:6\troute payload Line is owned by Modules/Billing/Line.cs — define it in Contracts/Orders/"]);
});

// A global using static in a compiled bin/ file imports the type's members project-wide, so the host consumes the
// type, as the compiler sees it; the file isn't judged, but its directive is a fact.
test("MER-BE-006 counts a global using static in a bin/ folder as the host using the type", () => {
    const files = {
        "App.csproj": compiledBin(),
        "Common/Gauge.cs": "namespace Acme.Common;\npublic static class Gauge { public static int Reading => 0; }\n",
        "Modules/Forms/Forms.cs": "using Acme.Common;\nnamespace Acme.Modules.Forms;\npublic sealed class Forms { public int Level => Gauge.Reading; }\n",
    };
    const findingsOf = (extra) => scan("MER-BE-006", { ...files, ...extra }, undefined, { git: true, restore: true }).map((finding) => finding.replace(/ — review.*/, ""));
    assert.deepEqual(findingsOf({}), ["Common/Gauge.cs:0\tCommon type Gauge is referenced only by module Forms"]);
    assert.deepEqual(findingsOf({ "bin/Debug/Globals.cs": "global using static Acme.Common.Gauge;\n" }), []);
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

test("MER-TE-001 evaluates each modular project and accepts a Taskfile that runs plumb", () => {
    assert.equal(run("MER-TE-001", "good"), "");
    const output = run("MER-TE-001", "bad");
    assert.equal((output.match(/^MER-TE-001\t/gm) || []).length, 2);
    assert.match(output, /^MER-TE-001\t.*\tUnenforced\/Unenforced\.csproj:1\t/m);
    assert.match(output, /^MER-TE-001\t.*\tApp\.csproj:1\t/m);
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
        // The file's own namespace brings OrderDto in: a use with no using.
        ["api/Modules/Orders/Application/OrderDtoExtensions.cs:5", "module Orders Application uses App.Contracts.Orders.OrderDto, the API's transport contract — map at the edge"],
        // A using is one finding, and each line that uses a type it brought in is another.
        ["api/Modules/Orders/Application/PlaceOrder/PlaceOrderUseCase.cs:1", "module Orders Application uses App.Contracts.Orders, the API's transport contract — map at the edge"],
        ["api/Modules/Orders/Application/PlaceOrder/PlaceOrderUseCase.cs:8", "module Orders Application uses App.Contracts.Orders.OrderDto, the API's transport contract — map at the edge"],
        ["api/Modules/Orders/Application/PlaceOrder/PlaceOrderUseCase.cs:9", "module Orders Application uses App.Contracts.Orders.OrderDto, the API's transport contract — map at the edge"],
        // A dependency inside a method body, with no using and no transport namespace on the line: the mapper comes
        // in through the project's global using, the wire type through `var`, and the next line reads its member.
        ["api/Modules/Orders/Application/DescribeOrder/DescribeOrderUseCase.cs:11", "module Orders Application uses App.Contracts.Orders.OrderTransportMapper, the API's transport contract — map at the edge"],
        ["api/Modules/Orders/Application/DescribeOrder/DescribeOrderUseCase.cs:11", "module Orders Application uses App.Contracts.Orders.OrderDto, the API's transport contract — map at the edge"],
        ["api/Modules/Orders/Application/DescribeOrder/DescribeOrderUseCase.cs:12", "module Orders Application uses App.Contracts.Orders.OrderDto, the API's transport contract — map at the edge"],
        ["api/Modules/Orders/Domain/Order.cs:5", "module Orders Domain uses App.Contracts.Orders.OrderDto, the API's transport contract — map at the edge"],
        // Infrastructure returning transport DTOs: no legal caller can use them.
        ["api/Modules/Orders/Infrastructure/OrderReader.cs:1", "module Orders Infrastructure uses App.Contracts.Orders, the API's transport contract — map at the edge"],
        ["api/Modules/Orders/Infrastructure/OrderReader.cs:9", "module Orders Infrastructure uses App.Contracts.Orders.OrderDto, the API's transport contract — map at the edge"],
        ["api/Modules/Orders/Infrastructure/OrderReader.cs:10", "module Orders Infrastructure uses App.Contracts.Orders.OrderDto, the API's transport contract — map at the edge"],
        // Global usings (C# and MSBuild) put the transport contract in scope everywhere; System.* and comments are ignored.
        ["api/GlobalUsings.cs:2", "global using App.Contracts.Orders puts the API's transport contract in scope in every file of the project, modules included — remove it and add a file-level using in a controller, endpoint, request validator or transport mapper at the module root or under Contracts/ that needs it"],
        ["api/GlobalUsings.cs:3", "global using Wire = App.Contracts.Orders.OrderDto puts the API's transport contract in scope"],
        ["api/Api.csproj:11", "<Using Include=\"App.Contracts.Orders\"> puts the API's transport contract in scope"],
    ]);
});

test("MER-BE-066 reports each layer of a module that uses a type at the module's own root, by using or by use", () => {
    assert.equal(run("MER-BE-066", "good"), "");
    const root = (layer, type) => `module Forms ${layer} must not use App.Modules.Forms.${type}, a type at the module's root — the root calls into the layers; move what ${layer} needs into a layer`;
    assertFindings("MER-BE-066", "bad", [
        // A dependency inside a method body, with no using: the root's namespace encloses the layer's.
        ["Modules/Forms/Application/CreateForm/CreateFormUseCase.cs:8", root("Application", "FormsRequestValidators")],
        ["Modules/Forms/Contracts/FormList.cs:3", root("Contracts", "FormsPage")],
        // A using static names the type, and the member it brings in is a use of it.
        ["Modules/Forms/Domain/Form.cs:1", root("Domain", "FormsRequestValidators")],
        ["Modules/Forms/Domain/Form.cs:7", root("Domain", "FormsRequestValidators")],
        ["Modules/Forms/Infrastructure/FormConfiguration.cs:5", root("Infrastructure", "FormsRequestValidators")],
    ]);
});

test("MER-BE-066 judges what the compiler binds, and leaves the root, a sibling module, a type with a part in a layer, and test code alone", () => {
    const findings = scan("MER-BE-066", {
        "api/Api.csproj": net10(),
        "api/Modules/Forms/FormsOptions.cs": "namespace App.Modules.Forms;\npublic sealed record FormsOptions(int Limit);\n",
        // Host code that hands the root type out; it is no module's file.
        "api/Host/FormsWiring.cs": "namespace App.Host;\npublic static class FormsWiring { public static App.Modules.Forms.FormsOptions Current() => new(1); }\n",
        // No line here names the root type: it arrives through `var`.
        "api/Modules/Forms/Application/Inferred.cs": "namespace App.Modules.Forms.Application;\npublic sealed class Inferred\n{\n    public int Limit()\n    {\n        var options = App.Host.FormsWiring.Current();\n        return options.Limit;\n    }\n}\n",
        // A type inside an alias's type arguments.
        "api/Modules/Forms/Infrastructure/Aliased.cs": "using Bag = System.Collections.Generic.List<App.Modules.Forms.FormsOptions>;\nnamespace App.Modules.Forms.Infrastructure;\npublic sealed class Aliased { }\n",
        // A using of the root's namespace brings in nothing the enclosing namespace doesn't.
        "api/Modules/Forms/Domain/Imports.cs": "using App.Modules.Forms;\nnamespace App.Modules.Forms.Domain;\npublic sealed class Imports { }\n",
        // The root uses its neighbours and the layers.
        "api/Modules/Forms/FormsController.cs": "namespace App.Modules.Forms;\npublic sealed class FormsController { public FormsOptions Options() => new(new Application.Inferred().Limit()); }\n",
        // Another module's root is MER-BE-005's.
        "api/Modules/Billing/Application/Sibling.cs": "namespace App.Modules.Billing.Application;\npublic sealed class Sibling { public App.Modules.Forms.FormsOptions? Options { get; set; } }\n",
        // A partial type with a part in a layer is no root type.
        "api/Modules/Forms/FormsShared.cs": "namespace App.Modules.Forms;\npublic static partial class FormsShared { }\n",
        "api/Modules/Forms/Domain/FormsShared.cs": "namespace App.Modules.Forms;\npublic static partial class FormsShared { public const int Max = 1; }\n",
        "api/Modules/Forms/Domain/UsesShared.cs": "namespace App.Modules.Forms.Domain;\npublic sealed class UsesShared { public int Max => FormsShared.Max; }\n",
        // A test project's files are test code, whatever folders they sit in.
        "tests/Api.Tests/Api.Tests.csproj": net10("", '<ItemGroup><ProjectReference Include="../../api/Api.csproj" /></ItemGroup>'),
        "tests/Api.Tests/Modules/Forms/Application/OptionsSpec.cs": "namespace App.Tests;\npublic sealed class OptionsSpec { public App.Modules.Forms.FormsOptions? Options { get; set; } }\n",
    }, undefined, { restore: true });
    assert.deepEqual(findings.map((finding) => finding.replace(/, a type at the module's root.*/, "")).sort(), [
        "api/Modules/Forms/Application/Inferred.cs:6\tmodule Forms Application must not use App.Modules.Forms.FormsOptions",
        "api/Modules/Forms/Application/Inferred.cs:7\tmodule Forms Application must not use App.Modules.Forms.FormsOptions",
        "api/Modules/Forms/Infrastructure/Aliased.cs:1\tmodule Forms Infrastructure must not use App.Modules.Forms.FormsOptions",
    ], findings.join("\n"));
});

// The transport rules (MER-BE-030, 031, and 067) judge each use a transport class makes. The framework types the
// repositories below use are stand-ins in their real namespaces, since the rules judge a type by its full name.
const mvcStubs = {
    "api/Stubs/Mvc.cs": [
        "namespace Microsoft.AspNetCore.Mvc { public abstract class ControllerBase { } }",
        "namespace Microsoft.AspNetCore.Mvc.RazorPages { public abstract class PageModel { } }",
        "namespace Microsoft.AspNetCore.SignalR { public abstract class Hub { } }",
        "namespace Microsoft.AspNetCore.Authentication { public class RemoteAuthenticationEvents { } }",
        "namespace Microsoft.AspNetCore.Authentication.Cookies { public class CookieAuthenticationEvents { } }",
        "namespace Microsoft.AspNetCore.Authentication.JwtBearer { public class JwtBearerEvents { } }",
    ].join("\n") + "\n",
};
const persistenceStubs = {
    "api/Stubs/Persistence.cs": [
        "namespace Microsoft.EntityFrameworkCore { public class DbContext { } public static class EntityFrameworkQueryableExtensions { public static Task<List<T>> ToListAsync<T>(this IQueryable<T> source, CancellationToken cancellationToken = default) => Task.FromResult(source.ToList()); } }",
        "namespace Microsoft.EntityFrameworkCoreExtras { public sealed class Helper { } }",
        "namespace Npgsql { public sealed class NpgsqlConnection { } }",
    ].join("\n") + "\n",
};
const tail = " — a controller calls use cases only; call a use case instead";
const unTailed = (finding) => finding.replace(tail, "");

// A throwaway repo scanned for each rule in turn: its projects are restored, and `beside` holds files next to the
// repo's folder (a project it references from outside the scanned root).
function scanTransport(rules, files, beside = {}) {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-transport-"));
    const root = path.join(parent, "repo");
    try {
        for (const [base, entries] of [[parent, beside], [root, files]]) {
            for (const [file, content] of Object.entries(entries)) {
                fs.mkdirSync(path.dirname(path.join(base, file)), { recursive: true });
                fs.writeFileSync(path.join(base, file), content);
            }
        }
        restoreProjects(root);
        return Object.fromEntries(rules.map((rule) => {
            const result = spawnSync(PLUMB, [root, "--rule", rule, "--ci", "--json"], { encoding: "utf8" });
            assert.ok([0, 1].includes(result.status), result.stderr);
            return [rule, JSON.parse(result.stdout).filter((finding) => finding.rule === rule).map((finding) => `${finding.location}\t${finding.message}`)];
        }));
    } finally {
        fs.rmSync(parent, { recursive: true, force: true });
    }
}

const property = (type) => `public ${type}? Db { get; set; }`;

test("MER-BE-030 reports a controller and an events class that use a DbContext, the app's own or DbContext itself", () => {
    assert.equal(run("MER-BE-030", "good"), "");
    const context = (from, type) => `${from} must not use ${type}, a DbContext${tail}`;
    assertFindings("MER-BE-030", "bad", [
        ["Auth/FormsCookieEvents.cs:5", context("App.Auth.FormsCookieEvents", "Microsoft.EntityFrameworkCore.DbContext")],
        ["Auth/FormsCookieEvents.cs:7", context("App.Auth.FormsCookieEvents", "Microsoft.EntityFrameworkCore.DbContext")],
        ["Modules/Forms/FormsController.cs:6", context("App.Modules.Forms.FormsController", "App.Data.AppDbContext")],
        ["Modules/Forms/FormsController.cs:8", context("App.Modules.Forms.FormsController", "App.Data.AppDbContext")],
    ]);
});

// A transport class is a type of a *Controller.cs or *Endpoints.cs file (by type: a partial class's other parts too), a
// type deriving from a framework transport base, or a type nested in one. Nothing else is, whatever it uses.
test("a transport class is a *Controller.cs or *Endpoints.cs type, a framework transport base's subclass, or a type nested in one", () => {
    const { "MER-BE-030": findings } = scanTransport(["MER-BE-030"], {
        "api/App.csproj": net10("<OutputType>Exe</OutputType>"),
        ...mvcStubs,
        ...persistenceStubs,
        "api/Data/AppDbContext.cs": "namespace App.Data;\npublic sealed class AppDbContext : Microsoft.EntityFrameworkCore.DbContext { }\npublic static class Holder { public static AppDbContext Current() => new(); }\n",
        // By file name alone: no base type.
        "api/Web/FormsController.cs": `namespace App.Web;\npublic sealed class FormsController\n{\n    ${property("App.Data.AppDbContext")}\n}\n`,
        // Nested two deep in a controller.
        "api/Web/ReportsController.cs": `namespace App.Web;\npublic sealed class ReportsController\n{\n    public sealed class Row\n    {\n        public sealed class Cell\n        {\n            ${property("App.Data.AppDbContext")}\n        }\n    }\n}\n`,
        // A controller whose second part is in a file with no transport name.
        "api/Web/OrdersController.cs": "namespace App.Web;\npublic sealed partial class OrdersController { }\n",
        "api/Web/OrdersLookups.cs": `namespace App.Web;\npublic sealed partial class OrdersController\n{\n    ${property("App.Data.AppDbContext")}\n}\n`,
        // Each framework base, and a subclass of a repository type that derives from one.
        "api/Web/Handlers.cs": [
            "namespace App.Web;",
            `public sealed class ChatHub : Microsoft.AspNetCore.SignalR.Hub { ${property("App.Data.AppDbContext")} }`,
            `public sealed class IndexModel : Microsoft.AspNetCore.Mvc.RazorPages.PageModel { ${property("App.Data.AppDbContext")} }`,
            `public sealed class BearerEvents : Microsoft.AspNetCore.Authentication.JwtBearer.JwtBearerEvents { ${property("App.Data.AppDbContext")} }`,
            `public sealed class RemoteEvents : Microsoft.AspNetCore.Authentication.RemoteAuthenticationEvents { ${property("App.Data.AppDbContext")} }`,
            `public sealed class CookieEvents : Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationEvents { ${property("App.Data.AppDbContext")} }`,
            "public abstract class BaseApi : Microsoft.AspNetCore.Mvc.ControllerBase { }",
            `public sealed class ThingApi : BaseApi { ${property("App.Data.AppDbContext")} }`,
            `public sealed class Plain { ${property("App.Data.AppDbContext")} }`,
            // Types nested in a base-derived class, in a file with no transport name: only the nesting makes them transport.
            "public sealed class NestedHub : Microsoft.AspNetCore.SignalR.Hub",
            "{",
            "    public sealed class Inner",
            "    {",
            `        public sealed class Deeper { ${property("App.Data.AppDbContext")} }`,
            "    }",
            "}",
            "",
        ].join("\n"),
        // A static endpoints class, with the context reached only through `var`.
        "api/Web/StatusEndpoints.cs": "namespace App.Web;\npublic static class StatusEndpoints\n{\n    public static bool Ready()\n    {\n        var context = App.Data.Holder.Current();\n        return context is not null;\n    }\n}\n",
        // Not transport: a use case, an adapter, the host's registration, and a test project's controller.
        "api/Modules/Forms/Application/CreateForm/CreateFormUseCase.cs": `namespace App.Modules.Forms.Application.CreateForm;\npublic sealed class CreateFormUseCase { ${property("App.Data.AppDbContext")} }\n`,
        "api/Modules/Forms/Infrastructure/FormStore.cs": `namespace App.Modules.Forms.Infrastructure;\npublic sealed class FormStore { ${property("App.Data.AppDbContext")} }\n`,
        "api/Program.cs": "var context = new App.Data.AppDbContext();\nSystem.Console.WriteLine(context);\n",
        "tests/Api.Tests/Api.Tests.csproj": testProject('<ProjectReference Include="../../api/App.csproj" />'),
        // Test code, one class by file name and one by its base: neither is judged.
        "tests/Api.Tests/Web/FormsController.cs": `namespace App.Tests;\npublic sealed class FormsController { ${property("App.Data.AppDbContext")} }\npublic sealed class FakeApi : Microsoft.AspNetCore.Mvc.ControllerBase { ${property("App.Data.AppDbContext")} }\n`,
    });
    assert.deepEqual(findings.map((finding) => unTailed(finding)), [
        ["api/Web/FormsController.cs:4", "App.Web.FormsController"],
        ["api/Web/Handlers.cs:14", "App.Web.NestedHub.Inner.Deeper"],
        ["api/Web/Handlers.cs:2", "App.Web.ChatHub"],
        ["api/Web/Handlers.cs:3", "App.Web.IndexModel"],
        ["api/Web/Handlers.cs:4", "App.Web.BearerEvents"],
        ["api/Web/Handlers.cs:5", "App.Web.RemoteEvents"],
        ["api/Web/Handlers.cs:6", "App.Web.CookieEvents"],
        ["api/Web/Handlers.cs:8", "App.Web.ThingApi"],
        ["api/Web/OrdersLookups.cs:4", "App.Web.OrdersController"],
        ["api/Web/ReportsController.cs:8", "App.Web.ReportsController.Row.Cell"],
        // No line names the context but the `var`'s and the use below it.
        ["api/Web/StatusEndpoints.cs:6", "App.Web.StatusEndpoints"],
        ["api/Web/StatusEndpoints.cs:7", "App.Web.StatusEndpoints"],
    ].map(([at, from]) => `${at}\t${from} must not use App.Data.AppDbContext, a DbContext`), findings.join("\n"));
});

// A context from a project outside the scanned root, under a name no framework prefix matches, is still a DbContext.
test("MER-BE-030 follows a context declared outside the scanned root to DbContext", () => {
    const { "MER-BE-030": findings } = scanTransport(["MER-BE-030"], {
        "api/App.csproj": net10("", '<ItemGroup><ProjectReference Include="../../ctx/Ctx.csproj" /></ItemGroup>'),
        ...mvcStubs,
        "api/Web/FormsController.cs": "namespace App.Web;\npublic sealed class FormsController\n{\n    public Acme.Data.AcmeDbContext? Db { get; set; }\n    public Acme.Data.Plain? Plain { get; set; }\n}\n",
    }, {
        "ctx/Ctx.csproj": net10(),
        "ctx/Ctx.cs": "namespace Microsoft.EntityFrameworkCore { public class DbContext { } }\nnamespace Acme.Data\n{\n    public class AcmeDbContext : Microsoft.EntityFrameworkCore.DbContext { }\n    public class Plain { }\n}\n",
    });
    assert.deepEqual(findings.map((finding) => unTailed(finding)), [
        "api/Web/FormsController.cs:4\tApp.Web.FormsController must not use Acme.Data.AcmeDbContext, a DbContext",
    ], findings.join("\n"));
});

test("MER-BE-031 reports a controller and an events class that import persistence or use its types", () => {
    assert.equal(run("MER-BE-031", "good"), "");
    assertFindings("MER-BE-031", "bad", [
        ["Auth/FormsCookieEvents.cs:7", `App.Auth.FormsCookieEvents must not use Npgsql.NpgsqlConnection, from the persistence namespace Npgsql${tail}`],
        ["Modules/Forms/FormsController.cs:2", `using Microsoft.EntityFrameworkCore imports persistence into a file with a transport class${tail}`],
        ["Modules/Forms/FormsController.cs:8", `App.Modules.Forms.FormsController must not use Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions, from the persistence namespace Microsoft.EntityFrameworkCore${tail}`],
    ]);
});

test("MER-BE-031 judges the compiler's namespaces by whole segment: usings, aliases, global usings, and names reached with no using", () => {
    const { "MER-BE-031": findings } = scanTransport(["MER-BE-031"], {
        "api/App.csproj": net10("<OutputType>Exe</OutputType>"),
        ...mvcStubs,
        ...persistenceStubs,
        // A global using in a file with no transport class is no transport file's using, and it puts the extension in scope.
        "api/GlobalUsings.cs": "global using Microsoft.EntityFrameworkCore;\n",
        // An extension call through that global using, with no using in the file.
        "api/Web/RowsController.cs": "namespace App.Web;\npublic sealed class RowsController\n{\n    public Task<List<string>> Titles(IQueryable<string> titles, CancellationToken cancellationToken) => titles.ToListAsync(cancellationToken);\n}\n",
        // A fully qualified name, with no using.
        "api/Web/QualifiedEndpoints.cs": "namespace App.Web;\npublic static class QualifiedEndpoints\n{\n    public static Npgsql.NpgsqlConnection? Connection { get; set; }\n}\n",
        // Each using form: a global using, a namespace alias, a type alias, and a type alias whose argument is persistence; and a namesake namespace.
        "api/Web/UsingsController.cs": [
            "global using Npgsql;",
            "using Ef = Microsoft.EntityFrameworkCore;",
            "using Conn = Npgsql.NpgsqlConnection;",
            "using Bag = System.Collections.Generic.List<Microsoft.EntityFrameworkCore.DbContext>;",
            "using Microsoft.EntityFrameworkCoreExtras;",
            "namespace App.Web;",
            "public sealed class UsingsController { }",
            "",
        ].join("\n"),
        // A type in a namespace that only begins with a persistence namespace's name is not persistence.
        "api/Web/ExtrasController.cs": "namespace App.Web;\npublic sealed class ExtrasController\n{\n    public Microsoft.EntityFrameworkCoreExtras.Helper? Helper { get; set; }\n}\n",
        // The context is MER-BE-030's: the using is still persistence in a transport file, and the use is not reported here.
        "api/Web/ContextController.cs": "using Microsoft.EntityFrameworkCore;\nnamespace App.Web;\npublic sealed class ContextController\n{\n    public DbContext? Db { get; set; }\n}\n",
        // Not transport: an adapter, the host, and a test project's controller.
        "api/Modules/Forms/Infrastructure/FormStore.cs": "using Microsoft.EntityFrameworkCore;\nnamespace App.Modules.Forms.Infrastructure;\npublic sealed class FormStore\n{\n    public Task<List<string>> Titles(IQueryable<string> titles) => titles.ToListAsync();\n}\n",
        "api/Program.cs": "using Npgsql;\nSystem.Console.WriteLine(new NpgsqlConnection());\n",
        "tests/Api.Tests/Api.Tests.csproj": testProject('<ProjectReference Include="../../api/App.csproj" />'),
        // Test code, one class by file name and one by its base: neither is judged.
        "tests/Api.Tests/Web/FormsController.cs": "using Npgsql;\nnamespace App.Tests;\npublic sealed class FormsController\n{\n    public NpgsqlConnection? Connection { get; set; }\n}\npublic sealed class FakeApi : Microsoft.AspNetCore.Mvc.ControllerBase\n{\n    public NpgsqlConnection? Connection { get; set; }\n}\n",
    });
    assert.deepEqual(findings.map((finding) => unTailed(finding)).sort(), [
        "api/Web/ContextController.cs:1\tusing Microsoft.EntityFrameworkCore imports persistence into a file with a transport class",
        "api/Web/QualifiedEndpoints.cs:4\tApp.Web.QualifiedEndpoints must not use Npgsql.NpgsqlConnection, from the persistence namespace Npgsql",
        "api/Web/RowsController.cs:4\tApp.Web.RowsController must not use Microsoft.EntityFrameworkCore.EntityFrameworkQueryableExtensions, from the persistence namespace Microsoft.EntityFrameworkCore",
        "api/Web/UsingsController.cs:1\tglobal using Npgsql imports persistence into a file with a transport class",
        "api/Web/UsingsController.cs:2\tusing Microsoft.EntityFrameworkCore imports persistence into a file with a transport class",
        "api/Web/UsingsController.cs:3\tusing Npgsql.NpgsqlConnection imports persistence into a file with a transport class",
        "api/Web/UsingsController.cs:4\tusing Microsoft.EntityFrameworkCore.DbContext imports persistence into a file with a transport class",
    ], findings.join("\n"));
});

test("MER-BE-067 reports a controller and an events class that use a module's port or Infrastructure adapter", () => {
    assert.equal(run("MER-BE-067", "good"), "");
    const use = (from, type, what) => `${from} must not use ${type}, a module's ${what}${tail}`;
    assertFindings("MER-BE-067", "bad", [
        ["Auth/FormsCookieEvents.cs:6", use("App.Auth.FormsCookieEvents", "App.Modules.Forms.Infrastructure.FormStore", "Infrastructure adapter")],
        ["Auth/FormsCookieEvents.cs:8", use("App.Auth.FormsCookieEvents", "App.Modules.Forms.Infrastructure.FormStore", "Infrastructure adapter")],
        ["Modules/Forms/FormsController.cs:6", use("App.Modules.Forms.FormsController", "App.Modules.Forms.Application.Ports.IFormRepository", "port")],
        ["Modules/Forms/FormsController.cs:8", use("App.Modules.Forms.FormsController", "App.Modules.Forms.Application.Ports.IFormRepository", "port")],
    ]);
});

test("MER-BE-067 flags an interface under Application anywhere and an adapter, and leaves records, enums, structs, delegates, classes, and a type with a part elsewhere", () => {
    let members = 0;
    const type = (name) => `public ${name}? Member${++members} { get; set; }`;
    const { "MER-BE-067": findings } = scanTransport(["MER-BE-067"], {
        "api/App.csproj": net10("<OutputType>Exe</OutputType>"),
        ...mvcStubs,
        "api/Modules/Forms/Application/Ports/IFormRepository.cs": "namespace App.Modules.Forms.Application.Ports;\npublic interface IFormRepository { bool Any(); }\n",
        // An I...Repository interface beside the use cases, outside Ports/.
        "api/Modules/Forms/Application/IOrderRepository.cs": "namespace App.Modules.Forms.Application;\npublic interface IOrderRepository { bool Any(); }\n",
        // An interface the module's own Application implements is a query behind an interface, not a port, wherever it
        // is filed. One only another module's Application implements is still a port of this module.
        "api/Modules/Forms/Application/Ports/IFormQuery.cs": "namespace App.Modules.Forms.Application.Ports;\npublic interface IFormQuery { bool Any(); }\n",
        "api/Modules/Forms/Application/FormQuery.cs": "namespace App.Modules.Forms.Application;\npublic sealed class FormQuery : App.Modules.Forms.Application.Ports.IFormQuery { public bool Any() => true; }\n",
        "api/Modules/Forms/Application/Ports/IFormLookup.cs": "namespace App.Modules.Forms.Application.Ports;\npublic interface IFormLookup { bool Any(); }\n",
        "api/Modules/Orders/Application/OrderForms.cs": "namespace App.Modules.Orders.Application;\npublic sealed class OrderForms : App.Modules.Forms.Application.Ports.IFormLookup { public bool Any() => true; }\n",
        // A use case's inputs, outputs, and helpers: a record and an enum in Ports/, a struct, a delegate, and a class.
        "api/Modules/Forms/Application/Ports/FormFilter.cs": "namespace App.Modules.Forms.Application.Ports;\npublic sealed record FormFilter(string Title);\npublic enum FormOrder { Title }\n",
        "api/Modules/Forms/Application/Shapes.cs": "namespace App.Modules.Forms.Application;\npublic readonly struct FormKey { }\npublic delegate void FormChanged();\npublic sealed class FormHelper { }\n",
        "api/Modules/Forms/Infrastructure/FormStore.cs": "namespace App.Modules.Forms.Infrastructure;\npublic sealed class FormStore : App.Modules.Forms.Application.Ports.IFormRepository, App.Modules.Forms.Application.IOrderRepository { public bool Any() => true; }\n",
        "api/Modules/Forms/Infrastructure/Options/StoreOptions.cs": "namespace App.Modules.Forms.Infrastructure.Options;\npublic sealed class StoreOptions { }\n",
        // A partial type with one part in Infrastructure and one in the host is no adapter.
        "api/Modules/Forms/Infrastructure/FormCache.cs": "namespace App.Host;\npublic sealed partial class FormCache { }\n",
        "api/Host/FormCache.cs": "namespace App.Host;\npublic sealed partial class FormCache { }\n",
        "api/Modules/Forms/FormsController.cs": [
            "namespace App.Modules.Forms;",
            "public sealed class FormsController : Microsoft.AspNetCore.Mvc.ControllerBase",
            "{",
            `    ${type("App.Modules.Forms.Application.Ports.IFormRepository")}`,
            `    ${type("App.Modules.Forms.Application.IOrderRepository")}`,
            `    ${type("App.Modules.Forms.Infrastructure.FormStore")}`,
            `    ${type("App.Modules.Forms.Infrastructure.Options.StoreOptions")}`,
            `    ${type("App.Modules.Forms.Application.Ports.FormFilter")}`,
            "    public App.Modules.Forms.Application.Ports.FormOrder Order { get; set; }",
            "    public App.Modules.Forms.Application.FormKey Key { get; set; }",
            `    ${type("App.Modules.Forms.Application.FormChanged")}`,
            `    ${type("App.Modules.Forms.Application.FormHelper")}`,
            `    ${type("App.Host.FormCache")}`,
            `    ${type("App.Modules.Forms.Application.Ports.IFormQuery")}`,
            `    ${type("App.Modules.Forms.Application.Ports.IFormLookup")}`,
            "}",
            "",
        ].join("\n"),
        // A static endpoints class, whose lambda parameter has the port's type and no line names it.
        "api/Web/Registry.cs": "namespace App.Web;\npublic sealed class Registry { public void Add(System.Func<App.Modules.Forms.Application.Ports.IFormRepository, bool> handler) { } }\n",
        "api/Web/FormsEndpoints.cs": "namespace App.Web;\npublic static class FormsEndpoints\n{\n    public static void Map(Registry registry) => registry.Add(forms => forms.Any());\n}\n",
        // Not transport: a use case, the adapter itself, the host, and a test project's controller.
        "api/Modules/Forms/Application/CreateForm/CreateFormUseCase.cs": "namespace App.Modules.Forms.Application.CreateForm;\npublic sealed class CreateFormUseCase(App.Modules.Forms.Application.Ports.IFormRepository forms) { public bool Execute() => forms.Any(); }\n",
        "api/Program.cs": "System.Console.WriteLine(new App.Modules.Forms.Infrastructure.FormStore());\n",
        "tests/Api.Tests/Api.Tests.csproj": testProject('<ProjectReference Include="../../api/App.csproj" />'),
        // Test code, one class by file name and one by its base: neither is judged.
        "tests/Api.Tests/Web/FormsController.cs": "namespace App.Tests;\npublic sealed class FormsController { public App.Modules.Forms.Application.Ports.IFormRepository? Repository { get; set; } }\npublic sealed class FakeApi : Microsoft.AspNetCore.Mvc.ControllerBase { public App.Modules.Forms.Application.Ports.IFormRepository? Repository { get; set; } }\n",
    });
    const from = "App.Modules.Forms.FormsController";
    assert.deepEqual(findings.map((finding) => unTailed(finding)).sort(), [
        `api/Modules/Forms/FormsController.cs:15\t${from} must not use App.Modules.Forms.Application.Ports.IFormLookup, a module's port`,
        `api/Modules/Forms/FormsController.cs:4\t${from} must not use App.Modules.Forms.Application.Ports.IFormRepository, a module's port`,
        `api/Modules/Forms/FormsController.cs:5\t${from} must not use App.Modules.Forms.Application.IOrderRepository, a module's port`,
        `api/Modules/Forms/FormsController.cs:6\t${from} must not use App.Modules.Forms.Infrastructure.FormStore, a module's Infrastructure adapter`,
        `api/Modules/Forms/FormsController.cs:7\t${from} must not use App.Modules.Forms.Infrastructure.Options.StoreOptions, a module's Infrastructure adapter`,
        "api/Web/FormsEndpoints.cs:4\tApp.Web.FormsEndpoints must not use App.Modules.Forms.Application.Ports.IFormRepository, a module's port",
    ], findings.join("\n"));
});

test("a DbContext reached by a transport class is MER-BE-030's alone: not a port or an adapter for MER-BE-067, and not persistence for MER-BE-031", () => {
    const found = scanTransport(["MER-BE-030", "MER-BE-031", "MER-BE-067"], {
        "api/App.csproj": net10(),
        ...mvcStubs,
        ...persistenceStubs,
        "api/Modules/Forms/Infrastructure/FormsContext.cs": "namespace App.Modules.Forms.Infrastructure;\npublic sealed class FormsContext : Microsoft.EntityFrameworkCore.DbContext { }\n",
        "api/Web/FormsController.cs": `namespace App.Web;\npublic sealed class FormsController\n{\n    ${property("App.Modules.Forms.Infrastructure.FormsContext")}\n}\n`,
    });
    assert.deepEqual(found["MER-BE-030"].map((finding) => unTailed(finding)), [
        "api/Web/FormsController.cs:4\tApp.Web.FormsController must not use App.Modules.Forms.Infrastructure.FormsContext, a DbContext",
    ]);
    assert.deepEqual(found["MER-BE-031"], []);
    assert.deepEqual(found["MER-BE-067"], []);
});

test("underModuleFolder places a file under a module's layer, or a folder of it, by path segment", () => {
    assert.equal(underModuleFolder("Modules/Forms/Application/Ports/IFormRepository.cs", "Application", "Ports"), true);
    assert.equal(underModuleFolder("api/Modules/Forms/Application/Ports/Deep/IFormRepository.cs", "Application", "Ports"), true);
    assert.equal(underModuleFolder("a/b/Modules/Forms/Application/Ports/IFormRepository.cs", "Application", "Ports"), true);
    assert.equal(underModuleFolder("Modules/Forms/Application/Ports/IFormRepository.cs", "Application"), true);
    assert.equal(underModuleFolder("Modules/Forms/Infrastructure/Options/Options.cs", "Infrastructure"), true);
    // A file directly in the layer folder is under the layer and under none of its folders; a folder is matched whole.
    assert.equal(underModuleFolder("Modules/Forms/Application/IFormRepository.cs", "Application"), true);
    assert.equal(underModuleFolder("Modules/Forms/Application/IFormRepository.cs", "Application", "Ports"), false);
    assert.equal(underModuleFolder("Modules/Forms/Application/PortsOfCall/IFormRepository.cs", "Application", "Ports"), false);
    assert.equal(underModuleFolder("Modules/Forms/Application/Ports", "Application", "Ports"), false);
    assert.equal(underModuleFolder("Modules/Forms/Domain/Ports/IFormRepository.cs", "Application", "Ports"), false);
    assert.equal(underModuleFolder("Modules/Forms/Application/IFormRepository.cs", "Infrastructure"), false);
    assert.equal(underModuleFolder("Modules/Forms/FormsController.cs", "Application"), false);
    assert.equal(underModuleFolder("Common/Application/Ports/IClock.cs", "Application", "Ports"), false);
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
// `git` makes the root a repository: outside one, the inventory's fallback walk never lists obj/ or bin/.
// `restore` restores its SDK projects first, as the rules that read C# facts need.
function scan(rule, files, args = ["--rule", rule], { git = false, restore = false } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-backend-"));
    try {
        for (const [file, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), content);
        }
        if (restore) restoreProjects(root);
        if (git) assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
        const result = spawnSync(PLUMB, [root, ...args, "--ci", "--json"], { encoding: "utf8" });
        assert.ok([0, 1].includes(result.status), result.stderr);
        return JSON.parse(result.stdout).filter((finding) => !rule || finding.rule === rule).map((finding) => `${finding.location}\t${finding.message}`);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

// A restored net10.0 web project for the RV-027 repos below: the compiler binds the names written in them. It is a library
// with the implicit usings and System.Text.Json.Serialization, which the sources name without a using.
const webProject = '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework><OutputType>Library</OutputType><ImplicitUsings>enable</ImplicitUsings></PropertyGroup>' +
    '<ItemGroup><Using Include="System.Text.Json.Serialization" /></ItemGroup></Project>\n';

test("MER-RV-027 resolves a shared name by namespace and never flags ErrorResponse", () => {
    const findings = scan("MER-RV-027", {
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs":
            "using App.Modules.Orders.Contracts;\nnamespace App.Contracts.Orders;\n" +
            "[RivetContract]\npublic static class OrdersContract\n{\n" +
            '    public static readonly RouteDefinition<OrderDto> Get = Define.Get<OrderDto>("/api/orders/{id}");\n' +
            '    public static readonly RouteDefinition<ImportResponse> Import = Define.Post<ImportResponse>("/api/orders/import");\n}\n' +
            "public sealed record OrderDto(Guid Id, string? Note = null);\n" +
            "public sealed record ImportResponse(int Imported, IReadOnlyList<ErrorResponse> Failures);\n",
        // Same name, published by the Orders module: the contract's own namespace wins over the using.
        "api/Modules/Orders/Contracts/OrderDto.cs": "namespace App.Modules.Orders.Contracts;\npublic sealed record OrderDto(Guid Id, string Note, int Version = 1);\n",
        // A canonical ErrorResponse outside Common/ is still BE-054's to judge, not RV-027's.
        "api/Contracts/Shared/ErrorResponse.cs":
            "namespace App.Contracts.Orders;\npublic sealed record ErrorResponse(string Code, string Message, IReadOnlyDictionary<string, string[]>? Errors = null);\n",
    }, undefined, { restore: true });
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /^api\/Contracts\/Orders\/OrdersContract\.cs:9\tOrderDto\.Note has a default on a response/);
});

test("MER-RV-027 follows a positional record's parameter to the namespace's type, not its own nested namesake", () => {
    const findings = scan("MER-RV-027", {
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs":
            "namespace App.Contracts.Orders;\n[RivetContract]\npublic static class OrdersContract\n{\n" +
            '    public static readonly RouteDefinition<Shipment> Get = Define.Get<Shipment>("/api/shipments/{id}");\n}\n' +
            "public sealed record Shipment(IReadOnlyList<Parcel> Parcels)\n{\n    public sealed record Parcel(int Weight);\n}\n" +
            "public sealed record Parcel(int Weight = 0);\n",
    }, undefined, { restore: true });
    assert.deepEqual(findings.map((finding) => finding.split(" on a response")[0]), ["api/Contracts/Orders/OrdersContract.cs:11\tParcel.Weight has a default"]);
});

// The project compiles the bin/ files, so the facts bind them; the rule still doesn't judge, follow, or read them.
test("MER-RV-027 leaves a response contract, a response type and a JSON options call in a bin/ folder alone, and reports the same outside it", () => {
    const options = (name) => `namespace App;\n\npublic static class ${name}\n{\n    public static void Use(IServiceCollection services) => services.ConfigureHttpJsonOptions(o => o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);\n}\n`;
    const usings = '<Using Include="System.Text.Json.Serialization" />';
    const findings = scan("MER-RV-027", {
        "api/Api.csproj": compiledBin(usings),
        ...rivetStubs("api"),
        // A type declared only in bin/ is no payload the rule follows, even from a contract outside it.
        "api/Contracts/Orders/OrdersContract.cs":
            "namespace App.Contracts.Orders;\n[RivetContract]\npublic static class OrdersContract\n{\n" +
            '    public static readonly RouteDefinition<OrderDto> Get = Define.Get<OrderDto>("/api/orders/{id}");\n' +
            '    public static readonly RouteDefinition<BinOwnedDto> Owned = Define.Get<BinOwnedDto>("/api/owned/{id}");\n}\n' +
            'public sealed record OrderDto(Guid Id, string Note = "");\n',
        "api/bin/Debug/BinOwnedDto.cs": 'namespace App.Contracts.Orders;\npublic sealed record BinOwnedDto(Guid Id, string Note = "");\n',
        "api/Host/Json.cs": options("Json"),
        "api/bin/Debug/BinJson.cs": options("BinJson"),
        // A project whose only contract is in bin/ serves no response, so its JSON options are not read, and the
        // contract's own response type is not judged.
        "tool/Tool.csproj": compiledBin(usings),
        ...rivetStubs("tool"),
        "tool/bin/Debug/BinContract.cs":
            "namespace App.Contracts.Bin;\n[RivetContract]\npublic static class BinContract\n{\n" +
            '    public static readonly RouteDefinition<BinResponse> Get = Define.Get<BinResponse>("/api/bin");\n}\n' +
            'public sealed record BinResponse(string Note = "");\n',
        "tool/Json.cs": options("ToolJson"),
    }, undefined, { git: true, restore: true });
    assert.deepEqual(findings.map((finding) => finding.split(" on a response")[0].replace(/ in the host's JSON options.*/, "")), [
        "api/Contracts/Orders/OrdersContract.cs:8\tOrderDto.Note has a default",
        "api/Host/Json.cs:5\tDefaultIgnoreCondition = WhenWritingNull",
    ], findings.join("\n"));
});

test("MER-BE-018 says 'declares itself' only for the namespace name, not a using on the same line", () => {
    const findings = scan("MER-BE-018", {
        "api/Api.csproj": webProject,
        "api/Contracts/Orders/OrderModels.cs": "namespace App.Contracts.Orders;\npublic sealed record OrderDto(Guid Id);\n",
        "api/Modules/Orders/Application/Uses.cs": "namespace App.Modules.Orders.Application { using App.Contracts.Orders; }\n",
    }, undefined, { restore: true });
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /Uses\.cs:1\tmodule Orders Application uses App\.Contracts\.Orders, the API's transport contract/);
});

test("MER-BE-018 reports a global using inside a module file once, as a global using", () => {
    const findings = scan("MER-BE-018", {
        "api/Api.csproj": webProject,
        "api/Contracts/Orders/OrderModels.cs": "namespace App.Contracts.Orders;\npublic sealed record OrderDto(Guid Id);\n",
        "api/Modules/Orders/Application/GlobalUsings.cs": "global using global::App.Contracts.Orders;\n",
        // A test project's global usings stay in the test project.
        "tests/Orders.Tests/Orders.Tests.csproj": '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup><ItemGroup><ProjectReference Include="../../api/Api.csproj" /><Using Include="App.Contracts.Orders" /></ItemGroup></Project>\n',
        "tests/Orders.Tests/Usings.cs": "global using App.Contracts.Orders;\n",
    }, undefined, { restore: true });
    assert.equal(findings.length, 1, findings.join("\n"));
    assert.match(findings[0], /^api\/Modules\/Orders\/Application\/GlobalUsings\.cs:1\tglobal using global::App\.Contracts\.Orders puts the API's transport contract in scope/);
});

// The contract here sits in App.Wire.Orders, so no line a module writes holds a `.Contracts` name: a transport type is one
// by the folder that declares it, and a use is what the compiler binds.
test("MER-BE-018 judges what the compiler binds: an inferred type, a name through the enclosing namespace, an alias, and a contract outside a .Contracts namespace", () => {
    const findings = scan("MER-BE-018", {
        "api/Api.csproj": webProject,
        "api/Contracts/Orders/OrderModels.cs": "namespace App.Wire.Orders;\npublic sealed record OrderDto(Guid Id);\n",
        // Host code that hands the wire type out; it is no module's file.
        "api/Host/OrderSource.cs": "namespace App.Host;\npublic static class OrderSource { public static App.Wire.Orders.OrderDto Load() => new(Guid.Empty); }\n",
        "api/GlobalUsings.cs": "global using App.Wire.Orders;\n",
        "api/Modules/Orders/Application/Inferred.cs": "namespace App.Modules.Orders.Application;\npublic sealed class Inferred\n{\n    public Guid Id()\n    {\n        var order = App.Host.OrderSource.Load();\n        return order.Id;\n    }\n}\n",
        "api/Modules/Orders/Domain/Enclosed.cs": "namespace App.Modules.Orders.Domain;\npublic sealed class Enclosed { public Wire.Orders.OrderDto? Order { get; set; } }\n",
        "api/Modules/Orders/Infrastructure/Aliased.cs": "using Sent = System.Collections.Generic.List<App.Wire.Orders.OrderDto>;\nnamespace App.Modules.Orders.Infrastructure;\npublic sealed class Aliased { public Sent Orders { get; } = []; }\n",
        "api/Modules/Orders/Contracts/Imported.cs": "using App.Wire.Orders;\nnamespace App.Modules.Orders.Contracts;\npublic sealed class Imported { }\n",
        // The module root is the transport edge, and a module's own types are its own.
        "api/Modules/Orders/OrdersController.cs": "namespace App.Modules.Orders;\npublic sealed class OrdersController { public App.Wire.Orders.OrderDto Get() => App.Host.OrderSource.Load(); }\n",
        "api/Modules/Orders/Application/Own.cs": "namespace App.Modules.Orders.Application;\npublic sealed record OrderDto(Guid Id);\npublic sealed class Own { public OrderDto? Order { get; set; } }\n",
    }, undefined, { restore: true });
    assert.deepEqual(findings.map((finding) => finding.replace(/, the API's transport contract.*| puts the API's.*/, "")).sort(), [
        "api/GlobalUsings.cs:1\tglobal using App.Wire.Orders",
        "api/Modules/Orders/Application/Inferred.cs:6\tmodule Orders Application uses App.Wire.Orders.OrderDto",
        "api/Modules/Orders/Application/Inferred.cs:7\tmodule Orders Application uses App.Wire.Orders.OrderDto",
        "api/Modules/Orders/Contracts/Imported.cs:1\tmodule Orders Contracts uses App.Wire.Orders",
        "api/Modules/Orders/Domain/Enclosed.cs:2\tmodule Orders Domain uses App.Wire.Orders.OrderDto",
        "api/Modules/Orders/Infrastructure/Aliased.cs:1\tmodule Orders Infrastructure uses System.Collections.Generic.List<App.Wire.Orders.OrderDto>",
        "api/Modules/Orders/Infrastructure/Aliased.cs:3\tmodule Orders Infrastructure uses App.Wire.Orders.OrderDto",
    ], findings.join("\n"));
});

test("MER-BE-018 reads every <Using> form and global using statement, and exempts test projects by metadata, test-only props and build output", () => {
    const findings = scan("MER-BE-018", {
        "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net10.0</TargetFramework><OutputType>Library</OutputType><ImplicitUsings>enable</ImplicitUsings></PropertyGroup>\n  <ItemGroup>\n    <Using\n      Include="System.Text.Json;App.Contracts.Orders" />\n  </ItemGroup>\n</Project>\n',
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
        "src/Api.Specs/Api.Specs.csproj": '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><TargetFramework>net10.0</TargetFramework></PropertyGroup><ItemGroup><ProjectReference Include="../../api/Api.csproj" /><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.0.0" /></ItemGroup></Project>\n',
        "src/Api.Specs/Modules/Orders/Application/PlaceOrderSpec.cs": "global using App.Contracts.Orders;\n",
        // A production *Test.cs file inside a module is production code.
        "api/Modules/Payments/Infrastructure/GovUkPayConnectionTest.cs": "using App.Contracts.Orders;\n",
        // A global using split over lines is reported once, as a global using.
        "api/Modules/Orders/Application/Usings.cs": "global using Split =\n    App.Contracts.Orders.OrderDto;\n",
    }, undefined, { git: true, restore: true });
    assert.deepEqual(findings.map((finding) => finding.replace(/ puts the API's.*/, "")).sort(), [
        "Directory.Build.props:12\t<Using Include=\"App.Contracts.Orders\">",
        "Directory.Build.props:3\t<Using Include=\"App.Contracts.Orders\">",
        "Directory.Build.props:9\t<Using Include=\"App.Contracts.Orders\">",
        "api/Api.csproj:3\t<Using Include=\"App.Contracts.Orders\">",
        "api/GlobalUsings.cs:1\tglobal using static App.Contracts.Orders.OrderDto",
        "api/GlobalUsings.cs:2\tglobal using Wire = App.Contracts.Orders.Page<App.Contracts.Orders.OrderDto>",
        "api/GlobalUsings.cs:3\tglobal using Dtos = App.Contracts.Orders.OrderDto[]",
        "api/Modules/Orders/Application/Usings.cs:1\tglobal using Split = App.Contracts.Orders.OrderDto",
        "api/Modules/Payments/Infrastructure/GovUkPayConnectionTest.cs:1\tmodule Payments Infrastructure uses App.Contracts.Orders, the API's transport contract — map at the edge (a controller, endpoint, request validator or transport mapper at the module root or under Contracts/) and keep the module on its own types",
    ]);
});

test("MER-RV-027 reads .Returns<T> only in a [RivetContract], and a conditional [JsonIgnore] beside [RivetOptional] is its own finding", () => {
    const findings = scan("MER-RV-027", {
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs":
            "[RivetContract]\npublic static class OrdersContract\n{\n" +
            '    public static readonly RouteDefinition Cancel = Define.Delete("/api/orders/{id}").Returns<CancelRefused>(409);\n}\n' +
            "public sealed record CancelRefused([property: RivetOptional, JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Reason);\n",
        // Not a Rivet contract: a mocking library's .Returns<T> names no response.
        "api/Modules/Orders/Infrastructure/ClockSetup.cs":
            "public static class ClockSetup { public static void Use(dynamic clock) => clock.Now().Returns<ClockReading>(1); }\n" +
            "public sealed record ClockReading(int Ticks = 0);\n",
    }, undefined, { restore: true });
    assert.equal(findings.length, 2, findings.join("\n"));
    assert.ok(findings.some((finding) => /^api\/Contracts\/Orders\/OrdersContract\.cs:6\tCancelRefused\.Reason is \[RivetOptional\] on a response/.test(finding)), findings.join("\n"));
    assert.ok(findings.some((finding) => /^api\/Contracts\/Orders\/OrdersContract\.cs:6\tCancelRefused\.Reason is \[JsonIgnore\(Condition = WhenWritingNull\)\] on a response/.test(finding)), findings.join("\n"));
});

test("MER-TE-008 checks a TypeScript API's test/ tree and accepts doubles in its support/ folder", () => {
    assertFindings("MER-TE-008", "bad", [
        ["Tests/FakeClock.cs:3", "top-level test double FakeClock lives outside TestSupport/<Module>"],
        ["Tests/InMemoryOutbox.cs:5", "top-level test double InMemoryOutbox lives outside TestSupport/<Module>"],
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
