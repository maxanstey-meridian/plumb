import { performance } from "node:perf_hooks";
import { createRepositoryContext } from "./repository-context.mjs";

export async function runInProcessRules(snapshot, rules, plannedCapabilities, options = {}) {
  const repository = createRepositoryContext(snapshot, plannedCapabilities, options);
  const timings = [];
  for (const rule of rules.filter((candidate) => candidate.kind !== "syntax")) {
    const started = performance.now();
    const context = repository.owner(rule.descriptor);
    if (rule.kind === "file") {
      for (const file of context.files) if (rule.files(file.path)) await rule.analyze(file, context);
    } else {
      await rule.analyze(context);
    }
    timings.push({ rule, duration: performance.now() - started });
  }
  const syntaxRules = rules.filter((rule) => rule.kind === "syntax");
  if (syntaxRules.length) {
    const registrations = syntaxRules.map((rule) => {
      const handlers = [];
      const context = repository.owner(rule.descriptor);
      rule.register(Object.freeze({
        onNode(handler) {
          if (typeof handler !== "function") throw new Error(`${rule.descriptor.source} registered a non-function syntax visitor`);
          handlers.push(handler);
        },
      }));
      return { rule, context, handlers };
    });
    const languageOf = (file) => /\.(?:ts|tsx|mts|cts)$/.test(file.path) ? "typescript" : /\.[cm]?jsx?$/.test(file.path) ? "javascript" : file.path.endsWith(".vue") ? "vue" : null;
    const started = new Map(syntaxRules.map((rule) => [rule, performance.now()]));
    for (const file of repository.context.files) {
      const selected = registrations.filter(({ rule }) => languageOf(file) === rule.language && (!rule.files || rule.files(file.path)));
      if (!selected.length) continue;
      const representations = file.path.endsWith(".vue")
        ? await Promise.all(repository.context.typescript.vueScripts(file).map((block) => repository.context.typescript.vueSource(block)))
        : [await repository.context.typescript.source(file)];
      for (const representation of representations) {
        if (!representation) continue;
        const visit = (node) => {
          for (const { context, handlers } of selected) for (const handler of handlers) handler(node, file, context, representation);
          node.forEachChild(visit);
        };
        visit(representation.sourceFile);
      }
    }
    for (const rule of syntaxRules) timings.push({ rule, duration: performance.now() - started.get(rule) });
  }
  const findings = repository.findings();
  const severity = { error: 3, warn: 2, info: 1 };
  findings.sort((a, b) => severity[b.sev] - severity[a.sev] || a.id.localeCompare(b.id) || a.loc.localeCompare(b.loc));
  return { findings: Object.freeze(findings), timings: Object.freeze(timings), diagnostics: Object.freeze(repository.diagnostics()) };
}
