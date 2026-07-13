import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Capability, planCapabilities } from "../lib/engine/contracts.mjs";
import { createRepositoryContext } from "../lib/engine/repository-context.mjs";
import { createRepositorySnapshot } from "../lib/engine/repository-snapshot.mjs";

function fixture(contents) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "plumb-frontend-engine-"));
  for (const [relative, text] of Object.entries(contents)) {
    const file = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
  const snapshot = createRepositorySnapshot({ root, mode: "test", files: Object.keys(contents) });
  return { root, snapshot, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const contextFor = (snapshot, capability, options = {}) =>
  createRepositoryContext(snapshot, planCapabilities([{ requirements: [capability] }]), options);

test("frontend graph capability closes over only its shared service dependencies", () => {
  assert.deepEqual(planCapabilities([{ requirements: [Capability.FRONTEND_GRAPH] }]), [
    Capability.PATH,
    Capability.TEXT,
    Capability.LINE_MAP,
    Capability.TYPESCRIPT,
    Capability.FRONTEND_ROOTS,
    Capability.FRONTEND_GRAPH,
  ]);
});

test("frontend roots are discovered once from visible inventory with depth views, owners, and visible app paths", () => {
  const f = fixture({
    "nuxt.config.ts": "export default {};",
    "app/pages/index.vue": "<template/>",
    "apps/admin/nuxt.config.mjs": "export default {};",
    "apps/admin/pages/index.vue": "<template/>",
    "apps/ignored/nuxt.config.cjs": "module.exports = {};",
  });
  try {
    const repository = contextFor(f.snapshot, Capability.FRONTEND_ROOTS, { typescriptLoader: async () => { throw new Error("must not load"); } });
    const roots = repository.context.frontendRoots.all();
    assert.equal(repository.context.frontendRoots.all(), roots);
    assert.deepEqual(roots.map((root) => [root.path, root.appPath]), [["", "app"], ["apps/admin", "apps/admin"]]);
    assert.deepEqual(repository.context.frontendRoots.withinDepth(1).map((root) => root.path), [""]);
    assert.equal(repository.context.frontendRoots.owner(repository.context.file("apps/admin/pages/index.vue")), roots[1]);
    assert.equal(repository.context.frontendRoots.owner(repository.context.file("app/pages/index.vue")), roots[0]);
    assert.equal(f.snapshot.counters.frontendRootDiscoveries, 1);
    assert.equal(f.snapshot.counters.typescriptRuntimeLoads, 0);
  } finally { f.cleanup(); }
});

test("frontend root depth counts directories rather than the config filename", () => {
  const f = fixture({
    "a/b/c/d/e/f/nuxt.config.ts": "export default {};",
    "a/b/c/d/e/f/app/pages/index.vue": "<template />",
    "a/b/c/d/e/f/g/nuxt.config.ts": "export default {};",
  });
  try {
    const repository = contextFor(f.snapshot, Capability.FRONTEND_ROOTS);
    assert.deepEqual(repository.context.frontendRoots.withinDepth(6).map((root) => root.path), ["a/b/c/d/e/f"]);
  } finally { f.cleanup(); }
});

test("one graph promise is shared by concurrent consumers and roots build separately", async () => {
  const f = fixture({
    "apps/a/nuxt.config.ts": "export default {};",
    "apps/a/app/from.ts": "import type { B } from './to';",
    "apps/a/app/to.ts": "export type B = {};",
    "apps/b/nuxt.config.js": "export default {};",
    "apps/b/app/from.js": "import './to';",
    "apps/b/app/to.js": "export {};",
  });
  try {
    let loads = 0, runs = 0;
    const loader = async () => {
      loads++;
      return { async cruise(_sources, options) {
        runs++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        const js = options.baseDir.endsWith(`${path.sep}b`);
        return { output: { modules: [{
          source: js ? "app/from.js" : "app/from.ts",
          dependencies: [{ module: "./to", resolved: js ? "app/to.js" : "app/to.ts", dependencyTypes: js ? ["local"] : ["type-only"] }],
        }] } };
      } };
    };
    const repository = contextFor(f.snapshot, Capability.FRONTEND_GRAPH, { dependencyCruiserLoader: loader });
    const [a, b] = repository.context.frontendRoots.all();
    const firstPromise = repository.context.frontendGraph.graph(a);
    const [first, second, third] = await Promise.all([firstPromise, repository.context.frontendGraph.graph(a), repository.context.frontendGraph.graph(a)]);
    assert.equal(first, second);
    assert.equal(second, third);
    assert.equal(first.edges[0].typeOnly, true);
    assert.equal(first.edges[0].from, repository.context.file("apps/a/app/from.ts"));
    const other = await repository.context.frontendGraph.graph(b);
    assert.notEqual(first, other);
    assert.equal(loads, 1);
    assert.equal(runs, 2);
    assert.equal(f.snapshot.counters.frontendGraphBuilds, 2);
  } finally { f.cleanup(); }
});

test("graphs retain only visible interned nodes, first edges, deterministic order, and Vue type metadata", async () => {
  const f = fixture({
    "nuxt.config.ts": "export default {};",
    "app/z.vue": '<script lang="ts">\r\nimport type { A } from "./a";\r\n</script>',
    "app/a.ts": "export type A = {};",
    "app/b.ts": "export {};",
  });
  try {
    const repository = contextFor(f.snapshot, Capability.FRONTEND_GRAPH, { dependencyCruiserLoader: async () => ({
      async cruise() { return { output: { modules: [{ source: "app/b.ts", dependencies: [
        { module: "./a", resolved: "app/a.ts", dependencyTypes: ["local"] },
        { module: "./a", resolved: "app/a.ts", dependencyTypes: ["type-only"] },
        { module: "./hidden", resolved: "app/hidden.ts", dependencyTypes: ["local"] },
        { module: "./generated", resolved: ".nuxt/generated.ts", dependencyTypes: ["local"] },
      ] }] } }; },
    }) });
    const graph = await repository.context.frontendGraph.graph(repository.context.frontendRoots.all()[0]);
    assert.deepEqual(graph.edges.map((edge) => `${edge.from.path}->${edge.to.path}:${edge.line}:${edge.typeOnly}`), [
      "app/b.ts->app/a.ts:0:false",
      "app/z.vue->app/a.ts:2:true",
    ]);
    assert.deepEqual(graph.nodes.map((file) => file.path), ["app/a.ts", "app/b.ts", "app/z.vue"]);
    assert.ok(graph.nodes.every((file) => repository.context.file(file.path) === file));
  } finally { f.cleanup(); }
});

test("mixed type and value imports to one target produce a value graph edge", async () => {
  const f = fixture({
    "nuxt.config.ts": "export default {};",
    "app/component.vue": '<script setup lang="ts">\nimport type { Auth } from "./useAuth";\nimport { useAuth } from "./useAuth";\n</script>',
    "app/useAuth.ts": "export type Auth = {}; export function useAuth() {}",
  });
  try {
    const repository = contextFor(f.snapshot, Capability.FRONTEND_GRAPH, { dependencyCruiserLoader: async () => ({
      async cruise() { return { output: { modules: [] } }; },
    }) });
    const graph = await repository.context.frontendGraph.graph(repository.context.frontendRoots.all()[0]);
    assert.equal(graph.edges.length, 1);
    assert.equal(graph.edges[0].typeOnly, false);
  } finally { f.cleanup(); }
});

test("focused TypeScript work initializes no frontend services", async () => {
  const f = fixture({ "a.ts": "const a = 1;", "nuxt.config.ts": "export default {};" });
  try {
    const repository = contextFor(f.snapshot, Capability.TYPESCRIPT);
    await repository.context.typescript.source(repository.context.file("a.ts"));
    assert.deepEqual({
      roots: f.snapshot.counters.frontendRootDiscoveries,
      builds: f.snapshot.counters.frontendGraphBuilds,
      loads: f.snapshot.counters.dependencyCruiserLoads,
      runs: f.snapshot.counters.dependencyCruiserRuns,
    }, { roots: 0, builds: 0, loads: 0, runs: 0 });
    assert.throws(() => repository.context.frontendRoots, /capability was not planned/);
  } finally { f.cleanup(); }
});

test("missing dependency-cruiser is diagnosed once while graph-free TypeScript remains usable", async () => {
  const f = fixture({ "nuxt.config.ts": "export default {};", "app/a.ts": "const a = 1;" });
  try {
    let loads = 0;
    const repository = contextFor(f.snapshot, Capability.FRONTEND_GRAPH, { dependencyCruiserLoader: async () => { loads++; throw new Error("missing"); } });
    const root = repository.context.frontendRoots.all()[0];
    assert.equal(await repository.context.frontendGraph.graph(root), null);
    assert.equal(await repository.context.frontendGraph.graph(root), null);
    assert.ok(await repository.context.typescript.source(repository.context.file("app/a.ts")));
    assert.equal(loads, 1);
    assert.equal(repository.diagnostics().length, 1);
    assert.equal(f.snapshot.counters.frontendGraphBuilds, 0);
    assert.equal(f.snapshot.counters.dependencyCruiserRuns, 0);
  } finally { f.cleanup(); }
});

test("missing TypeScript prevents graph and dependency-cruiser initialization", async () => {
  const f = fixture({ "nuxt.config.ts": "export default {};", "app/a.ts": "const a = 1;" });
  try {
    let cruiserLoads = 0;
    const repository = contextFor(f.snapshot, Capability.FRONTEND_GRAPH, {
      typescriptLoader: async () => { throw new Error("missing"); },
      dependencyCruiserLoader: async () => { cruiserLoads++; return { async cruise() { throw new Error("must not run"); } }; },
    });
    const root = repository.context.frontendRoots.all()[0];
    assert.equal(await repository.context.frontendGraph.graph(root), null);
    assert.equal(cruiserLoads, 0);
    assert.equal(f.snapshot.counters.frontendGraphBuilds, 0);
    assert.equal(f.snapshot.counters.dependencyCruiserLoads, 0);
    assert.equal(repository.diagnostics().length, 1);
  } finally { f.cleanup(); }
});

test("frontend graph build failures are promise-memoized", async () => {
  const f = fixture({ "nuxt.config.ts": "export default {};", "a.ts": "" });
  try {
    const failure = new Error("cruise failed");
    let runs = 0;
    const repository = contextFor(f.snapshot, Capability.FRONTEND_GRAPH, { dependencyCruiserLoader: async () => ({
      async cruise() { runs++; throw failure; },
    }) });
    const root = repository.context.frontendRoots.all()[0];
    const promise = repository.context.frontendGraph.graph(root);
    await assert.rejects(promise, (error) => error === failure);
    await assert.rejects(repository.context.frontendGraph.graph(root), (error) => error === failure);
    assert.equal(runs, 1);
    assert.equal(f.snapshot.counters.frontendGraphBuilds, 1);
  } finally { f.cleanup(); }
});
