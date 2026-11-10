#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { restoreProjects } from "../scripts/dotnet-restore.mjs";
import { newtonsoftStubs, rivetStubs } from "./helpers/rivet-stubs.mjs";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(HOME, "fixtures", "MER-RV-027");
const PLUMB = path.join(HOME, "plumb");
const RULE = "MER-RV-027";
const FIELDS_REF = "rules/rivet/take-every-response-field-positionally.md";
const HOST_OPTIONS_REF = "rules/rivet/keep-wire-changing-settings-out-of-host-json-options.md";
// The one other rule this file scans for, MER-RV-011.
const PAYLOAD_REF = "rules/rivet/own-each-route-payload-in-its-transport-contract.md";

const omitNull = "is [JsonIgnore(Condition = WhenWritingNull)] on a response, so the server drops it from the JSON when it is null and the client sees the field as optional — remove the attribute so it is always sent";
const optional = "is [RivetOptional] on a response, so the client type marks it optional though the server always sends it — drop the attribute";
const defaulted = "has a default on a response, so a builder can leave it out and still compile — remove the default";
const positional = ", so a builder can leave a field out and still compile — declare it as a positional record";
const bodyProperty = "is set in the record body, so a builder can leave it out and still compile — move it into the parameter list";
const globalNull = "DefaultIgnoreCondition = WhenWritingNull in the host's JSON options drops every null field from every response, so the client sees all of them as optional — remove it so every field is always sent";
const globalDefault = "DefaultIgnoreCondition = WhenWritingDefault in the host's JSON options drops every field holding its type's default (null, 0, false…) from every response, so the client sees all of them as optional — remove it so every field is always sent";

// Every RV-027 finding for a repo root, as `location<TAB>message`, sorted; severity and docRef are checked here.
function findings(root, rule = RULE) {
    const result = spawnSync(PLUMB, [root, "--rule", rule, "--ci", "--json"], { encoding: "utf8" });
    assert.ok([0, 1].includes(result.status), result.stderr);
    const all = JSON.parse(result.stdout).filter((finding) => finding.rule === rule);
    for (const finding of all) {
        assert.equal(finding.severity, rule === RULE ? "warn" : "error", finding.message);
        const fieldRef = finding.message.startsWith("DefaultIgnoreCondition") ? HOST_OPTIONS_REF : FIELDS_REF;
        assert.equal(finding.docRef, rule === RULE ? fieldRef : PAYLOAD_REF, finding.message);
    }
    return all.map((finding) => `${finding.location}\t${finding.message}`).sort();
}

// A throwaway repo holding only `files` (each an array of lines), its projects restored, scanned for RV-027.
function scan(files, rule = RULE) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-rv027-"));
    try {
        for (const [file, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), Array.isArray(content) ? `${content.join("\n")}\n` : content);
        }
        restoreProjects(root);
        return findings(root, rule);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

const sorted = (values) => [...values].sort();
// A net10.0 project the facts can read: its SDK, and the items of one ItemGroup. It compiles on its own, so it is a library
// unless it holds an entry point, and brings in the implicit usings and the namespaces the sources name without a using.
const usings = (...names) => names.map((name) => `<Using Include="${name}" />`).join("");
// A plain project that names the host's services references the framework that holds them.
const hostItems = `<FrameworkReference Include="Microsoft.AspNetCore.App" />${usings("Microsoft.Extensions.DependencyInjection")}`;
const project = (sdk = "Microsoft.NET.Sdk", items = "", outputType = "Library") =>
    `<Project Sdk="${sdk}">\n  <PropertyGroup>\n    <TargetFramework>net10.0</TargetFramework>\n    <OutputType>${outputType}</OutputType>\n    <ImplicitUsings>enable</ImplicitUsings>\n  </PropertyGroup>\n  <ItemGroup>${usings("System.Text.Json", "System.Text.Json.Serialization")}${sdk.endsWith(".Web") ? usings("Microsoft.AspNetCore.Http.Json") : ""}${items}</ItemGroup>\n</Project>\n`;
const testSdk = '<PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.0.0" />';
const webProject = project("Microsoft.NET.Sdk.Web");
const webApp = project("Microsoft.NET.Sdk.Web", "", "Exe");
const contract = (route, ...types) => [
    "namespace App.Contracts.Orders;",
    "[RivetContract]",
    "public static class OrdersContract",
    "{",
    `    public static readonly RouteDefinition<${route}> Get = Define.Get<${route}>("/api/orders/{id}");`,
    "}",
    ...types,
];

