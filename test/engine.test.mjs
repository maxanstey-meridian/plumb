import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Capability,
  createConfigParser,
  createRuleDescriptor,
  defineFileRule,
  defineRepositoryRule,
  planCapabilities,
} from "../lib/engine/contracts.mjs";
import { createRepositoryContext, createLineMap } from "../lib/engine/repository-context.mjs";
import { createRepositorySnapshot } from "../lib/engine/repository-snapshot.mjs";
import { runInProcessRules } from "../lib/engine/run-rules.mjs";
import { loadRuleOwners } from "../lib/rule-catalog.mjs";
import { detectRivetContext } from "../lib/rivet-context.mjs";

const descriptor = (id, source = "test-rule.mjs") => createRuleDescriptor({ id, source });
const inventory = (files = ["src/a.ts"], root = "/repository") => ({ root, mode: "test", files });

test("capability planning closes dependencies, rejects unknown capabilities, and descriptors support multiple IDs", () => {
  const rule = defineRepositoryRule({ descriptor: descriptor("MER-TO-901"), requirements: [Capability.FRONTEND_GRAPH], analyze() {} });
  assert.deepEqual(planCapabilities([rule]), [Capability.TYPESCRIPT, Capability.FRONTEND_ROOTS, Capability.FRONTEND_GRAPH]);
  assert.throws(() => planCapabilities([{ requirements: ["unknown"] }]), /unknown capability/);
  const multi = createRuleDescriptor({ ids: ["MER-TO-901", "MER-TO-902"], source: "family.mjs" });
  assert.deepEqual(multi.ids, ["MER-TO-901", "MER-TO-902"]);
  assert.throws(() => createRuleDescriptor({ ids: ["MER-TO-901", "MER-FE-902"], source: "mixed.mjs" }), /multiple packs/);
});

test("snapshot interns files and memoizes successful and failed physical reads", () => {
  let reads = 0;
  const snapshot = createRepositorySnapshot(inventory(["a.ts"]), { readFile() { reads++; return "source"; } });
  const file = snapshot.file("a.ts");
  assert.equal(snapshot.file("a.ts"), file);
  assert.equal(snapshot.text(file), "source");
  assert.equal(snapshot.text(file), "source");
  assert.equal(reads, 1);
  assert.throws(() => snapshot.text({ path: "a.ts" }), /does not belong/);

  const failure = new Error("unreadable");
  reads = 0;
  const broken = createRepositorySnapshot(inventory(["a.ts"]), { readFile() { reads++; throw failure; } });
  for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => broken.text(broken.file("a.ts")), (error) => error === failure);
  assert.equal(reads, 1);
  assert.equal(broken.counters.textReads, 1);
});

test("line maps preserve LF, CRLF, and terminal-newline offsets", () => {
  const lf = createLineMap("a\nb");
  assert.deepEqual(lf.lines, ["a", "b"]);
  assert.deepEqual(lf.starts, [0, 2]);
  assert.deepEqual([0, 1, 2, 3].map((offset) => lf.lineAt(offset)), [1, 1, 2, 2]);

  const crlf = createLineMap("a\r\nb");
  assert.deepEqual(crlf.lines, ["a\r", "b"]);
  assert.deepEqual(crlf.starts, [0, 3]);
  assert.deepEqual([2, 3, 4].map((offset) => crlf.lineAt(offset)), [1, 2, 2]);

  const terminal = createLineMap("a\n");
  assert.deepEqual(terminal.lines, ["a", ""]);
  assert.deepEqual(terminal.starts, [0, 2]);
  assert.equal(terminal.lineAt(2), 2);
  assert.throws(() => terminal.lineAt(3), /invalid text offset/);
});

test("line-map failures are memoized", () => {
  let reads = 0;
  const failure = new Error("unreadable");
  const snapshot = createRepositorySnapshot(inventory(["a.ts"]), { readFile() { reads++; throw failure; } });
  const repository = createRepositoryContext(snapshot, []);
  const file = repository.context.file("a.ts");
  for (let attempt = 0; attempt < 2; attempt++) assert.throws(() => file.lineMap(), (error) => error === failure);
  assert.equal(reads, 1);
  assert.equal(snapshot.counters.lineMaps, 1);
});

