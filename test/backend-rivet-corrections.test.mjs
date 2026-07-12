#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKS = path.join(HOME, "checks");
const FIXTURES = path.join(HOME, "fixtures");

function run(rule, fixture) {
    const script = {
        "MER-BE-001": "MER-BE-001-layer-usings.sh",
        "MER-BE-005": "MER-BE-005-cross-module.mjs",
        "MER-BE-006": "MER-BE-006-common-single-consumer.mjs",
        "MER-BE-009": "MER-BE-009-no-service-locator.sh",
        "MER-BE-022": "MER-BE-022-usecase-ct.sh",
        "MER-BE-040": "MER-BE-040-repository-dto.mjs",
        "MER-RV-003": "MER-RV-003-contract-invoke.sh",
        "MER-RV-001": "MER-RV-001-no-rivetclient.mjs",
        "MER-RV-002": "MER-RV-002-routes-from-contract.mjs",
        "MER-RV-006": "MER-RV-006-contract-purity.mjs",
        "MER-RV-007": "MER-RV-007-result-extension-owner.mjs",
        "MER-RV-008": "MER-RV-008-program-endpoints.sh",
        "MER-RV-009": "MER-RV-009-endpoint-builder-target.sh",
        "MER-RV-010": "MER-RV-010-contract-location.mjs",
        "MER-TE-001": "MER-TE-001-architecture-enforcement.mjs",
        "MER-TE-007": "MER-TE-007-no-ef-inmemory.sh",
    }[rule];
    const result = spawnSync(path.join(CHECKS, script), [path.join(FIXTURES, rule, fixture)], {
        encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
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

test("MER-RV-007 scopes owners to the nearest project and sees nested generic receivers", () => {
    assert.equal(run("MER-RV-007", "good"), "");
    assert.equal((run("MER-RV-007", "bad").match(/^MER-RV-007\t/gm) || []).length, 2);
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
