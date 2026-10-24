#!/usr/bin/env node
// The BT, FE-043 and RV-021 rules read test code through the shared isTestScript definition
// (testing-philosophy.md#test-location): a package's top-level test/, tests/ and e2e/ trees are tests, and a
// test/ or tests/ folder inside the app tree is production code. A file with no package is measured from the
// repository root. Backend rules skip a Nuxt frontend's files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUMB = path.join(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "plumb");

function scan(files, args) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-test-source-"));
    try {
        for (const [file, content] of Object.entries(files)) {
            fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
            fs.writeFileSync(path.join(root, file), content);
        }
        const result = spawnSync(PLUMB, [root, ...args, "--ci", "--json"], { encoding: "utf8" });
        assert.ok([0, 1].includes(result.status), result.stderr);
        return JSON.parse(result.stdout).map((finding) => `${finding.rule}\t${finding.location}`).sort();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

test("the BT pack exempts a package's top-level test/ and e2e/ trees but not a test/ folder inside src/", () => {
    const findings = scan({
        "package.json": '{"dependencies":{"typed-inject":"^5.0.0"}}\n',
        "tsconfig.json": '{"compilerOptions":{"baseUrl":"."}}\n',
        // Production: every layer rule still fires here.
        "src/modules/orders/domain/order.ts":
            'import { Injectable } from "@nestjs/common";\nexport const now = () => Date.now();\n' +
            "export interface OrderRepository { save(id: string): Promise<void>; }\nexport type Order = { id: string };\n",
        // A test/ folder inside the app tree is production code, so it may not read the environment.
        "src/modules/orders/test/env.ts": "export const mode = process.env.MODE;\n",
        // Test code: each file would trip its rule if it were production.
        "test/modules/orders/domain/order-builder.ts": // BT-010, BT-013, BT-016, BT-017
            'import { Injectable } from "@nestjs/common";\nexport const at = Date.now();\n' +
            "export interface OrderRepository { save(id: string): Promise<void>; }\nexport const mode = process.env.MODE;\n",
        "e2e/modules/orders/application/locate.ts": // BT-015
            'import { container } from "tsyringe";\nexport const locate = () => container.resolve("orders");\n',
        "test/support/application/ports/clock.ts": "export class Clock {}\n", // BT-001
        "test/support/fake-clock.ts": // BT-002
            'import { Clock } from "../../src/modules/orders/application/ports/clock";\nexport class FakeClock extends Clock {}\n',
        "test/support/tick.ts": 'export class Tick {\n  static inject = ["clock"];\n  constructor(clock) {}\n}\n', // BT-004
        "test/shared/ports/order-reader.ts": // BT-014
            'import type { Order } from "../../../src/modules/orders/domain/order";\nexport interface OrderReader { find(id: string): Promise<Order>; }\n',
        "test/http/orders-controller.ts": 'import { PrismaClient } from "@prisma/client";\nexport const db = new PrismaClient();\n', // BT-020
        "test/modules/mail/fake-mailer.service.ts": "export class FakeMailerService {}\n", // BT-003, BT-005
    }, ["--pack", "BT"]);
    assert.deepEqual(findings, [
        "MER-BT-010\tsrc/modules/orders/domain/order.ts:1",
        "MER-BT-013\tsrc/modules/orders/domain/order.ts:3",
        "MER-BT-016\tsrc/modules/orders/domain/order.ts:2",
        "MER-BT-017\tsrc/modules/orders/test/env.ts:1",
    ]);
});

test("the BT pack takes a workspace package's own test/ tree as its package's tests", () => {
    const findings = scan({
        "package.json": '{"private":true,"workspaces":["packages/*"]}\n',
        "packages/api/package.json": '{"name":"api"}\n',
        "packages/api/src/modules/orders/application/submit.ts": "export const submit = () => 1;\n",
        "packages/api/test/env.ts": "export const mode = process.env.MODE;\n",
        "packages/api/src/tests/env.ts": "export const mode = process.env.MODE;\n",
    }, ["--rule", "MER-BT-017"]);
    assert.deepEqual(findings, ["MER-BT-017\tpackages/api/src/tests/env.ts:1"]);
});

test("the BT pack measures a test tree from a Nuxt root that has no package.json, and a settings-only pnpm-workspace.yaml leaves its package a package", () => {
    // A Nuxt app nested in a repo package without its own package.json: its tests/ tree is tests for every rule.
    assert.deepEqual(scan({
        "package.json": '{"name":"repo"}\n',
        "web/nuxt.config.ts": "export default {}\n",
        "web/tests/support/env.ts": "export const mode = process.env.MODE;\n",
    }, ["--rule", "MER-BT-017"]), []);
    // pnpm keeps settings in pnpm-workspace.yaml too; without `packages:` it declares no workspace, so lib/test/ is
    // a folder inside the package, not its top-level test tree.
    assert.deepEqual(scan({
        "package.json": '{"name":"tool"}\n',
        "pnpm-workspace.yaml": "onlyBuiltDependencies:\n  - esbuild\n",
        "lib/test/env.ts": "export const mode = process.env.MODE;\n",
    }, ["--rule", "MER-BT-017"]), ["MER-BT-017\tlib/test/env.ts:1"]);
});

test("a file with no package is measured from the repository root, so only a top-level test tree is tests", () => {
    const env = "export const mode = process.env.MODE;\n";
    assert.deepEqual(scan({
        "test/env.ts": env,
        "docs/test/env.ts": env,
        "infra/tests/env.ts": env,
    }, ["--rule", "MER-BT-017"]), [
        "MER-BT-017\tdocs/test/env.ts:1",
        "MER-BT-017\tinfra/tests/env.ts:1",
    ]);
});

test("MER-BT-016 skips a Nuxt app/ tree beside a TypeScript backend but still checks the backend's application layer", () => {
    const findings = scan({
        "package.json": '{"private":true,"workspaces":["web","api"]}\n',
        "web/package.json": '{"name":"web"}\n',
        "web/nuxt.config.ts": "export default {}\n",
        "web/app/composables/useClock.ts": "export const useClock = () => Date.now();\n",
        "api/package.json": '{"name":"api"}\n',
        "api/src/modules/orders/application/submit-order.ts": "export const submittedAt = () => Date.now();\n",
    }, ["--rule", "MER-BT-016"]);
    assert.deepEqual(findings, ["MER-BT-016\tapi/src/modules/orders/application/submit-order.ts:1"]);
});

test("the BT layer rules read a Nuxt frontend's app/ and modules/ trees as frontend code", () => {
    const nuxt = {
        "package.json": '{"name":"web"}\n',
        "tsconfig.json": '{"compilerOptions":{"baseUrl":"."}}\n',
        "nuxt.config.ts": "export default {}\n",
        "src/app/composables/useOrders.ts": 'import { container } from "tsyringe";\nexport const useOrders = () => container.resolve("orders");\n',
        "modules/billing/runtime/plugin.ts": 'import { internal } from "../../orders/runtime/internal";\nexport const plugin = internal;\n',
        "modules/orders/runtime/internal.ts": "export const internal = 1;\n",
    };
    assert.deepEqual(scan(nuxt, ["--rule", "MER-BT-012"]), []);
    assert.deepEqual(scan(nuxt, ["--rule", "MER-BT-015"]), []);
});

test("MER-FE-043 exempts the frontend root's tests/ and e2e/ trees but checks a tests/ folder inside the app", () => {
    const useState = 'export const flag = useState("flag", () => false);\n';
    const findings = scan({
        "nuxt.config.ts": "export default {}\n",
        "app/pages/tests/debug.ts": useState,
        "app/components/__tests__/harness.ts": useState,
        "tests/support/mount.ts": useState,
        "e2e/helpers.ts": useState,
    }, ["--rule", "MER-FE-043"]);
    assert.deepEqual(findings, ["MER-FE-043\tapp/pages/tests/debug.ts:1"]);
});

test("MER-RV-021 counts only production configureRivet calls toward the once-per-app bootstrap", () => {
    const base = {
        "rivet-pack-marker.cs": "// [RivetContract] pack marker\n",
        "nuxt.config.ts": "export default {}\n",
        "app/plugins/rivet.client.ts": "configureRivet();\n",
        "tests/setup.ts": "configureRivet();\n",
        "app/utils/boot.test.ts": "configureRivet();\n",
    };
    assert.deepEqual(scan(base, ["--rule", "MER-RV-021"]), []);
    assert.deepEqual(scan({ ...base, "app/utils/tests/boot.ts": "configureRivet();\n" }, ["--rule", "MER-RV-021"]), [
        "MER-RV-021\tapp/plugins/rivet.client.ts:1",
        "MER-RV-021\tapp/utils/tests/boot.ts:1",
    ]);
});
