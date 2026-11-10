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

// A copy of an FE-046 fixture (or, given null, an empty repository) with some files replaced (or, given null,
// deleted), run through the real CLI.
function fe046Repo(fixture, files, check, args = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-fe046-"));
  try {
    if (fixture) fs.cpSync(path.join(HOME, "fixtures", "MER-FE-046", fixture), root, { recursive: true });
    for (const [file, content] of Object.entries(files)) {
      if (content === null) fs.rmSync(path.join(root, file));
      else {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), content);
      }
    }
    assert.equal(spawnSync("git", ["init", "-q"], { cwd: root }).status, 0);
    const out = spawnSync(path.join(HOME, "plumb"), [root, "--rule", "MER-FE-046", "--json", "--ci", ...args], { encoding: "utf8" });
    assert.ok([0, 1].includes(out.status), out.stderr);
    check(JSON.parse(out.stdout || "[]").map((finding) => `${finding.severity} ${finding.location}`), out, JSON.parse(out.stdout || "[]"));
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("FE-046 reports an orphaned inject at the pair's declaration and the reverse as a warning", () => {
  const out = spawnSync(path.join(HOME, "plumb"), [path.join(HOME, "fixtures", "MER-FE-046", "bad"), "--rule", "MER-FE-046", "--json", "--ci"], { encoding: "utf8" });
  assert.equal(out.status, 1, out.stderr);
  const findings = JSON.parse(out.stdout);
  assert.deepEqual(findings.map((finding) => `${finding.severity} ${finding.location}`), [
    // Injected through a renamed import, a Nuxt alias, and the feature index; provided only by a test.
    "error app/features/booking/port.ts:5",
    // Names that don't follow the convention, re-exported under another name, called through a namespace import.
    "error app/features/clock/port.ts:5",
    // Page b's pair: page a's same-named pair is provided and stays clean.
    "error app/pages/b/ports/auth.ts:5",
    "warn app/features/rooms/port.ts:5",
  ]);
  assert.match(findings[0].message, /^injectBooking is called \(app\/pages\/bookings\.vue:4\) but provideBooking is called only in test sources \(tests\/pages\/bookings\.spec\.ts:3\)/);
  assert.match(findings[1].message, /^readClock is called \(app\/pages\/index\.vue:4\) but installClock is called nowhere/);
  assert.match(findings[3].message, /^provideRooms is called \(app\/app\.vue:4\) but injectRooms is called nowhere/);

  const good = runProducer("MER-FE-046", "good");
  assert.equal(good.status, 0, good.stderr);
  assert.equal(good.stdout, "");
});

test("FE-046 passes the good fixture only because each provide and inject is called", () => {
  const appVue = (script) => `<script setup lang="ts">\n${script}</script>\n\n<template>\n  <NuxtPage />\n</template>\n`;
  // Without the namespace-import provide, the renamed inject in the layout is orphaned.
  fe046Repo("good", { "app/app.vue": appVue("installTheme({ dark: false });\n") }, (found) =>
    assert.deepEqual(found, ["error app/features/session/port.ts:5"]));
  // Without the auto-imported provide, the inject renamed by the feature index is orphaned.
  fe046Repo("good", { "app/app.vue": appVue('import * as session from "./features/session";\n\nsession.provideSession({ userId: "u1" });\n') }, (found) =>
    assert.deepEqual(found, ["error app/features/theme/port.ts:5"]));
  // Page b stops providing its own pair: page a's same-named provide doesn't cover it.
  fe046Repo("good", { "app/pages/b/index.vue": "<template>\n  <div />\n</template>\n" }, (found) =>
    assert.deepEqual(found, ["error app/pages/b/ports/auth.ts:5"]));
  // The reverse alone is a warning, and a warning doesn't fail the run.
  fe046Repo("good", { "app/layouts/default.vue": "<template>\n  <slot />\n</template>\n" }, (found, out) => {
    assert.deepEqual(found, ["warn app/features/session/port.ts:5"]);
    assert.equal(out.status, 0);
  });
});

test("FE-046 fixes clear the bad fixture, and a comment or string naming provideX provides nothing", () => {
  const fixes = {
    "app/pages/bookings.vue": '<script setup lang="ts">\nimport { injectBooking as useBooking, provideBooking as wire } from "~/features/booking";\n\nwire({ book: async () => {} });\nconst booking = useBooking();\n</script>\n',
    "app/pages/index.vue": '<script setup lang="ts">\nimport * as clock from "../features/clock";\n\nclock.installClock({ now: () => new Date() });\nconst now = clock.currentClock().now();\n</script>\n',
    "app/pages/b/index.vue": '<script setup lang="ts">\nimport { provideAuth } from "./ports/auth";\n\nprovideAuth({ signOut: () => {} });\n</script>\n',
    "app/components/RoomList.vue": '<script setup lang="ts">\nimport { injectRooms } from "../features/rooms";\n\nconst rooms = injectRooms();\n</script>\n',
  };
  fe046Repo("bad", fixes, (found) => assert.deepEqual(found, []));
  fe046Repo("bad", { ...fixes, "app/pages/b/index.vue": '<script setup lang="ts">\n// provideAuth({ signOut: () => {} });\nconst hint = "provideAuth()";\n</script>\n' }, (found) =>
    assert.deepEqual(found, ["error app/pages/b/ports/auth.ts:5"]));
});

