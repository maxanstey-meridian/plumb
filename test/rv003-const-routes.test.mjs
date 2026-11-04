#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { restoreProjects } from "./helpers/dotnet-restore.mjs";
import { rivetResultStubs, rivetStubs } from "./helpers/rivet-stubs.mjs";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(HOME, "fixtures", "MER-RV-003");
const PLUMB = path.join(HOME, "plumb");
const unbound = "but the following handler block has no .Bind or terminal (.Success/.Error/.File) call on";

function findings(root) {
    const result = spawnSync(PLUMB, [root, "--rule", "MER-RV-003", "--ci", "--json"], { encoding: "utf8" });
    assert.ok([0, 1].includes(result.status), result.stderr);
    return JSON.parse(result.stdout).map((finding) => `${finding.location}\t${finding.message}`).sort();
}

// The package-free net10.0 project the rule's facts need: the compiler binds the contract names written in the files. It
// is a library on the Web SDK, so the controllers compile, and it brings in the implicit usings and MVC's namespace.
const project = `<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <OutputType>Library</OutputType>
    <ImplicitUsings>enable</ImplicitUsings>
  </PropertyGroup>
  <ItemGroup>
    <Using Include="Microsoft.AspNetCore.Mvc" />
  </ItemGroup>
</Project>
`;

// What the sources name without declaring: the DTOs, and the `useCase` and `endpoint` the controllers call, which a
// static using brings in for a simple name.
const appStubs = `global using App;
global using static App.UseCases;

namespace App;

public sealed record OrderDto;

public sealed record AdminOrderDto;

public sealed record InviteMemberRequest;

public sealed record InviteMemberResponse;

public sealed class UseCase
{
    public OrderDto Execute(Guid id) => new();

    public OrderDto Get(Guid id) => new();

    public OrderDto[] Lines(Guid id) => [];

    public OrderDto[] List() => [];

    public InviteMemberResponse Invite(InviteMemberRequest request) => new();
}

public static class UseCases
{
    public static readonly UseCase useCase = new();

    public static readonly RouteDefinition<OrderDto> endpoint = Define.Get<OrderDto>("/api/orders/{id}");
}
`;

// A throwaway repo holding `files` in one project, restored unless `restore` is false, deleted when test `t` ends.
function repo(t, files, { restore = true } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-rv003-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [file, text] of Object.entries({ "App.csproj": project, ...rivetStubs(), ...rivetResultStubs(), "Stubs/App.cs": appStubs, ...files })) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
    }
    if (restore) restoreProjects(root);
    return root;
}

const contract = `[RivetContract]
public static class OrdersContract
{
    public const string BaseRoute = "/api/orders";
    public const string GetRoute = "/api/orders/{id}";

    public static readonly RouteDefinition<OrderDto> Get = Define.Get<OrderDto>(GetRoute);
}
`;

test("MER-RV-003 good accepts const routes answered through the field the contract defines for that verb", () => {
    assert.deepEqual(findings(path.join(FIXTURES, "good")), []);
});

test("MER-RV-003 bad names the contract field each const-route handler must bind or answer through", () => {
    const constRouted = findings(path.join(FIXTURES, "bad")).filter((line) => /Route but|handler is Http/.test(line));
    assert.deepEqual(constRouted, [
        `Modules/Orders/OrdersController.cs:13\thandler route references OrdersContract.ListRoute ${unbound} OrdersContract.List`,
        `Modules/Orders/OrdersController.cs:26\thandler route references OrdersContract.DraftRoute ${unbound} OrdersContract.GetDraft`,
        `Modules/Orders/OrdersController.cs:29\thandler route references OrdersContract.DraftRoute ${unbound} OrdersContract.SaveDraft`,
        `Modules/Orders/OrdersController.cs:3\thandler route references OrdersContract.CreateRoute ${unbound} OrdersContract.Create`,
        `Modules/Orders/OrdersController.cs:36\thandler route references MembersContract.InviteRoute ${unbound} any MembersContract field`,
        "Modules/Orders/OrdersController.cs:43\thandler is HttpDelete but OrdersContract.DraftRoute backs only Get and Put fields (GetDraft, SaveDraft) — use the matching verb, or add the field",
        `Modules/Orders/OrdersEndpoints.cs:9\thandler route references OrdersContract.DraftRoute ${unbound} OrdersContract.GetDraft`,
    ]);
});

test("MER-RV-003 reports a const-route handler in a base-routed controller once, under its const", (t) => {
    const root = repo(t, {
        "Contracts/Orders/OrdersContract.cs": contract,
        "Modules/Orders/OrdersController.cs": `[Route(OrdersContract.BaseRoute)]
public sealed class OrdersController : ControllerBase
{
    [HttpGet(OrdersContract.GetRoute)]
    public IActionResult Get(Guid id) => Ok(useCase.Execute(id));
}
`,
    });
    assert.deepEqual(findings(root), [
        `Modules/Orders/OrdersController.cs:4\thandler route references OrdersContract.GetRoute ${unbound} OrdersContract.Get`,
    ]);
});

