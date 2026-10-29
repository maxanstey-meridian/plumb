#!/usr/bin/env node
// Runner harness — run: node --test test/
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
import { spawnProducer } from "./helpers/run-producer.mjs";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUMB = path.join(HOME, "plumb");
const FIX = path.join(HOME, "fixtures");
const CHECKS = path.join(HOME, "checks");
const LINE = /^MER-[A-Z]{2}-\d{3}\t(error|warn|info)\t[^\t]+:\d+\t[^\t]+\t\S+$/;
const MIGRATED = [
  "MER-BE-001", "MER-BE-002", "MER-BE-003", "MER-BE-004", "MER-BE-005", "MER-BE-006",
  "MER-BE-007", "MER-BE-008", "MER-BE-009", "MER-BE-010", "MER-BE-011", "MER-BE-012",
  "MER-BE-013", "MER-BE-014", "MER-BE-015", "MER-BE-016", "MER-BE-017", "MER-BE-020", "MER-BE-021", "MER-BE-022",
  "MER-BE-023", "MER-BE-024", "MER-BE-030", "MER-BE-031", "MER-BE-032", "MER-BE-040", "MER-BE-041", "MER-BE-042",
  "MER-BE-051", "MER-BE-052", "MER-BE-053", "MER-BE-054", "MER-BE-055", "MER-BE-060", "MER-BE-018",
  "MER-BT-001", "MER-BT-002", "MER-BT-004", "MER-BT-010", "MER-BT-011", "MER-BT-012",
  "MER-BT-013", "MER-BT-014", "MER-BT-015", "MER-BT-016", "MER-BT-017", "MER-BT-020",
  "MER-BT-003", "MER-BT-005", "MER-FE-005", "MER-FE-041", "MER-FE-043",
  "MER-FE-004", "MER-FE-006", "MER-FE-007", "MER-FE-008", "MER-FE-010", "MER-FE-011",
  "MER-FE-013", "MER-FE-014", "MER-FE-015", "MER-FE-020", "MER-FE-021", "MER-FE-022",
  "MER-FE-030", "MER-FE-031", "MER-FE-032", "MER-FE-040", "MER-FE-044", "MER-FE-045",
  "MER-RV-001", "MER-RV-002", "MER-RV-003", "MER-RV-006", "MER-RV-007", "MER-RV-008", "MER-RV-009", "MER-RV-010", "MER-RV-011",
  "MER-RV-020", "MER-RV-021", "MER-RV-025", "MER-RV-026", "MER-RV-027", "MER-CP-001", "MER-CP-002",
  "MER-TE-001", "MER-TE-002", "MER-TE-003", "MER-TE-005", "MER-TE-006", "MER-TE-007", "MER-TE-008", "MER-TE-009",
  "MER-TO-001", "MER-TO-002", "MER-TO-003", "MER-TO-004", "MER-TO-005", "MER-TO-010", "MER-TO-011", "MER-TO-012", "MER-TO-014", "MER-TO-015",
];

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

function focusedFindings(root, id) {
  const out = plumb(root, "--rule", id, "--json", "--ci");
  assert.ok([0, 1].includes(out.status), `${id} exited ${out.status}: ${out.stderr}`);
  return { out, findings: JSON.parse(out.stdout || "[]") };
}

function isolatedPlumb(producers) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-isolated-"));
  cleanup.push(home);
  for (const dir of ["checks/_lib", "lib", "rules", "fixtures"]) fs.mkdirSync(path.join(home, dir), { recursive: true });
  for (const file of ["plumb", "lib/rule-catalog.mjs", "lib/repository-inventory.mjs", "checks/_lib/fs-scan.mjs", "checks/_lib/rivet-variant.mjs"]) {
    fs.copyFileSync(path.join(HOME, file), path.join(home, file));
  }
  fs.cpSync(path.join(HOME, "lib", "engine"), path.join(home, "lib", "engine"), { recursive: true });
  fs.cpSync(path.join(HOME, "lib", "in-process-rules"), path.join(home, "lib", "in-process-rules"), { recursive: true });
  fs.cpSync(path.join(HOME, "configs"), path.join(home, "configs"), { recursive: true });
  fs.copyFileSync(path.join(HOME, "lib", "rivet-context.mjs"), path.join(home, "lib", "rivet-context.mjs"));
  fs.mkdirSync(path.join(home, "node_modules", "@vue"), { recursive: true });
  for (const dependency of ["ignore", "fast-xml-parser", "yaml", "picomatch", "braces", "@vue/compiler-sfc"]) {
    const target = path.join(home, "node_modules", ...dependency.split("/"));
    fs.symlinkSync(fs.realpathSync(path.join(HOME, "node_modules", ...dependency.split("/"))), target, "dir");
  }
  fs.chmodSync(path.join(home, "plumb"), 0o755);
  fs.writeFileSync(path.join(home, "sgconfig.yml"), "ruleDirs:\n  - rules\n");
  for (const [name, source] of Object.entries(producers)) {
    const file = path.join(home, "checks", name);
    fs.writeFileSync(file, source);
    fs.chmodSync(file, 0o755);
  }
  const target = path.join(home, "target");
  fs.mkdirSync(target);
  return {
    home,
    target,
    run(...args) {
      const out = spawnSync(path.join(home, "plumb"), [target, ...args], { encoding: "utf8" });
      out.ids = (out.stdout || "").split("\n").filter((line) => line.startsWith("MER-")).map((line) => line.split("\t")[0]);
      return out;
    },
  };
}