test("MER-RV-027 fixtures: the good tree stays clean and the bad tree pins the property-response, union-case, body-property and global-setting cases", () => {
    assert.deepEqual(findings(path.join(FIXTURES, "good")), []);
    const bad = findings(path.join(FIXTURES, "bad"));
    assert.equal(bad.length, 26, bad.join("\n"));
    const summary = "api/Contracts/Orders/OrderSummaryContract.cs";
    const events = "api/Contracts/Orders/OrderEventsContract.cs";
    for (const expected of [
        `${summary}:17\tResponse type OrderSummaryView is a class with properties${positional}`,
        `${summary}:21\tOrderSummaryView.Note ${omitNull}`,
        `${summary}:24\tOrderSummaryView.Priority ${optional}`,
        // Followed through a property; InternalAudit sits behind an unconditional [JsonIgnore], so it isn't.
        `${summary}:41\tOrderTotalsView.Currency ${defaulted}`,
        // Its only property is required, so the reason is the house shape, not a builder leaving it out.
        `${summary}:46\tResponse type OrderHistoryDto is a record whose fields are properties; response records take every field positionally — declare it as a positional record`,
        `${summary}:50\tEntry.By ${defaulted}`,
        `${summary}:54\tResponse type OrderTagsView is a class with properties${positional}`,
        `${summary}:61\tOrderTagsView.Colour ${optional}`,
        // Settable body auto-properties of a positional record; computed, get-only and privately set ones aren't.
        `${events}:15\tOrderEventDto.Actor ${bodyProperty}`,
        `${events}:17\tOrderEventDto.Sequence is a required body property, but response records take every field positionally — move it into the parameter list`,
        `${events}:17\tOrderEventDto.Sequence ${optional}`,
        // The cases a union base's [JsonDerivedType] names, nested or beside it; their overrides aren't body fields.
        `${events}:35\tPlaced.Channel has a default and is [RivetOptional] on a response, so a builder can leave it out and the client type marks it optional though the server always sends it — remove both`,
        `${events}:42\tOrderCancelled.Reason ${defaulted}`,
        `api/Program.cs:5\t${globalNull}`,
        `api/Program.cs:8\t${globalDefault}`,
        `api/Program.cs:18\t${globalNull}`,
    ]) assert.ok(bad.includes(expected), `missing ${expected}\n${bad.join("\n")}`);
});

test("MER-RV-027 flags a DefaultIgnoreCondition in every host JSON options form, bare or qualified, and nothing that only reads or names it", () => {
    const actual = scan({
        "api/Api.csproj": webApp,
        ...rivetStubs("api"),
        ...newtonsoftStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": contract("OrderDto", "public sealed record OrderDto(Guid Id);"),
        "api/Program.cs": [
            "var builder = WebApplication.CreateBuilder(args);",
            "builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);",
            "builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.DefaultIgnoreCondition =",
            "    System.Text.Json.Serialization.JsonIgnoreCondition . WhenWritingDefault);",
            "builder.Services.Configure<Microsoft.AspNetCore.Http.Json.JsonOptions>(o => o.SerializerOptions.DefaultIgnoreCondition = global::System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull);",
            "builder.Services.PostConfigure<Microsoft.AspNetCore.Mvc.JsonOptions>(o =>",
            "    o.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingDefault);",
            // An adapter's own options write what it sends elsewhere, not a response.
            "var options = new JsonSerializerOptions { DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull };",
            "options.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingDefault;",
            // Never, a comparison, a comment, a string and Newtonsoft's setting drop nothing from a response.
            "options.DefaultIgnoreCondition = JsonIgnoreCondition.Never;",
            "if (options.DefaultIgnoreCondition == JsonIgnoreCondition.WhenWritingNull) return;",
            "if (options.DefaultIgnoreCondition != JsonIgnoreCondition.WhenWritingDefault) return;",
            "// options.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;",
            'var text = "DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull";',
            "settings.NullValueHandling = NullValueHandling.Ignore;",
            "builder.Services.AddOptions<JsonOptions>().Configure(o => o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);",
            // A source-generated context's options and an API client's are their own.
            "client.JsonSerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;",
            "[JsonSourceGenerationOptions(DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull)]",
            "[JsonSerializable(typeof(string))]",
            "partial class Wire : JsonSerializerContext;",
            // What the statements above name: Newtonsoft's settings and an API client's options.
            "partial class Program { static JsonSerializerSettings settings = new(); static Client client = new(); }",
            "class Client { public JsonSerializerOptions JsonSerializerOptions { get; } = new(); }",
        ],
    });
    assert.deepEqual(actual, sorted([
        `api/Program.cs:2\t${globalNull}`,
        `api/Program.cs:3\t${globalDefault}`,
        `api/Program.cs:5\t${globalNull}`,
        `api/Program.cs:7\t${globalDefault}`,
        `api/Program.cs:16\t${globalNull}`,
    ]));
});

