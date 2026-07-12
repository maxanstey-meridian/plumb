#!/usr/bin/env node
// Runner harness per FABLE_CONTRACT.md §8 — run: node --test test/
// Near-metal per the skill's testing philosophy: plumb is invoked as a real
// subprocess against synthetic temp repos built from the rule fixtures. No
// mocks, no test deps beyond node:test. Pack gating is the headline coverage —
// the v4 TE-pack gap (marker in the §5 table, never implemented in detectPacks)
// is exactly the bug class self-test cannot see, because self-test bypasses
// pack detection with allPacks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUMB = path.join(HOME, "plumb");
const FIX = path.join(HOME, "fixtures");
const CHECKS = path.join(HOME, "checks");
const LINE = /^MER-[A-Z]{2}-\d{3}\t(error|warn|info)\t[^\t]+:\d+\t[^\t]+\t\S+$/;

const cleanup = [];
process.on("exit", () => { for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true }); });

function repo(fixtureBads = [], files = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-harness-"));
  cleanup.push(d);
  for (const id of fixtureBads) fs.cpSync(path.join(FIX, id, "bad"), d, { recursive: true });
  for (const [p, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(d, p)), { recursive: true });
    fs.writeFileSync(path.join(d, p), content);
  }
  return d;
}

function plumb(...args) {
  const out = spawnSync(PLUMB, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  out.ids = (out.stdout || "").split("\n").filter((l) => l.startsWith("MER-")).map((l) => l.split("\t")[0]);
  return out;
}

// ---- exit-code contract (§5) ----

test("no repo root → usage on stderr, exit 2", () => {
  const out = plumb();
  assert.equal(out.status, 2);
  assert.match(out.stderr, /usage:/);
});

test("nonexistent directory → exit 2", () => {
  const out = plumb("/nonexistent/plumb-harness-path");
  assert.equal(out.status, 2);
});

test("option requiring a value rejects a missing value with exit 2", () => {
  const r = repo();
  for (const flag of ["--fail-on", "--rule", "--pack", "--baseline", "--write-baseline"]) {
    const out = plumb(r, flag);
    assert.equal(out.status, 2, flag);
    assert.match(out.stderr, new RegExp(`${flag} requires a value`), flag);
  }
});

test("unknown flag is rejected with exit 2", () => {
  const r = repo();
  for (const flag of ["--wat", "-x"]) {
    const out = plumb(r, flag);
    assert.equal(out.status, 2, flag);
    assert.match(out.stderr, new RegExp(`unknown option ${flag}`), flag);
  }
});

test("invalid --fail-on value is rejected with exit 2", () => {
  const out = plumb(repo(), "--fail-on", "warning");
  assert.equal(out.status, 2);
  assert.match(out.stderr, /invalid --fail-on value/);
});

test("invalid --rule value is rejected with exit 2", () => {
  const out = plumb(repo(), "--rule", "TO-004");
  assert.equal(out.status, 2);
  assert.match(out.stderr, /invalid --rule value/);
});

test("invalid --pack value is rejected with exit 2", () => {
  const out = plumb(repo(), "--pack", "FE,nope");
  assert.equal(out.status, 2);
  assert.match(out.stderr, /invalid --pack value/);
});

test("conflicting baseline flags are rejected with exit 2", () => {
  const r = repo();
  const out = plumb(r, "--baseline", path.join(r, "old.json"), "--write-baseline", path.join(r, "new.json"));
  assert.equal(out.status, 2);
  assert.match(out.stderr, /--baseline and --write-baseline cannot be used together/);
});

test("clean repo → zero findings, exit 0", () => {
  const out = plumb(repo([], { "nuxt.config.ts": "export default { ssr: false }\n" }));
  assert.equal(out.status, 0);
  assert.deepEqual(out.ids, []);
  assert.match(out.stdout, /plumb: 0 error, 0 warn, 0 info/);
});

test("gitignored build/vendor-style paths do not affect scan", () => {
  const d = repo([], {
    ".gitignore": "vendor/\n",
    "App.csproj": "<Project/>\n",
    "vendor/api/Modules/Auth/Application/U.cs": "namespace Acme.Modules.Auth.Application; using Acme.Modules.Billing.Application.Ports;\n",
    "vendor/api/Modules/Billing/Application/Ports/IBilling.cs": "namespace Acme.Modules.Billing.Application.Ports; public interface IBilling {}\n",
    "vendor/api/Common/Shared.cs": "namespace Acme.Common; public sealed class Shared {}\n",
  });
  spawnSync("git", ["init", "-q"], { cwd: d });
  const out = plumb(d, "--rule", "MER-BE-005");
  assert.equal(out.status, 0);
  assert.ok(!out.ids.includes("MER-BE-005"), `gitignored vendor finding leaked: ${out.ids}`);
});

test("MER-BE-006 propagates contract consumers to enum, nested record, and collection element types", () => {
  const good = spawnSync(path.join(CHECKS, "MER-BE-006-common-single-consumer.mjs"),
    [path.join(FIX, "MER-BE-006", "good")], { encoding: "utf8" });
  assert.equal(good.status, 0);
  for (const type of ["SubmissionState", "SubmissionDetails", "SubmissionItem"]) {
    assert.doesNotMatch(good.stdout, new RegExp(`Common type ${type} `));
  }

  const bad = spawnSync(path.join(CHECKS, "MER-BE-006-common-single-consumer.mjs"),
    [path.join(FIX, "MER-BE-006", "bad")], { encoding: "utf8" });
  assert.match(bad.stdout, /Common type SlugRules is referenced only by module Forms/);
});

test("MER-TO-004 warns when a Vitest config export cannot be resolved", () => {
  const r = repo([], {
    "nuxt.config.ts": "export default {}\n",
    "package.json": JSON.stringify({
      scripts: { typecheck: "vue-tsc --noEmit", test: "vitest run" },
      devDependencies: { vitest: "latest", "happy-dom": "latest" },
    }),
    "tests/page.test.ts": "export {}\n",
    "vitest.config.ts": 'import config from "./missing-config";\nexport default config;\n',
  });
  const out = spawnSync(path.join(CHECKS, "MER-TO-004-nuxt-typecheck-tests.mjs"), [r], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^MER-TO-004\twarn\tpackage\.json:1\t/m);
});

test("MER-TO-003 ignores unreachable eslint config objects", () => {
  const out = spawnSync(path.join(CHECKS, "MER-TO-003-generated-lint-exclusions.mjs"),
    [path.join(FIX, "MER-TO-003", "bad")], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /MER-TO-003\twarn\tpackages\/contracts\/eslint\.config\.mjs:1\t/);
});

test("MER-TO-003 follows local fragments reachable from the default eslint export", () => {
  const out = spawnSync(path.join(CHECKS, "MER-TO-003-generated-lint-exclusions.mjs"),
    [path.join(FIX, "MER-TO-003", "good")], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.equal(out.stdout, "");
});

test("MER-TO-003 supports the official globalIgnores helper reachable from the default export", () => {
  const out = spawnSync(path.join(CHECKS, "MER-TO-003-generated-lint-exclusions.mjs"),
    [path.join(FIX, "MER-TO-003", "good")], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.doesNotMatch(out.stdout, /packages\/helper\/eslint\.config\.mjs/);
});

test("MER-TO-004 resolves a local imported Vitest config", () => {
  const fixture = path.join(FIX, "MER-TO-004", "good", "apps", "imported");
  const out = spawnSync(path.join(CHECKS, "MER-TO-004-nuxt-typecheck-tests.mjs"), [fixture], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.equal(out.stdout, "");
});

test("MER-TO-004 uses the Vitest config when a separate build-only Vite config exists", () => {
  const fixture = path.join(FIX, "MER-TO-004", "good");
  const out = spawnSync(path.join(CHECKS, "MER-TO-004-nuxt-typecheck-tests.mjs"), [fixture], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.equal(out.stdout, "");
});

test("MER-TO-004 warns for a dynamic Vitest config", () => {
  const r = repo([], {
    "nuxt.config.ts": "export default {}\n",
    "package.json": JSON.stringify({
      scripts: { typecheck: "vue-tsc --noEmit", test: "vitest run" },
      devDependencies: { vitest: "latest", "happy-dom": "latest" },
    }),
    "tests/page.test.ts": "export {}\n",
    "vitest.config.ts": 'export default defineConfig(() => ({ test: { environment: "happy-dom" } }));\n',
  });
  const out = spawnSync(path.join(CHECKS, "MER-TO-004-nuxt-typecheck-tests.mjs"), [r], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^MER-TO-004\twarn\tpackage\.json:1\t/m);
});

test("MER-TO-004 does not let a static sibling mask a dynamic Vitest config", () => {
  const r = repo([], {
    "nuxt.config.ts": "export default {}\n",
    "package.json": JSON.stringify({
      scripts: { typecheck: "vue-tsc --noEmit", test: "vitest run" },
      devDependencies: { vitest: "latest", "happy-dom": "latest" },
    }),
    "tests/page.test.ts": "export {}\n",
    "vite.config.ts": 'export default defineConfig({ test: { environment: "happy-dom" } });\n',
    "vitest.config.ts": 'export default defineConfig(() => ({ test: { environment: "happy-dom" } }));\n',
  });
  const out = spawnSync(path.join(CHECKS, "MER-TO-004-nuxt-typecheck-tests.mjs"), [r], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^MER-TO-004\twarn\tpackage\.json:1\t/m);
});

test("MER-TO-011 applies props by project ancestry and checks settings independently", () => {
  const r = repo([], {
    "covered/Directory.Build.props": "<Project><PropertyGroup><Nullable>enable</Nullable></PropertyGroup></Project>\n",
    "covered/App.csproj": "<Project><PropertyGroup><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>\n",
    "uncovered/App.csproj": "<Project/>\n",
  });
  const out = spawnSync(path.join(CHECKS, "MER-TO-011-nullable.sh"), [r], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.doesNotMatch(out.stdout, /\tcovered\/App\.csproj/);
  assert.match(out.stdout, /MER-TO-011\terror\tuncovered\/App\.csproj:0\t/);
  assert.match(out.stdout, /MER-TO-011\twarn\tuncovered\/App\.csproj:0\t/);
});

test("MER-TO-011 ignores XML comments and conditional property values", () => {
  const out = spawnSync(path.join(CHECKS, "MER-TO-011-nullable.sh"),
    [path.join(FIX, "MER-TO-011", "bad")], { encoding: "utf8" });
  assert.equal(out.status, 0);
  for (const project of ["commented/App.csproj", "conditional/App.csproj", "disabled/App.csproj"]) {
    assert.match(out.stdout, new RegExp(`MER-TO-011\\terror\\t${project.replace(".", "\\.")}:0\\t`));
    assert.match(out.stdout, new RegExp(`MER-TO-011\\twarn\\t${project.replace(".", "\\.")}:0\\t`));
  }
});

test("error finding → exit 1; warn-only → 0 by default, 1 with --fail-on warn", () => {
  const errRepo = repo(["MER-BE-005"], { "App.csproj": "<Project/>\n" });
  assert.equal(plumb(errRepo).status, 1);
  const warnRepo = repo(["MER-TE-005"]); // tests/ dir is its own TE marker; TE-005 is warn
  const warn = plumb(warnRepo);
  assert.ok(warn.ids.includes("MER-TE-005"));
  assert.equal(warn.status, 0);
  assert.equal(plumb(warnRepo, "--fail-on", "warn").status, 1);
});

// ---- pack gating (§5 marker table) ----

test("BE pack gates on csproj + Modules: same violation, marker decides", () => {
  const unmarked = plumb(repo(["MER-BE-005"])); // Modules/ present, no csproj
  assert.ok(!unmarked.ids.some((id) => id.startsWith("MER-BE-")), `BE leaked without marker: ${unmarked.ids}`);
  const marked = plumb(repo(["MER-BE-005"], { "App.csproj": "<Project/>\n" }));
  assert.ok(marked.ids.includes("MER-BE-005"));
});

test("FE pack gates on nuxt.config: same violation, marker decides", () => {
  const unmarked = plumb(repo(["MER-FE-041"]));
  assert.ok(!unmarked.ids.includes("MER-FE-041"), `FE leaked without marker: ${unmarked.ids}`);
  const marked = plumb(repo(["MER-FE-041"], { "nuxt.config.ts": "export default {}\n" }));
  assert.ok(marked.ids.includes("MER-FE-041"));
});

test("TE pack detected from tests dir (the v4 detectPacks gap)", () => {
  assert.ok(plumb(repo(["MER-TE-005"])).ids.includes("MER-TE-005"));
});

test("TE-001 executes for an applicable modular .NET repo without a tests directory", () => {
  const out = plumb(repo(["MER-TE-001"]));
  assert.ok(out.ids.includes("MER-TE-001"), `TE-001 missing for modular .NET repo: ${out.ids}`);
});

test("MER-TE-001 does not accept Meridian.Analyzers from an unrelated project", () => {
  const r = repo([], {
    "app/App.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
    "app/Modules/Auth/Login.cs": "namespace App.Modules.Auth; public sealed class Login;\n",
    "tools/Tools.csproj": '<Project><ItemGroup><PackageReference Include="Meridian.Analyzers" /></ItemGroup></Project>\n',
  });
  const out = spawnSync(path.join(CHECKS, "MER-TE-001-architecture-enforcement.mjs"), [r], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^MER-TE-001\twarn\tapp\/App\.csproj:1\t/m);
});

test("MER-TE-001 does not accept an unexecuted architecture rule declaration", () => {
  const r = repo([], {
    "App.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
    "Modules/Auth/Login.cs": "namespace App.Modules.Auth; public sealed class Login;\n",
    "Tests/ArchitectureTests.cs": "var rule = ArchRuleDefinition.Types().Should().BeSealed();\n",
  });
  const out = spawnSync(path.join(CHECKS, "MER-TE-001-architecture-enforcement.mjs"), [r], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^MER-TE-001\twarn\tApp\.csproj:1\t/m);
});

test("MER-TE-001 accepts Meridian.Analyzers from an ancestor Directory.Build.props", () => {
  const r = repo([], {
    "Directory.Build.props": '<Project><ItemGroup><PackageReference Include="Meridian.Analyzers" /></ItemGroup></Project>\n',
    "src/App/App.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
    "src/App/Modules/Auth/Login.cs": "namespace App.Modules.Auth; public sealed class Login;\n",
  });
  const out = spawnSync(path.join(CHECKS, "MER-TE-001-architecture-enforcement.mjs"), [r], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.equal(out.stdout, "");
});

test("MER-TE-001 accepts an architecture API only when a test executes it", () => {
  const r = repo([], {
    "App.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
    "Modules/Auth/Login.cs": "namespace App.Modules.Auth; public sealed class Login;\n",
    "Tests/ArchitectureTests.cs": "var rule = ArchRuleDefinition.Types().Should().BeSealed();\nrule.Check(architecture);\n",
  });
  const out = spawnSync(path.join(CHECKS, "MER-TE-001-architecture-enforcement.mjs"), [r], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.equal(out.stdout, "");
});

test("MER-TE-007 independently rejects EF InMemory in test source", () => {
  const r = repo([], {
    "Tests/App.Tests.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
    "Tests/InMemoryTests.cs": "new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(\"test\");\n",
  });
  const out = spawnSync(path.join(CHECKS, "MER-TE-007-no-ef-inmemory.sh"), [r], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^MER-TE-007\terror\tTests\/InMemoryTests\.cs:1\tEF InMemory provider/m);
  assert.doesNotMatch(out.stdout, /SQLite test database/);
});

test("MER-TE-007 independently rejects SQLite for a referenced Postgres project", () => {
  const r = repo([], {
    "src/App/App.csproj": '<Project><ItemGroup><PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" /></ItemGroup></Project>\n',
    "Tests/App.Tests.csproj": '<Project><ItemGroup><ProjectReference Include="../src/App/App.csproj" /></ItemGroup></Project>\n',
    "Tests/SqliteTests.cs": "new DbContextOptionsBuilder<AppDbContext>().UseSqlite(\"DataSource=:memory:\");\n",
  });
  const out = spawnSync(path.join(CHECKS, "MER-TE-007-no-ef-inmemory.sh"), [r], { encoding: "utf8" });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /^MER-TE-007\terror\tTests\/SqliteTests\.cs:1\tSQLite test database/m);
  assert.doesNotMatch(out.stdout, /EF InMemory provider/);
});

test("BT pack detected from lowercase application/ports", () => {
  assert.ok(plumb(repo(["MER-BT-001"])).ids.includes("MER-BT-001"));
});

test("RV pack detected from *Contract.cs", () => {
  assert.ok(plumb(repo(["MER-RV-002"])).ids.includes("MER-RV-002"));
});

// ---- Rivet variant detection + gating (§5 v8 — the detectPacks bug class:
// wrong detection silently suppresses/filters findings) ----

const V2_ARTIFACTS = {
  "packages/contracts/package.json": '{ "name": "@acme/contracts", "private": true }\n',
  "packages/contracts/generated/openapi.json": '{ "openapi": "3.1.0" }\n',
  "packages/contracts/generated/schema.d.ts": "// generated by openapi-typescript — do not edit\nexport interface paths {}\n",
};

test("v1-pinned FE-005/006 fire under v1 artifacts, are suppressed under pure v2", () => {
  // FE-005/006 bad fixtures carry v1 artifacts (generated/rivet/...)
  const v1 = plumb(repo(["MER-FE-005", "MER-FE-006"]));
  assert.ok(v1.ids.includes("MER-FE-005"), `FE-005 missing under v1: ${v1.ids}`);
  assert.ok(v1.ids.includes("MER-FE-006"), `FE-006 missing under v1: ${v1.ids}`);
  // same violations, v1 artifacts replaced by v2 fingerprints → suppressed
  const d = repo(["MER-FE-005", "MER-FE-006"], V2_ARTIFACTS);
  fs.rmSync(path.join(d, "generated"), { recursive: true, force: true });
  const v2 = plumb(d);
  assert.ok(!v2.ids.includes("MER-FE-005"), `FE-005 leaked under v2: ${v2.ids}`);
  assert.ok(!v2.ids.includes("MER-FE-006"), `FE-006 leaked under v2: ${v2.ids}`);
});

test("v2-pinned FE-007 fires under v2, not under v1", () => {
  const v2 = plumb(repo(["MER-FE-007"]));
  assert.ok(v2.ids.includes("MER-FE-007"), `FE-007 missing under v2: ${v2.ids}`);
  // same code, v2 fingerprints removed and a v1 artifact added → gated off
  const d = repo(["MER-FE-007"]);
  fs.rmSync(path.join(d, "packages/contracts/generated"), { recursive: true, force: true });
  fs.mkdirSync(path.join(d, "generated/rivet"), { recursive: true });
  fs.writeFileSync(path.join(d, "generated/rivet/rivet.ts"), "// generated — do not edit\n");
  const v1 = plumb(d);
  assert.ok(!v1.ids.includes("MER-FE-007"), `FE-007 leaked under v1: ${v1.ids}`);
});

test("RV pack detected from the v2 artifact fingerprint alone (no Contract.cs, no v1 paths)", () => {
  const d = repo([], {
    "shared/api-schema/openapi.json": '{ "openapi": "3.1.0" }\n',
    "shared/api-schema/schema.d.ts": "export interface paths {}\n",
    "api/Api.csproj": '<Project><ItemGroup><PackageReference Include="Rivet.Attributes" Version="0.34.3" /></ItemGroup></Project>\n',
  });
  const out = plumb(d);
  assert.ok(out.ids.includes("MER-RV-026"), `RV-026 mismatch warn missing — RV pack not detected from v2 fingerprint: ${out.ids}`);
});

// ---- filters ----

test("--rule and --pack filter the merged findings", () => {
  const r = repo(["MER-BE-005", "MER-TE-005"], { "App.csproj": "<Project/>\n" });
  const byRule = plumb(r, "--rule", "MER-BE-005");
  assert.ok(byRule.ids.length > 0);
  assert.ok(byRule.ids.every((id) => id === "MER-BE-005"));
  const byPack = plumb(r, "--pack", "TE");
  assert.ok(byPack.ids.length > 0);
  assert.ok(byPack.ids.every((id) => id.startsWith("MER-TE-")));
});

// ---- --json shape ----

test("--json emits an array of {rule, severity, location, message, docRef}", () => {
  const out = plumb(repo(["MER-BE-005"], { "App.csproj": "<Project/>\n" }), "--json");
  const arr = JSON.parse(out.stdout);
  assert.ok(Array.isArray(arr) && arr.length > 0);
  for (const f of arr) {
    assert.match(f.rule, /^MER-[A-Z]{2}-\d{3}$/);
    assert.ok(["error", "warn", "info"].includes(f.severity));
    assert.match(f.location, /:\d+$/);
    assert.ok(f.message.length > 0);
    assert.ok(typeof f.docRef === "string");
  }
});

// ---- producer contract (§3): every check, run directly against its fixtures ----

const scripts = fs.readdirSync(CHECKS, { withFileTypes: true })
  .filter((e) => e.isFile() && !e.name.startsWith(".") && !e.name.startsWith("_"))
  .map((e) => e.name);

for (const s of scripts) {
  const id = s.match(/^MER-[A-Z]{2}-\d{3}/)?.[0];
  const fixture = id && fs.existsSync(path.join(FIX, id, "bad")) ? id : null;
  test(`producer ${s}: exits 0, emits §3 five-field lines, fires on bad / not good`, { skip: !fixture && "no own fixture (family member)" }, () => {
    const env = { ...process.env, PLUMB_CI: "1" };
    const bad = spawnSync(path.join(CHECKS, s), [path.join(FIX, fixture, "bad")], { encoding: "utf8", env });
    assert.equal(bad.status, 0, `bad run exit ${bad.status}: ${bad.stderr}`);
    const lines = (bad.stdout || "").split("\n").filter((l) => l.trim());
    assert.ok(lines.some((l) => l.startsWith(fixture)), `did not fire on its own bad fixture`);
    for (const l of lines) assert.match(l, LINE, `malformed finding line: ${JSON.stringify(l)}`);
    const good = spawnSync(path.join(CHECKS, s), [path.join(FIX, fixture, "good")], { encoding: "utf8", env });
    assert.equal(good.status, 0, `good run exit ${good.status}: ${good.stderr}`);
    assert.ok(!(good.stdout || "").split("\n").some((l) => l.startsWith(fixture)), `false positive on good fixture`);
  });
}

// ---- §4 degradation: AST-tier check without its optional dep ----

test("AST check with unresolvable typescript → stderr diagnostic, no findings, exit 0", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-degrade-"));
  cleanup.push(d);
  const copy = path.join(d, "MER-BT-001-port-shape.mjs");
  fs.copyFileSync(path.join(CHECKS, "MER-BT-001-port-shape.mjs"), copy);
  fs.chmodSync(copy, 0o755);
  const out = spawnSync(copy, [path.join(FIX, "MER-BT-001", "bad")], { encoding: "utf8" });
  if (out.stdout && out.stdout.includes("MER-BT-001")) {
    // a node_modules/typescript resolved above the temp dir — environment can't simulate the missing dep
    return;
  }
  assert.equal(out.status, 0);
  assert.equal((out.stdout || "").trim(), "");
  assert.match(out.stderr, /typescript/i);
});

// ---- --baseline ratchet (§5, 2026-06-11) ----

test("baseline: write → rerun clean exit 0 with visible suppressed count; new finding still fails", () => {
  const r = repo(["MER-BE-005"], { "App.csproj": "<Project/>\n" });
  const bl = path.join(r, ".plumb-baseline.json");
  const write = plumb(r, "--write-baseline", bl);
  assert.equal(write.status, 0);
  assert.match(write.stdout, /baseline written/);
  // same findings, baselined → exit 0, count visible not hidden
  const ratcheted = plumb(r, "--baseline", bl);
  assert.equal(ratcheted.status, 0);
  assert.deepEqual(ratcheted.ids, []);
  assert.match(ratcheted.stdout, /\+\d+ baselined, baseline holds \d+/);
  // a NEW violation in a different file is not absorbed by the allowance
  fs.cpSync(path.join(FIX, "MER-BE-005", "bad", "api", "Modules", "Auth", "Application", "U.cs"),
    path.join(r, "api", "Modules", "Auth", "Application", "U2.cs"));
  const withNew = plumb(r, "--baseline", bl);
  assert.equal(withNew.status, 1);
  assert.ok(withNew.ids.includes("MER-BE-005"));
});

test("baseline: shrinking is reported and suggests ratcheting down", () => {
  const r = repo(["MER-BE-005"], { "App.csproj": "<Project/>\n" });
  const bl = path.join(r, ".plumb-baseline.json");
  plumb(r, "--write-baseline", bl);
  // fix the violation → suppressed < baseline total → shrink message
  fs.rmSync(path.join(r, "api"), { recursive: true });
  fs.writeFileSync(path.join(r, "App.csproj"), "<Project/>\n");
  const out = plumb(r, "--baseline", bl);
  assert.equal(out.status, 0);
  assert.match(out.stdout, /shrunk; re-run --write-baseline/);
});

test("baseline: --json emits only actionable findings; unreadable baseline → exit 2", () => {
  const r = repo(["MER-BE-005"], { "App.csproj": "<Project/>\n" });
  const bl = path.join(r, ".plumb-baseline.json");
  plumb(r, "--write-baseline", bl);
  const out = plumb(r, "--baseline", bl, "--json");
  assert.deepEqual(JSON.parse(out.stdout), []);
  assert.equal(plumb(r, "--baseline", "/nonexistent/bl.json").status, 2);
});