function producer(id, { produces = null, marker = null, emit = id, severity = "warn" } = {}) {
  return `#!/usr/bin/env node
${produces ? `// PRODUCES: ${produces.join(", ")}\n` : ""}import fs from "node:fs";
import path from "node:path";
const root = process.argv[2];
${marker ? `fs.writeFileSync(path.join(root, ${JSON.stringify(marker)}), "ran\\n");` : ""}
${emit ? `console.log(${JSON.stringify(`${emit}\t${severity}\tresult.txt:1\tfinding from sentinel\ttools.md#default-stack-1`)});` : ""}
`;
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
  for (const flag of ["--fail-on", "--rule", "--pack", "--exclude", "--baseline", "--write-baseline"]) {
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
  assert.match(out.stderr, /--baseline, --no-baseline and --write-baseline cannot be used together/);
  const both = plumb(r, "--no-baseline", "--baseline", path.join(r, "old.json"));
  assert.equal(both.status, 2);
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

test(".plumbignore and repeatable --exclude patterns remove files from every rule engine", () => {
  const d = repo([], {
    ".plumbignore": "ignored-by-config/\n",
    "ignored-by-config/package.json": "{}\n",
    "ignored-by-cli/package.json": "{}\n",
    "visible.txt": "visible\n",
  });
  const out = plumb(d, "--rule", "MER-TO-001", "--json", "--exclude", "ignored-by-cli/", "--exclude", "unused/");
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), []);
});

test("manifest preserves spaces and canonical separators in shell findings", () => {
  const r = repo([], {
    "App.csproj": "<Project/>\n",
    "api/Modules/Sales Ops/Domain/System Clock.cs": "public static class Clock { public static DateTime Value => DateTime.UtcNow; }\n",
  });
  const out = plumb(r, "--rule", "MER-BE-024");
  assert.equal(out.status, 1, out.stderr);
  assert.match(out.stdout, /api\/Modules\/Sales Ops\/Domain\/System Clock\.cs:1/);
  assert.doesNotMatch(out.stdout, /\\/);
});

test("MER-BE-006 propagates contract consumers to enum, nested record, and collection element types", () => {
  const good = focusedFindings(path.join(FIX, "MER-BE-006", "good"), "MER-BE-006");
  for (const type of ["SubmissionState", "SubmissionDetails", "SubmissionItem"]) {
    assert.ok(!good.findings.some((finding) => finding.message.includes(`Common type ${type} `)));
  }

  const bad = focusedFindings(path.join(FIX, "MER-BE-006", "bad"), "MER-BE-006");
  assert.ok(bad.findings.some((finding) => finding.message.includes("Common type SlugRules is referenced only by module Forms")));
});

test("MER-BE-010 discovers nested Modules roots from C# paths", () => {
  const r = repo([], {
    "App.csproj": "<Project/>\n",
    "api/Modules/Outer/Modules/Inner/Source.cs": "namespace App.Modules.Inner;\n",
  });
  const out = plumb(r, "--rule", "MER-BE-010");
  assert.match(out.stdout, /api\/Modules\/Outer\/Modules\/Inner:0\tmodule Inner must expose/);
});

test("MER-BT-005 preserves the original union of TypeScript and modules globs", () => {
  const r = repo([], {
    "package.json": '{"dependencies":{"typed-inject":"^5.0.0"}}\n',
    "outside.ts": "export class OutsideService {}\n",
    "src/modules/notes.txt": "class NotesService {}\n",
  });
  const out = plumb(r, "--rule", "MER-BT-005", "--json");
  assert.match(out.stdout, /outside\.ts:1/);
  assert.match(out.stdout, /src\/modules\/notes\.txt:1/);
});

test("migrated text rules preserve Unicode word matching and CRLF line numbers", () => {
  const bt = repo([], {
    "package.json": '{"dependencies":{"typed-inject":"^5.0.0"}}\n',
    "src/modules/mail/cafe.ts": "export class CaféService {}\r\n",
  });
  const btFindings = JSON.parse(plumb(bt, "--rule", "MER-BT-005", "--json").stdout);
  assert.ok(btFindings.some((finding) => finding.location === "src/modules/mail/cafe.ts:1"));

  const fe = repo([], {
    "nuxt.config.ts": "export default {}\r\n",
    "app/plugins/boot.ts": "const first = true\r\nconst state = useState<string>(\"boot\")\r\n",
  });
  const feFindings = JSON.parse(plumb(fe, "--rule", "MER-FE-043", "--json").stdout);
  assert.deepEqual(feFindings.map((finding) => finding.location), ["app/plugins/boot.ts:2"]);
});

test("MER-FE-041 matches shell basename and composables-segment semantics", () => {
  const r = repo([], {
    "nuxt.config.ts": "export default {}\n",
    "app/composables/nested/use-bad-name.ts": "export {}\n",
    "app/not-composables/use-also-bad.ts": "export {}\n",
    "app/composables/useGoodName.ts": "export {}\n",
  });
  const findings = JSON.parse(plumb(r, "--rule", "MER-FE-041", "--json").stdout);
  assert.deepEqual(findings.map((finding) => finding.location), ["app/composables/nested/use-bad-name.ts:0"]);
});

test("MER-FE-031 and MER-FE-022 count consumers through shared items, per feature, and app-wide", () => {
  // Good: consumers reached through a shared component, two features, app-wide consumers and a shared cycle.
  for (const id of ["MER-FE-031", "MER-FE-022"]) {
    assert.deepEqual(focusedFindings(path.join(FIX, id, "good"), id).findings, [], `${id} good`);
  }
  const bad = (id) => focusedFindings(path.join(FIX, id, "bad"), id).findings.map((finding) => [finding.location, finding.message]);
  const item = (owner) => `only one subtree (${owner}) consumes this shared item — review ownership; consumer count alone does not prove misplacement`;
  const composable = (owner, route = "") => `shared composable is consumed only by ${owner}${route} — composables live at their composition root; ` +
    (route ? "move them together into that subtree" : "move it into that subtree");
  // Bad: tests are no consumers, and neither a nested .global middleware file nor middleware/<dir>/index.global.ts is
  // global middleware.
  assert.deepEqual(bad("MER-FE-031"), [
    ["app/shared/components/Chart.vue:0", item("pages/index")],
    ["app/shared/logic/conditions.ts:0", item("features/alpha")],
    ["app/shared/logic/expiry.ts:0", item("middleware")],
    ["app/shared/logic/format.ts:0", item("pages/index")],
    ["app/shared/logic/redirect.ts:0", item("middleware")],
    ["app/shared/logic/scale.ts:0", item("pages/index")],
    ["app/shared/logic/session.ts:0", item("middleware")],
  ]);
  assert.deepEqual(bad("MER-FE-022"), [
    ["app/shared/composables/use-clock.ts:0", composable("pages/index")],
    ["app/shared/composables/use-pulse.ts:0", composable("pages/index", ", directly and through shared/components/Pulse.vue")],
    ["app/shared/composables/use-ticker.ts:0", composable("pages/index", ", through shared/components/Ticker.vue")],
  ]);
});

test("MER-TE-006 preserves Nuxt root depth and per-directory deduplication", () => {
  const r = repo([], {
    "a/b/c/d/e/nuxt.config.ts": "export default {}\n",
    "a/b/c/d/e/app/pages/__tests__/one.test.ts": "export {}\n",
    "a/b/c/d/e/app/pages/__tests__/two.test.ts": "export {}\n",
    "a/b/c/d/e/app/pages/loose.spec.ts": "export {}\n",
    "too/deep/for/this/config/root/nuxt.config.ts": "export default {}\n",
    "too/deep/for/this/config/root/app/__tests__/ignored.test.ts": "export {}\n",
  });
  const findings = JSON.parse(plumb(r, "--rule", "MER-TE-006", "--json").stdout);
  assert.deepEqual(findings.map((finding) => finding.location), [
    "a/b/c/d/e/app/pages/__tests__:0",
    "a/b/c/d/e/app/pages/loose.spec.ts:0",
  ]);
});

test("MER-RV-026 keeps legacy version parsing and floor comparison", () => {
  const r = repo([], {
    "Api.csproj": '<Project><ItemGroup><PackageReference Include="Rivet.Attributes" Version="0.34.99" /></ItemGroup></Project>\n',
    "package.json": '{"dependencies":{"rivet-ts":"0.11"},"devDependencies":{"rivet-ts":">=0.1.0"}}\n',
  });
  const findings = JSON.parse(plumb(r, "--rule", "MER-RV-026", "--json").stdout);
  assert.deepEqual(findings.map((finding) => finding.location), ["Api.csproj:1"]);
});

test("MER-TO-001 preserves grep's accepted packageManager whitespace", () => {
  const r = repo([], {
    "package.json": '{\n\t"packageManager"\t:\r\n\t"pnpm@10.0.0"\n}\n',
  });
  const findings = JSON.parse(plumb(r, "--rule", "MER-TO-001", "--json").stdout);
  assert.deepEqual(findings, []);
});

test("migrated lexical rules preserve ripgrep and POSIX Unicode whitespace", () => {
  const backend = repo([], {
    "package.json": '{"dependencies":{"typed-inject":"1"}}',
    "src/modules/mail/application/mailer.ts": "class\u0085MailerService {}\n",
  });
  assert.match(plumb(backend, "--rule", "MER-BT-005").stdout, /MER-BT-005/);

  const frontend = repo([], {
    "nuxt.config.ts": "export default { ssr: false }\n",
    "app/pages/index.vue": "<script setup>useState\u0085('key')</script>\n",
  });
  assert.match(plumb(frontend, "--rule", "MER-FE-043").stdout, /MER-FE-043/);

  const tooling = repo([], { "package.json": '{"packageManager"\u2003:\u2003"pnpm@10"}\n' });
  assert.doesNotMatch(plumb(tooling, "--rule", "MER-TO-001").stdout, /MER-TO-001/);
});

test("MER-RV-021 accepts every nuxt.config suffix as an app marker", () => {
  const root = repo([], {
    "rivet-pack-marker.cs": "// [RivetContract] pack marker\n",
    "apps/a/nuxt.config.cjs": "module.exports = { ssr: false };\n",
    "apps/a/plugins/rivet.ts": "configureRivet();\n",
    "apps/b/nuxt.config.mts": "export default { ssr: false };\n",
    "apps/b/plugins/rivet.ts": "configureRivet();\n",
  });
  assert.doesNotMatch(plumb(root, "--rule", "MER-RV-021").stdout, /MER-RV-021/);
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
  const { findings } = focusedFindings(r, "MER-TO-004");
  assert.ok(findings.some((finding) => finding.location === "package.json:1"));
});

test("MER-TO-003 ignores unreachable eslint config objects", () => {
  const { findings } = focusedFindings(path.join(FIX, "MER-TO-003", "bad"), "MER-TO-003");
  assert.ok(findings.some((finding) => finding.location === "packages/contracts/eslint.config.mjs:1"));
});

test("MER-TO-003 follows local fragments reachable from the default eslint export", () => {
  const { findings } = focusedFindings(path.join(FIX, "MER-TO-003", "good"), "MER-TO-003");
  assert.ok(!findings.some((finding) => finding.rule === "MER-TO-003"));
});

test("MER-TO-003 supports the official globalIgnores helper reachable from the default export", () => {
  const { findings } = focusedFindings(path.join(FIX, "MER-TO-003", "good"), "MER-TO-003");
  assert.ok(!findings.some((finding) => finding.location === "packages/helper/eslint.config.mjs:1"));
});

test("MER-TO-004 resolves a local imported Vitest config", () => {
  const fixture = path.join(FIX, "MER-TO-004", "good", "apps", "imported");
  const { findings } = focusedFindings(fixture, "MER-TO-004");
  assert.ok(!findings.some((finding) => finding.rule === "MER-TO-004"));
});

test("MER-TO-004 uses the Vitest config when a separate build-only Vite config exists", () => {
  const fixture = path.join(FIX, "MER-TO-004", "good");
  const { findings } = focusedFindings(fixture, "MER-TO-004");
  assert.ok(!findings.some((finding) => finding.rule === "MER-TO-004"));
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
  const { findings } = focusedFindings(r, "MER-TO-004");
  assert.ok(findings.some((finding) => finding.location === "package.json:1"));
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
  const { findings } = focusedFindings(r, "MER-TO-004");
  assert.ok(findings.some((finding) => finding.location === "package.json:1"));
});

test("MER-TO-011 applies props by project ancestry and checks settings independently", () => {
  const r = repo([], {
    "covered/Directory.Build.props": "<Project><PropertyGroup><Nullable>enable</Nullable></PropertyGroup></Project>\n",
    "covered/App.csproj": "<Project><PropertyGroup><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>\n",
    "uncovered/App.csproj": "<Project/>\n",
  });
  const { findings } = focusedFindings(r, "MER-TO-011");
  assert.ok(!findings.some((finding) => finding.location === "covered/App.csproj:0"));
  assert.ok(findings.some((finding) => finding.severity === "error" && finding.location === "uncovered/App.csproj:0"));
  assert.ok(findings.some((finding) => finding.severity === "warn" && finding.location === "uncovered/App.csproj:0"));
});

test("MER-TO-011 ignores XML comments and conditional property values", () => {
  const { findings } = focusedFindings(path.join(FIX, "MER-TO-011", "bad"), "MER-TO-011");
  for (const project of ["commented/App.csproj", "conditional/App.csproj", "disabled/App.csproj"]) {
    assert.ok(findings.some((finding) => finding.severity === "error" && finding.location === `${project}:0`));
    assert.ok(findings.some((finding) => finding.severity === "warn" && finding.location === `${project}:0`));
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
  const withoutMarker = repo(["MER-FE-041"]);
  fs.rmSync(path.join(withoutMarker, "nuxt.config.ts"));
  const unmarked = plumb(withoutMarker);
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
  const { findings } = focusedFindings(r, "MER-TE-001");
  assert.ok(findings.some((finding) => finding.location === "app/App.csproj:1"));
});

test("MER-TE-001 does not accept an unexecuted architecture rule declaration", () => {
  const r = repo([], {
    "App.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
    "Modules/Auth/Login.cs": "namespace App.Modules.Auth; public sealed class Login;\n",
    "Tests/ArchitectureTests.cs": "var rule = ArchRuleDefinition.Types().Should().BeSealed();\n",
  });
  const { findings } = focusedFindings(r, "MER-TE-001");
  assert.ok(findings.some((finding) => finding.location === "App.csproj:1"));
});

test("MER-TE-001 accepts Meridian.Analyzers from an ancestor Directory.Build.props", () => {
  const r = repo([], {
    "Directory.Build.props": '<Project><ItemGroup><PackageReference Include="Meridian.Analyzers" /></ItemGroup></Project>\n',
    "src/App/App.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
    "src/App/Modules/Auth/Login.cs": "namespace App.Modules.Auth; public sealed class Login;\n",
  });
  const { findings } = focusedFindings(r, "MER-TE-001");
  assert.deepEqual(findings, []);
});

test("MER-TE-001 accepts an architecture API only when a test executes it", () => {
  const r = repo([], {
    "App.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
    "Modules/Auth/Login.cs": "namespace App.Modules.Auth; public sealed class Login;\n",
    "Tests/ArchitectureTests.cs": "var rule = ArchRuleDefinition.Types().Should().BeSealed();\nrule.Check(architecture);\n",
  });
  const { findings } = focusedFindings(r, "MER-TE-001");
  assert.deepEqual(findings, []);
});

test("MER-TE-007 independently rejects EF InMemory in test source", () => {
  const r = repo([], {
    "Tests/App.Tests.csproj": '<Project Sdk="Microsoft.NET.Sdk" />\n',
    "Tests/InMemoryTests.cs": "new DbContextOptionsBuilder<AppDbContext>().UseInMemoryDatabase(\"test\");\n",
  });
  const { findings } = focusedFindings(r, "MER-TE-007");
  assert.ok(findings.some((finding) => finding.location === "Tests/InMemoryTests.cs:1" && finding.message.startsWith("EF InMemory provider")));
  assert.ok(!findings.some((finding) => finding.message.startsWith("SQLite test database")));
});

test("MER-TE-007 independently rejects SQLite for a referenced Postgres project", () => {
  const r = repo([], {
    "src/App/App.csproj": '<Project><ItemGroup><PackageReference Include="Npgsql.EntityFrameworkCore.PostgreSQL" /></ItemGroup></Project>\n',
    "Tests/App.Tests.csproj": '<Project><ItemGroup><ProjectReference Include="../src/App/App.csproj" /></ItemGroup></Project>\n',
    "Tests/SqliteTests.cs": "new DbContextOptionsBuilder<AppDbContext>().UseSqlite(\"DataSource=:memory:\");\n",
  });
  const { findings } = focusedFindings(r, "MER-TE-007");
  assert.ok(findings.some((finding) => finding.location === "Tests/SqliteTests.cs:1" && finding.message.startsWith("SQLite test database")));
  assert.ok(!findings.some((finding) => finding.message.startsWith("EF InMemory provider")));
});

test("MER-TE-002 and MER-TE-005 preserve test-directory suffix matching", () => {
  const r = repo([], {
    "integration-tests/Dense.cs": `${"Substitute.For<IDep>();\n".repeat(6)}class MockClock {}\n`,
  });
  assert.ok(focusedFindings(r, "MER-TE-002").findings.some((finding) => finding.location === "integration-tests/Dense.cs:0"));
  assert.ok(focusedFindings(r, "MER-TE-005").findings.some((finding) => finding.location === "integration-tests/Dense.cs:7"));
});

test("MER-RV-009 preserves the legacy line for global-qualified endpoint receivers", () => {
  const r = repo([], {
    "Modules/Orders/OrdersEndpoints.cs": "namespace App;\n\npublic static void MapOrdersEndpoints(this global::Microsoft.AspNetCore.Builder.WebApplication app) {}\n",
  });
  const { findings } = focusedFindings(r, "MER-RV-009");
  assert.ok(findings.some((finding) => finding.location === "Modules/Orders/OrdersEndpoints.cs:1"));
});

test("BT pack detected from lowercase application/ports", () => {
  assert.ok(plumb(repo(["MER-BT-001"])).ids.includes("MER-BT-001"));
});

test("BT pack: a Nuxt app's src/domain/ and src/app/ don't turn it on; a TypeScript backend beside it does", () => {
  const nuxt = {
    "package.json": "{}\n",
    "nuxt.config.ts": "export default defineNuxtConfig({ ssr: false });\n",
    // BT-013 reads any domain/ tree, so only the pack staying off keeps this clean.
    "src/domain/order.ts": "export interface OrderRepository { save(): void }\n",
    "src/app/submit.ts": "export const submittedAt = () => Date.now();\n",
  };
  const frontendOnly = plumb(repo([], nuxt));
  assert.deepEqual(frontendOnly.ids.filter((id) => id.startsWith("MER-BT-")), [], frontendOnly.stdout);
  const withBackend = plumb(repo([], {
    ...nuxt,
    "api/package.json": "{}\n",
    "api/src/domain/order.ts": "export const stamp = () => Date.now();\n",
    "api/src/application/submit.ts": "export const submittedAt = () => Date.now();\n",
  }));
  assert.ok(withBackend.ids.includes("MER-BT-016"), withBackend.stdout);
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

test("a generated/client file is not a Rivet v1 client directory", () => {
  const d = repo(["MER-FE-005"], {
    ...V2_ARTIFACTS,
    "packages/contracts/generated/client": "not a directory\n",
  });
  fs.rmSync(path.join(d, "generated"), { recursive: true, force: true });
  const v2 = plumb(d, "--rule", "MER-FE-005");
  assert.ok(!v2.ids.includes("MER-FE-005"), `FE-005 leaked when generated/client was a file: ${v2.ids}`);
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

test("explicit --rule executes its owner without an automatic pack marker", () => {
  const root = repo([], { "app/components/Provider.ts": "provideAuth();\n" });
  const out = plumb(root, "--rule", "MER-FE-020", "--json");
  assert.ok(JSON.parse(out.stdout).some((finding) => finding.rule === "MER-FE-020"));
});

test("FE-020 skips monorepo frontend test harnesses but still checks the app tree", () => {
  const root = repo([], {
    "apps/ui/nuxt.config.ts": "export default { ssr: false }\n",
    "apps/ui/tests/pages/import-tab.spec.ts": 'import { provideAuth } from "../../app/ports/auth";\nprovideAuth(createFakeAuth());\n',
    "apps/ui/tests/support/mount.ts": "export const mount = () => provideAuth(createFakeAuth());\n",
    "tests/e2e/harness.ts": "provideAuth(createFakeAuth());\n",
    "apps/ui/app/components/Provider.ts": "provideAuth(createAuth());\n",
  });
  const findings = JSON.parse(plumb(root, "--rule", "MER-FE-020", "--json").stdout);
  assert.deepEqual(findings.map((finding) => finding.location), ["apps/ui/app/components/Provider.ts:1"]);
});

test("--rule does not execute an unrelated producer", () => {
  const isolated = isolatedPlumb({
    "MER-TO-901-selected.mjs": producer("MER-TO-901"),
    "MER-TO-902-sentinel.mjs": producer("MER-TO-902", { marker: "unrelated-ran", emit: null }),
  });
  const out = isolated.run("--rule", "MER-TO-901");
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.ids, ["MER-TO-901"]);
  assert.ok(!fs.existsSync(path.join(isolated.target, "unrelated-ran")));
});

test("--pack does not execute a producer belonging to another pack", () => {
  const isolated = isolatedPlumb({
    "MER-TO-903-selected.mjs": producer("MER-TO-903"),
    "MER-BE-904-sentinel.mjs": producer("MER-BE-904", { marker: "be-ran", emit: null }),
  });
  fs.mkdirSync(path.join(isolated.target, "Modules", "Auth"), { recursive: true });
  fs.writeFileSync(path.join(isolated.target, "App.csproj"), "<Project><PropertyGroup><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>\n");
  fs.writeFileSync(path.join(isolated.target, "Modules", "Auth", "AuthModule.cs"), "namespace App.Modules.Auth;\n");
  const out = isolated.run("--pack", "TO");
  assert.equal(out.status, 0, out.stderr);
  assert.ok(out.ids.includes("MER-TO-903"));
  assert.ok(out.ids.every((id) => id.startsWith("MER-TO-")), `non-TO finding leaked: ${out.ids}`);
  assert.ok(!fs.existsSync(path.join(isolated.target, "be-ran")));
});

test("--rule selects the owner of a secondary ID from PRODUCES metadata", () => {
  const isolated = isolatedPlumb({
    "MER-BE-905-family.mjs": producer("MER-BE-905", {
      produces: ["MER-BE-905", "MER-BE-906"],
      emit: "MER-BE-906",
    }),
  });
  fs.mkdirSync(path.join(isolated.target, "Modules", "Auth"), { recursive: true });
  fs.writeFileSync(path.join(isolated.target, "App.csproj"), "<Project/>\n");
  fs.writeFileSync(path.join(isolated.target, "Modules", "Auth", "AuthModule.cs"), "namespace App.Modules.Auth;\n");
  const out = isolated.run("--rule", "MER-BE-906");
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.ids, ["MER-BE-906"]);
});

test("CI-only owner is not executed without --ci", () => {
  const isolated = isolatedPlumb({
    "MER-RV-024-sentinel.mjs": producer("MER-RV-024", { marker: "ci-ran", emit: null }),
  });
  fs.mkdirSync(path.join(isolated.target, "generated", "rivet"), { recursive: true });
  fs.writeFileSync(path.join(isolated.target, "generated", "rivet", "rivet.ts"), "// generated\n");
  const local = isolated.run("--rule", "MER-RV-024");
  assert.equal(local.status, 0, local.stderr);
  assert.ok(!fs.existsSync(path.join(isolated.target, "ci-ran")));
  const ci = isolated.run("--rule", "MER-RV-024", "--ci");
  assert.equal(ci.status, 0, ci.stderr);
  assert.ok(fs.existsSync(path.join(isolated.target, "ci-ran")));
});

test("profile output is opt-in, reports selected owners, and leaves JSON stdout valid", () => {
  const isolated = isolatedPlumb({
    "MER-TO-907-profile.mjs": producer("MER-TO-907", { severity: "error" }),
    "MER-TO-908-unrelated.mjs": producer("MER-TO-908", { emit: null }),
  });
  const ordinary = isolated.run("--rule", "MER-TO-907", "--json");
  assert.equal(ordinary.status, 1);
  assert.doesNotMatch(ordinary.stderr, /plumb profile:/);
  const profiled = isolated.run("--rule", "MER-TO-907", "--json", "--profile");
  assert.equal(profiled.status, ordinary.status, profiled.stderr);
  assert.deepEqual(JSON.parse(profiled.stdout).map((finding) => finding.rule), ["MER-TO-907"]);
  assert.match(profiled.stderr, /plumb profile: setup /);
  assert.equal((profiled.stderr.match(/plumb profile: inventory /g) || []).length, 1);
  assert.match(profiled.stderr, /plumb profile: producer MER-TO-907 \(MER-TO-907-profile\.mjs\)/);
  assert.doesNotMatch(profiled.stderr, /MER-TO-908-unrelated/);
  assert.match(profiled.stderr, /plumb profile: external-ci total /);
  assert.match(profiled.stderr, /plumb profile: analysis-counters /);
  assert.match(profiled.stderr, /plumb profile: rendering /);
  assert.match(profiled.stderr, /plumb profile: total /);
});

test("successful legacy producer stderr is forwarded without contaminating JSON stdout", () => {
  const isolated = isolatedPlumb({
    "MER-TO-910-diagnostic.mjs": `#!/usr/bin/env node
process.stderr.write("legacy diagnostic\\n");
console.log("MER-TO-910\\twarn\\tresult.txt:1\\tfinding from sentinel\\ttools.md#default-stack-1");
`,
  });
  const out = isolated.run("--rule", "MER-TO-910", "--json");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stderr, /legacy diagnostic/);
  assert.deepEqual(JSON.parse(out.stdout).map((finding) => finding.rule), ["MER-TO-910"]);
});

test("focused in-process rules initialize only required capabilities", () => {
  const out = plumb(path.join(FIX, "MER-TO-001", "bad"), "--rule", "MER-TO-001", "--json", "--profile");
  assert.match(out.stderr, /plumb profile: in-process MER-TO-001 \(in-process\/to\.mjs\)/);
  assert.doesNotMatch(out.stderr, /plumb profile: producer MER-TO-001/);
  assert.match(out.stderr, /plumb profile: capabilities typescript=0 frontend-roots=0 frontend-graph=0 csharp=0 dotnet-projects=0/);
});

test("selected TypeScript owners share one source parse without frontend graph work", () => {
  const r = repo([], {
    "application/ports/.gitkeep": "",
    "src/modules/orders/application/use-case.ts": "export const now = Date.now();\nexport const mode = process.env.MODE;\n",
  });
  const out = plumb(r, "--pack", "BT", "--json", "--profile");
  assert.match(out.stderr, /analysis-counters .*typescript-runtime-load=1 typescript-parse=1 /);
  assert.match(out.stderr, /frontend-root-discovery=0 frontend-graph-build=0 dependency-cruiser-load=0 dependency-cruiser-run=0/);
});

test("selected C# owners share source masks and parse each visible project once", () => {
  const r = repo([], {
    "App.csproj": "<Project><PropertyGroup><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>\n",
    "Modules/Auth/Domain/Clock.cs": "public sealed class Clock { public static DateTime Now => DateTime.UtcNow; }\n",
    "Modules/Auth/Application/RunUseCase.cs": "public sealed class RunUseCase { public Task ExecuteAsync(CancellationToken ct) => Task.CompletedTask; }\n",
    "tests/App.Tests.csproj": "<Project><PropertyGroup><IsTestProject>true</IsTestProject></PropertyGroup></Project>\n",
  });
  const out = plumb(r, "--pack", "BE", "--json", "--profile");
  assert.ok([0, 1].includes(out.status), out.stderr);
  assert.match(out.stderr, /analysis-counters .*csharp-read=2 csharp-mask=2 csharp-classification=2 dotnet-project-parse=2 dotnet-project-graph-build=1 /);
});

test("focused syntax-light C# work does not construct the project graph", () => {
  const r = repo([], {
    "App.csproj": "<Project />\n",
    "Modules/Orders/Application/Ports/IOrderRepository.cs": "public interface IOrderRepository\n{\n    Task<OrderDto> GetAsync(Guid id);\n}\n",
  });
  // BE-040 reads only C# source; rules that judge test code by its project (BE-001, BE-052, BE-054 and others) build the graph.
  const out = plumb(r, "--rule", "MER-BE-040", "--json", "--profile");
  assert.equal(JSON.parse(out.stdout).length, 1, out.stderr);
  assert.match(out.stderr, /analysis-counters .*dotnet-project-parse=0 dotnet-project-graph-build=0 /);
  assert.match(out.stderr, /capabilities .*csharp=1 dotnet-projects=0/);
});

test("selected frontend consumers share Vue parsing and one graph per root", () => {
  const r = repo([], {
    "nuxt.config.ts": "export default { ssr: false }\n",
    "app/pages/index.vue": '<script setup lang="ts">\nimport { useAuth } from "~/composables/useAuth";\n</script>\n<template />\n',
    "app/composables/useAuth.ts": "export function useAuth() { return {}; }\n",
  });
  const out = plumb(r, "--pack", "FE", "--json", "--profile");
  assert.ok([0, 1].includes(out.status), out.stderr);
  assert.match(out.stderr, /analysis-counters .*vue-extraction=1 vue-script-parse=1 /);
  assert.match(out.stderr, /frontend-root-discovery=1 frontend-graph-build=1 dependency-cruiser-load=1 dependency-cruiser-run=1/);
});

test("Vue rules preserve first-block and all-block selection", () => {
  const firstOnly = repo([], {
    "app/component.vue": '<script setup lang="ts">const clean = true;</script>\n<script lang="ts">import { client } from "generated/client"; try { await client.GET("/x"); } catch {}</script>\n',
  });
  assert.deepEqual(JSON.parse(plumb(firstOnly, "--rule", "MER-FE-006", "--json").stdout), []);

  const allBlocks = repo([], {
    "app/component.vue": '<script setup lang="ts">const clean = true;</script>\n<script lang="ts">import { provideAuth } from "./ports/auth"; provideAuth();</script>\n',
  });
  const findings = JSON.parse(plumb(allBlocks, "--rule", "MER-FE-020", "--json").stdout);
  assert.ok(findings.some((finding) => finding.rule === "MER-FE-020" && finding.location === "app/component.vue:2"));
});

test("multiple selected in-process rules share physical file reads", () => {
  const r = repo([], {
    "App.csproj": "<Project><PropertyGroup><EnforceCodeStyleInBuild>true</EnforceCodeStyleInBuild></PropertyGroup><ItemGroup><PackageReference Include=\"CSharpier.MsBuild\" /></ItemGroup></Project>\n",
    "global.json": '{"sdk":{"version":"10.0.100","rollForward":"latestFeature"}}\n',
  });
  const out = plumb(r, "--pack", "TO", "--json", "--profile");
  assert.match(out.stderr, /plumb profile: counters text-read=2 /);
  assert.match(out.stderr, /plumb profile: in-process MER-TO-010 /);
  assert.match(out.stderr, /plumb profile: in-process MER-TO-012 /);
  assert.match(out.stderr, /plumb profile: in-process MER-TO-014 /);
});

test("mixed in-process, YAML, and legacy findings merge through the real CLI", () => {
  const r = repo([], {
    "package.json": "{}\n",
    "nuxt.config.ts": "export default {}\n",
    "app/logic/framework.ts": 'import { ref } from "vue";\n',
    "App.csproj": "<Project/>\n",
  });
  const out = plumb(r, "--json", "--fail-on", "info");
  assert.deepEqual(JSON.parse(out.stdout), [
    { rule: "MER-FE-001", severity: "error", location: "app/logic/framework.ts:1", message: "logic/ must not import framework code — keep it pure TypeScript or move it to a composable", docRef: "frontend-pa-vsa.md#logic" },
    { rule: "MER-TO-011", severity: "error", location: "App.csproj:0", message: "enable nullable reference types", docRef: "tools.md#default-stack-1" },
    { rule: "MER-FE-044", severity: "warn", location: "nuxt.config.ts:1", message: "Nuxt SPA config must explicitly set ssr: false", docRef: "frontend-pa-vsa.md#purpose" },
    { rule: "MER-TO-001", severity: "warn", location: "package.json:0", message: "pin pnpm via the packageManager field", docRef: "tools.md#default-stack" },
    { rule: "MER-TO-002", severity: "warn", location: ".oxfmtrc.json:0", message: "no .oxfmtrc.json found — TS repos carry the oxfmt base config (golden: configs/oxfmtrc.json in plumb)", docRef: "tools.md#linting-and-formatting" },
    { rule: "MER-TO-002", severity: "warn", location: ".oxlintrc.json:0", message: "no .oxlintrc.json found — TS repos carry the oxlint base config (golden: configs/oxlintrc.json in plumb)", docRef: "tools.md#linting-and-formatting" },
    { rule: "MER-TO-004", severity: "warn", location: "package.json:1", message: "Nuxt TypeScript package needs a script using vue-tsc or Nuxt typecheck", docRef: "tools.md#typescript--vue--nuxt" },
    { rule: "MER-TO-010", severity: "warn", location: ".:0", message: "no global.json — pin the SDK (.NET 10, rollForward latestFeature)", docRef: "tools.md#default-stack-1" },
    { rule: "MER-TO-011", severity: "warn", location: "App.csproj:0", message: "enable implicit usings (Meridian tooling default)", docRef: "tools.md#default-stack-1" },
    { rule: "MER-TO-012", severity: "warn", location: ".editorconfig:0", message: "no .editorconfig in a .NET repo — it is the style/analyzer authority (golden: configs/editorconfig.dotnet in plumb)", docRef: "tools.md#formatting-and-analyzers" },
    { rule: "MER-TO-012", severity: "warn", location: "App.csproj:1", message: "analyzers not enabled — set EnforceCodeStyleInBuild (or AnalysisLevel) in the csproj or Directory.Build.props", docRef: "tools.md#formatting-and-analyzers" },
    { rule: "MER-TO-014", severity: "warn", location: ".config/dotnet-tools.json:0", message: "CSharpier not wired — add CSharpier.MsBuild to the project (or a dotnet tool manifest) so formatting is enforced at build", docRef: "tools.md#formatting-and-analyzers" },
  ]);
});

test("malformed JSON keeps MER-TO-002's legacy warning", () => {
  const r = repo([], {
    "package.json": "{}\n",
    "source.ts": "export {}\n",
    ".oxlintrc.json": "{\n",
    ".oxfmtrc.json": fs.readFileSync(path.join(HOME, "configs", "oxfmtrc.json"), "utf8"),
  });
  const out = plumb(r, "--rule", "MER-TO-002", "--json");
  const findings = JSON.parse(out.stdout);
  assert.ok(findings.some((finding) => finding.location === ".oxlintrc.json:1" && finding.message === "unparseable JSON — cannot verify against the golden base"));
});

test("manifest temporary files are removed when a producer fails", () => {
  const isolated = isolatedPlumb({
    "MER-TO-909-failure.mjs": "#!/usr/bin/env node\nprocess.exit(2);\n",
  });
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-manifest-cleanup-"));
  cleanup.push(temporary);
  const out = spawnSync(path.join(isolated.home, "plumb"), [isolated.target, "--rule", "MER-TO-909"], {
    encoding: "utf8",
    env: { ...process.env, TMPDIR: temporary },
  });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(fs.readdirSync(temporary), []);
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

// MER-RV-024 drives go-task itself, so its producer run and its own test below need it. Another tool can own the name
// (Taskwarrior is `task` too, and both print a bare version), so go-task is known by its help naming the Taskfile, as
// the check knows it.
const taskHelp = spawnSync("task", ["--help"], { encoding: "utf8" });
const goTask = /\bTaskfile\b/.test(`${taskHelp.stdout ?? ""}${taskHelp.stderr ?? ""}`);

for (const s of scripts) {
  const id = s.match(/^MER-[A-Z]{2}-\d{3}/)?.[0];
  const fixture = id && fs.existsSync(path.join(FIX, id, "bad")) ? id : null;
  const skip = (!fixture && "no own fixture (family member)") || (id === "MER-RV-024" && !goTask && "go-task (task) not on PATH");
  test(`producer ${s}: exits 0, emits §3 five-field lines, fires on bad / not good`, { skip }, () => {
    const env = { ...process.env, PLUMB_CI: "1" };
    const bad = spawnProducer(path.join(CHECKS, s), path.join(FIX, fixture, "bad"), { encoding: "utf8", env });
    assert.equal(bad.status, 0, `bad run exit ${bad.status}: ${bad.stderr}`);
    const lines = (bad.stdout || "").split("\n").filter((l) => l.trim());
    assert.ok(lines.some((l) => l.startsWith(fixture)), `did not fire on its own bad fixture`);
    for (const l of lines) assert.match(l, LINE, `malformed finding line: ${JSON.stringify(l)}`);
    const good = spawnProducer(path.join(CHECKS, s), path.join(FIX, fixture, "good"), { encoding: "utf8", env });
    assert.equal(good.status, 0, `good run exit ${good.status}: ${good.stderr}`);
    assert.ok(!(good.stdout || "").split("\n").some((l) => l.startsWith(fixture)), `false positive on good fixture`);
  });
}

for (const id of MIGRATED) {
  test(`in-process ${id}: real CLI fires on bad / not good`, () => {
    const bad = plumb(path.join(FIX, id, "bad"), "--rule", id, "--json", "--ci");
    assert.ok([0, 1].includes(bad.status), `${id} bad exited ${bad.status}: ${bad.stderr}`);
    assert.ok(JSON.parse(bad.stdout).some((finding) => finding.rule === id), `${id} did not fire on bad fixture`);
    const good = plumb(path.join(FIX, id, "good"), "--rule", id, "--json", "--ci");
    assert.ok([0, 1].includes(good.status), `${id} good exited ${good.status}: ${good.stderr}`);
    assert.ok(!JSON.parse(good.stdout).some((finding) => finding.rule === id), `${id} fired on good fixture`);
  });
}

// ---- §4 degradation: AST-tier check without its optional dep ----

// A repo whose tsconfig extends a package that isn't installed, and whose domain imports through an alias.
const unreadableTsconfigRepo = () => repo([], {
  "tsconfig.json": '{ "extends": "@nuxt/tsconfig" }\n',
  "src/domain/a.ts": 'import { b } from "~/domain/b";\nexport const a = b;\n',
  "src/domain/b.ts": "export const b = 1;\n",
});

test("AST check with unresolvable typescript → stderr diagnostic, no findings, exit 0; a --ci run exits 2", () => {
  const isolated = isolatedPlumb({});
  fs.cpSync(path.join(FIX, "MER-BT-001", "bad"), isolated.target, { recursive: true });
  const out = isolated.run("--rule", "MER-BT-001", "--json");
  assert.equal(out.status, 0);
  assert.deepEqual(JSON.parse(out.stdout), []);
  assert.match(out.stderr, /TypeScript not installed/);
  // The summary doesn't read as clean: it says the run is degraded, and why is on stderr.
  const text = isolated.run("--rule", "MER-BT-001");
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^plumb: 0 error, 0 warn, 0 info — degraded: 1 analysis incomplete \(see above\)$/m);
  for (const args of [["--ci"], ["--ci", "--json"]]) {
    const ci = isolated.run("--rule", "MER-BT-001", ...args);
    assert.equal(ci.status, 2, `${args}: ${ci.stderr}`);
    assert.match(ci.stderr, /TypeScript not installed/, `${args}`);
  }
  // TypeScript is there but the repo's tsconfig extends a package that isn't installed: the rule runs with its
  // aliased imports unresolved, which degrades the run the same way.
  const partial = unreadableTsconfigRepo();
  const unread = plumb(partial, "--rule", "MER-BT-010");
  assert.equal(unread.status, 0, unread.stderr);
  assert.match(unread.stderr, /^plumb: TypeScript alias resolution degraded for tsconfig\.json: File '@nuxt\/tsconfig' not found/m);
  assert.match(unread.stdout, /^plumb: 0 error, 0 warn, 0 info — degraded: 1 analysis incomplete \(see above\)$/m);
  assert.equal(plumb(partial, "--rule", "MER-BT-010", "--ci").status, 2);
});

test("graph check without dependency-cruiser degrades while TypeScript remains available", () => {
  const isolated = isolatedPlumb({});
  fs.mkdirSync(path.join(isolated.home, "node_modules"), { recursive: true });
  fs.symlinkSync(fs.realpathSync(path.join(HOME, "node_modules", "typescript")), path.join(isolated.home, "node_modules", "typescript"), "dir");
  fs.cpSync(path.join(FIX, "MER-FE-004", "bad"), isolated.target, { recursive: true });
  const out = isolated.run("--rule", "MER-FE-004", "--json");
  assert.equal(out.status, 0);
  assert.deepEqual(JSON.parse(out.stdout), []);
  assert.match(out.stderr, /dependency-cruiser not installed/);
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
  assert.match(ratcheted.stdout, /\+\d+ baselined by \.plumb-baseline\.json, baseline holds \d+/);
  // a NEW violation in a different file is not absorbed by the allowance
  fs.cpSync(path.join(FIX, "MER-BE-005", "bad", "api", "Modules", "Auth", "Application", "U.cs"),
    path.join(r, "api", "Modules", "Auth", "Application", "U2.cs"));
  const withNew = plumb(r, "--baseline", bl);
  assert.equal(withNew.status, 1);
  assert.ok(withNew.ids.includes("MER-BE-005"));
});

test("baseline: the repo's own .plumb-baseline.json applies without --baseline; --no-baseline shows everything", () => {
  const r = repo(["MER-BE-005"], { "App.csproj": "<Project/>\n" });
  const flagged = plumb(r).ids.length;
  assert.ok(flagged > 0);
  assert.equal(plumb(r, "--write-baseline", path.join(r, ".plumb-baseline.json")).status, 0);
  const discovered = plumb(r);
  assert.equal(discovered.status, 0);
  assert.deepEqual(discovered.ids, []);
  assert.match(discovered.stdout, /\+\d+ baselined by \.plumb-baseline\.json, baseline holds \d+/);
  // --json keeps stdout pure and still says what the baseline hid.
  const asJson = plumb(r, "--json");
  assert.deepEqual(JSON.parse(asJson.stdout), []);
  assert.match(asJson.stderr, new RegExp(`^plumb: \\+${flagged} baselined by \\.plumb-baseline\\.json, baseline holds ${flagged}$`, "m"));
  // An explicit --baseline wins over the discovered one.
  fs.writeFileSync(path.join(r, "empty.json"), JSON.stringify({ version: 1, entries: {} }));
  assert.equal(plumb(r, "--baseline", path.join(r, "empty.json")).ids.length, flagged);
  assert.equal(plumb(r, "--no-baseline", "--write-baseline", path.join(r, "x.json")).status, 2);
  const everything = plumb(r, "--no-baseline");
  assert.equal(everything.ids.length, flagged);
  // --write-baseline captures every finding, not just those the existing baseline leaves.
  const rewrite = plumb(r, "--write-baseline", path.join(r, "again.json"));
  assert.match(rewrite.stdout, new RegExp(`baseline written — ${flagged} findings`));
});

test("baseline: a run whose check failed can't tell a shrink, and says nothing of one", () => {
  const baselineOf = (isolated) => {
    const file = path.join(isolated.target, ".plumb-baseline.json");
    fs.writeFileSync(file, JSON.stringify({ version: 1, entries: { "MER-TO-909\tresult.txt": 1 } }));
    return file;
  };
  const quiet = isolatedPlumb({ "MER-TO-909-quiet.mjs": "#!/usr/bin/env node\n" });
  assert.match(quiet.run("--rule", "MER-TO-909", "--baseline", baselineOf(quiet)).stdout, /shrunk/);
  // A producer exits 0 whether or not it finds drift, so any other exit, an uncaught throw (Node exits 1) or a
  // signal is a failure.
  for (const [body, reason] of [
    ["process.exit(2);", /failed \(exit 2\)/],
    ['throw new Error("producer blew up");', /failed \(exit 1\): .*producer blew up/s],
    ['process.kill(process.pid, "SIGKILL");', /failed \(killed by SIGKILL\)/],
  ]) {
    const failing = isolatedPlumb({ "MER-TO-909-failure.mjs": `#!/usr/bin/env node\n${body}\n` });
    const out = failing.run("--rule", "MER-TO-909", "--baseline", baselineOf(failing));
    assert.match(out.stderr, /check .*MER-TO-909-failure\.mjs failed/, body);
    assert.match(out.stderr, reason, body);
    assert.match(out.stdout, /baseline holds 1\) — degraded: 1 analysis incomplete \(see above\)$/m, body);
    assert.doesNotMatch(out.stdout, /shrunk/, body);
    assert.equal(out.status, 0, body);
    assert.equal(failing.run("--rule", "MER-TO-909", "--baseline", baselineOf(failing), "--ci").status, 2, body);
  }
  // Each incomplete analysis counts. TypeScript is there, so only the two producers fail.
  const both = isolatedPlumb({
    "MER-TO-908-failure.mjs": "#!/usr/bin/env node\nprocess.exit(2);\n",
    "MER-TO-909-failure.mjs": "#!/usr/bin/env node\nprocess.exit(2);\n",
  });
  fs.symlinkSync(fs.realpathSync(path.join(HOME, "node_modules", "typescript")), path.join(both.home, "node_modules", "typescript"), "dir");
  const out = both.run("--pack", "TO", "--no-baseline");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^plumb: 0 error, 0 warn, 0 info — degraded: 2 analyses incomplete \(see above\)$/m, out.stderr);
});

