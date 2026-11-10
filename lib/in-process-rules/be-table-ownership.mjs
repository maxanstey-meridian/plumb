import { Capability, createRuleDescriptor, defineRepositoryRule } from "../engine/contracts.mjs";
import { moduleLayout, moduleOfPath } from "./be-csharp.mjs";
import { inBuildOutput, under } from "./helpers.mjs";

const source = "in-process/be-table-ownership.mjs";
const moduleInternalsRef = "rules/backend/never-reach-into-another-modules-internals.md";

const listOf = (names) => names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;

// Which module owns each table, and which mappings break that, per backend root. A table is a schema and a name; a
// mapping with no schema takes the default schema its own module declares with `HasDefaultSchema` (one context per
// module), else the ones declared in the root's host code, and is compared under each when those give several. Module
// code owns the tables it maps with `ToTable` or `[Table]`, and the module declaring the entity the migrations snapshot
// maps a table to with `ToTable` owns it too. A table that two modules own has no owner, and a `ToView` of a table
// nobody maps is a view. Host code is not judged. Returns, per root, `wrong` (a module mapping another's table: `{ file, line, module, owner,
// table }`) and `shared` (a table two modules both own: one `{ file, line, modules, table }` per owning mapping).
export function tableOwnership(context) {
  const layout = moduleLayout(context);
  if (layout.tables) return layout.tables;
  const facts = context.csharpFacts;
  const result = [];
  for (const backend of layout.roots) {
    const moduleOf = (file) => {
      if (layout.isTest(file) || inBuildOutput(file.path)) return null;
      const placed = moduleOfPath(file.path);
      return placed?.root === backend ? placed.module : null;
    };
    const declared = facts.defaultSchemas.filter((entry) => under(entry.file.path, backend) && !layout.isTest(entry.file) && !inBuildOutput(entry.file.path));
    const schemasOf = (entries) => [...new Set(entries.map((entry) => entry.schema))].sort();
    const hostDefaults = schemasOf(declared.filter((entry) => !moduleOfPath(entry.file.path)));
    // A module that declares a default schema of its own gets that one, not the default of another module's context.
    const keysOf = (entry, module) => {
      if (entry.schema !== null) return [`${entry.schema}.${entry.table}`];
      const own = schemasOf(declared.filter((declaration) => moduleOf(declaration.file) === module));
      const schemas = own.length ? own : hostDefaults;
      return (schemas.length ? schemas : [""]).map((schema) => `${schema}.${entry.table}`);
    };

    const mappings = [];
    for (const entry of facts.tables) {
      const module = moduleOf(entry.file);
      if (module) mappings.push({ file: entry.file, line: entry.line, module, owns: entry.method !== "ToView", keys: keysOf(entry, module) });
    }
    // Every module that owns a table, by a `ToTable` or `[Table]` in module code and by the migrations snapshot.
    const owners = new Map();
    const addOwner = (key, module) => {
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key).add(module);
    };
    for (const mapping of mappings) {
      if (!mapping.owns) continue;
      for (const key of mapping.keys) addOwner(key, mapping.module);
    }
    for (const entry of facts.snapshotTables) {
      if (entry.method !== "ToTable" || !under(entry.file.path, backend)) continue;
      const parts = facts.types.get(entry.entity)?.parts ?? [];
      const module = parts.map((part) => moduleOf(part.file)).find(Boolean);
      if (!module) continue;
      for (const key of keysOf(entry, module)) addOwner(key, module);
    }
    const ownerOf = (key) => {
      const modules = owners.get(key);
      return modules?.size === 1 ? [...modules][0] : null;
    };
    const shown = (key) => key.startsWith(".") ? key.slice(1) : key;

    const wrong = [];
    const shared = [];
    for (const mapping of mappings) {
      for (const key of mapping.keys) {
        const owner = ownerOf(key);
        if (owner && owner !== mapping.module) {
          wrong.push({ file: mapping.file, line: mapping.line, module: mapping.module, owner, table: shown(key) });
          break;
        }
      }
      if (!mapping.owns) continue;
      const clash = mapping.keys.find((key) => owners.get(key).size > 1);
      if (clash !== undefined) shared.push({ file: mapping.file, line: mapping.line, modules: [...owners.get(clash)].sort(), table: shown(clash) });
    }
    const order = (left, right) => left.file.path.localeCompare(right.file.path) || left.line - right.line;
    result.push({ backend, wrong: wrong.sort(order), shared: shared.sort(order) });
  }
  layout.tables = result;
  return result;
}

const be064 = defineRepositoryRule({
  descriptor: createRuleDescriptor({ id: "MER-BE-064", source }),
  requirements: [Capability.CSHARP, Capability.DOTNET_PROJECTS, Capability.CSHARP_FACTS],
  analyze(context) {
    const emit = (entry, message) => {
      context.report({ severity: "error", path: entry.file.path, line: entry.line, message, docRef: moduleInternalsRef });
    };
    for (const { wrong, shared } of tableOwnership(context)) {
      for (const entry of wrong) emit(entry, `module ${entry.module} maps ${entry.owner}'s table ${entry.table} — read it through a consumer-owned required port bridged at the host, or ${entry.owner}'s published contract`);
      for (const entry of shared) emit(entry, `table ${entry.table} is mapped by modules ${listOf(entry.modules)} (with ToTable or [Table]) — one module owns a table; the other reads it through a port or a published contract`);
    }
  },
});

export const beTableOwnershipRules = Object.freeze([be064]);