test("FE-046 matches by imported name when it can't resolve the specifier, and never by the local alias", () => {
  // A workspace package specifier isn't resolved: the imported name still finds the pair through a rename.
  fe046Repo("bad", { "app/pages/b/index.vue": '<script setup lang="ts">\nimport { provideAuth as wireAuth } from "@acme/auth";\n\nwireAuth({ signOut: () => {} });\n</script>\n' }, (found) =>
    assert.ok(!found.includes("error app/pages/b/ports/auth.ts:5"), found.join(", ")));
  // A local function that happens to share the provide's name is not the pair's provide.
  fe046Repo("bad", { "app/pages/b/index.vue": '<script setup lang="ts">\nconst provideAuth = (value: object) => value;\n\nprovideAuth({});\n</script>\n' }, (found) =>
    assert.ok(found.includes("error app/pages/b/ports/auth.ts:5"), found.join(", ")));
});

const fe046Page = (script, template = "<div />") => `<script setup lang="ts">\n${script}</script>\n\n<template>\n  ${template}\n</template>\n`;

test("FE-046 reads a pair neither side calls, and reports it as soon as one side is", () => {
  fe046Repo("good", { "app/pages/notes.vue": fe046Page('import { injectNotes } from "../features/notes/port";\n\ninjectNotes();\n') }, (found) =>
    assert.deepEqual(found, ["error app/features/notes/port.ts:5"]));
  fe046Repo("good", { "app/pages/notes.vue": fe046Page('import { provideNotes } from "../features/notes/port";\n\nprovideNotes({ save: () => {} });\n') }, (found) =>
    assert.deepEqual(found, ["warn app/features/notes/port.ts:5"]));
});

test("FE-046 counts any reference to a pair's names as a use, so a provide it can't trace is not reported missing", async (t) => {
  const provide = "{ book: async () => {} }";
  const port = 'import { useProvideInject } from "../../shared/use-provide-inject";\n\nexport type Booking = { book(roomId: string): Promise<void> };\n\nexport const [injectBooking, provideBooking] = useProvideInject<Booking>("Booking");\n';
  const named = 'import { injectBooking, provideBooking } from "~/features/booking";\n\ninjectBooking();\n';
  const cases = {
    "a value alias": { "app/pages/bookings.vue": fe046Page(`${named}const wire = provideBooking;\nwire(${provide});\n`) },
    "a value alias with type arguments": { "app/pages/bookings.vue": fe046Page(`${named}const wire = provideBooking<Booking>;\nwire(${provide});\n`) },
    "a template expression": { "app/pages/bookings.vue": fe046Page(named, `<button type="button" @click="provideBooking(${provide})">Book</button>`) },
    "a namespace export": {
      "app/features/booking/index.ts": 'export * as booking from "./port";\n',
      "app/pages/bookings.vue": fe046Page(`import { booking } from "~/features/booking";\nimport { injectBooking } from "../features/booking/port";\n\ninjectBooking();\nbooking.provideBooking(${provide});\n`),
    },
    "a default export": {
      "app/features/booking/port.ts": `${port}\nexport default provideBooking;\n`,
      "app/pages/bookings.vue": fe046Page(`import { injectBooking } from "~/features/booking";\nimport wire from "../features/booking/port";\n\ninjectBooking();\nwire(${provide});\n`),
    },
    "a destructured dynamic import": {
      "app/pages/bookings.vue": fe046Page(`import { injectBooking } from "~/features/booking";\n\ninjectBooking();\nconst { provideBooking: wire } = await import("~/features/booking");\nwire(${provide});\n`),
    },
    "a dynamic import read as a value": {
      "app/pages/bookings.vue": fe046Page(`import { injectBooking } from "~/features/booking";\n\ninjectBooking();\nimport("~/features/booking").then((booking) => booking.provideBooking(${provide}));\n`),
    },
    "a namespace passed on as a value": {
      "app/pages/bookings.vue": fe046Page('import * as booking from "~/features/booking";\nimport { injectBooking } from "../features/booking/port";\n\ninjectBooking();\nconsole.log(booking);\n'),
    },
    "a rename through a workspace package": {
      "app/features/booking/index.ts": 'export { injectBooking, provideBooking as wireBooking } from "./port";\n',
      "app/pages/bookings.vue": fe046Page(`import { injectBooking, wireBooking } from "@acme/booking";\n\ninjectBooking();\nwireBooking(${provide});\n`),
    },
    "a .cts source": { "app/wire.cts": `import { provideBooking } from "./features/booking";\n\nprovideBooking(${provide});\n` },
    "a .jsx source": { "app/wire.jsx": `import { provideBooking } from "./features/booking";\n\nprovideBooking(${provide});\n` },
    "a .cjs source": { "app/wire.cjs": `import { provideBooking } from "./features/booking";\n\nprovideBooking(${provide});\n` },
    "a call inside a class's extends clause": {
      "app/wire.ts": `import { provideBooking } from "./features/booking";\n\nconst mix = <T>(value: T) => class {};\n\nexport class Wire extends mix(provideBooking(${provide})) {}\n`,
    },
  };
  for (const [label, files] of Object.entries(cases)) {
    await t.test(label, () => fe046Repo("bad", files, (found) =>
      assert.ok(!found.some((finding) => finding.includes("app/features/booking/port.ts")), found.join(", "))));
  }
  // A mention in a type position provides nothing.
  await t.test("a type that only names the provide is not a use", () =>
    fe046Repo("bad", { "app/wire.ts": 'import { provideBooking } from "./features/booking";\n\nexport type Wire = typeof provideBooking;\nexport interface Wired extends Record<string, Wire> {}\n' }, (found) =>
      assert.ok(found.includes("error app/features/booking/port.ts:5"), found.join(", "))));
  // The inject side the same way: a pair whose inject is only held as a value is still consumed.
  await t.test("an inject held as a value", () => fe046Repo("bad", { "app/components/RoomList.vue": fe046Page('import { injectRooms } from "../features/rooms";\n\nconst use = injectRooms;\nuse();\n') }, (found) =>
    assert.ok(!found.includes("warn app/features/rooms/port.ts:5"), found.join(", "))));
});