test("MER-RV-027 reads a global DefaultIgnoreCondition only where Rivet responses are served, never in test code", () => {
    const setting = (namespace) => [`namespace ${namespace};`, "static class Json", "{", "    public static void Use(IServiceCollection services) => services.ConfigureHttpJsonOptions(o => o.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull);", "}"];
    const files = {
        // The host references the contracts project, so its JSON options write the responses.
        "src/Contracts/Contracts.csproj": project(),
        ...rivetStubs("src/Contracts"),
        "src/Contracts/Orders/OrdersContract.cs": contract("OrderDto", "public sealed record OrderDto(Guid Id);"),
        "src/Host/Host.csproj": project("Microsoft.NET.Sdk.Web", '<ProjectReference Include="../Contracts/Contracts.csproj" />'),
        "src/Host/Json.cs": setting("App.Host"),
        // A tool beside them configures a host that serves no Rivet response.
        "src/Tool/Tool.csproj": project("Microsoft.NET.Sdk", hostItems),
        "src/Tool/Json.cs": setting("App.Tool"),
        // A test project known only by its test SDK (not its folder or file name) is test code.
        "src/Host.Specs/Host.Specs.csproj": project("Microsoft.NET.Sdk", `${testSdk}${hostItems}<ProjectReference Include="../Host/Host.csproj" />`),
        "src/Host.Specs/Json.cs": setting("App.Host.Specs"),
    };
    assert.deepEqual(scan(files), [`src/Host/Json.cs:4\t${globalNull}`]);
    // Without the test SDK the same project is production and its options are read.
    assert.deepEqual(scan({ ...files, "src/Host.Specs/Host.Specs.csproj": project("Microsoft.NET.Sdk", `${hostItems}<ProjectReference Include="../Host/Host.csproj" />`) }),
        [`src/Host.Specs/Json.cs:4\t${globalNull}`, `src/Host/Json.cs:4\t${globalNull}`]);
    // A repo that serves no Rivet response has nothing for the setting to strip.
    assert.deepEqual(scan({ "src/Tool/Tool.csproj": project("Microsoft.NET.Sdk", hostItems), "src/Tool/Json.cs": setting("App.Tool") }), []);
});

test("MER-RV-027 flags a class, struct or property record response once and reads only its public instance properties", () => {
    const actual = scan({
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": contract("OrderView",
            "public class OrderView : IOrder",
            "{",
            "    public OrderView(Guid id) => Id = id;",
            "    [property: JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)] public Guid Id { get; }",
            "    [JsonIgnore(Condition = global::System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)]",
            "    public string? Note { get; init; } = null;",
            "    [RivetOptional, JsonPropertyName(\"p\")] public virtual int? Priority",
            "    {",
            "        get => _priority;",
            "        set { _priority = value; }",
            "    }",
            "    private int? _priority;",
            "    public OrderStamp Stamp { get; init; } = new() { At = default };",
            "    public Parts Lines { get; init; } = new(0);",
            // Not serialized members: private, static, explicit interface, indexer, method, event, field and constant.
            "    [RivetOptional] private string? Hidden { get; set; }",
            "    [RivetOptional] public static OrderView? Last { get; set; }",
            "    [RivetOptional] string? IOrder.Code => null;",
            "    [RivetOptional] public string this[int index] => \"\";",
            "    [RivetOptional] public int Count() => 0;",
            "    [RivetOptional] public event EventHandler? Changed;",
            "    [RivetOptional] public int? Version;",
            "    public const int Max = 1;",
            "    #region Nested",
            "    public sealed record Parts(int Count = 0);",
            "    #endregion",
            "}",
            "public struct OrderStamp",
            "{",
            "    public DateTimeOffset At { get; set; }",
            "}",
            // The namespace's namesake of a nested type isn't what the property names.
            "public sealed record Parts(int Count);",
            "public interface IOrder { string? Code { get; } }",
        ),
    });
    const at = (line, message) => `api/Contracts/Orders/OrdersContract.cs:${line}\t${message}`;
    assert.deepEqual(actual, sorted([
        at(7, `Response type OrderView is a class with properties${positional}`),
        at(10, "OrderView.Id is [JsonIgnore(Condition = WhenWritingDefault)] on a response, so the server drops it from the JSON when it holds its type's default (null, 0, false…) and the client sees the field as optional — remove the attribute so it is always sent"),
        at(11, `OrderView.Note ${omitNull}`),
        at(13, `OrderView.Priority ${optional}`),
        at(30, `Parts.Count ${defaulted}`),
        at(33, `Response type OrderStamp is a struct with properties${positional}`),
    ]));
});

