import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRepositoryInventory, writeInventoryManifest } from "../lib/repository-inventory.mjs";
import { walkFiles } from "../checks/_lib/fs-scan.mjs";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cleanup = [];
process.on("exit", () => cleanup.splice(0).forEach((directory) => fs.rmSync(directory, { recursive: true, force: true })));

function temporaryRepository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-inventory-"));
  cleanup.push(root);
  return root;
}

function write(root, relative, content = "") {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("Git inventory includes tracked and untracked visible files but excludes ignored paths", () => {
  const root = temporaryRepository();
  spawnSync("git", ["init", "-q"], { cwd: root });
  write(root, ".gitignore", "ignored/\nbuild/\nvendor/\n");
  write(root, "tracked.ts");
  write(root, "deleted.ts");
  write(root, "untracked file.ts");
  write(root, "ignored/hidden.ts");
  write(root, "build/output.ts");
  write(root, "vendor/tracked.ts");
  assert.equal(spawnSync("git", ["add", "tracked.ts", "deleted.ts", "-f", "vendor/tracked.ts"], { cwd: root }).status, 0);
  fs.rmSync(path.join(root, "deleted.ts"));

  const inventory = createRepositoryInventory(root);
  assert.equal(inventory.mode, "git");
  assert.ok(inventory.files.includes("tracked.ts"));
  assert.ok(inventory.files.includes("untracked file.ts"));
  assert.ok(inventory.files.includes("vendor/tracked.ts"));
  assert.ok(!inventory.files.includes("deleted.ts"));
  assert.ok(!inventory.files.includes("ignored/hidden.ts"));
  assert.ok(!inventory.files.includes("build/output.ts"));
  assert.ok(inventory.files.every((file) => !file.includes("\\")));
});

test("nested Git target receives canonical paths relative to the target", () => {
  const repository = temporaryRepository();
  spawnSync("git", ["init", "-q"], { cwd: repository });
  write(repository, "apps/web/source file.ts");
  write(repository, "outside.ts");
  const inventory = createRepositoryInventory(path.join(repository, "apps", "web"));
  assert.deepEqual(inventory.files, ["source file.ts"]);
});

test("non-Git fallback traverses once and applies the fallback skip set", () => {
  const root = temporaryRepository();
  write(root, "src/source file.ts");
  write(root, "node_modules/pkg/index.ts");
  write(root, "build/output.js");
  const inventory = createRepositoryInventory(root);
  assert.equal(inventory.mode, "fallback");
  assert.deepEqual(inventory.files, ["src/source file.ts"]);
});

test("non-Git fallback remains available when Git is not installed", () => {
  const root = temporaryRepository();
  write(root, "source.ts");
  const previousPath = process.env.PATH;
  process.env.PATH = temporaryRepository();
  try {
    assert.deepEqual(createRepositoryInventory(root).files, ["source.ts"]);
  } finally {
    process.env.PATH = previousPath;
  }
});

test(".plumbignore and explicit excludes use gitignore pattern semantics", () => {
  const root = temporaryRepository();
  spawnSync("git", ["init", "-q"], { cwd: root });
  write(root, ".plumbignore", "fixtures/\n*.generated.ts\n!src/keep.generated.ts\n");
  write(root, "fixtures/bad/source.ts");
  write(root, "src/drop.generated.ts");
  write(root, "src/keep.generated.ts");
  write(root, "coverage/report.json");
  write(root, "src/main.ts");

  const inventory = createRepositoryInventory(root, { excludes: ["coverage/"] });
  assert.deepEqual(inventory.files, [".plumbignore", "src/keep.generated.ts", "src/main.ts"]);
});

test("manifest traversal retains dot-dot-prefixed names and excludes file symlinks", () => {
  const root = temporaryRepository();
  write(root, "..config.ts");
  write(root, "..generated/source.ts");
  const external = path.join(temporaryRepository(), "external.ts");
  fs.writeFileSync(external, "external\n");
  fs.symlinkSync(external, path.join(root, "linked.ts"));
  const inventory = createRepositoryInventory(root);
  assert.deepEqual(inventory.files, ["..config.ts", "..generated/source.ts"]);
  const manifest = writeInventoryManifest(inventory);
  const previousManifest = process.env.PLUMB_FILE_MANIFEST;
  const previousRoot = process.env.PLUMB_REPO_ROOT;
  process.env.PLUMB_FILE_MANIFEST = manifest.file;
  process.env.PLUMB_REPO_ROOT = inventory.root;
  try {
    assert.deepEqual([...walkFiles(root)].map((file) => path.relative(inventory.root, file)).sort(), ["..config.ts", "..generated/source.ts"]);
  } finally {
    if (previousManifest === undefined) delete process.env.PLUMB_FILE_MANIFEST;
    else process.env.PLUMB_FILE_MANIFEST = previousManifest;
    if (previousRoot === undefined) delete process.env.PLUMB_REPO_ROOT;
    else process.env.PLUMB_REPO_ROOT = previousRoot;
    manifest.cleanup();
  }
});

test("manifest is NUL-delimited and cleanup removes its private directory", () => {
  const root = temporaryRepository();
  write(root, "path with spaces/file.ts");
  const manifest = writeInventoryManifest(createRepositoryInventory(root));
  const directory = path.dirname(manifest.file);
  assert.equal(fs.readFileSync(manifest.file, "utf8"), "path with spaces/file.ts\0");
  manifest.cleanup();
  assert.ok(!fs.existsSync(directory));
});

test("legacy producers contain no independent recursive repository discovery", () => {
  const checks = path.join(HOME, "checks");
  for (const name of fs.readdirSync(checks).filter((entry) => entry.endsWith(".sh"))) {
    const source = fs.readFileSync(path.join(checks, name), "utf8");
    assert.doesNotMatch(source, /^\s*(?:\w+=\$\()?find\s/gm, `${name} invokes find`);
    for (const command of source.replaceAll("\\\n", " ").split("\n")) {
      if (/\brg\b/.test(command) && !/manifest_rg/.test(command)) {
        assert.doesNotMatch(command, /["']?\$root["']?/, `${name} runs recursive rg against the repository root`);
      }
    }
  }

  const scan = fs.readFileSync(path.join(checks, "_lib", "fs-scan.mjs"), "utf8");
  assert.doesNotMatch(scan, /spawnSync|ls-files|readdirSync/);
});
