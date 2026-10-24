#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURES = path.join(HOME, "fixtures", "MER-RV-003");
const PLUMB = path.join(HOME, "plumb");
const unbound = "but the following handler block has no .Bind or terminal (.Success/.Error/.File) call on";

function findings(root) {
    const result = spawnSync(PLUMB, [root, "--rule", "MER-RV-003", "--ci", "--json"], { encoding: "utf8" });
    assert.ok([0, 1].includes(result.status), result.stderr);
    return JSON.parse(result.stdout).map((finding) => `${finding.location}\t${finding.message}`).sort();
}

// A throwaway repo holding `files`, deleted when test `t` ends.
function repo(t, files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-rv003-"));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), text);
    }
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
    const constRouted = findings(path.join(FIXTURES, "bad")).filter((line) => /Route but/.test(line));
    assert.deepEqual(constRouted, [
        `Modules/Orders/OrdersController.cs:26\thandler route references OrdersContract.DraftRoute ${unbound} OrdersContract.GetDraft`,
        `Modules/Orders/OrdersController.cs:29\thandler route references OrdersContract.DraftRoute ${unbound} OrdersContract.SaveDraft`,
        `Modules/Orders/OrdersController.cs:36\thandler route references MembersContract.InviteRoute ${unbound} any MembersContract field`,
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

test("MER-RV-003 reads only a bare const route, narrowed by verb, including a named route: argument", (t) => {
    const root = repo(t, {
        "Contracts/Orders/OrdersContract.cs": `[RivetContract]
public static class OrdersContract
{
    public const string BaseRoute = "/api/orders";
    public const string ItemRoute = "/api/orders/{id}";

    public static readonly RouteDefinition<OrderDto[]> List = Define.Get<OrderDto[]>(BaseRoute);
    public static readonly RouteDefinition Remove = Define.Delete(route: OrdersContract.ItemRoute);
}
`,
        "Modules/Orders/OrdersController.cs": `public sealed class OrdersController : ControllerBase
{
    // BaseRoute plus a suffix names no single field.
    [HttpGet(OrdersContract.BaseRoute + "/{id}")]
    public IActionResult Get(Guid id) => OrdersContract.Get.Success(useCase.Execute(id)).ToActionResult();

    // No DELETE field on BaseRoute: a plain ASP.NET route, not a Rivet handler.
    [HttpDelete(OrdersContract.BaseRoute)]
    public IActionResult Clear() => NoContent();

    [HttpDelete(OrdersContract.ItemRoute)]
    public IActionResult Remove(Guid id) => NoContent();
}
`,
    });
    assert.deepEqual(findings(root), [
        `Modules/Orders/OrdersController.cs:11\thandler route references OrdersContract.ItemRoute ${unbound} OrdersContract.Remove`,
    ]);
});