test("MER-RV-027 skips property types never sent, fieldless and abstract-only types, ErrorResponse, and types outside the scan", () => {
    const actual = scan({
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": [
            ...contract("OrderView",
                "public sealed class OrderView",
                "{",
                "    [JsonIgnore] public Audit Audit { get; init; } = new();",
                "    [JsonIgnore(Condition = JsonIgnoreCondition.Always)] public Audit Trace { get; init; } = new();",
                "    [JsonIgnore(Condition = JsonIgnoreCondition.Never)] public Kind Kind { get; init; } = new();",
                "    public ErrorResponse? Error { get; init; }",
                "    public Money Total { get; init; }",
                "    public Base Base { get; init; }",
                "    public Empty Empty { get; init; }",
                "}",
                "public sealed record Audit(string By = \"system\");",
                "public sealed class Kind { public int Value { get; init; } }",
                "public sealed class ErrorResponse { [RivetOptional] public string? Code { get; init; } }",
                // Abstract and computed properties are each subtype's to send; a fieldless record has nothing to leave out.
                "public abstract record Base { public abstract string Name { get; init; } public string Label => Name; }",
                "public sealed record Empty;",
            ),
        ],
        // Money is outside the scan: the compiler binds it, but no file in the scan declares it.
        ".plumbignore": "Outside/\n",
        "api/Outside/Money.cs": "namespace App.Contracts.Orders;\npublic sealed class Money { [RivetOptional] public string? Currency { get; init; } }\n",
    });
    const at = (line, message) => `api/Contracts/Orders/OrdersContract.cs:${line}\t${message}`;
    assert.deepEqual(actual, sorted([
        at(7, `Response type OrderView is a class with properties${positional}`),
        // Kind's [JsonIgnore(Condition = Never)] property is always sent, so its class is followed.
        at(18, `Response type Kind is a class with properties${positional}`),
    ]));
});

test("MER-RV-027 merges a partial response's parts, leaves a request-only class alone, and marks a class used both ways", () => {
    const actual = scan({
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": [
            "namespace App.Contracts.Orders;",
            "[RivetContract]",
            "public static class OrdersContract",
            "{",
            '    public static readonly RouteDefinition<NoteRequest, NoteView> Add = Define.Post<NoteRequest, NoteView>("/api/notes");',
            '    public static readonly RouteDefinition<NoteSettings, NoteSettings> Settings = Define.Put<NoteSettings, NoteSettings>("/api/notes/settings");',
            "}",
            "public sealed class NoteRequest { [RivetOptional] public string? Author { get; init; } public string Text { get; init; } = \"\"; }",
            "public sealed partial record NoteView(Guid Id);",
            "public sealed class NoteSettings { public bool Pin { get; set; } }",
        ],
        "api/Contracts/Orders/NoteView.Tags.cs": [
            "namespace App.Contracts.Orders;",
            "public sealed partial record NoteView",
            "{",
            "    [RivetOptional] public IReadOnlyList<Tag>? Tags { get; init; }",
            "}",
            "public sealed record Tag(string Name = \"\");",
        ],
    });
    assert.deepEqual(actual, sorted([
        // The positional part makes NoteView positional, so the other part's property is a body property; it is still
        // read and followed.
        `api/Contracts/Orders/NoteView.Tags.cs:4\tNoteView.Tags ${optional}`,
        `api/Contracts/Orders/NoteView.Tags.cs:4\tNoteView.Tags ${bodyProperty}`,
        `api/Contracts/Orders/NoteView.Tags.cs:6\tTag.Name ${defaulted}`,
        `api/Contracts/Orders/OrdersContract.cs:10\tResponse type NoteSettings is a class with properties${positional} (it's a request type too)`,
    ]));
});

test("MER-RV-027 takes test code from the project analysis: a test-SDK project's records and routes are skipped", () => {
    const files = {
        // ProbeDto is declared only in Api.Specs, so the contract's project references it to name it.
        "api/Api.csproj": project("Microsoft.NET.Sdk.Web", '<ProjectReference Include="../src/Api.Specs/Api.Specs.csproj" />'),
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": contract("ProbeDto"),
        // Declared only in a project known as test code by its test SDK, not by its folder or file name.
        "src/Api.Specs/Api.Specs.csproj": project("Microsoft.NET.Sdk", testSdk),
        ...rivetStubs("src/Api.Specs"),
        "src/Api.Specs/Probe.cs": [
            "namespace App.Contracts.Orders;",
            "public sealed record ProbeDto(int Attempt = 0);",
            "[RivetContract]",
            "public static class SpecContract",
            "{",
            '    public static readonly RouteDefinition<SpecDto> Get = Define.Get<SpecDto>("/spec");',
            "}",
            "public sealed record SpecDto(int Attempt = 0);",
        ],
    };
    assert.deepEqual(scan(files), []);
    // The same project without the test SDK is production: the record and its own route are both read.
    assert.deepEqual(scan({ ...files, "src/Api.Specs/Api.Specs.csproj": project() }), [
        `src/Api.Specs/Probe.cs:2\tProbeDto.Attempt ${defaulted}`,
        `src/Api.Specs/Probe.cs:8\tSpecDto.Attempt ${defaulted}`,
    ]);
});