test("MER-RV-003 accepts a local holding the field only when a terminal is called on that local", (t) => {
    const controller = (body) => repo(t, {
        "Contracts/Orders/OrdersContract.cs": contract,
        "Modules/Orders/OrdersController.cs": `public sealed class OrdersController : ControllerBase
{
    [HttpGet(OrdersContract.GetRoute)]
    public IActionResult Get(Guid id)
    {
        ${body}
    }
}
`,
    });
    assert.deepEqual(findings(controller("var endpoint = OrdersContract.Get;\n        return endpoint.Success(useCase.Execute(id)).ToActionResult();")), []);
    assert.equal(findings(controller("var endpoint = OrdersContract.Get;\n        return Ok(useCase.Execute(id)); // endpoint.Success(...)")).length, 1);
    assert.equal(findings(controller("var other = OrdersContract.Get;\n        return endpoint.Success(useCase.Execute(id)).ToActionResult();")).length, 1);
});

test("MER-RV-003 narrows a bare const route by verb, flags a verb mismatch, takes template:, route: and qualified names, and accepts any field for the verb on a composed route", (t) => {
    const root = repo(t, {
        "Contracts/Orders/OrdersContract.cs": `namespace App.Contracts.Orders;

[RivetContract]
public static class OrdersContract
{
    public const string BaseRoute = "/api/orders";
    public const string ItemRoute = "/api/orders/{id}";

    public static readonly RouteDefinition<OrderDto[]> List = Define.Get<OrderDto[]>(BaseRoute);
    public static readonly RouteDefinition<OrderDto> Get = Define.Get<OrderDto>(BaseRoute + "/{id}");
    public static readonly RouteDefinition Remove = Define.Delete(route: OrdersContract.ItemRoute);
}
`,
        // No POST field: a composed POST route on it is a plain ASP.NET handler.
        "Modules/Orders/AuthController.cs": `using App.Contracts.Orders;

public sealed class AuthController : ControllerBase
{
    [HttpPost(OrdersContract.BaseRoute + "/logout")]
    public IActionResult Logout() => SignOut();
}
`,
        "Modules/Orders/OrdersController.cs": `using App.Contracts.Orders;

public sealed class OrdersController : ControllerBase
{
    // BaseRoute plus a suffix names no single field, so any OrdersContract GET field answers it.
    [HttpGet(OrdersContract.BaseRoute + "/{id}")]
    public IActionResult Get(Guid id) => OrdersContract.Get.Success(useCase.Execute(id)).ToActionResult();

    [HttpGet(OrdersContract.BaseRoute + "/{id}/lines")]
    public IActionResult Lines(Guid id) => Ok(useCase.Lines(id));

    [HttpGet(template: OrdersContract.BaseRoute)]
    public IActionResult List() => Ok(useCase.List());

    [HttpGet(App.Contracts.Orders.OrdersContract.BaseRoute)]
    public IActionResult ListAgain() => Ok(useCase.List());

    // BaseRoute backs only a GET field: a DELETE on it is usually the wrong verb.
    [HttpDelete(OrdersContract.BaseRoute)]
    public IActionResult Clear() => NoContent();

    [HttpDelete(OrdersContract.ItemRoute)]
    public IActionResult Remove(Guid id) => NoContent();
}
`,
    });
    assert.deepEqual(findings(root), [
        `Modules/Orders/OrdersController.cs:12\thandler route references OrdersContract.BaseRoute ${unbound} OrdersContract.List`,
        `Modules/Orders/OrdersController.cs:15\thandler route references OrdersContract.BaseRoute ${unbound} OrdersContract.List`,
        "Modules/Orders/OrdersController.cs:19\thandler is HttpDelete but OrdersContract.BaseRoute backs only Get fields (List) — use the matching verb, or add the field",
        `Modules/Orders/OrdersController.cs:22\thandler route references OrdersContract.ItemRoute ${unbound} OrdersContract.Remove`,
        `Modules/Orders/OrdersController.cs:9\thandler route references OrdersContract.BaseRoute ${unbound} OrdersContract.List or OrdersContract.Get`,
    ]);
});

