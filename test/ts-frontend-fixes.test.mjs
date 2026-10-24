#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runProducer(id, fixture) {
  const out = spawnSync(path.join(HOME, "plumb"), [path.join(HOME, "fixtures", id, fixture), "--rule", id, "--json", "--ci"], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  const findings = JSON.parse(out.stdout || "[]");
  return {
    ...out,
    status: [0, 1].includes(out.status) ? 0 : out.status,
    stdout: findings.map((finding) => `${finding.rule}\t${finding.severity}\t${finding.location}\t${finding.message}\t${finding.docRef}`).join("\n") + (findings.length ? "\n" : ""),
  };
}

test("FE-020 finds real provideX calls in TS and Vue without matching comments or strings", () => {
  const bad = runProducer("MER-FE-020", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /app\/components\/DigitProvider\.ts:1/);
  assert.match(bad.stdout, /app\/pages\/x\/components\/Panel\.vue:3/);

  const good = runProducer("MER-FE-020", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
});

test("FE-020 follows imported aliases and namespace property calls", () => {
  const bad = runProducer("MER-FE-020", "bad");
  assert.match(bad.stdout, /AliasedProvider\.ts:4/);
  assert.match(bad.stdout, /AliasedProvider\.ts:5/);

  const good = runProducer("MER-FE-020", "good");
  assert.equal(good.stdout, "");
});

test("FE-020 exempts test sources but not a tests folder inside the app tree", () => {
  const good = runProducer("MER-FE-020", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.doesNotMatch(good.stdout, /tests\/pages\/panel\.spec\.ts/);
  assert.doesNotMatch(good.stdout, /tests\/support\/mount-with-auth\.ts/);
  assert.doesNotMatch(good.stdout, /tests\/support\/AuthHarness\.vue/);
  assert.doesNotMatch(good.stdout, /Panel\.spec\.ts/);

  const bad = runProducer("MER-FE-020", "bad");
  assert.match(bad.stdout, /app\/pages\/tests\/composables\/useProbe\.ts:1/);
});

test("FE-030 warns on page-local index shims but permits public feature and generated entry points", () => {
  const bad = runProducer("MER-FE-030", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /app\/pages\/x\/exports\.ts:1/);
  assert.match(bad.stdout, /app\/pages\/x\/index\.ts:1/);
  assert.doesNotMatch(bad.stdout, /app\/features\/auth\/index\.ts/);

  const good = runProducer("MER-FE-030", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
});

test("FE-032 enforces root and app page/layout subtree boundaries", () => {
  const bad = runProducer("MER-FE-032", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /pages\/a\/composables\/use-root\.ts:1/);
  assert.match(bad.stdout, /app\/layouts\/default\/composables\/use-shell\.ts:1/);
  assert.match(bad.stdout, /app\/pages\/a\/composables\/register-b\.ts:1/);

  const good = runProducer("MER-FE-032", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
});

test("BT-020 treats handler names as transport only outside architectural layers", () => {
  const bad = runProducer("MER-BT-020", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /src\/modules\/orders\/order-handler\.ts:1/);

  const good = runProducer("MER-BT-020", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
});

test("BT-014 rejects inline import types that expose a module domain", () => {
  const bad = runProducer("MER-BT-014", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /inline-order-reader\.ts:1/);
});

test("BT-014 inspects exported functions and exported const callable signatures", () => {
  const bad = runProducer("MER-BT-014", "bad");
  assert.match(bad.stdout, /function-order-reader\.ts:3/);
  assert.match(bad.stdout, /function-order-reader\.ts:7/);
});

test("BT-015 follows namespace imports and simple container aliases", () => {
  const bad = runProducer("MER-BT-015", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /namespace-container\.ts:6/);
});

test("BT-016 applies Date shadowing lexically", () => {
  const bad = runProducer("MER-BT-016", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /shadowed-date\.ts:3.*globalThis\.Date\.now/);
  assert.match(bad.stdout, /shadowed-date\.ts:6.*Date\.now/);
  assert.doesNotMatch(bad.stdout, /shadowed-date\.ts:3.*via Date\.now/);
});

test("BT-017 permits root config trees, workspace package config, and build-tool config, but not module-local config", () => {
  const good = runProducer("MER-BT-017", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "", `expected no warnings, got: ${good.stdout}`);

  const bad = runProducer("MER-BT-017", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /modules\/orders\/config\/database\.ts:1/);
  assert.match(bad.stdout, /app\/orders\.config\.ts:1/);
});

test("BT-017 applies process and globalThis.process shadowing lexically", () => {
  const bad = runProducer("MER-BT-017", "bad");
  assert.match(bad.stdout, /lexical-process\.ts:5.*process\.env/);
  assert.match(bad.stdout, /lexical-process\.ts:11.*globalThis\.process\.env/);
  assert.doesNotMatch(bad.stdout, /lexical-process\.ts:(?:2|8)\b/);
});

test("FE-011 reports malformed provide/inject tuple arity", () => {
  const bad = runProducer("MER-FE-011", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /auth\.ts:5.*exactly two elements/);
});

test("FE-013 checks port declarations exported through a later list", () => {
  const bad = runProducer("MER-FE-013", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /auth\.ts:5.*BillingService/);
});

test("FE-014 validates the returned inject function and supports declarations", () => {
  const bad = runProducer("MER-FE-014", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /app\/composables\/useProvideInject\.ts:1/);

  const good = runProducer("MER-FE-014", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
});

test("FE-014 rejects a guard that throws when injection is present", () => {
  const bad = runProducer("MER-FE-014", "bad");
  assert.match(bad.stdout, /polarity\/composables\/useProvideInject\.ts:1/);
});

test("FE-021 ignores type-only composable imports", () => {
  const good = runProducer("MER-FE-021", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
});

test("FE-040 accepts a function exported under the matching alias", () => {
  const good = runProducer("MER-FE-040", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
});

const locations = (stdout) => stdout.split("\n").filter(Boolean).map((line) => line.split("\t")[2]).sort();

test("FE-045 reports each unlabelled control once, including a tests folder inside the app tree", () => {
  const bad = runProducer("MER-FE-045", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.deepEqual(locations(bad.stdout), [
    "app/components/NameField.vue:7",
    "app/components/NameField.vue:8",
    "app/components/OrderRow.vue:14",
    "app/components/OrderRow.vue:21",
    "app/components/OrderRow.vue:7",
    "app/components/OrderRow.vue:8",
    "app/pages/tests/index.vue:6",
  ]);
});

test("TE-009 flags hand-written stand-ins, including json/body that replaces a fetched response", () => {
  const bad = runProducer("MER-TE-009", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.deepEqual(locations(bad.stdout), [
    "ui/e2e/orders.spec.ts:10",
    "ui/e2e/orders.spec.ts:11",
    "ui/e2e/orders.spec.ts:12",
    "ui/e2e/orders.spec.ts:15",
    "ui/e2e/orders.spec.ts:23",
    "ui/e2e/orders.spec.ts:29",
    "ui/e2e/orders.spec.ts:8",
  ]);

  const good = runProducer("MER-TE-009", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
});

test("TE-009 reads test folders relative to a nested frontend root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-te009-root-"));
  try {
    const support = path.join(root, "src", "web", "e2e", "support");
    fs.mkdirSync(support, { recursive: true });
    fs.writeFileSync(path.join(support, "orders.ts"), 'import type { Route } from "@playwright/test";\nexport const stubOrders = (route: Route) => route.fulfill({ json: [{ id: "1" }] });\n');
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
    const run = () => {
      const out = spawnSync(path.join(HOME, "plumb"), [root, "--rule", "MER-TE-009", "--json", "--ci"], { encoding: "utf8" });
      assert.ok([0, 1].includes(out.status), out.stderr);
      return JSON.parse(out.stdout || "[]").map((finding) => finding.location);
    };
    // Without a frontend root, `src` is an app tree, so e2e/ beneath it isn't a test folder.
    assert.deepEqual(run(), []);
    fs.writeFileSync(path.join(root, "src", "web", "nuxt.config.ts"), "export default defineNuxtConfig({});\n");
    assert.deepEqual(run(), ["src/web/e2e/support/orders.ts:2"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("FE-006/007/010/015 skip a Nuxt fixture app under tests/ by the shared frontend test-source definition", () => {
  const good = runProducer("MER-FE-010", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
  // The same port file in a frontend root outside tests/ is app code and is reported.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-fe010-root-"));
  try {
    const app = path.join(HOME, "fixtures", "MER-FE-010", "good", "tests", "fixtures", "portal");
    fs.cpSync(app, path.join(root, "portal"), { recursive: true });
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
    const out = spawnSync(path.join(HOME, "plumb"), [root, "--rule", "MER-FE-010", "--json", "--ci"], { encoding: "utf8" });
    assert.ok([0, 1].includes(out.status), out.stderr);
    assert.deepEqual(JSON.parse(out.stdout || "[]").map((finding) => finding.location), ["portal/app/pages/index/ports/auth.ts:8"]);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