test("MER-RV-027 follows a union base's [JsonDerivedType] cases, nested ones before the namespace's namesakes, and checks each as a response", () => {
    const actual = scan({
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": [
            ...contract("Payment",
                "[JsonPolymorphic(TypeDiscriminatorPropertyName = \"$kind\")]",
                "[JsonDerivedType(typeof(Card), \"card\"), JsonDerivedType(typeof(Payment.Transfer), \"transfer\")]",
                "[JsonDerivedType(typeof(Voucher), \"voucher\")]",
                "[JsonDerivedType(typeof(Missing), \"missing\")]",
                "public abstract record Payment",
                "{",
                "    public sealed record Card(string Last4 = \"\") : Payment;",
                "    public sealed record Transfer(string? Reference = null) : Payment;",
                "}",
                // Declared beside the base, with the same names as its nested cases: the nested ones are what it names.
                "public sealed record Card(string Last4 = \"\");",
                "public sealed record Transfer(string? Reference = null);",
                "public sealed record Voucher([property: RivetOptional] string? Code) : Payment;",
                // A base without a body names cases from where its attribute is written.
                "[JsonDerivedType(typeof(Refund), \"refund\")]",
                "public abstract record Adjustment;",
                "public sealed record Refund(decimal Amount = 0) : Adjustment;",
                "public sealed record Unrelated(int Value = 0);",
            ),
        ],
        // Missing is outside the scan: the compiler binds it, but no file in the scan declares it.
        ".plumbignore": "Outside/\n",
        "api/Outside/Missing.cs": "namespace App.Contracts.Orders;\npublic sealed record Missing(string? Name = null);\n",
    });
    const at = (line, message) => `api/Contracts/Orders/OrdersContract.cs:${line}\t${message}`;
    assert.deepEqual(actual, sorted([
        at(13, `Card.Last4 ${defaulted}`),
        at(14, `Transfer.Reference ${defaulted}`),
        at(18, `Voucher.Code ${optional}`),
    ]));
    // Adjustment is reached only through a response, so its case is checked once it is.
    const withAdjustment = scan({
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": contract("Adjustment",
            "[JsonDerivedType(typeof(Refund), \"refund\")]",
            "public abstract record Adjustment;",
            "public sealed record Refund(decimal Amount = 0) : Adjustment;",
        ),
    });
    assert.deepEqual(withAdjustment, [`api/Contracts/Orders/OrdersContract.cs:9\tRefund.Amount ${defaulted}`]);
});

test("MER-RV-027 flags a positional response record's settable body auto-properties, keeps the attribute checks on them, and leaves the rest alone", () => {
    const actual = scan({
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": contract("OrderDto",
            "public sealed record OrderDto(Guid Id) : AuditedDto",
            "{",
            "    public string? Note { get; init; }",
            "    public required int Count { get; set; }",
            "    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]",
            "    public string? Tag { get; init; } = null;",
            "    public string? Owner { get; internal set; }",
            "    public string? Editor { get; protected init; }",
            "    public string Label => Id.ToString();",
            "    public string Code { get; } = \"\";",
            "    public string Upper { get { return Code.ToUpperInvariant(); } }",
            "    public string Backed { get => _backed; set => _backed = value; }",
            "    private string _backed = \"\";",
            "    public override string By { get; init; } = \"\";",
            "    private string? Hidden { get; set; }",
            "    public static int Created { get; set; }",
            "}",
            "public abstract record AuditedDto { public abstract string By { get; init; } }",
        ),
    });
    const at = (line, message) => `api/Contracts/Orders/OrdersContract.cs:${line}\t${message}`;
    assert.deepEqual(actual, sorted([
        at(9, `OrderDto.Note ${bodyProperty}`),
        at(10, "OrderDto.Count is a required body property, but response records take every field positionally — move it into the parameter list"),
        at(11, `OrderDto.Tag ${bodyProperty}`),
        at(11, `OrderDto.Tag ${omitNull}`),
    ]));
});

