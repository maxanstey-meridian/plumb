import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Capability, planCapabilities, defineRepositoryRule, defineSyntaxRule, createRuleDescriptor } from "../lib/engine/contracts.mjs";
import { createRepositoryContext } from "../lib/engine/repository-context.mjs";
import { createRepositorySnapshot } from "../lib/engine/repository-snapshot.mjs";
import { runInProcessRules } from "../lib/engine/run-rules.mjs";

function fixture(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-typescript-engine-"));
  for (const [relative, text] of Object.entries(contents)) {
    const file = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const files = Object.keys(contents).filter((file) => !file.startsWith("node_modules/"));
  const snapshot = createRepositorySnapshot({ root, mode: "test", files });
  return { root, snapshot, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const contextFor = (snapshot, capabilities = [Capability.TYPESCRIPT], options = {}) =>
  createRepositoryContext(snapshot, planCapabilities([{ requirements: capabilities }]), options);

test("TypeScript sources are lazy, shared by identity, and use correct script kinds with parent links", async () => {
  const f = fixture({
    "src/a.ts": "export const a = 1;",
    "src/b.tsx": "export const B = <div />;",
    "src/e.mts": "export const e = 1;",
    "src/f.cts": "export const f = 1;",
    "src/c.js": "export const c = 1;",
    "src/d.jsx": "export const D = <div />;",
  });
  try {
    let loads = 0;
    const repository = contextFor(f.snapshot, [Capability.TYPESCRIPT], { typescriptLoader: async () => { loads++; return import("typescript"); } });
    assert.equal(f.snapshot.counters.typescriptParses, 0);
    assert.equal(f.snapshot.counters.typescriptRuntimeLoads, 0);
    const serviceOne = repository.context.typescript;
    const serviceTwo = repository.owner(createRuleDescriptor({ id: "MER-TO-901", source: "consumer.mjs" })).typescript;
    const file = repository.context.file("src/a.ts");
    const [first, second] = await Promise.all([serviceOne.source(file), serviceTwo.source(file)]);
    assert.equal(first, second);
    assert.equal(first.sourceFile.statements[0].parent, first.sourceFile);
    assert.equal(first.lineOf(first.sourceFile.statements[0]), 1);
    assert.ok(Object.isFrozen(first));
    assert.equal(Object.isFrozen(first.sourceFile), false);
    assert.equal(f.snapshot.counters.typescriptParses, 1);
    assert.throws(() => serviceOne.source({ ...file }), /does not belong/);
    assert.equal(loads, 1);
    const kinds = await Promise.all(["src/a.ts", "src/b.tsx", "src/c.js", "src/d.jsx", "src/e.mts", "src/f.cts"].map(async (name) => (await serviceOne.source(repository.context.file(name))).kind));
    assert.deepEqual(kinds, ["TS", "TSX", "JS", "JSX", "TS", "TS"]);
  } finally { f.cleanup(); }
});

test("Vue extraction is shared, preserves exact offsets and original CRLF lines, and parses each block once", async () => {
  const source = '<script setup lang="ts">const a = 1;\r\nconst b = 2;</script>\r\n<template/>\r\n<script lang="jsx">export const C = <div/>;</script>';
  const f = fixture({ "app.vue": source });
  try {
    const repository = contextFor(f.snapshot);
    const service = repository.context.typescript;
    const file = repository.context.file("app.vue");
    const all = service.vueScripts(file);
    assert.equal(service.vueScript(file), all[0]);
    assert.equal(service.vueScripts(file), all);
    assert.equal(all.length, 2);
    assert.equal(all[0].text, "const a = 1;\r\nconst b = 2;");
    assert.equal(source.slice(all[0].bodyStart, all[0].bodyEnd), all[0].text);
    assert.deepEqual([all[0].language, all[0].kind, all[1].language, all[1].kind], ["ts", "TS", "jsx", "JSX"]);
    assert.equal(all[0].originalLine(0), 1);
    assert.equal(all[0].originalLine(all[0].text.indexOf("const b")), 2);
    assert.equal(all[1].originalLine(0), 4);
    assert.equal(f.snapshot.counters.vueExtractions, 1);
    const [parsed, same] = await Promise.all([service.vueSource(all[0]), service.vueSource(all[0])]);
    assert.equal(parsed, same);
    assert.equal(parsed.sourceFile.statements[0].parent, parsed.sourceFile);
    assert.equal(parsed.lineOf(parsed.sourceFile.statements[1]), 2);
    assert.equal(f.snapshot.counters.vueScriptParses, 1);
  } finally { f.cleanup(); }
});

test("nearest visible tsconfigs own distinct cached options and alias/negative resolutions", async () => {
  const f = fixture({
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@value": ["src/root-value.ts"] } } }),
    "src/root.ts": "import '@value';",
    "src/root-value.ts": "export {};",
    "packages/child/tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@value": ["src/child-value.ts"] } } }),
    "packages/child/src/child.ts": "import '@value';",
    "packages/child/src/child-value.ts": "export {};",
  });
  try {
    const repository = contextFor(f.snapshot);
    const service = repository.context.typescript;
    const rootFile = repository.context.file("src/root.ts");
    const childFile = repository.context.file("packages/child/src/child.ts");
    assert.equal(service.nearestConfig(rootFile), "tsconfig.json");
    assert.equal(service.nearestConfig(childFile), "packages/child/tsconfig.json");
    const [rootOptions, rootOptionsAgain, childOptions] = await Promise.all([
      service.compilerOptions(rootFile), service.compilerOptions(rootFile), service.compilerOptions(childFile),
    ]);
    assert.equal(rootOptions, rootOptionsAgain);
    assert.notEqual(rootOptions, childOptions);
    const [rootResolved, childResolved] = await Promise.all([service.resolve(rootFile, "@value"), service.resolve(childFile, "@value")]);
    assert.equal(rootResolved, path.join(fs.realpathSync(f.root), "src/root-value.ts"));
    assert.equal(childResolved, path.join(fs.realpathSync(f.root), "packages/child/src/child-value.ts"));
    const missing = await service.resolve(childFile, "@missing");
    assert.equal(await service.resolve(childFile, "@missing"), missing);
    assert.equal(missing, null);
    assert.equal(f.snapshot.counters.tsconfigParses, 2);
    assert.equal(f.snapshot.counters.tsconfigDiscoveries, 2);
    assert.equal(f.snapshot.counters.moduleResolutions, 3);
    assert.deepEqual(repository.diagnostics(), []);
  } finally { f.cleanup(); }
});