test("MER-RV-003 resolves the written contract name: a namesake module class or a test-source copy leaves an out-of-scan contract open", (t) => {
    const controller = `using App.Contracts.Members;

namespace App.Modules.Orders;

public sealed class MembersController : ControllerBase
{
    [HttpPost(MembersContract.InviteRoute)]
    public IActionResult Invite(InviteMemberRequest request) => Ok(useCase.Invite(request));
}
`;
    const open = [`Modules/Orders/MembersController.cs:7\thandler route references MembersContract.InviteRoute ${unbound} any MembersContract field`];
    // A module class that happens to share the name is not the contract the controller imports. The contract it imports
    // is outside the scan (.plumbignore) but compiled.
    assert.deepEqual(findings(repo(t, {
        ".plumbignore": "Outside/\n",
        "Outside/MembersContract.cs": `namespace App.Contracts.Members;

public static class MembersContract
{
    public const string InviteRoute = "/api/members";
}
`,
        "Modules/Members/MembersContract.cs": "namespace App.Modules.Members;\n\npublic sealed class MembersContract\n{\n}\n",
        "Modules/Orders/MembersController.cs": controller,
    })), open);
    // A test project's copy of the contract is not read for its fields.
    assert.deepEqual(findings(repo(t, {
        "tests/App.Tests/MembersContract.cs": `namespace App.Contracts.Members;

public static class MembersContract
{
    public const string InviteRoute = "/api/members";

    public static readonly RouteDefinition<InviteMemberRequest, InviteMemberResponse> Invite = Define.Post<InviteMemberRequest, InviteMemberResponse>(InviteRoute);
}
`,
        "Modules/Orders/MembersController.cs": controller,
    })), open);
});

test("MER-RV-003 judges no handler in a project the compiler's facts could not read", (t) => {
    const files = {
        "Contracts/Orders/OrdersContract.cs": contract,
        "Modules/Orders/OrdersController.cs": `public sealed class OrdersController : ControllerBase
{
    [HttpGet(OrdersContract.GetRoute)]
    public IActionResult Get(Guid id) => Ok(useCase.Execute(id));
}
`,
    };
    assert.equal(findings(repo(t, files)).length, 1);
    // Not restored, the project loads no facts: the contract can't be told from one outside the source, so no handler
    // is judged, and the run says why.
    const degraded = spawnSync(PLUMB, [repo(t, files, { restore: false }), "--rule", "MER-RV-003", "--ci", "--json"], { encoding: "utf8" });
    assert.match(degraded.stderr, /C# facts incomplete for App\.csproj: not restored/);
    assert.deepEqual(JSON.parse(degraded.stdout), []);
});

test("MER-RV-003 reads fields only from the contract the name resolves to, not a namesake in another namespace", (t) => {
    const root = repo(t, {
        "Contracts/Orders/OrdersContract.cs": `namespace App.Contracts.Orders;

[RivetContract]
public static class OrdersContract
{
    public const string ItemRoute = "/api/orders/{id}";
    public const string PurgeRoute = "/api/orders/{id}/purge";

    public static readonly RouteDefinition<OrderDto> Get = Define.Get<OrderDto>(ItemRoute);
}
`,
        "Contracts/Admin/OrdersContract.cs": `namespace App.Contracts.Admin;

[RivetContract]
public static class OrdersContract
{
    public const string ItemRoute = "/api/admin/orders/{id}";
    public const string PurgeRoute = "/api/admin/orders/{id}/purge";

    public static readonly RouteDefinition<AdminOrderDto> Detail = Define.Get<AdminOrderDto>(ItemRoute);
    public static readonly RouteDefinition Purge = Define.Delete(PurgeRoute);
}
`,
        // Answering the public contract's Get field doesn't answer the admin contract's ItemRoute.
        "Modules/Admin/AdminOrdersController.cs": `using App.Contracts.Admin;

namespace App.Modules.Admin;

public sealed class AdminOrdersController : ControllerBase
{
    [HttpGet(OrdersContract.ItemRoute)]
    public IActionResult Get(Guid id) => App.Contracts.Orders.OrdersContract.Get.Success(useCase.Get(id)).ToActionResult();

    [HttpGet(OrdersContract.ItemRoute)]
    public IActionResult Detail(Guid id) => OrdersContract.Detail.Success(useCase.Get(id)).ToActionResult();
}
`,
        // The public contract backs no field with PurgeRoute; the admin contract's Purge doesn't make this a Rivet handler.
        "Modules/Orders/OrdersController.cs": `using App.Contracts.Orders;

namespace App.Modules.Orders;

public sealed class OrdersController : ControllerBase
{
    [HttpDelete(OrdersContract.PurgeRoute)]
    public IActionResult Purge(Guid id) => NoContent();
}
`,
    });
    assert.deepEqual(findings(root), [
        `Modules/Admin/AdminOrdersController.cs:7\thandler route references OrdersContract.ItemRoute ${unbound} OrdersContract.Detail`,
    ]);
});