test("baseline: a run whose in-process rule lacked its engine can't tell a shrink", () => {
  const isolated = isolatedPlumb({});
  fs.cpSync(path.join(FIX, "MER-BT-001", "good"), isolated.target, { recursive: true });
  const bl = path.join(isolated.target, ".plumb-baseline.json");
  fs.writeFileSync(bl, JSON.stringify({ version: 1, entries: { "MER-BT-001\tsrc/gone.ts": 1 } }));
  const out = isolated.run("--rule", "MER-BT-001", "--baseline", bl);
  assert.match(out.stderr, /TypeScript not installed/);
  assert.match(out.stdout, /baseline holds 1/);
  assert.doesNotMatch(out.stdout, /shrunk/);
});

test("baseline: a run whose ast-grep failed can't tell a shrink", () => {
  const isolated = isolatedPlumb({});
  // Catalogue-valid but not an ast-grep rule: ast-grep exits 8 with empty stdout.
  fs.mkdirSync(path.join(isolated.home, "rules", "to"), { recursive: true });
  fs.writeFileSync(path.join(isolated.home, "rules", "to", "MER-TO-908-broken.yml"), "id: MER-TO-908\nlanguage: nolang\nrule:\n  pattern: x\n");
  fs.writeFileSync(path.join(isolated.target, "a.ts"), "x\n");
  const bl = path.join(isolated.target, ".plumb-baseline.json");
  fs.writeFileSync(bl, JSON.stringify({ version: 1, entries: { "MER-TO-908\ta.ts": 1 } }));
  const out = isolated.run("--rule", "MER-TO-908", "--baseline", bl);
  assert.match(out.stderr, /plumb: ast-grep failed, YAML rules skipped: exit 8: .*Cannot parse rule/s);
  assert.match(out.stdout, /baseline holds 1\) — degraded: 1 analysis incomplete \(see above\)$/m);
  assert.doesNotMatch(out.stdout, /shrunk/);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(isolated.run("--rule", "MER-TO-908", "--baseline", bl, "--ci").status, 2);
});