test("relative imports stay syntactic, installed packages are excluded, and workspace symlinks are retained", async () => {
  const f = fixture({
    "tsconfig.json": JSON.stringify({ compilerOptions: { moduleResolution: "node", preserveSymlinks: false } }),
    "src/use.ts": "",
    "packages/shared/index.ts": "export {};",
    "packages/shared/package.json": JSON.stringify({ name: "@scope/shared", types: "index.ts" }),
    "node_modules/external/package.json": JSON.stringify({ name: "external", types: "index.d.ts" }),
    "node_modules/external/index.d.ts": "export {};",
  });
  try {
    fs.mkdirSync(path.join(f.root, "node_modules/@scope"), { recursive: true });
    fs.symlinkSync(path.join(f.root, "packages/shared"), path.join(f.root, "node_modules/@scope/shared"), "dir");
    const repository = contextFor(f.snapshot);
    const service = repository.context.typescript;
    const from = repository.context.file("src/use.ts");
    assert.equal(await service.resolve(from, "./does-not-need-to-exist"), path.join(fs.realpathSync(f.root), "src/does-not-need-to-exist"));
    assert.equal(await service.resolve(from, "external"), null);
    assert.equal(await service.resolve(from, "@scope/shared"), path.join(fs.realpathSync(f.root), "packages/shared/index.ts"));
  } finally { f.cleanup(); }
});

test("missing TypeScript and parser failures are each memoized without findings or crashes", async () => {
  const f = fixture({ "a.ts": "const a = 1;" });
  try {
    let loads = 0;
    const missing = contextFor(f.snapshot, [Capability.TYPESCRIPT], { typescriptLoader: async () => { loads++; throw new Error("missing"); } });
    const file = missing.context.file("a.ts");
    assert.equal(await missing.context.typescript.source(file), null);
    assert.equal(await missing.context.typescript.source(file), null);
    assert.equal(loads, 1);
    assert.equal(missing.diagnostics().length, 1);

    const failure = new Error("parse failed");
    const brokenFixture = fixture({ "b.ts": "const b = 1;" });
    try {
      const broken = contextFor(brokenFixture.snapshot, [Capability.TYPESCRIPT], { typescriptLoader: async () => ({
        ScriptKind: { TS: 1 }, ScriptTarget: { Latest: 99 },
        createSourceFile() { throw failure; },
      }) });
      const promise = broken.context.typescript.source(broken.context.file("b.ts"));
      await assert.rejects(promise, (error) => error === failure);
      await assert.rejects(broken.context.typescript.source(broken.context.file("b.ts")), (error) => error === failure);
      assert.equal(brokenFixture.snapshot.counters.typescriptParses, 1);
    } finally { brokenFixture.cleanup(); }
  } finally { f.cleanup(); }
});

test("runner returns optional dependency diagnostics instead of writing or crashing", async () => {
  const f = fixture({ "a.ts": "const a = 1;" });
  try {
    const rule = defineRepositoryRule({
      descriptor: createRuleDescriptor({ id: "MER-TO-901", source: "typescript-test.mjs" }),
      requirements: [Capability.TYPESCRIPT],
      async analyze(context) { await context.typescript.source(context.file("a.ts")); },
    });
    const result = await runInProcessRules(f.snapshot, [rule], planCapabilities([rule]), { typescriptLoader: async () => { throw new Error("missing"); } });
    assert.deepEqual(result.findings, []);
    assert.equal(result.diagnostics.length, 1);
  } finally { f.cleanup(); }
});

test("syntax rules share one parse and one traversal dispatch", async () => {
  const f = fixture({ "a.ts": "export const answer = 42;" });
  try {
    const visits = [0, 0];
    const rules = visits.map((_, index) => defineSyntaxRule({
      descriptor: createRuleDescriptor({ id: `MER-TO-90${index + 1}`, source: `syntax-${index}.mjs` }),
      language: "typescript",
      register(visitor) { visitor.onNode(() => visits[index]++); },
    }));
    await runInProcessRules(f.snapshot, rules, planCapabilities(rules));
    assert.ok(visits[0] > 1);
    assert.equal(visits[0], visits[1]);
    assert.equal(f.snapshot.counters.typescriptParses, 1);
  } finally { f.cleanup(); }
});

test("tsconfig failures and negative results are cached with one diagnostic per config", async () => {
  const f = fixture({ "tsconfig.json": "{", "a.ts": "" });
  try {
    const repository = contextFor(f.snapshot);
    const file = repository.context.file("a.ts");
    assert.equal(await repository.context.typescript.resolve(file, "@missing"), null);
    assert.equal(await repository.context.typescript.resolve(file, "@missing"), null);
    assert.equal(f.snapshot.counters.tsconfigParses, 1);
    assert.equal(f.snapshot.counters.moduleResolutions, 1);
    assert.equal(repository.diagnostics().length, 1);
  } finally { f.cleanup(); }
});