test("MER-RV-027 skips ignored, redeclared and converter-written members, reads array properties, and reads past methods and operators", () => {
    const actual = scan({
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": contract("OrderDto",
            "public sealed record OrderDto(string Name, Money Total, Stamp At, Echo E, Split S) : Base",
            "{",
            "    [JsonIgnore] public string? CacheKey { get; init; }",
            "    [JsonPropertyName(\"n\")] public string Name { get; init; } = Name.Trim();",
            "    public string Describe(int indent = 0) { return Name; }",
            "    public string Format(int indent = default(int)) { return Name; }",
            "    public required OrderLine[] Lines { get; init; }",
            "}",
            "public abstract record Base { [JsonIgnore] public string? Etag { get; init; } }",
            "public sealed class OrderLine",
            "{",
            "    public static bool operator ==(OrderLine a, OrderLine b) { return true; }",
            "    public static bool operator !=(OrderLine a, OrderLine b) { return false; }",
            "    public string Text { get; init; } = \"\";",
            "    [RivetOptional] public string? Tag { get; init; }",
            "}",
            // A converter writes the type's JSON itself, on the type, on any part of a partial one, or on the member
            // that holds it.
            "[JsonConverter(typeof(MoneyConverter))]",
            "public readonly struct Money { public decimal Amount { get; init; } }",
            "public sealed class Stamp { public DateTimeOffset At { get; init; } }",
            // Redeclared without reading the parameter, the property is never set by the constructor.
            "public sealed record Echo(string Name) { public string Name { get; init; } }",
            "[JsonConverter(typeof(SplitConverter))]",
            "public partial class Split { }",
            "public partial class Split { public int A { get; init; } }",
        ),
        // The converters the attributes name; a converter type isn't checked when the attribute is written.
        "api/Contracts/Orders/Converters.cs": [
            "namespace App.Contracts.Orders;",
            "public sealed class MoneyConverter;",
            "public sealed class SplitConverter;",
            "public sealed class StampConverter;",
        ],
        "api/Contracts/Orders/HolderContract.cs": [
            "namespace App.Contracts.Orders;",
            "[RivetContract]",
            "public static class HolderContract",
            "{",
            '    public static readonly RouteDefinition<HolderView> Get = Define.Get<HolderView>("/api/holders/{id}");',
            "}",
            "public sealed record HolderView([property: JsonConverter(typeof(StampConverter))] Stamp At);",
        ],
    });
    const at = (line, message) => `api/Contracts/Orders/OrdersContract.cs:${line}\t${message}`;
    assert.deepEqual(actual, sorted([
        at(13, "OrderDto.Lines is a required body property, but response records take every field positionally — move it into the parameter list"),
        at(16, `Response type OrderLine is a class with properties${positional}`),
        at(21, `OrderLine.Tag ${optional}`),
        // OrderDto's own Stamp has no converter, so it is followed; HolderView's is written by one.
        at(25, `Response type Stamp is a class with properties${positional}`),
        at(26, `Echo.Name ${bodyProperty}`),
    ]));
});

test("MER-RV-027 gives the positional reason, not the builder one, when no property can be left out", () => {
    const actual = scan({
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": contract("TicketView",
            "public sealed class TicketView(Guid id)",
            "{",
            "    public Guid Id { get; } = id;",
            "    public required string Title { get; init; }",
            "}",
        ),
    });
    assert.deepEqual(actual, [
        "api/Contracts/Orders/OrdersContract.cs:7\tResponse type TicketView is a class with properties; response records take every field positionally — declare it as a positional record",
    ]);
});

