#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveTsImport } from "../checks/_lib/ts-resolution.mjs";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runProducer(id, fixture) {
  const name = fs.readdirSync(path.join(HOME, "checks")).find((entry) => entry.startsWith(id));
  assert.ok(name, `producer ${id} not found`);
  return spawnSync(path.join(HOME, "checks", name), [path.join(HOME, "fixtures", id, fixture)], { encoding: "utf8" });
}

test("TS resolution excludes installed packages but retains workspace symlink targets", (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-ts-resolution-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));

  const root = path.join(fixture, "repo");
  const workspace = path.join(fixture, "workspace-package");
  const source = path.join(root, "src", "main.ts");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", "external-package"), { recursive: true });
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { moduleResolution: "node" } }));
  fs.writeFileSync(source, "export {}\n");
  fs.writeFileSync(path.join(root, "node_modules", "external-package", "package.json"), JSON.stringify({ types: "index.ts" }));
  fs.writeFileSync(path.join(root, "node_modules", "external-package", "index.ts"), "export const external = true;\n");
  fs.writeFileSync(path.join(workspace, "package.json"), JSON.stringify({ name: "workspace-package", types: "index.ts" }));
  fs.writeFileSync(path.join(workspace, "index.ts"), "export const workspaceValue = true;\n");
  fs.symlinkSync(workspace, path.join(root, "node_modules", "workspace-package"), "dir");

  assert.equal(resolveTsImport(root, source, "external-package"), null);
  assert.equal(resolveTsImport(root, source, "workspace-package"), fs.realpathSync(path.join(workspace, "index.ts")));
});

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

test("BT-017 permits root config trees but not module-local config", () => {
  const good = runProducer("MER-BT-017", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");

  const bad = runProducer("MER-BT-017", "bad");
  assert.equal(bad.status, 0, bad.stderr);
  assert.match(bad.stdout, /modules\/orders\/config\/database\.ts:1/);
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