test("FE-046 counts a use in a file left out of the run, and reports no pair declared in one", () => {
  // app.vue provides the session and the theme; leaving it out of the run must not orphan their injects.
  fe046Repo("good", {}, (found) => assert.deepEqual(found, []), ["--exclude", "app/app.vue"]);
  fe046Repo("good", { ".plumbignore": "app/app.vue\n" }, (found) => assert.deepEqual(found, []));
  // The bad fixture's orphaned booking pair is not reported when its own file is left out, and still is otherwise.
  fe046Repo("bad", {}, (found) => assert.ok(found.includes("error app/features/booking/port.ts:5"), found.join(", ")));
  fe046Repo("bad", {}, (found) => assert.ok(!found.some((finding) => finding.includes("app/features/booking/port.ts")), found.join(", ")),
    ["--exclude", "app/features/booking/port.ts"]);
});

test("FE-046 reports a pair outside every Nuxt app as a warning, since a host application may provide it", () => {
  const helper = fs.readFileSync(path.join(HOME, "fixtures", "MER-FE-046", "good", "app", "shared", "use-provide-inject.ts"), "utf8");
  const port = (helperPath, name) => `import { useProvideInject } from "${helperPath}";\n\nexport type ${name} = { open(): void };\n\nexport const [inject${name}, provide${name}] = useProvideInject<${name}>("${name}");\n`;
  fe046Repo(null, {
    "apps/web/nuxt.config.ts": "export default defineNuxtConfig({ ssr: false });\n",
    "apps/web/app/shared/use-provide-inject.ts": helper,
    "apps/web/app/features/cart/port.ts": port("../../shared/use-provide-inject", "Cart"),
    "apps/web/app/pages/index.vue": fe046Page('import { injectCart } from "../features/cart/port";\n\ninjectCart();\n'),
    "packages/ui/src/use-provide-inject.ts": helper,
    "packages/ui/src/port.ts": port("./use-provide-inject", "Panel"),
    "packages/ui/src/Panel.vue": fe046Page('import { injectPanel } from "./port";\n\ninjectPanel();\n'),
  }, (found, out, findings) => {
    assert.deepEqual(found, ["error apps/web/app/features/cart/port.ts:5", "warn packages/ui/src/port.ts:5"]);
    assert.match(findings[1].message, /^injectPanel is called \(packages\/ui\/src\/Panel\.vue:4\) but providePanel is called nowhere/);
  });
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

test("FE-010 skips a Nuxt fixture app under tests/ by the shared TypeScript test-source definition", () => {
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