test("baseline: a degraded run refuses --write-baseline and leaves the file untouched", () => {
  const held = `${JSON.stringify({ version: 1, entries: { "MER-TO-909\tresult.txt": 1 } }, null, 2)}\n`;
  const quiet = isolatedPlumb({ "MER-TO-909-quiet.mjs": "#!/usr/bin/env node\n" });
  const quietFile = path.join(quiet.target, ".plumb-baseline.json");
  fs.writeFileSync(quietFile, held);
  assert.equal(quiet.run("--rule", "MER-TO-909", "--write-baseline", quietFile).status, 0);
  assert.notEqual(fs.readFileSync(quietFile, "utf8"), held);
  const failing = isolatedPlumb({ "MER-TO-909-failure.mjs": "#!/usr/bin/env node\nprocess.exit(2);\n" });
  const file = path.join(failing.target, ".plumb-baseline.json");
  fs.writeFileSync(file, held);
  const out = failing.run("--rule", "MER-TO-909", "--write-baseline", file);
  assert.equal(out.status, 2, out.stderr);
  assert.match(out.stderr, /check .*MER-TO-909-failure\.mjs failed \(exit 2\)/);
  assert.match(out.stderr, /plumb: the run is degraded — not writing .*\.plumb-baseline\.json, which would drop the entries of findings its incomplete analyses could miss$/m);
  assert.doesNotMatch(out.stdout, /baseline written/);
  assert.equal(fs.readFileSync(file, "utf8"), held);
  // A rule that ran on partial input (a tsconfig extending a package that isn't installed) can miss findings too.
  const partial = unreadableTsconfigRepo();
  const partialFile = path.join(partial, ".plumb-baseline.json");
  fs.writeFileSync(partialFile, held);
  const unread = plumb(partial, "--rule", "MER-BT-010", "--write-baseline", partialFile);
  assert.equal(unread.status, 2, unread.stderr);
  assert.match(unread.stderr, /TypeScript alias resolution degraded for tsconfig\.json/);
  assert.match(unread.stderr, /plumb: the run is degraded — not writing /);
  assert.equal(fs.readFileSync(partialFile, "utf8"), held);
});

test("baseline: a narrowed --write-baseline replaces only what the run checked and keeps the rest", () => {
  const r = repo(["MER-BE-005"], { "App.csproj": "<Project/>\n", "package.json": "{}\n" });
  const bl = path.join(r, ".plumb-baseline.json");
  const entriesOf = () => JSON.parse(fs.readFileSync(bl, "utf8")).entries;
  assert.equal(plumb(r, "--write-baseline", bl).status, 0);
  const full = entriesOf();
  const hold = (extra) => fs.writeFileSync(bl, JSON.stringify({ version: 1, entries: { ...full, ...extra } }));
  const api = Object.keys(full).filter((key) => key.startsWith("MER-BE-005\tapi/"));
  assert.ok(api.length, JSON.stringify(full));
  // --rule: every other rule's entries stay, and the rule that ran holds exactly what it found.
  hold({ "MER-TO-001\tgone.json": 1 });
  const focused = plumb(r, "--rule", "MER-TO-001", "--write-baseline", bl);
  assert.equal(focused.status, 0, focused.stderr);
  assert.match(focused.stdout, /keeping \d+ held for rules or files this run left out/);
  assert.deepEqual(entriesOf(), { ...full, "MER-TO-001\tpackage.json": 1 });
  // --pack: the other packs' entries stay, a held one included, and the pack that ran holds what it found.
  hold({ "MER-TO-001\tgone.json": 1, "MER-BE-005\tother/Gone.cs": 1 });
  assert.equal(plumb(r, "--pack", "BE", "--write-baseline", bl).status, 0);
  assert.deepEqual(entriesOf(), { ...full, "MER-TO-001\tgone.json": 1 });
  // A baseline it can't read exits 2 and stays as it was, rather than being replaced by this run's findings.
  fs.writeFileSync(bl, "{ not json\n");
  const corrupt = plumb(r, "--rule", "MER-TO-001", "--write-baseline", bl);
  assert.equal(corrupt.status, 2, corrupt.stderr);
  assert.match(corrupt.stderr, /^plumb: cannot read baseline .*\.plumb-baseline\.json: /m);
  assert.doesNotMatch(corrupt.stdout, /baseline written/);
  assert.equal(fs.readFileSync(bl, "utf8"), "{ not json\n");
  // --exclude: the excluded files' entries stay; a file the run checked holds what it found.
  hold({ "MER-BE-005\tother/Gone.cs": 1 });
  assert.equal(plumb(r, "--exclude", "api/**", "--write-baseline", bl).status, 0);
  const excluded = entriesOf();
  for (const key of api) assert.equal(excluded[key], full[key], key);
  assert.equal(excluded["MER-BE-005\tother/Gone.cs"], undefined);
  // Without --ci the CI-only rule didn't run, so its entry stays; a rule the catalogue no longer has ran and goes.
  hold({ "MER-RV-024\tweb/package.json": 1, "MER-BE-999\tgone.cs": 3 });
  assert.equal(plumb(r, "--write-baseline", bl).status, 0);
  assert.deepEqual(entriesOf(), { ...full, "MER-RV-024\tweb/package.json": 1 });
  // With --ci it ran, found nothing (no Taskfile) and its entry goes.
  assert.equal(plumb(r, "--rule", "MER-RV-024", "--ci", "--write-baseline", bl).status, 0);
  assert.deepEqual(entriesOf(), full);
  // A write checks every entry but those of the files --exclude left out of this run, which it keeps. A file a
  // persistent exclusion hides (.plumbignore, a fallback skip folder, .gitignore) can never be reported, so its entries
  // go, as a missing file's do; a directory is never hidden, so its entries are replaced by what was found (repeated
  // writes never add to them).
  const dirFindings = isolatedPlumb({
    "MER-TO-909-dirs.mjs": `#!/usr/bin/env node
console.log("MER-TO-909\\twarn\\tgenerated/rivet:0\\tdirectory finding\\ttools.md#default-stack-1");
console.log("MER-TO-909\\twarn\\tgenerated/missing.txt:1\\tmissing-file finding\\ttools.md#default-stack-1");
`,
  });
  for (const [file, text] of [["generated/rivet/rivet.ts", "// generated\n"], ["generated/old.ts", "// old\n"], ["hidden.ts", "// hidden\n"], [".plumbignore", "hidden.ts\n"], ["node_modules/dep/index.ts", "// dependency\n"], ["built/out.ts", "// built\n"]]) {
    fs.mkdirSync(path.dirname(path.join(dirFindings.target, file)), { recursive: true });
    fs.writeFileSync(path.join(dirFindings.target, file), text);
  }
  const dirBaseline = path.join(dirFindings.target, ".plumb-baseline.json");
  const found = { "MER-TO-909\tgenerated/rivet": 1, "MER-TO-909\tgenerated/missing.txt": 1 };
  const persistent = { "MER-TO-909\thidden.ts": 1, "MER-TO-909\tnode_modules/dep/index.ts": 1 };
  const dirEntries = { ...found, ...persistent, "MER-TO-909\tgenerated/rivet/rivet.ts": 1, "MER-TO-909\tgenerated/old.ts": 2, "MER-TO-909\tgone/missing.ts": 4 };
  const writes = (entries, args, written, keeping) => {
    const label = args.join(" ") || "full";
    fs.writeFileSync(dirBaseline, JSON.stringify({ version: 1, entries }));
    for (let write = 1; write <= 3; write++) {
      const out = dirFindings.run("--rule", "MER-TO-909", ...args, "--write-baseline", dirBaseline);
      assert.equal(out.status, 0, out.stderr);
      const held = keeping ? `, keeping ${keeping} held for rules or files this run left out` : "";
      assert.match(out.stdout, new RegExp(`baseline written — 2 findings across ${Object.keys(written).length} \\(rule,path\\) keys${held}$`, "m"), `${label} write ${write}`);
      assert.deepEqual(JSON.parse(fs.readFileSync(dirBaseline, "utf8")).entries, written, `${label} write ${write}`);
    }
  };
  // A directory pattern excludes the files under it, not the directory's own entry.
  writes(dirEntries, ["--exclude", "generated/"], { ...found, "MER-TO-909\tgenerated/rivet/rivet.ts": 1, "MER-TO-909\tgenerated/old.ts": 2 }, 3);
  writes(dirEntries, ["--exclude", "generated/rivet/"], { ...found, "MER-TO-909\tgenerated/rivet/rivet.ts": 1 }, 1);
  writes(dirEntries, [], found, 0);
  // In Git, a gitignored file is as unreportable, whatever --exclude says of it.
  fs.writeFileSync(path.join(dirFindings.target, ".gitignore"), "built/\n");
  spawnSync("git", ["init", "-q"], { cwd: dirFindings.target });
  writes({ ...found, ...persistent, "MER-TO-909\tbuilt/out.ts": 1 }, ["--exclude", "built/"], found, 0);
});