test("JSON results memoize success and failure and deeply freeze parsed values", () => {
  const source = new Map([["good.json", '{"nested":{"value":1}}'], ["bad.json", "{"]]);
  const snapshot = createRepositorySnapshot(inventory([...source.keys()]), { readFile(file) { return source.get(path.basename(file)); } });
  const repository = createRepositoryContext(snapshot, []);
  const good = repository.context.file("good.json").json();
  assert.equal(repository.context.file("good.json").json(), good);
  assert.ok(good.ok);
  assert.ok(Object.isFrozen(good.value));
  assert.ok(Object.isFrozen(good.value.nested));
  assert.throws(() => { good.value.nested.value = 2; }, TypeError);
  const bad = repository.context.file("bad.json").json();
  assert.equal(repository.context.file("bad.json").json(), bad);
  assert.equal(bad.ok, false);
  assert.equal(snapshot.counters.jsonParses, 2);
  assert.equal(snapshot.counters.textReads, 2);
});

test("named configuration parsing is memoized and freezes null-prototype objects", () => {
  let loads = 0, parses = 0;
  const parser = createConfigParser("null-prototype", (text) => {
    parses++;
    const value = Object.create(null);
    value.content = text;
    return value;
  });
  const snapshot = createRepositorySnapshot(inventory([]), { readFile() { throw new Error("not used"); } });
  const repository = createRepositoryContext(snapshot, [], {
    staticInputs: { golden() { loads++; return "value"; } },
  });
  const first = repository.context.staticConfig("golden", parser);
  const second = repository.context.staticConfig("golden", parser);
  assert.equal(first, second);
  assert.equal(loads, 1);
  assert.equal(parses, 1);
  assert.equal(Object.getPrototypeOf(first.value), null);
  assert.ok(Object.isFrozen(first.value));
});

test("configuration parsing rejects values that remain mutable when frozen", () => {
  const parser = createConfigParser("map", () => new Map([["key", "value"]]));
  const snapshot = createRepositorySnapshot(inventory(["config"]), { readFile() { return "value"; } });
  const repository = createRepositoryContext(snapshot, []);
  const parsed = repository.context.file("config").config(parser);
  assert.equal(parsed.ok, false);
  assert.match(parsed.error.message, /unsupported mutable parsed value/);
  assert.ok(Object.isFrozen(parsed.error));
});

test("file dispatch is central, capabilities are enforced, and shared files read once", async () => {
  let reads = 0;
  const snapshot = createRepositorySnapshot(inventory(["a.ts", "b.vue"]), { readFile() { reads++; return "match\n"; } });
  const analyzed = [];
  const makeRule = (id) => defineFileRule({
    descriptor: descriptor(id, `${id}.mjs`),
    files: (file) => file.endsWith(".ts"),
    analyze(file) { analyzed.push(`${id}:${file.path}:${file.text()}`); },
  });
  const rules = [makeRule("MER-TO-901"), makeRule("MER-TO-902")];
  await runInProcessRules(snapshot, rules, planCapabilities(rules));
  assert.deepEqual(analyzed, ["MER-TO-901:a.ts:match\n", "MER-TO-902:a.ts:match\n"]);
  assert.equal(reads, 1);
  assert.deepEqual(snapshot.counters.capabilityInitializations, {
    typescript: 0,
    "frontend-roots": 0,
    "frontend-graph": 0,
    csharp: 0,
    "dotnet-projects": 0,
  });

  const basic = createRepositoryContext(snapshot, []);
  assert.equal(basic.context.file("a.ts").text(), "match\n");
  assert.throws(() => basic.context.typescript, /capability was not planned/);
});

test("findings are owner-scoped, validated, immutable, and deterministically ordered", async () => {
  const snapshot = createRepositorySnapshot(inventory([]));
  const one = defineRepositoryRule({ descriptor: descriptor("MER-TO-902", "one.mjs"), analyze(context) {
    context.report({ severity: "warn", path: "z", line: 0, message: "z", docRef: "tools.md#z" });
  } });
  const two = defineRepositoryRule({ descriptor: descriptor("MER-TO-901", "two.mjs"), analyze(context) {
    context.report({ severity: "error", path: "b", line: 2, message: "b", docRef: "tools.md#b" });
    context.report({ severity: "error", path: "a", line: 1, message: "a", docRef: "tools.md#a" });
  } });
  const result = await runInProcessRules(snapshot, [one, two], planCapabilities([one, two]));
  assert.deepEqual(result.findings.map((finding) => `${finding.id}:${finding.loc}`), ["MER-TO-901:a:1", "MER-TO-901:b:2", "MER-TO-902:z:0"]);
  assert.ok(Object.isFrozen(result.findings));

  const repository = createRepositoryContext(snapshot, []);
  assert.throws(() => repository.owner(one.descriptor).report({ id: "MER-TO-999", severity: "warn", path: "a", line: 0, message: "x", docRef: "x" }), /undeclared rule ID/);
  assert.throws(() => repository.owner(one.descriptor).report({ severity: "fatal", path: "a", line: 0, message: "x", docRef: "x" }), /invalid severity/);
  assert.throws(() => repository.owner(one.descriptor).report({ severity: "warn", path: "../a", line: 0, message: "x", docRef: "x" }), /invalid location/);
  assert.throws(() => repository.owner(one.descriptor).report({ severity: "warn", path: "a", line: 0, message: "", docRef: "x" }), /invalid message/);
  assert.throws(() => repository.owner(one.descriptor).report({ severity: "warn", path: "a", line: 0, message: "x\ny", docRef: "x" }), /invalid message/);
});

