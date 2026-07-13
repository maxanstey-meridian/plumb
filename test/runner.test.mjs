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
import { spawnProducer } from "./helpers/run-producer.mjs";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUMB = path.join(HOME, "plumb");
const FIX = path.join(HOME, "fixtures");
const CHECKS = path.join(HOME, "checks");
const LINE = /^MER-[A-Z]{2}-\d{3}\t(error|warn|info)\t[^\t]+:\d+\t[^\t]+\t\S+$/;
const MIGRATED = [
  "MER-BE-001", "MER-BE-002", "MER-BE-003", "MER-BE-004", "MER-BE-005", "MER-BE-006",
  "MER-BE-007", "MER-BE-008", "MER-BE-009", "MER-BE-010", "MER-BE-011", "MER-BE-012",
  "MER-BE-013", "MER-BE-014", "MER-BE-015", "MER-BE-020", "MER-BE-021", "MER-BE-022",
  "MER-BE-023", "MER-BE-024", "MER-BE-030", "MER-BE-031", "MER-BE-040", "MER-BE-041",
  "MER-BE-051", "MER-BE-052", "MER-BE-053", "MER-BE-054", "MER-BE-060",
  "MER-BT-001", "MER-BT-002", "MER-BT-004", "MER-BT-010", "MER-BT-011", "MER-BT-012",
  "MER-BT-013", "MER-BT-014", "MER-BT-015", "MER-BT-016", "MER-BT-017", "MER-BT-020",
  "MER-BT-003", "MER-BT-005", "MER-FE-005", "MER-FE-041", "MER-FE-043",
  "MER-FE-004", "MER-FE-006", "MER-FE-007", "MER-FE-008", "MER-FE-010", "MER-FE-011",
  "MER-FE-013", "MER-FE-014", "MER-FE-015", "MER-FE-020", "MER-FE-021", "MER-FE-022",
  "MER-FE-030", "MER-FE-031", "MER-FE-032", "MER-FE-040", "MER-FE-044",
  "MER-RV-001", "MER-RV-002", "MER-RV-003", "MER-RV-006", "MER-RV-007", "MER-RV-008", "MER-RV-009", "MER-RV-010",
  "MER-RV-020", "MER-RV-021", "MER-RV-025", "MER-RV-026",
  "MER-TE-001", "MER-TE-002", "MER-TE-003", "MER-TE-005", "MER-TE-006", "MER-TE-007", "MER-TE-008",
  "MER-TO-001", "MER-TO-002", "MER-TO-003", "MER-TO-004", "MER-TO-005", "MER-TO-010", "MER-TO-011", "MER-TO-012", "MER-TO-014",
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

test("MER-BE-010 discovers nested Modules roots from manifest paths", () => {
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
  assert.match(out.stderr, /plumb profile: capabilities path=1 text=1 line-map=0 json=0 basic-config=0/);
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
    "Modules/Auth/Domain/Clock.cs": "public sealed class Clock { public static DateTime Now => DateTime.UtcNow; }\n",
  });
  const out = plumb(r, "--rule", "MER-BE-024", "--json", "--profile");
  assert.equal(out.status, 1, out.stderr);
  assert.match(out.stderr, /analysis-counters .*csharp-read=1 csharp-mask=1 csharp-classification=1 dotnet-project-parse=0 dotnet-project-graph-build=0 /);
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
    "app/component.vue": '<script setup lang="ts">const clean = true;</script>\n<script setup lang="ts">import { client } from "generated/client"; try { await client.GET("/x"); } catch {}</script>\n',
  });
  assert.deepEqual(JSON.parse(plumb(firstOnly, "--rule", "MER-FE-006", "--json").stdout), []);

  const allBlocks = repo([], {
    "app/component.vue": '<script setup lang="ts">const clean = true;</script>\n<script setup lang="ts">import { provideAuth } from "./ports/auth"; provideAuth();</script>\n',
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
    { rule: "MER-TO-002", severity: "warn", location: ".oxfmtrc.json:0", message: "no .oxfmtrc.json found — TS repos carry the oxfmt base config (golden: ~/Sites/plumb/configs/oxfmtrc.json)", docRef: "tools.md#linting-and-formatting" },
    { rule: "MER-TO-002", severity: "warn", location: ".oxlintrc.json:0", message: "no .oxlintrc.json found — TS repos carry the oxlint base config (golden: ~/Sites/plumb/configs/oxlintrc.json)", docRef: "tools.md#linting-and-formatting" },
    { rule: "MER-TO-004", severity: "warn", location: "package.json:1", message: "Nuxt TypeScript package needs a script using vue-tsc or Nuxt typecheck", docRef: "tools.md#typescript--vue--nuxt" },
    { rule: "MER-TO-010", severity: "warn", location: ".:0", message: "no global.json — pin the SDK (.NET 10, rollForward latestFeature)", docRef: "tools.md#default-stack-1" },
    { rule: "MER-TO-011", severity: "warn", location: "App.csproj:0", message: "enable implicit usings (Meridian tooling default)", docRef: "tools.md#default-stack-1" },
    { rule: "MER-TO-012", severity: "warn", location: ".editorconfig:0", message: "no .editorconfig in a .NET repo — it is the style/analyzer authority (golden: ~/Sites/plumb/configs/editorconfig.dotnet)", docRef: "tools.md#formatting-and-analyzers" },
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

for (const s of scripts) {
  const id = s.match(/^MER-[A-Z]{2}-\d{3}/)?.[0];
  const fixture = id && fs.existsSync(path.join(FIX, id, "bad")) ? id : null;
  test(`producer ${s}: exits 0, emits §3 five-field lines, fires on bad / not good`, { skip: !fixture && "no own fixture (family member)" }, () => {
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

test("AST check with unresolvable typescript → stderr diagnostic, no findings, exit 0", () => {
  const isolated = isolatedPlumb({});
  fs.cpSync(path.join(FIX, "MER-BT-001", "bad"), isolated.target, { recursive: true });
  const out = isolated.run("--rule", "MER-BT-001", "--json");
  assert.equal(out.status, 0);
  assert.deepEqual(JSON.parse(out.stdout), []);
  assert.match(out.stderr, /TypeScript not installed/);
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

test("baseline identity and suppression are unchanged for migrated findings", () => {
  const r = repo([], { "package.json": "{}\n" });
  const baseline = path.join(r, "baseline.json");
  assert.equal(plumb(r, "--rule", "MER-TO-001", "--write-baseline", baseline).status, 0);
  const out = plumb(r, "--rule", "MER-TO-001", "--baseline", baseline, "--json");
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(JSON.parse(out.stdout), []);
  assert.deepEqual(JSON.parse(fs.readFileSync(baseline, "utf8")).entries, { "MER-TO-001\tpackage.json": 1 });
});