// A type one multi-target project declares differently under each framework is judged under each framework, as the
// header that framework compiles, and the facts hold the headers of both. The shapes are the compiled forms of #if around
// a header, a file removed from one framework, a file compiled by both, and a partial part beside the headers.
test("MER-RV-027 judges a response type under each target framework: each header, never the headers read as one type", () => {
    const orders = "api/Contracts/Orders";
    const contractFile = `${orders}/OrdersContract.cs`;
    const multiTarget = (items) => project("Microsoft.NET.Sdk.Web", items).replace("<TargetFramework>net10.0</TargetFramework>", "<TargetFrameworks>net10.0;net9.0</TargetFrameworks>");
    const actual = scan({
        "api/Api.csproj": multiTarget(
            `<Compile Remove="Contracts/Orders/Removed.Ten.cs" Condition="'$(TargetFramework)' == 'net9.0'" /><Compile Remove="Contracts/Orders/Removed.Nine.cs" Condition="'$(TargetFramework)' == 'net10.0'" />`,
        ),
        ...rivetStubs("api"),
        [contractFile]: `namespace App.Contracts.Orders;

[RivetContract]
public static class OrdersContract
{
    public static readonly RouteDefinition<PosBoth> A = Define.Get<PosBoth>("/a");
    public static readonly RouteDefinition<Mixed> B = Define.Get<Mixed>("/b");
    public static readonly RouteDefinition<MixedReversed> C = Define.Get<MixedReversed>("/c");
    public static readonly RouteDefinition<ConverterOne> D = Define.Get<ConverterOne>("/d");
    public static readonly RouteDefinition<PartialOne> E = Define.Get<PartialOne>("/e");
    public static readonly RouteDefinition<PartialCross> F = Define.Get<PartialCross>("/f");
    public static readonly RouteDefinition<WholeFile> G = Define.Get<WholeFile>("/g");
    public static readonly RouteDefinition<Removed> H = Define.Get<Removed>("/h");
    public static readonly RouteDefinition<Holder> I = Define.Get<Holder>("/i");
    public static readonly RouteDefinition<KindSplit> J = Define.Get<KindSplit>("/j");
    public static readonly RouteDefinition<PropertyOptional> K = Define.Get<PropertyOptional>("/k");
    public static readonly RouteDefinition<Namesake> L = Define.Get<Namesake>("/l");
    public static readonly RouteDefinition<Shared> M = Define.Get<Shared>("/m");
}

// Both headers positional, each parameter with a default.
#if NET9_0
public record PosBoth(string? Note = "nine");
#else
public record PosBoth(string? Note = "ten");
#endif

// Positional under one framework, a class under the other.
#if NET9_0
public record Mixed(string? Note = null);
#else
public class Mixed
{
    public string? Note { get; set; }
}
#endif

#if NET9_0
public class MixedReversed
{
    public string? Note { get; set; }
}
#else
public record MixedReversed(string? Note);
#endif

// A converter writes it under one framework only.
#if NET9_0
[JsonConverter(typeof(ConverterOneConverter))]
public class ConverterOne
{
    public string? Note { get; set; }
}
#else
public class ConverterOne
{
    public string? Note { get; set; }
}
#endif

public sealed class ConverterOneConverter : JsonConverter<ConverterOne>
{
    public override ConverterOne? Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) => null;
    public override void Write(Utf8JsonWriter writer, ConverterOne value, JsonSerializerOptions options) { }
}

// Partial under one framework, not under the other.
#if NET9_0
public partial class PartialOne
{
    public string? Note { get; set; }
}
#else
public class PartialOne
{
    public string? Note { get; set; }
}
#endif

// Partial under one framework with a second part in another file, plain under the other framework.
#if NET9_0
public partial class PartialCross
{
    public string? Note { get; set; }
}
#else
public class PartialCross
{
    public string? Note { get; set; }
}
#endif

// Each header names a member type only its framework sees.
#if NET9_0
public class Holder
{
    public InnerNine Inner { get; set; } = new("x");
}
public record InnerNine(string Value = "");
#else
public class Holder
{
    public InnerTen Inner { get; set; } = new("x");
}
public record InnerTen(string Value = "");
#endif

// A class under one framework, a record with properties under the other.
#if NET9_0
public class KindSplit
{
    public string? Note { get; set; }
}
#else
public record KindSplit
{
    public string? Note { get; set; }
}
#endif

// A property that is [RivetOptional] on each header.
#if NET9_0
public class PropertyOptional
{
    [RivetOptional] public string? Note { get; set; } = "nine";
}
#else
public class PropertyOptional
{
    [RivetOptional] public string? Note { get; set; } = "ten";
}
#endif

// A partial part both frameworks compile, and one more part for each.
public partial class Shared
{
    [RivetOptional] public string? Both { get; set; }
}
#if NET9_0
public partial class Shared
{
    [RivetOptional] public string? Nine { get; set; }
}
#else
public partial class Shared
{
    [RivetOptional] public string? Ten { get; set; }
}
#endif
`,
        // The second part of PartialCross, which only net9.0 compiles.
        [`${orders}/PartialCross.Second.cs`]: `namespace App.Contracts.Orders;

#if NET9_0
public partial class PartialCross
{
    [RivetOptional] public string? Second { get; set; }
}
#endif
`,
        // Each file is compiled by one framework only: by a #if around its header, and by a removal from the other framework.
        [`${orders}/WholeFile.Nine.cs`]: "namespace App.Contracts.Orders;\n\n#if NET9_0\npublic class WholeFile\n{\n    public string? Note { get; set; }\n}\n#endif\n",
        [`${orders}/WholeFile.Ten.cs`]: "namespace App.Contracts.Orders;\n\n#if !NET9_0\npublic class WholeFile\n{\n    public string? Note { get; set; }\n}\n#endif\n",
        [`${orders}/Removed.Nine.cs`]: "namespace App.Contracts.Orders;\n\npublic class Removed\n{\n    public string? Note { get; set; }\n}\n",
        [`${orders}/Removed.Ten.cs`]: "namespace App.Contracts.Orders;\n\npublic class Removed\n{\n    public string? Note { get; set; }\n}\n",
        // Two types of one name that both frameworks compile: a file-local class is its own type beside the public one.
        [`${orders}/Namesake.File.cs`]: "namespace App.Contracts.Orders;\n\nfile class Namesake\n{\n    public string? Local { get; set; }\n}\n",
        [`${orders}/Namesake.cs`]: "namespace App.Contracts.Orders;\n\npublic class Namesake\n{\n    public string? Note { get; set; }\n}\n",
    });
    const at = (file, line, message) => `${file}:${line}\t${message}`;
    const here = (line, message) => at(contractFile, line, message);
    const classOf = (name) => `Response type ${name} is a class with properties${positional}`;
    assert.deepEqual(actual, sorted([
        // Both headers are positional records with a default, one finding each.
        here(23, `PosBoth.Note ${defaulted}`),
        here(25, `PosBoth.Note ${defaulted}`),
        // The record's default and the class's shape, and the class's property is not "set in the record body".
        here(30, `Mixed.Note ${defaulted}`),
        here(32, classOf("Mixed")),
        // The class alone has a finding; the clean positional record has none.
        here(39, classOf("MixedReversed")),
        // The header with [JsonConverter] is written by it; the other is not.
        here(55, classOf("ConverterOne")),
        // One finding per header, whichever of them is partial.
        here(69, classOf("PartialOne")),
        here(74, classOf("PartialOne")),
        // The net9.0 header with its second part is one type, the net10.0 header another.
        here(82, classOf("PartialCross")),
        here(87, classOf("PartialCross")),
        at(`${orders}/PartialCross.Second.cs`, 6, `PartialCross.Second ${optional}`),
        at(`${orders}/WholeFile.Nine.cs`, 4, classOf("WholeFile")),
        at(`${orders}/WholeFile.Ten.cs`, 4, classOf("WholeFile")),
        at(`${orders}/Removed.Nine.cs`, 3, classOf("Removed")),
        at(`${orders}/Removed.Ten.cs`, 3, classOf("Removed")),
        // Each header and the type only its framework names.
        here(95, classOf("Holder")),
        here(99, `InnerNine.Value ${defaulted}`),
        here(101, classOf("Holder")),
        here(105, `InnerTen.Value ${defaulted}`),
        // Each header's own shape.
        here(110, classOf("KindSplit")),
        here(115, `Response type KindSplit is a record whose fields are properties${positional}`),
        here(123, classOf("PropertyOptional")),
        here(125, `PropertyOptional.Note ${optional}`),
        here(128, classOf("PropertyOptional")),
        here(130, `PropertyOptional.Note ${optional}`),
        // The part both frameworks compile is read under each and reported once, with the part each framework adds.
        here(135, classOf("Shared")),
        here(137, `Shared.Both ${optional}`),
        here(142, `Shared.Nine ${optional}`),
        here(147, `Shared.Ten ${optional}`),
        // The public Namesake is the response type, judged from its own file; the file-local one beside it is another type.
        at(`${orders}/Namesake.cs`, 3, classOf("Namesake")),
    ]));
});