test("mixed catalogues reject duplicate ownership", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-engine-catalog-"));
  try {
    const checks = path.join(root, "checks"), rules = path.join(root, "rules");
    fs.mkdirSync(checks);
    fs.mkdirSync(rules);
    fs.writeFileSync(path.join(checks, "MER-TO-901-owner.mjs"), "#!/usr/bin/env node\n");
    const duplicate = defineRepositoryRule({ descriptor: descriptor("MER-TO-901", "in-process.mjs"), analyze() {} });
    assert.throws(() => loadRuleOwners(checks, rules, [duplicate]), /duplicate owner for MER-TO-901/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("script owners cannot span packs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-engine-catalog-"));
  try {
    const checks = path.join(root, "checks"), rules = path.join(root, "rules");
    fs.mkdirSync(checks);
    fs.mkdirSync(rules);
    fs.writeFileSync(path.join(checks, "MER-TO-901-owner.mjs"), "// PRODUCES: MER-TO-901 MER-FE-902\n");
    assert.throws(() => loadRuleOwners(checks, rules), /IDs from multiple packs/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("snapshot caches and counters do not survive invocations", () => {
  let reads = 0;
  const options = { readFile() { reads++; return String(reads); } };
  const first = createRepositorySnapshot(inventory(["a.ts"]), options);
  const second = createRepositorySnapshot(inventory(["a.ts"]), options);
  assert.equal(first.text(first.file("a.ts")), "1");
  assert.equal(second.text(second.file("a.ts")), "2");
  assert.equal(first.counters.textReads, 1);
  assert.equal(second.counters.textReads, 1);
});

test("Rivet context preserves artifact fingerprints, package ancestry, and sorted relative directories", () => {
  const contents = new Map([
    ["package.json", '{"name":"@root/repository"}'],
    ["packages/contracts/package.json", '{"name":"@acme/contracts"}'],
    ["packages/contracts/z-generated/openapi.json", "{}"],
    ["packages/contracts/z-generated/schema.d.ts", ""],
    ["apps/web/generated/rivet/client/index.ts", ""],
    ["apps/web/generated/rivet/rivet.ts", ""],
    ["apps/web/generated/client", "this is a file, not a directory"],
  ]);
  const snapshot = createRepositorySnapshot(inventory([...contents.keys()]), {
    readFile(file) { return contents.get(file.slice("/repository/".length)); },
  });
  const context = detectRivetContext(snapshot);
  assert.equal(context.variant, "both");
  assert.deepEqual(context.v1Dirs, ["apps/web/generated/rivet"]);
  assert.deepEqual(context.v2Dirs, ["packages/contracts/z-generated"]);
  assert.deepEqual(context.contractsPackages, ["@root/repository", "@acme/contracts"]);
  assert.equal(snapshot.counters.textReads, 2);
  assert.equal(detectRivetContext(snapshot).contractsPackages[0], "@root/repository");
  assert.equal(snapshot.counters.textReads, 2);
  assert.equal(snapshot.counters.jsonParses, 2);
});

test("Rivet bootstrap and rule contexts share parsed JSON", () => {
  let reads = 0;
  const snapshot = createRepositorySnapshot(inventory([
    "package.json",
    "generated/openapi.json",
    "generated/schema.d.ts",
  ]), { readFile(file) {
    reads++;
    return file.endsWith("package.json") ? '{"name":"@acme/contracts"}' : "";
  } });
  detectRivetContext(snapshot);
  const repository = createRepositoryContext(snapshot, []);
  assert.equal(repository.context.file("package.json").json().value.name, "@acme/contracts");
  assert.equal(reads, 1);
  assert.equal(snapshot.counters.jsonParses, 1);
});
