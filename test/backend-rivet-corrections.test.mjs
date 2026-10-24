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

test("MER-RV-003 supports class base routes while retaining route-specific and minimal handlers", () => {
    assert.equal(run("MER-RV-003", "good"), "");
    const output = run("MER-RV-003", "bad");
    assert.match(output, /OrdersController\.cs:3\t.*OrdersContract\.Create/);
    assert.match(output, /OrdersController\.cs:20\t.*MembersContract\.List/);
    assert.match(output, /OrdersEndpoints\.cs:4\t.*OrdersContract\.Create/);
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

test("MER-RV-007 flags every app-written RivetResult bridge, one alone included, and leaves Rivet's own adapters", () => {
    assert.equal(run("MER-RV-007", "good"), "");
    const locations = [...run("MER-RV-007", "bad").matchAll(/^MER-RV-007\twarn\t(\S+)/gm)].map((match) => match[1]).sort();
    assert.deepEqual(locations, [
        "Modules/Common/ResultExtensions.Actions.cs:1",
        "Modules/Common/ResultExtensions.cs:1",
        "Modules/Orders/OrderResultExtensions.cs:1",
        "Worker/Modules/Common/WorkerResultExtensions.cs:1",
    ]);
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
        ["Modules/Orders/OrdersController.cs:3", `references OrdersContract.Create ${unbound}`],
        ["Modules/Orders/OrdersController.cs:13", `references OrdersContract.List ${unbound}`],
        ["Modules/Orders/OrdersController.cs:20", `references MembersContract.List ${unbound}`],
        ["Modules/Orders/OrdersEndpoints.cs:4", `references OrdersContract.Create ${unbound}`],
        // Const-route handlers; test/rv003-const-routes.test.mjs pins their messages.
        ["Modules/Orders/OrdersController.cs:26", `references OrdersContract.DraftRoute ${unbound}`],
        ["Modules/Orders/OrdersController.cs:29", `references OrdersContract.DraftRoute ${unbound}`],
        ["Modules/Orders/OrdersController.cs:36", `references MembersContract.InviteRoute ${unbound}`],
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
        ["api/GlobalUsings.cs:2", "global using App.Contracts.Orders puts the API's transport contract in scope in every file of the project, modules included — remove it and add a file-level using in the controllers and Contracts transport mappers that need it"],
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
    ]);
});

// A throwaway repo holding only `files`, scanned for one rule.
function scan(rule, files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-backend-"));
    try {
        for (const [file, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), content);
        }
        const result = spawnSync(PLUMB, [root, "--rule", rule, "--ci", "--json"], { encoding: "utf8" });
        assert.ok([0, 1].includes(result.status), result.stderr);
        return JSON.parse(result.stdout).map((finding) => `${finding.location}\t${finding.message}`);
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
        ["api/test/orders/fake-quote-store.ts:2", "top-level test double FakeQuoteStore lives outside the test tree's support/ folder — move reusable doubles there"],
    ]);
    const findings = scan("MER-TE-008", {
        "api/test/orders/support/fake-clock.ts": "export class FakeClock {}\n",
        "api/tests/fake-mailer.ts": "export class FakeMailer {}\n",
        // src/test/ is app code, not a test tree.
        "api/src/test/fake-seed.ts": "export class FakeSeed {}\n",
    });
    assert.deepEqual(findings.map((finding) => finding.split("\t")[0]), ["api/tests/fake-mailer.ts:1"]);
});