test("self-test: a check that crashes on its good fixture is an ERROR, not clean", () => {
  const isolated = isolatedPlumb({
    "MER-TO-909-flaky.mjs": `#!/usr/bin/env node
if (process.argv[2].endsWith("good")) { console.error("blew up on good"); process.exit(3); }
console.log("MER-TO-909\\twarn\\tresult.txt:1\\tfinding\\ttools.md#default-stack-1");
`,
    "MER-TO-910-healthy.mjs": `#!/usr/bin/env node
if (process.argv[2].endsWith("bad")) console.log("MER-TO-910\\twarn\\tresult.txt:1\\tfinding\\ttools.md#default-stack-1");
`,
    "MER-TO-911-broken.mjs": "#!/usr/bin/env node\nprocess.exit(3);\n",
  });
  for (const id of ["MER-TO-909", "MER-TO-910", "MER-TO-911"]) {
    for (const kind of ["bad", "good"]) {
      fs.mkdirSync(path.join(isolated.home, "fixtures", id, kind), { recursive: true });
      fs.writeFileSync(path.join(isolated.home, "fixtures", id, kind, "a.txt"), "x\n");
    }
  }
  const out = spawnSync(path.join(isolated.home, "plumb"), ["--self-test"], { encoding: "utf8" });
  assert.equal(out.status, 1, out.stdout + out.stderr);
  assert.match(out.stdout, /^FAIL MER-TO-909 {2}bad:hit {2}good:ERROR \(check MER-TO-909-flaky\.mjs failed \(exit 3\)\)$/m);
  assert.match(out.stdout, /^ok {3}MER-TO-910$/m);
  assert.match(out.stdout, /^FAIL MER-TO-911 {2}bad:ERROR \(check MER-TO-911-broken\.mjs failed \(exit 3\)\) {2}good:ERROR \(check MER-TO-911-broken\.mjs failed \(exit 3\)\)$/m);
  // Each cause counts once, however many fixture scans it broke: MER-TO-911's failed both of its own.
  assert.match(out.stdout, /^self-test: 2\/3 failing — degraded: 2 analyses incomplete \(see above\)$/m);
});

const rv024 = (r, env = {}) =>
  spawnProducer(path.join(CHECKS, "MER-RV-024-stale-generated.mjs"), r, { encoding: "utf8", env: { PLUMB_CI: "1", ...env } });
const rv024Taskfile = 'version: "3"\n\ntasks:\n  generate:\n    cmds:\n      - ./fake-rivet --project api --output generated/rivet\n';

// These cases fake their own PATH, so they run with or without go-task installed.
test("MER-RV-024: with no go-task on PATH it exits 2 with a reason, whatever else is called `task`", () => {
  // No task binary: PATH holds only node.
  const bin = repo([]);
  fs.symlinkSync(process.execPath, path.join(bin, "node"));
  const noTask = rv024(repo([], { "Taskfile.yml": rv024Taskfile }), { PATH: bin });
  assert.equal(noTask.status, 2, noTask.stderr);
  assert.match(noTask.stderr, /MER-RV-024: task \(go-task\) not on PATH — cannot check/);
  // A `task` that isn't go-task is never asked to run the generator.
  fs.writeFileSync(path.join(bin, "task"), "#!/bin/sh\necho 3.1.0\n");
  fs.chmodSync(path.join(bin, "task"), 0o755);
  const otherTask = rv024(repo([], { "Taskfile.yml": rv024Taskfile }), { PATH: bin });
  assert.equal(otherTask.status, 2, otherTask.stderr);
  assert.match(otherTask.stderr, /MER-RV-024: `task` on PATH is not go-task — cannot check/);
});

test("MER-RV-024: a convention it can't check exits 2 with a reason, so a --ci baseline can't read it as a shrink", { skip: !goTask && "go-task (task) not on PATH" }, () => {
  // No Taskfile, or none with a rivet task: the rule doesn't apply.
  assert.equal(rv024(repo([], { "README.md": "x\n" })).status, 0);
  assert.equal(rv024(repo([], { "Taskfile.yml": 'version: "3"\n\ntasks:\n  build:\n    cmds:\n      - echo hi\n' })).status, 0);
  // An empty --output is unresolved, not the next line's first word.
  const unresolved = rv024(repo([], { "Taskfile.yml": `${rv024Taskfile.replace("generated/rivet", "{{.OUT}}")}      - ./fake-rivet --check\n` }));
  assert.equal(unresolved.status, 2, unresolved.stderr);
  assert.match(unresolved.stderr, /could not resolve --output for task generate/);
  const missing = rv024(repo([], { "Taskfile.yml": rv024Taskfile }));
  assert.equal(missing.status, 2, missing.stderr);
  assert.match(missing.stderr, /output dir generated\/rivet does not exist/);
  // --output=dir names the directory as --output dir does.
  const joined = rv024(repo([], { "Taskfile.yml": rv024Taskfile.replace("--output generated/rivet", "--output=generated/rivet") }));
  assert.equal(joined.status, 2, joined.stderr);
  assert.match(joined.stderr, /output dir generated\/rivet does not exist/);
  // A generator that fails, or whose output diff can't read, can't be checked; either way the checked-in output is
  // restored over whatever it wrote.
  const generating = (script) => {
    const r = repo([], { "Taskfile.yml": rv024Taskfile, "fake-rivet": `#!/bin/sh\n${script}\n`, "generated/rivet/rivet.ts": "// checked in\n" });
    fs.chmodSync(path.join(r, "fake-rivet"), 0o755);
    return r;
  };
  const restored = (r) => fs.readFileSync(path.join(r, "generated", "rivet", "rivet.ts"), "utf8");
  const failing = generating("printf 'changed\\n' > generated/rivet/rivet.ts\nexit 3");
  const failed = rv024(failing);
  assert.equal(failed.status, 2, failed.stderr);
  assert.match(failed.stderr, /task generate failed/);
  assert.equal(restored(failing), "// checked in\n");
  const taskBin = repo([]);
  fs.symlinkSync(process.execPath, path.join(taskBin, "node"));
  fs.symlinkSync(process.env.PATH.split(path.delimiter).map((dir) => path.join(dir, "task")).find((file) => fs.existsSync(file)), path.join(taskBin, "task"));
  for (const [script, env, reason] of [
    // root reads a mode-000 file, so only another user's diff fails on it.
    ...(process.getuid?.() === 0 ? [] : [["printf 'changed\\n' > generated/rivet/rivet.ts\nchmod 000 generated/rivet/rivet.ts", {}, /diff failed \(exit 2\)/]]),
    ["rm generated/rivet/rivet.ts\nln -s missing generated/rivet/rivet.ts", {}, /diff failed/],
    ["exit 0", { PATH: taskBin }, /diff failed \(spawnSync diff ENOENT\)/],
  ]) {
    const unreadable = generating(script);
    const out = rv024(unreadable, env);
    assert.equal(out.status, 2, `${script}: ${out.stderr}`);
    assert.match(out.stderr, reason, script);
    assert.doesNotMatch(out.stdout, /MER-RV-024/, script);
    assert.equal(restored(unreadable), "// checked in\n", script);
  }
});

test("baseline: shrinking is reported and suggests ratcheting down", () => {
  const r = repo(["MER-BE-005"], { "App.csproj": "<Project/>\n" });
  const bl = path.join(r, ".plumb-baseline.json");
  plumb(r, "--write-baseline", bl);
  // fix the violation → suppressed < baseline total → shrink message
  fs.rmSync(path.join(r, "api"), { recursive: true });
  fs.writeFileSync(path.join(r, "App.csproj"), "<Project/>\n");
  // The hint names the command that works: the file given to --baseline, in its place…
  const ratchets = (out, file) => out.stdout.includes(` — shrunk; re-run with --write-baseline=${file} in place of --baseline to ratchet down)\n`);
  const out = plumb(r, "--baseline", bl);
  assert.equal(out.status, 0);
  assert.ok(ratchets(out, bl), out.stdout);
  // …or, with none given, the discovered one by its path from the current directory, absolute when it's outside.
  assert.ok(plumb(r).stdout.includes(` — shrunk; re-run with --write-baseline=${bl} to ratchet down)\n`));
  const inside = spawnSync(PLUMB, ["."], { cwd: r, encoding: "utf8" });
  assert.ok(inside.stdout.includes(" — shrunk; re-run with --write-baseline=.plumb-baseline.json to ratchet down)\n"), inside.stdout);
  // Either way the path is quoted for the shell, so one with a space or a quote pastes back as the one argument.
  const spaced = path.join(repo(), "my repo's");
  fs.cpSync(r, spaced, { recursive: true });
  const spacedBaseline = path.join(spaced, ".plumb-baseline.json");
  const pasted = (out) => {
    const hint = out.stdout.match(/ — shrunk; re-run with --write-baseline=(.+?)(?: in place of --baseline)? to ratchet down\)\n/)?.[1];
    assert.ok(hint, out.stdout);
    return spawnSync("sh", ["-c", `printf %s ${hint}`], { encoding: "utf8" }).stdout;
  };
  assert.equal(pasted(plumb(spaced, "--baseline", spacedBaseline)), spacedBaseline);
  assert.equal(pasted(plumb(spaced)), spacedBaseline);
  // …and joined to the flag with `=`, so a path starting with `-` (which the parser would read as a flag after a
  // space) or `=` (zsh's `=cmd` expansion) is still the flag's value: the hint, run as written, ratchets down.
  const leading = path.join(repo(), "leading");
  fs.cpSync(r, leading, { recursive: true });
  for (const name of ["-x.json", "=x.json"]) {
    fs.copyFileSync(path.join(leading, ".plumb-baseline.json"), path.join(leading, name));
    const run = (...args) => spawnSync(PLUMB, [".", ...args], { cwd: leading, encoding: "utf8" });
    const hinted = run(`--baseline=${name}`).stdout.match(/ — shrunk; re-run with (--write-baseline=\S+) in place of --baseline/)?.[1];
    assert.equal(hinted, `--write-baseline=${name}`);
    if (name.startsWith("-")) assert.equal(run("--write-baseline", name).status, 2, "after a space it reads as a flag");
    const rerun = spawnSync("sh", ["-c", `"$0" . ${hinted}`, PLUMB], { cwd: leading, encoding: "utf8" });
    assert.equal(rerun.status, 0, rerun.stderr);
    assert.doesNotMatch(run(`--baseline=${name}`).stdout, /shrunk/);
  }
  // A narrowed run compares only the entries of the rules it ran, and the same hint holds: a narrowed
  // --write-baseline keeps every other rule's entries.
  const focused = plumb(r, "--baseline", bl, "--rule", "MER-BE-001");
  assert.equal(focused.status, 0, focused.stderr);
  assert.match(focused.stdout, /baselined by \.plumb-baseline\.json/);
  assert.doesNotMatch(focused.stdout, /shrunk/);
  assert.ok(ratchets(plumb(r, "--baseline", bl, "--rule", "MER-BE-005"), bl));
  assert.ok(ratchets(plumb(r, "--baseline", bl, "--pack", "BE"), bl));
  assert.doesNotMatch(plumb(r, "--baseline", bl, "--pack", "FE").stdout, /shrunk/);
  // --exclude hides its files from every rule, so only their entries can't tell; a shrink among the rest still shows.
  assert.ok(ratchets(plumb(r, "--baseline", bl, "--exclude", "docs/**"), bl));
  // A CI-only rule's entries don't hide a real shrink in a run without --ci…
  const withCiOnly = JSON.parse(fs.readFileSync(bl, "utf8"));
  fs.writeFileSync(bl, JSON.stringify({ ...withCiOnly, entries: { ...withCiOnly.entries, "MER-RV-024\tweb/package.json": 1 } }));
  assert.ok(ratchets(plumb(r, "--baseline", bl), bl));
  assert.ok(ratchets(plumb(r, "--baseline", bl, "--rule", "MER-BE-005", "--ci"), bl));
  // …nor count as one when they're the only entries that run couldn't produce.
  const kept = repo(["MER-BE-005"], { "App.csproj": "<Project/>\n" });
  const keptBaseline = path.join(kept, ".plumb-baseline.json");
  plumb(kept, "--write-baseline", keptBaseline);
  const written = JSON.parse(fs.readFileSync(keptBaseline, "utf8"));
  fs.writeFileSync(keptBaseline, JSON.stringify({ ...written, entries: { ...written.entries, "MER-RV-024\tweb/package.json": 1 } }));
  const local = plumb(kept, "--baseline", keptBaseline);
  assert.equal(local.status, 0, local.stderr);
  assert.match(local.stdout, /baselined by \.plumb-baseline\.json/);
  assert.doesNotMatch(local.stdout, /shrunk/);
  // An entry for a rule the catalogue no longer has can only go, so it counts as shrunk.
  fs.writeFileSync(keptBaseline, JSON.stringify({ ...written, entries: { ...written.entries, "MER-BE-999\tgone.cs": 3 } }));
  assert.ok(ratchets(plumb(kept, "--baseline", keptBaseline), keptBaseline));
  // Excluded, it wasn't checked, and the entries that were all came back.
  fs.writeFileSync(path.join(kept, "notes.txt"), "x\n");
  fs.writeFileSync(keptBaseline, JSON.stringify({ ...written, entries: { ...written.entries, "MER-BE-999\tnotes.txt": 3 } }));
  assert.ok(ratchets(plumb(kept, "--baseline", keptBaseline), keptBaseline));
  const keptExcluded = plumb(kept, "--baseline", keptBaseline, "--exclude", "notes.txt");
  assert.equal(keptExcluded.status, 0, keptExcluded.stderr);
  assert.match(keptExcluded.stdout, /baselined by \.plumb-baseline\.json/);
  assert.doesNotMatch(keptExcluded.stdout, /shrunk/);
  // A finding no pattern hides (at a directory) doesn't stand in for an entry that didn't come back, and an entry
  // whose file --exclude hid, a directory pattern's included, can't tell. One whose file a persistent exclusion hides
  // (.plumbignore, a fallback skip folder, .gitignore) can never come back, so it shows a shrink.
  const dirFinding = isolatedPlumb({ "MER-TO-909-dir.mjs": producer("MER-TO-909").replace("result.txt:1", "generated/rivet:0") });
  for (const [file, text] of [["generated/rivet/rivet.ts", "// generated\n"], ["generated/old.ts", "// old\n"], ["hidden.ts", "// hidden\n"], [".plumbignore", "hidden.ts\n"], ["node_modules/dep/index.ts", "// dependency\n"], ["built/out.ts", "// built\n"]]) {
    fs.mkdirSync(path.dirname(path.join(dirFinding.target, file)), { recursive: true });
    fs.writeFileSync(path.join(dirFinding.target, file), text);
  }
  const dirBaseline = path.join(dirFinding.target, ".plumb-baseline.json");
  fs.writeFileSync(dirBaseline, JSON.stringify({ version: 1, entries: { "MER-TO-909\tgenerated/rivet": 1, "MER-TO-909\tresult.txt": 1 } }));
  const absorbed = dirFinding.run("--rule", "MER-TO-909", "--baseline", dirBaseline, "--exclude", "generated/");
  assert.equal(absorbed.status, 0, absorbed.stderr);
  assert.match(absorbed.stdout, /\+1 baselined by \.plumb-baseline\.json, baseline holds 2 — shrunk; /);
  assert.ok(ratchets(absorbed, dirBaseline), absorbed.stdout);
  const shrinkOf = (entries, ...args) => {
    fs.writeFileSync(dirBaseline, JSON.stringify({ version: 1, entries: { "MER-TO-909\tgenerated/rivet": 1, ...entries } }));
    const out = dirFinding.run("--rule", "MER-TO-909", "--baseline", dirBaseline, ...args);
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /\+1 baselined by \.plumb-baseline\.json/);
    return ratchets(out, dirBaseline);
  };
  assert.equal(shrinkOf({ "MER-TO-909\tgenerated/old.ts": 1 }, "--exclude", "generated/"), false);
  assert.equal(shrinkOf({ "MER-TO-909\tgenerated/rivet/rivet.ts": 1 }, "--exclude", "generated/rivet/"), false);
  assert.equal(shrinkOf({ "MER-TO-909\tgenerated/old.ts": 1 }, "--exclude", "generated/rivet/"), true);
  assert.equal(shrinkOf({ "MER-TO-909\thidden.ts": 1 }), true);
  assert.equal(shrinkOf({ "MER-TO-909\tnode_modules/dep/index.ts": 1 }), true);
  // A missing file is never hidden, so its entry is checked even under a pattern that covers it.
  assert.equal(shrinkOf({ "MER-TO-909\tgenerated/gone.ts": 1 }, "--exclude", "generated/"), true);
  fs.writeFileSync(path.join(dirFinding.target, ".gitignore"), "built/\n");
  spawnSync("git", ["init", "-q"], { cwd: dirFinding.target });
  assert.equal(shrinkOf({ "MER-TO-909\tbuilt/out.ts": 1 }, "--exclude", "built/"), true);
  assert.equal(shrinkOf({ "MER-TO-909\thidden.ts": 1 }, "--exclude", "hidden.ts"), true);
});