// Each project's assembly is its own, so two `Api` projects' `Foo` are two types, each judged from its own file.
test("MER-RV-027 judges each project's response type when two projects with one assembly name declare one type name", () => {
    const side = (folder, property) => ({
        [`${folder}/Api.csproj`]: webProject,
        ...rivetStubs(folder),
        [`${folder}/Contracts/Orders/OrdersContract.cs`]: contract("Foo"),
        [`${folder}/Contracts/Orders/Foo.cs`]: `namespace App.Contracts.Orders;\n\npublic class Foo\n{\n    public string? ${property} { get; set; }\n}\n`,
    });
    const actual = scan({ ...side("a/api", "A"), ...side("b/api", "B") });
    assert.deepEqual(actual, sorted([
        `a/api/Contracts/Orders/Foo.cs:3\tResponse type Foo is a class with properties${positional}`,
        `b/api/Contracts/Orders/Foo.cs:3\tResponse type Foo is a class with properties${positional}`,
    ]));
});

// A file-local class is its own type beside a public one of the same name, so the contract's `Foo` is the public class
// (judged, and reported from its file), never read as a second declaration of it that leaves the type unjudged.
test("MER-RV-027 judges the public response type beside a file-local class of the same name in another file", () => {
    const actual = scan({
        "api/Api.csproj": webProject,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": contract("Foo"),
        // Sorts before Foo.cs, so the file-local part is the first declaration the facts list.
        "api/Contracts/Orders/Foo.File.cs": "namespace App.Contracts.Orders;\n\nfile class Foo\n{\n    public string? Local { get; set; }\n}\n",
        "api/Contracts/Orders/Foo.cs": "namespace App.Contracts.Orders;\n\npublic class Foo\n{\n    public string? Note { get; set; }\n}\n",
    });
    assert.deepEqual(actual, sorted([
        `api/Contracts/Orders/Foo.cs:3\tResponse type Foo is a class with properties${positional}`,
    ]));
});

// MER-RV-011 judges a payload type under each target framework, as its declarations that framework compiles: a type
// declared once per framework in differently placed files is owned wrongly under the framework whose file is misplaced.
test("MER-RV-011 judges a payload type under each target framework: one declared in a wrong owner's file under one framework is reported", () => {
    const multiTarget = project("Microsoft.NET.Sdk.Web").replace("<TargetFramework>net10.0</TargetFramework>", "<TargetFrameworks>net10.0;net9.0</TargetFrameworks>");
    const declaration = (symbol) => `namespace App.Contracts.Orders;\n\n#if ${symbol}\npublic class Line\n{\n    public string? Note { get; set; }\n}\n#endif\n`;
    const actual = scan({
        "api/Api.csproj": multiTarget,
        ...rivetStubs("api"),
        "api/Contracts/Orders/OrdersContract.cs": contract("Line"),
        "api/Contracts/Orders/Line.cs": declaration("NET10_0"),
        "api/Modules/Billing/Line.cs": declaration("NET9_0"),
    }, "MER-RV-011");
    assert.deepEqual(actual, [
        "api/Contracts/Orders/OrdersContract.cs:5\troute payload Line is owned by api/Modules/Billing/Line.cs — define it in Contracts/Orders/",
    ]);
});