test("baseline: --json emits only actionable findings; unreadable baseline → exit 2", () => {
  const r = repo(["MER-BE-005"], { "App.csproj": "<Project/>\n" });
  const bl = path.join(r, ".plumb-baseline.json");
  plumb(r, "--write-baseline", bl);
  const out = plumb(r, "--baseline", bl, "--json");
  assert.deepEqual(JSON.parse(out.stdout), []);
  assert.equal(plumb(r, "--baseline", "/nonexistent/bl.json").status, 2);
});

test("baseline identity and suppression are unchanged for migrated findings", () => {
  const r = repo([], { "package.json": "{}\n" });
  const baseline = path.join(r, "baseline.json");
  assert.equal(plumb(r, "--rule", "MER-TO-001", "--write-baseline", baseline).status, 0);
  const out = plumb(r, "--rule", "MER-TO-001", "--baseline", baseline, "--json");
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(baseline, "utf8")).entries, { "MER-TO-001\tpackage.json": 1 });
});

// index.vue lines 10, 11 and 15 are a literal type, a template literal type and an interface member: type
// positions never count. Line 16's route argument is the generated client's, but the id in its query is a copy.
// Each crm-positions.ts and CrmLinks.vue line shows one kind of id position, some with several ids in it
// (crm-positions.ts:15, 16 and 20, CrmLinks.vue:3 and 4); crm-positions.ts:55 only declares the component line 56
// maps to. A key mapped to another server id (31, 51-53, 65, 72, 74, and 86 and 87 written with `.set` and at an
// index) or to a route (57-59, 62, 64, 66-69, 71, 74, 76, 78, 85, 101, 105, and 73, 75 and 84 through a branch or
// fallback: a value starting with `/`, `./`, `../`, `#/` or `#!/`, a full or protocol-relative URL, or a template
// whose first text does) is a
// route table, not a label, and both ids of an id-to-id map are copies; a `new Map` or `Object.fromEntries` entry's
// key counts however the result is used (64-66, 74), and an unquoted key only beside a value with an id among its
// results (70, 79-82: directly, in an array, in a branch, beside `??`). A key mapped to a value that may not be a
// label is flagged: an unknown value `??` a label (77), a template of only substitutions (83), or a branch whose
// other result is an id or route, even beside `undefined`, or that holds only `null` and `undefined` (84). Only a
// web asset's extension makes an asset, not a version's or a name's dot (76, 78), nor a protocol-relative URL's host
// (85). A key mapped to a number (36) is
// flagged, an ordering or a limit alike, since a limit is a rule. Line 61's "export" is meant as a label, but a
// value is judged by whether it equals an id, so "csv" mapped to it is flagged too: the accepted trade-off, as route
// tables are the real harm. Navigating from script (90-93: `navigateTo`, `router.push`/`.replace`, with a path, a
// route location's `path`, `params` or `query`; useCrmDestination.ts:12-16, a router and its methods bound by name
// from `useRouter()` or from a router bound to it, one taking a bare string) builds a link like `to` does, and so
// does a query built with `URLSearchParams` (94-98: a URL's `searchParams.set`/`.append`, `new URLSearchParams` from
// an object, entries or a string, and a name bound to one), whose parameter names count only beside an id value
// (99, 100), though a name declared as something else is read as an id, whatever the file binds the same name to
// elsewhere (106: a parameter, beside line 98's search params), and a request's `query` or
// ofetch's `params` (useCrmDestination.ts:19-22: `$fetch`, `useFetch`, `$fetch.raw`). A path's pieces are read at `/`
// and `=` (102, a query value holding `=`), its query starts at the first `?` only (103), a hashbang route is a route
// (104), and a template's piece is a path when the template holds a `/` anywhere (107); a template's piece past a
// hash-mode `#/` is read (useCrmDestination.ts:23, CrmLinks.vue:31), and one that continues a query is read as the
// open parameter's value and its `&name=value` values (108-111, CrmLinks.vue:32: a tail in `navigateTo`, a middle,
// the CSV-style id before a bare name, a `URLSearchParams` string, a query-only link).
// A link's MIME-shaped value (CrmLinks.vue:12-18: static, bound, a template, a bare `v-bind` object's `to` or `href`,
// and a route location's `path`) is a relative path, a nested object in a `v-bind` (11) is data, not attributes, and a link's route
// location `params` and `query` values (19, 20, 24, also in an array), its query string (21, 22, and 25 and 29
// without a `/`), the path (26) and query (27) before a fragment, whose `#…` is not read, a `$router.push` in a
// handler (23), and a `push` bound from `useRouter()` in the script (28) build the link from an id. Only a table's
// key (a quoted, computed or unquoted key, a Map entry's, `.set`'s or an index assigned to) gets the message's note
// that a table may map the id to labels. The good fixture's server declares
// ExportId = "export", and its crm-copy.ts and CrmConflict.vue use "export" as wording and stay clean: `noun:`,
// `title:`, `typeLabel:`, a native element's `class=`, `title=`, `data-testid=` and `id=`, a component's `id=`/`:id=`
// and `noun=`/`:noun=`, the `id` and `type` keys of an argument-less `v-bind` object (attributes, like
// `:id`/`:type`), also through a branch or `??`, any key of an argument-less `v-bind` or `v-on` object (attribute and
// event names), test hooks (`data-test-id=`, `:data-qa-id=`), a route name (`:to="{ name: 'export' }"`) and a `path`
// outside a link, `:class` object keys, a `new Map` entry's value, a class field and `this.title =` under wording
// names, an interpolation, a returned value, a call argument, and the whitespace paths "Choose import/export" and
// `Choose ${mode}/export`. Its string labels, colours and icons keyed on "acme-crm" or "csv" (quoted, computed,
// `new Map` entries, through `as const`, `<const>`, `<string>` and `satisfies`) are presentation, including
// "Read/Write", whose `/` doesn't make it a route, and a component's name as a string ("AcmeCrmPanel"): the accepted
// reading, as Nuxt dispatches on the imported component, which is flagged (56). Labels too: a choice between labels,
// a translation (`t("acme")`, `i18n.t(…)`, `$t(…)` in a bound object, also beside `??` or through `!`), a label beside
// `null` or `undefined`, and an asset path, known by a web asset's extension (also `.csv`, though "csv" is an id),
// at a full or protocol-relative URL, with a fragment, or in a bound object. A label table written with `.set`, at
// an index or by `Object.fromEntries` is presentation like a `new Map`. Unquoted keys beside wording are field names
// (`{ email: true }`, `{ csv: "Comma separated" }`), a branched `v-on` object's keys are events, a `path` in a
// non-link prop (`:meta`) is no link, nor is a query-shaped `:title` without a `/`, `.push` onto a list, a `push`
// not bound from `useRouter()` and a form's `.append` aren't links, and "text/csv" is a MIME type, not a path to the
// "csv" id. A query parameter's name beside a value that isn't an id (`?email=${address}`, `?export=1`, a search
// params `.set`/`.get`, an initial object's keys or entry's name, also past a substitution: `` `?tab=${t}&csv` ``,
// `&export=1`, a `URLSearchParams` string's, a query after a hash-mode route) is no copy, nor is the name `.has` asks
// of a variable declared as search params beside a same-named parameter that isn't, and a fragment only scrolls
// (`href="#export"` beside `id="export"`, a route location's `hash`, `<use href="#csv">`, `<Teleport to="#export">`, a template's
// text past a `#`).
test("MER-CP-001 names each copied id's qualified owner at its exact location", () => {
  const findings = JSON.parse(plumb(path.join(FIX, "MER-CP-001", "bad"), "--rule", "MER-CP-001", "--json").stdout);
  const owner = (finding) => finding.message.match(/is the server's (\S+);/)?.[1];
  assert.deepEqual(findings.map((finding) => [finding.location, owner(finding)]), [
    ["ui/app/pages/crm/components/CrmLinks.vue:10", "CrmIntegration.ExportId"], // v-bind object, a link's `to`
    ["ui/app/pages/crm/components/CrmLinks.vue:11", "CrmIntegration.Webhooks.HandlerId"], // nested object in a v-bind, id-named key
    ["ui/app/pages/crm/components/CrmLinks.vue:12", "CrmIntegration.IntegrationId"], // MIME-shaped static link
    ["ui/app/pages/crm/components/CrmLinks.vue:13", "CrmConnector.ConnectorId"], // MIME-shaped bound link
    ["ui/app/pages/crm/components/CrmLinks.vue:14", "CrmIntegration.Webhooks.HandlerId"], // MIME-shaped link in a branched v-bind object
    ["ui/app/pages/crm/components/CrmLinks.vue:15", "CrmIntegration.Webhooks.HandlerId"], // a bound route location's `path`
    ["ui/app/pages/crm/components/CrmLinks.vue:16", "TestCrmConnectionUseCase.ProbeId"], // a route location's `path` in a v-bind object
    ["ui/app/pages/crm/components/CrmLinks.vue:17", "CrmIntegration.IntegrationId"], // MIME-shaped template bound to a link
    ["ui/app/pages/crm/components/CrmLinks.vue:18", "CrmConnector.ConnectorId"], // MIME-shaped `href` in a v-bind object
    ["ui/app/pages/crm/components/CrmLinks.vue:19", "CrmIntegration.IntegrationId"], // a link's route-location `params` value
    ["ui/app/pages/crm/components/CrmLinks.vue:2", "CrmIntegration.IntegrationId"], // static href
    ["ui/app/pages/crm/components/CrmLinks.vue:20", "CrmConnector.ConnectorId"], // a link's route-location `query` value
    ["ui/app/pages/crm/components/CrmLinks.vue:21", "CrmIntegration.IntegrationId"], // a static link's query value
    ["ui/app/pages/crm/components/CrmLinks.vue:22", "CrmIntegration.Webhooks.HandlerId"], // a bound link's query value after `&`
    ["ui/app/pages/crm/components/CrmLinks.vue:23", "TestCrmConnectionUseCase.ProbeId"], // `$router.push` in a handler
    ["ui/app/pages/crm/components/CrmLinks.vue:24", "CrmConnector.ConnectorId"], // a listed `params` value in a v-bind link
    ["ui/app/pages/crm/components/CrmLinks.vue:25", "CrmIntegration.IntegrationId"], // a query-only link, no `/`
    ["ui/app/pages/crm/components/CrmLinks.vue:26", "CrmConnector.ConnectorId"], // a route location's `path` beside a `hash`, not read
    ["ui/app/pages/crm/components/CrmLinks.vue:27", "CrmIntegration.Webhooks.HandlerId"], // a query before a fragment, not read
    ["ui/app/pages/crm/components/CrmLinks.vue:28", "TestCrmConnectionUseCase.ProbeId"], // `push` bound from useRouter() in the script
    ["ui/app/pages/crm/components/CrmLinks.vue:29", "CrmIntegration.IntegrationId"], // a query-only template link
    ["ui/app/pages/crm/components/CrmLinks.vue:3", "CrmConnector.ConnectorId"], // id-named static attributes
    ["ui/app/pages/crm/components/CrmLinks.vue:3", "CrmIntegration.Webhooks.HandlerId"],
    ["ui/app/pages/crm/components/CrmLinks.vue:30", "CrmIntegration.IntegrationId"], // a hash-mode route is a route, not a fragment
    ["ui/app/pages/crm/components/CrmLinks.vue:31", "CrmConnector.ConnectorId"], // a template's piece past a hash-mode route's `#/`
    ["ui/app/pages/crm/components/CrmLinks.vue:32", "CrmIntegration.IntegrationId"], // a query-only template link's value past a substitution
    ["ui/app/pages/crm/components/CrmLinks.vue:4", "CrmIntegration.Webhooks.HandlerId"], // id-named bound attributes
    ["ui/app/pages/crm/components/CrmLinks.vue:4", "CrmIntegration.IntegrationId"],
    ["ui/app/pages/crm/components/CrmLinks.vue:5", "CrmIntegration.IntegrationId"], // under an id-named key in a bound object
    ["ui/app/pages/crm/components/CrmLinks.vue:6", "CrmIntegration.IntegrationId"], // a component's `type` prop
    ["ui/app/pages/crm/components/CrmLinks.vue:7", "CrmIntegration.Webhooks.HandlerId"], // v-bind object, id-named key
    ["ui/app/pages/crm/components/CrmLinks.vue:8", "CrmIntegration.EmailChannelId"], // an HTML type on a component that isn't an input
    ["ui/app/pages/crm/components/CrmLinks.vue:9", "CrmIntegration.IntegrationId"], // v-bind object, a component's `type`
    ["ui/app/pages/crm/composables/useCrmDestination.ts:12", "CrmIntegration.IntegrationId"], // a router bound from useRouter(), a bare string
    ["ui/app/pages/crm/composables/useCrmDestination.ts:13", "CrmIntegration.IntegrationId"], // a destructured `push`'s `params`
    ["ui/app/pages/crm/composables/useCrmDestination.ts:14", "CrmConnector.ConnectorId"], // a renamed `replace`'s `query`
    ["ui/app/pages/crm/composables/useCrmDestination.ts:16", "TestCrmConnectionUseCase.ProbeId"], // destructured from a bound router
    ["ui/app/pages/crm/composables/useCrmDestination.ts:17", "CrmIntegration.IntegrationId"], // a hash-mode route, `#/…`
    ["ui/app/pages/crm/composables/useCrmDestination.ts:18", "CrmConnector.ConnectorId"], // a hash-mode route after the URL, `/#/…`
    ["ui/app/pages/crm/composables/useCrmDestination.ts:19", "CrmIntegration.IntegrationId"], // $fetch's `query`
    ["ui/app/pages/crm/composables/useCrmDestination.ts:20", "CrmConnector.ConnectorId"], // useFetch's `query`
    ["ui/app/pages/crm/composables/useCrmDestination.ts:21", "TestCrmConnectionUseCase.ProbeId"], // $fetch's `params`, ofetch's alias for `query`
    ["ui/app/pages/crm/composables/useCrmDestination.ts:22", "CrmIntegration.Webhooks.HandlerId"], // $fetch.raw's `query`
    ["ui/app/pages/crm/composables/useCrmDestination.ts:23", "CrmIntegration.IntegrationId"], // a template's piece past `/#/` in navigateTo
    ["ui/app/pages/crm/composables/useCrmDestination.ts:6", "CrmIntegration.IntegrationId"], // ref(…)'s initial value, held by a variable
    ["ui/app/pages/crm/index.vue:12", "CrmIntegration.IntegrationId"], // compared against a literal-typed value
    ["ui/app/pages/crm/index.vue:13", "CrmIntegration.IntegrationId"], // hand-built /api/ URL
    ["ui/app/pages/crm/index.vue:14", "TestCrmConnectionUseCase.ProbeId"], // production type named Test…
    ["ui/app/pages/crm/index.vue:16", "CrmIntegration.IntegrationId"], // an id in the client call's options
    ["ui/app/pages/crm/index.vue:22", "CrmIntegration.IntegrationId"],
    ["ui/app/pages/crm/index.vue:23", "CrmIntegration.IntegrationId"],
    ["ui/app/pages/crm/index.vue:6", "CrmIntegration.IntegrationId"],
    ["ui/app/pages/crm/index.vue:7", "CrmIntegration.IntegrationId"],
    ["ui/app/pages/crm/index.vue:8", "CrmConnector.ConnectorId"],
    ["ui/app/pages/crm/index.vue:9", "CrmIntegration.Webhooks.HandlerId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:100", "CrmIntegration.EmailChannelId"], // an entry's name beside an id value
    ["ui/app/pages/crm/logic/crm-positions.ts:100", "CrmIntegration.IntegrationId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:101", "CrmIntegration.IntegrationId"], // a route table to a hash-mode route, `#/…`
    ["ui/app/pages/crm/logic/crm-positions.ts:102", "CrmIntegration.IntegrationId"], // a query value holding `=`, split at it
    ["ui/app/pages/crm/logic/crm-positions.ts:103", "CrmIntegration.IntegrationId"], // a `&` before any `?` is the path's
    ["ui/app/pages/crm/logic/crm-positions.ts:104", "CrmIntegration.IntegrationId"], // a hashbang route, `#!/…`
    ["ui/app/pages/crm/logic/crm-positions.ts:105", "CrmConnector.ConnectorId"], // a route table to a hashbang route
    ["ui/app/pages/crm/logic/crm-positions.ts:106", "CrmIntegration.IntegrationId"], // `.has` on a parameter sharing a search params name
    ["ui/app/pages/crm/logic/crm-positions.ts:107", "CrmIntegration.IntegrationId"], // a template's query piece, its `/` in an earlier piece
    ["ui/app/pages/crm/logic/crm-positions.ts:108", "CrmIntegration.IntegrationId"], // a query continued past a substitution, a tail
    ["ui/app/pages/crm/logic/crm-positions.ts:109", "CrmIntegration.IntegrationId"], // and a middle
    ["ui/app/pages/crm/logic/crm-positions.ts:110", "CrmIntegration.CsvFormatId"], // a value before a bare name
    ["ui/app/pages/crm/logic/crm-positions.ts:111", "CrmIntegration.IntegrationId"], // a URLSearchParams string past a substitution
    ["ui/app/pages/crm/logic/crm-positions.ts:15", "CrmIntegration.IntegrationId"], // .includes( argument
    ["ui/app/pages/crm/logic/crm-positions.ts:15", "CrmConnector.ConnectorId"], // .has( argument
    ["ui/app/pages/crm/logic/crm-positions.ts:15", "CrmIntegration.Webhooks.HandlerId"], // .indexOf( argument
    ["ui/app/pages/crm/logic/crm-positions.ts:16", "CrmIntegration.IntegrationId"], // array tested with .includes
    ["ui/app/pages/crm/logic/crm-positions.ts:16", "CrmConnector.ConnectorId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:17", "CrmIntegration.Webhooks.HandlerId"], // array tested with .indexOf
    ["ui/app/pages/crm/logic/crm-positions.ts:18", "CrmIntegration.Webhooks.HandlerId"], // listed constant, `as const`
    ["ui/app/pages/crm/logic/crm-positions.ts:19", "CrmIntegration.IntegrationId"], // constant, `as const`
    ["ui/app/pages/crm/logic/crm-positions.ts:20", "CrmIntegration.Webhooks.HandlerId"], // id-named properties
    ["ui/app/pages/crm/logic/crm-positions.ts:20", "CrmConnector.ConnectorId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:21", "CrmIntegration.IntegrationId"], // object key mapped to a capability, not a label
    ["ui/app/pages/crm/logic/crm-positions.ts:22", "CrmIntegration.IntegrationId"], // template head building a path
    ["ui/app/pages/crm/logic/crm-positions.ts:23", "CrmConnector.ConnectorId"], // template tail
    ["ui/app/pages/crm/logic/crm-positions.ts:24", "CrmIntegration.Webhooks.HandlerId"], // template middle
    ["ui/app/pages/crm/logic/crm-positions.ts:25", "CrmIntegration.IntegrationId"], // enum member
    ["ui/app/pages/crm/logic/crm-positions.ts:26", "CrmIntegration.IntegrationId"], // conditional branch, held
    ["ui/app/pages/crm/logic/crm-positions.ts:27", "CrmConnector.ConnectorId"], // conditional branch, id-named property
    ["ui/app/pages/crm/logic/crm-positions.ts:28", "CrmIntegration.Webhooks.HandlerId"], // ?? fallback
    ["ui/app/pages/crm/logic/crm-positions.ts:29", "TestCrmConnectionUseCase.ProbeId"], // || fallback
    ["ui/app/pages/crm/logic/crm-positions.ts:3", "CrmIntegration.IntegrationId"], // !==
    ["ui/app/pages/crm/logic/crm-positions.ts:30", "CrmIntegration.IntegrationId"], // new Set([…])
    ["ui/app/pages/crm/logic/crm-positions.ts:31", "CrmConnector.ConnectorId"], // new Map([[…]]) key mapped to a list, not a label
    ["ui/app/pages/crm/logic/crm-positions.ts:31", "CrmIntegration.ExportId"], // an id listed under an id key
    ["ui/app/pages/crm/logic/crm-positions.ts:32", "TestCrmConnectionUseCase.ProbeId"], // a Set tested with .has
    ["ui/app/pages/crm/logic/crm-positions.ts:33", "CrmIntegration.Webhooks.HandlerId"], // array under an id-named property
    ["ui/app/pages/crm/logic/crm-positions.ts:34", "CrmIntegration.Webhooks.HandlerId"], // right side of =
    ["ui/app/pages/crm/logic/crm-positions.ts:35", "CrmIntegration.IntegrationId"], // element access
    ["ui/app/pages/crm/logic/crm-positions.ts:36", "CrmConnector.ConnectorId"], // computed key mapped to a number
    ["ui/app/pages/crm/logic/crm-positions.ts:37", "CrmIntegration.Webhooks.HandlerId"], // under a computed id-named key
    ["ui/app/pages/crm/logic/crm-positions.ts:38", "CrmIntegration.IntegrationId"], // `in`
    ["ui/app/pages/crm/logic/crm-positions.ts:39", "CrmIntegration.Webhooks.HandlerId"], // default parameter
    ["ui/app/pages/crm/logic/crm-positions.ts:4", "CrmIntegration.IntegrationId"], // ==
    ["ui/app/pages/crm/logic/crm-positions.ts:40", "CrmConnector.ConnectorId"], // destructuring default
    ["ui/app/pages/crm/logic/crm-positions.ts:41", "CrmIntegration.IntegrationId"], // class field under an id name
    ["ui/app/pages/crm/logic/crm-positions.ts:42", "TestCrmConnectionUseCase.ProbeId"], // <T> type assertion
    ["ui/app/pages/crm/logic/crm-positions.ts:43", "CrmIntegration.IntegrationId"], // assigned at a computed index of an id-named collection
    ["ui/app/pages/crm/logic/crm-positions.ts:44", "CrmIntegration.IntegrationId"], // right side of &&, held
    ["ui/app/pages/crm/logic/crm-positions.ts:45", "CrmIntegration.IntegrationId"], // ??=
    ["ui/app/pages/crm/logic/crm-positions.ts:46", "CrmIntegration.IntegrationId"], // .get( key
    ["ui/app/pages/crm/logic/crm-positions.ts:47", "CrmIntegration.IntegrationId"], // Id split off an acronym
    ["ui/app/pages/crm/logic/crm-positions.ts:48", "CrmIntegration.IntegrationId"], // `test` + `id` after another word is no test hook
    ["ui/app/pages/crm/logic/crm-positions.ts:49", "CrmIntegration.IntegrationId"], // a ref array's element, by the ref's name
    ["ui/app/pages/crm/logic/crm-positions.ts:5", "CrmConnector.ConnectorId"], // !=
    ["ui/app/pages/crm/logic/crm-positions.ts:50", "CrmIntegration.IntegrationId"], // static field, whatever its name
    ["ui/app/pages/crm/logic/crm-positions.ts:51", "CrmIntegration.IntegrationId"], // key mapped to another id, a route table
    ["ui/app/pages/crm/logic/crm-positions.ts:51", "CrmIntegration.Webhooks.HandlerId"], // and the id it maps to
    ["ui/app/pages/crm/logic/crm-positions.ts:52", "CrmConnector.ConnectorId"], // new Map([[…]]) key mapped to another id
    ["ui/app/pages/crm/logic/crm-positions.ts:52", "TestCrmConnectionUseCase.ProbeId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:53", "CrmConnector.ConnectorId"], // computed key mapped to another id
    ["ui/app/pages/crm/logic/crm-positions.ts:53", "CrmIntegration.Webhooks.HandlerId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:54", "CrmIntegration.IntegrationId"], // MIME-shaped template tail of a path
    ["ui/app/pages/crm/logic/crm-positions.ts:56", "CrmIntegration.IntegrationId"], // key mapped to a component, a dispatch table
    ["ui/app/pages/crm/logic/crm-positions.ts:57", "CrmIntegration.IntegrationId"], // key mapped to a path, a route table
    ["ui/app/pages/crm/logic/crm-positions.ts:58", "CrmConnector.ConnectorId"], // new Map([[…]]) key mapped to a path
    ["ui/app/pages/crm/logic/crm-positions.ts:59", "CrmIntegration.Webhooks.HandlerId"], // computed key mapped to a template path
    ["ui/app/pages/crm/logic/crm-positions.ts:61", "CrmIntegration.CsvFormatId"], // a label equal to an id: the accepted trade-off
    ["ui/app/pages/crm/logic/crm-positions.ts:61", "CrmIntegration.ExportId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:62", "CrmIntegration.IntegrationId"], // key mapped to a `${…}/` template route
    ["ui/app/pages/crm/logic/crm-positions.ts:64", "CrmIntegration.IntegrationId"], // a returned Map's route table
    ["ui/app/pages/crm/logic/crm-positions.ts:65", "CrmConnector.ConnectorId"], // a Map passed to a call, id to id
    ["ui/app/pages/crm/logic/crm-positions.ts:65", "CrmIntegration.Webhooks.HandlerId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:66", "CrmIntegration.IntegrationId"], // a Map in a computed
    ["ui/app/pages/crm/logic/crm-positions.ts:67", "CrmIntegration.IntegrationId"], // `./` and `../` routes
    ["ui/app/pages/crm/logic/crm-positions.ts:67", "CrmConnector.ConnectorId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:68", "CrmIntegration.Webhooks.HandlerId"], // `${a}${b}/` template route
    ["ui/app/pages/crm/logic/crm-positions.ts:69", "CrmIntegration.IntegrationId"], // a full URL
    ["ui/app/pages/crm/logic/crm-positions.ts:69", "CrmConnector.ConnectorId"], // a URL's host isn't an asset, even in a `.zip` TLD
    ["ui/app/pages/crm/logic/crm-positions.ts:70", "CrmIntegration.CsvFormatId"], // unquoted keys mapped to ids, both sides
    ["ui/app/pages/crm/logic/crm-positions.ts:70", "CrmIntegration.ExportId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:70", "CrmIntegration.EmailChannelId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:70", "CrmIntegration.Webhooks.HandlerId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:71", "CrmIntegration.IntegrationId"], // a plain backtick route
    ["ui/app/pages/crm/logic/crm-positions.ts:72", "CrmIntegration.IntegrationId"], // a Map entry's `as const` id value, both sides
    ["ui/app/pages/crm/logic/crm-positions.ts:72", "CrmIntegration.Webhooks.HandlerId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:73", "CrmIntegration.IntegrationId"], // a branch between a label and a route
    ["ui/app/pages/crm/logic/crm-positions.ts:73", "CrmConnector.ConnectorId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:74", "CrmIntegration.IntegrationId"], // Object.fromEntries entries, as Map entries
    ["ui/app/pages/crm/logic/crm-positions.ts:74", "CrmConnector.ConnectorId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:74", "CrmIntegration.Webhooks.HandlerId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:75", "CrmIntegration.IntegrationId"], // a label `??` a route
    ["ui/app/pages/crm/logic/crm-positions.ts:75", "CrmConnector.ConnectorId"], // a label `||` a route
    ["ui/app/pages/crm/logic/crm-positions.ts:76", "CrmIntegration.IntegrationId"], // a version's dot isn't an asset extension
    ["ui/app/pages/crm/logic/crm-positions.ts:77", "CrmIntegration.Webhooks.HandlerId"], // an unknown value `??` a label
    ["ui/app/pages/crm/logic/crm-positions.ts:78", "CrmIntegration.IntegrationId"], // nor is a name's (`/users/john.doe`)
    ["ui/app/pages/crm/logic/crm-positions.ts:79", "CrmIntegration.CsvFormatId"], // unquoted id key, an id listed in its value
    ["ui/app/pages/crm/logic/crm-positions.ts:79", "CrmIntegration.ExportId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:8", "CrmIntegration.Webhooks.HandlerId"], // case label
    ["ui/app/pages/crm/logic/crm-positions.ts:80", "CrmIntegration.CsvFormatId"], // unquoted id key, an id in a branch
    ["ui/app/pages/crm/logic/crm-positions.ts:80", "CrmIntegration.ExportId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:81", "CrmIntegration.EmailChannelId"], // unquoted id key, ids in both branches
    ["ui/app/pages/crm/logic/crm-positions.ts:81", "CrmIntegration.ExportId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:81", "CrmIntegration.CsvFormatId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:82", "CrmIntegration.CsvFormatId"], // unquoted id key, an `as const` id beside `??`
    ["ui/app/pages/crm/logic/crm-positions.ts:82", "CrmIntegration.ExportId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:83", "CrmIntegration.IntegrationId"], // templates of only substitutions aren't labels
    ["ui/app/pages/crm/logic/crm-positions.ts:83", "CrmConnector.ConnectorId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:84", "CrmIntegration.IntegrationId"], // a label `:` an id
    ["ui/app/pages/crm/logic/crm-positions.ts:84", "CrmIntegration.Webhooks.HandlerId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:84", "CrmConnector.ConnectorId"], // `undefined` `:` a route
    ["ui/app/pages/crm/logic/crm-positions.ts:84", "TestCrmConnectionUseCase.ProbeId"], // `null` `:` `undefined`, no label at all
    ["ui/app/pages/crm/logic/crm-positions.ts:85", "CrmIntegration.IntegrationId"], // a protocol-relative URL's host isn't an asset
    ["ui/app/pages/crm/logic/crm-positions.ts:86", "CrmIntegration.IntegrationId"], // `.set` of an id to an id
    ["ui/app/pages/crm/logic/crm-positions.ts:86", "CrmIntegration.Webhooks.HandlerId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:87", "CrmConnector.ConnectorId"], // an id assigned at an id's index
    ["ui/app/pages/crm/logic/crm-positions.ts:87", "TestCrmConnectionUseCase.ProbeId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:90", "CrmIntegration.IntegrationId"], // navigateTo(…)'s `query`
    ["ui/app/pages/crm/logic/crm-positions.ts:91", "CrmConnector.ConnectorId"], // router.push(…)
    ["ui/app/pages/crm/logic/crm-positions.ts:92", "CrmIntegration.Webhooks.HandlerId"], // router.replace({ path })
    ["ui/app/pages/crm/logic/crm-positions.ts:93", "TestCrmConnectionUseCase.ProbeId"], // router.push's `params` and `query`
    ["ui/app/pages/crm/logic/crm-positions.ts:93", "CrmIntegration.IntegrationId"],
    ["ui/app/pages/crm/logic/crm-positions.ts:94", "CrmIntegration.IntegrationId"], // searchParams.set(…)
    ["ui/app/pages/crm/logic/crm-positions.ts:94", "CrmConnector.ConnectorId"], // searchParams.append(…)
    ["ui/app/pages/crm/logic/crm-positions.ts:95", "CrmIntegration.Webhooks.HandlerId"], // new URLSearchParams({ … })
    ["ui/app/pages/crm/logic/crm-positions.ts:96", "TestCrmConnectionUseCase.ProbeId"], // new URLSearchParams([[…]])
    ["ui/app/pages/crm/logic/crm-positions.ts:97", "CrmIntegration.IntegrationId"], // new URLSearchParams("…")
    ["ui/app/pages/crm/logic/crm-positions.ts:98", "CrmConnector.ConnectorId"], // .append on a name bound to URLSearchParams
    ["ui/app/pages/crm/logic/crm-positions.ts:99", "CrmIntegration.CsvFormatId"], // a search params name beside an id value
    ["ui/app/pages/crm/logic/crm-positions.ts:99", "CrmIntegration.ExportId"],
  ]);
  assert.equal(findings.find((finding) => finding.location === "ui/app/pages/crm/logic/crm-positions.ts:19").message,
    '"acme-crm" is the server\'s CrmIntegration.IntegrationId; keep no copy of it in the UI (comparing, holding, keying on or ' +
      "building a URL from it) — have the DTO carry the answer: availableActions, a named flag, the route, or the id itself.");
  const tableNote = " A table keyed on it may map it only to labels, colours or icons.";
  assert.deepEqual(findings.filter((finding) => finding.message.endsWith(tableNote)).map((finding) => [finding.location, owner(finding)]), [
    ...[[101, "IntegrationId"], [105, "ConnectorId"], // sorted as text, so ahead of line 21
      [21, "IntegrationId"], [31, "ConnectorId"], [36, "ConnectorId"], [51, "IntegrationId"], [52, "ConnectorId"], [53, "ConnectorId"],
      [56, "IntegrationId"], [57, "IntegrationId"], [58, "ConnectorId"], [59, "Webhooks.HandlerId"], [61, "CsvFormatId"],
      [62, "IntegrationId"], [64, "IntegrationId"], [65, "ConnectorId"], [66, "IntegrationId"], [67, "IntegrationId"], [67, "ConnectorId"],
      [68, "Webhooks.HandlerId"], [69, "IntegrationId"], [69, "ConnectorId"], [70, "CsvFormatId"], [70, "EmailChannelId"],
      [71, "IntegrationId"], [72, "IntegrationId"], [73, "IntegrationId"], [73, "ConnectorId"], [74, "IntegrationId"], [74, "ConnectorId"],
      [75, "IntegrationId"], [75, "ConnectorId"], [76, "IntegrationId"], [77, "Webhooks.HandlerId"], [78, "IntegrationId"],
      [79, "CsvFormatId"], [80, "CsvFormatId"], [81, "EmailChannelId"], [82, "CsvFormatId"], [83, "IntegrationId"], [83, "ConnectorId"],
      [84, "IntegrationId"], [84, "ConnectorId"], [84, "ProbeId"], [85, "IntegrationId"], [86, "IntegrationId"], [87, "ConnectorId"]],
  ].map(([line, id]) => [`ui/app/pages/crm/logic/crm-positions.ts:${line}`, `${id === "ProbeId" ? "TestCrmConnectionUseCase" : id === "ConnectorId" ? "CrmConnector" : "CrmIntegration"}.${id}`]));
  const good = JSON.parse(plumb(path.join(FIX, "MER-CP-001", "good"), "--rule", "MER-CP-001", "--json").stdout);
  assert.deepEqual(good, []);
});

// Names are read by their last whole word, and any tag's `id`, a native element's `type`, and Vue's `key`, aren't ids. The
// held lines (2-5, 15, 16) count; the rest are wording, a conditional's condition, a returned value, a plain call
// argument, `+=` and a whitespace "path".
test("MER-CP-001 reads names by whole word and keeps wording, returns and call arguments out", () => {
  const r = repo([], {
    "api/Modules/Crm/Contracts/Crm.cs": 'public static class Crm\n{\n    public const string ExportId = "export";\n}\n',
    "nuxt.config.ts": "export default defineNuxtConfig({ ssr: false });\n",
    "app/pages/index.vue": [
      '<script setup lang="ts">',
      'const ids = { integrationKey: "export" };',
      'const dashed = { "handler-id": "export" };',
      'const shouty = { HANDLER_ID: "export" };',
      'const acronym = { URLKind: "export" };',
      'const words = { valid: "export", grid: "export", typeface: "export", keyword: "export", monkey: "export", typeLabel: "export" };',
      'const flag = "export" ? 1 : 2;',
      'const title = () => { return "export"; };',
      'const open = (noun: string) => noun;',
      'open(flag ? "export" : "import");',
      'let text = ""; text += "export";',
      'const hint = { description: "Choose import/export" };',
      "</script>",
      "<template>",
      '  <span :data-type="flag ? \'export\' : \'import\'" />',
      '  <span :handlerId="\'export\'" />',
      '  <span id="export" type="export" data-testid="export" :key="\'export\'" :type="\'export\'" :title="\'export\'" :valid="\'export\'" @click="open(\'export\')">{{ flag ? \'export\' : \'\' }}</span>',
      "</template>",
      "",
    ].join("\n"),
  });
  const findings = JSON.parse(plumb(r, "--rule", "MER-CP-001", "--json").stdout);
  assert.deepEqual(findings.map((finding) => finding.location), [
    "app/pages/index.vue:15", "app/pages/index.vue:16", "app/pages/index.vue:2", "app/pages/index.vue:3", "app/pages/index.vue:4",
    "app/pages/index.vue:5",
  ]);
});

test("MER-CP-001 skips frontend tests but not a tests/ route folder inside the app tree", () => {
  const r = repo([], {
    "api/Modules/Crm/Contracts/CrmIntegration.cs": 'public static class CrmIntegration\n{\n    public const string IntegrationId = "acme-crm";\n}\n',
    "nuxt.config.ts": "export default defineNuxtConfig({ ssr: false });\n",
    "app/components/X.spec.ts": 'export const id = "acme-crm";\n',
    "app/components/__tests__/X.ts": 'export const id = "acme-crm";\n',
    "app/pages/tests/index.vue": '<script setup lang="ts">\nconst id = "acme-crm";\n</script>\n',
  });
  const findings = JSON.parse(plumb(r, "--rule", "MER-CP-001", "--json").stdout);
  assert.deepEqual(findings.map((finding) => finding.location), ["app/pages/tests/index.vue:2"]);
});

test("MER-CP-001 reads constrained generics and `new` consts, and test paths relative to a nested frontend root", () => {
  const r = repo([], {
    "api/Modules/Crm/Contracts/Handlers.cs":
      "public static class Handlers<T, U> where T : class where U : struct\n{\n" +
      '    public new const string AId = "a-id";\n    new public const string BId = "b-id";\n    protected new const string CId = "c-id";\n}\n',
    "src/web/nuxt.config.ts": "export default defineNuxtConfig({ ssr: false });\n",
    "src/web/pages/index.vue": '<script setup lang="ts">\nconst ids = ["a-id", "b-id", "c-id"];\n</script>\n',
    "src/web/tests/helpers.ts": 'export const id = "a-id";\n',
    "tests/fixtures/basic/nuxt.config.ts": "export default defineNuxtConfig({ ssr: false });\n",
    "tests/fixtures/basic/pages/index.vue": '<script setup lang="ts">\nconst id = "a-id";\n</script>\n',
  });
  const findings = JSON.parse(plumb(r, "--rule", "MER-CP-001", "--json").stdout);
  assert.deepEqual(findings.map((finding) => [finding.location, finding.message.match(/is the server's (\S+);/)?.[1]]), [
    ["src/web/pages/index.vue:2", "Handlers.AId"],
    ["src/web/pages/index.vue:2", "Handlers.BId"],
  ]);
});

// A test project's consts are test fixtures wherever its folders sit: ArchitectureTesting/ is known by its metadata.
test("MER-CP-001 takes no server ids from a test project, known by metadata, and names nested owners outermost first", () => {
  const r = repo([], {
    "ArchitectureTesting/ArchitectureTesting.csproj": '<Project Sdk="Microsoft.NET.Sdk"><ItemGroup><PackageReference Include="Microsoft.NET.Test.Sdk" Version="17.0.0" /></ItemGroup></Project>\n',
    "ArchitectureTesting/Modules/Crm/Contracts/CrmFixture.cs": 'public static class CrmFixture\n{\n    public const string FixtureId = "fixture-id";\n}\n',
    "api/Api.csproj": '<Project Sdk="Microsoft.NET.Sdk.Web" />\n',
    "api/Modules/Crm/Contracts/Crm.cs": "public static class Crm\n{\n    public sealed record Done(int A);\n    public static class Hooks\n    {\n" +
      '        public const string HookId = "hook-id";\n    }\n    public const string CrmId = "crm-id";\n}\n',
    "nuxt.config.ts": "export default defineNuxtConfig({ ssr: false });\n",
    "app/pages/index.vue": '<script setup lang="ts">\nconst ids = ["fixture-id", "hook-id", "crm-id"];\n</script>\n',
  });
  const findings = JSON.parse(plumb(r, "--rule", "MER-CP-001", "--json").stdout);
  assert.deepEqual(findings.map((finding) => finding.message.match(/is the server's (\S+);/)?.[1]), ["Crm.Hooks.HookId", "Crm.CrmId"]);
});

test("MER-CP-002 reads a rule from any level-2 heading that starts with its ID, and reports each missing field, unknown or repeated rule ID, rule headed at another level, file with no rule, and cited name that isn't in the code", () => {
  const findings = JSON.parse(plumb(path.join(FIX, "MER-CP-002", "bad"), "--rule", "MER-CP-002", "--json").stdout);
  const cited = (finding) => finding.message.match(/cites `([^`]+)`(?:, which matches \d+ files)?/)?.[0] ??
    finding.message.match(/^\S+ has no \w+|rule [A-Z-]+\d+|already defined|^\S+ is headed at level \d|^defines no rule/)?.[0];
  assert.deepEqual(findings.map((finding) => [finding.location, cited(finding)]), [
    // The `### Notes` subheading and the fenced `# a shell comment` above them leave BILL-001's names checked.
    ["api/Modules/Billing/INVARIANTS.md:16", "cites `InvoiceDecider.Removed`"], // the type exists, and only a comment names its member
    ["api/Modules/Billing/INVARIANTS.md:16", "cites `GoneService`"],
    ["api/Modules/Billing/INVARIANTS.md:16", "cites `Modules/Gone/`"],
    ["api/Modules/Billing/INVARIANTS.md:16", "cites `Gone.Method`"],
    ["api/Modules/Billing/INVARIANTS.md:16", "cites `gone.bicep`"],
    ["api/Modules/Billing/INVARIANTS.md:16", "cites `refuse_deleted_change`"], // an Owner's lower-case name is code, so it is checked
    ["api/Modules/Billing/INVARIANTS.md:18", "cites `GoneTests`"],
    ["api/Modules/Billing/INVARIANTS.md:18", "cites `InvoiceDeciderTests.A_deleted_test`"],
    ["api/Modules/Billing/INVARIANTS.md:18", "cites `Gone.feature`"],
    ["api/Modules/Billing/INVARIANTS.md:18", "cites `gone.spec.ts`"],
    ["api/Modules/Billing/INVARIANTS.md:19", "cites `A_deleted_test_method`"],
    ["api/Modules/Billing/INVARIANTS.md:19", "cites `invoice.spec.ts`, which matches 2 files"],
    ["api/Modules/Billing/INVARIANTS.md:19", "cites `gone.bicep`"], // a Proof's lower-case name with a file's ending is checked as a file
    ["api/Modules/Billing/INVARIANTS.md:19", "cites `invoiceGoneTests`"], // a Proof's lower-case `…Tests` name is a test class, so it is checked
    ["api/Modules/Billing/INVARIANTS.md:21", "BILL-002 has no Proof"],
    ["api/Modules/Billing/INVARIANTS.md:27", "BILL-003 has no Owner"],
    ["api/Modules/Billing/INVARIANTS.md:27", "rule BILL-077"],
    ["api/Modules/Billing/INVARIANTS.md:33", "BILL-004 has no Proof"], // headed `## BILL-004 — …`, so it is still a rule
    ["api/Modules/Billing/INVARIANTS.md:5", "rule BILL-009"],
    // Headed `## FORM-001 — …`, so its names are checked; each is cited twice on its line and reported once.
    ["api/Modules/Forms/INVARIANTS.md:5", "rule FORM-009"],
    ["api/Modules/Forms/INVARIANTS.md:7", "cites `FormSubmitter`"],
    ["api/Modules/Payments/INVARIANTS.md:3", "already defined"],
    ["api/Modules/Payments/INVARIANTS.md:5", "rule GONE-001"], // no defined rule starts GONE, and it is still a reference
    // Its only entry is headed `### REFUND-001: …`, so the file defines no rule and the heading is reported.
    ["api/Modules/Refunds/INVARIANTS.md:1", "defines no rule"],
    ["api/Modules/Refunds/INVARIANTS.md:3", "REFUND-001 is headed at level 3"],
  ]);
});

test("MER-CP-002 judges a cited name against the whole repository, so excluding the code it names changes nothing", () => {
  const run = (twin, ...excludes) => JSON.parse(plumb(path.join(FIX, "MER-CP-002", twin), "--rule", "MER-CP-002", "--json", "--no-baseline",
    ...excludes.flatMap((pattern) => ["--exclude", pattern])).stdout);
  const narrowed = ["ui/", "api.tests/", "api/Migrations/", "api/Modules/Billing/*.cs"];
  assert.deepEqual(run("bad", ...narrowed), run("bad"));
  assert.deepEqual(run("good", ...narrowed), []);
});
