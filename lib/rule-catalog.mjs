import fs from "node:fs";
import path from "node:path";

const RULE_ID = /MER-[A-Z]{2}-\d{3}/g;
const CI_ONLY_RULES = new Set(["MER-RV-024"]);

export function loadRuleOwners(checksDir, rulesDir, inProcessRules = []) {
  const owners = [];
  const byRule = new Map();

  const addOwner = (owner) => {
    for (const id of owner.ids) {
      const existing = byRule.get(id);
      if (existing) throw new Error(`duplicate owner for ${id}: ${existing.source}, ${owner.source}`);
      byRule.set(id, owner);
    }
    owners.push(owner);
  };

  for (const entry of fs.readdirSync(checksDir, { withFileTypes: true })) {
    if (!entry.isFile() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const primaryId = entry.name.match(/^(MER-[A-Z]{2}-\d{3})(?:-|\.)/)?.[1];
    if (!primaryId) throw new Error(`producer filename has no rule ID: ${entry.name}`);
    const file = path.join(checksDir, entry.name);
    const source = fs.readFileSync(file, "utf8");
    const produces = source.match(/^\s*(?:\/\/|#)\s*PRODUCES:\s*(.+)$/m)?.[1];
    const ids = produces?.match(RULE_ID) ?? [primaryId];
    if (new Set(ids).size !== ids.length) throw new Error(`producer ${entry.name} repeats an ID in PRODUCES metadata`);
    if (!ids.includes(primaryId)) throw new Error(`producer ${entry.name} omits its filename ID ${primaryId}`);
    if (new Set(ids.map((id) => id.split("-")[1])).size !== 1) throw new Error(`producer ${entry.name} declares IDs from multiple packs`);
    addOwner({
      kind: "script",
      source: entry.name,
      file,
      ids,
      ciOnly: ids.some((id) => CI_ONLY_RULES.has(id)),
    });
  }

  for (const pack of fs.readdirSync(rulesDir).sort()) {
    const dir = path.join(rulesDir, pack);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (!fs.statSync(file).isFile()) continue;
      const source = fs.readFileSync(file, "utf8");
      const fields = [...source.matchAll(/^id:\s*(MER-[A-Z]{2}-\d{3})\s*(?:#.*)?$/gm)];
      if (fields.length !== 1) throw new Error(`expected exactly one id field in rules/${pack}/${name}`);
      const id = fields[0][1];
      if (!name.startsWith(`${id}-`) && !name.startsWith(`${id}.`)) {
        throw new Error(`YAML id ${id} does not match rules/${pack}/${name}`);
      }
      addOwner({ kind: "yaml", source: `rules/${pack}/${name}`, file, ids: [id], ciOnly: false });
    }
  }

  for (const rule of inProcessRules) {
    const { descriptor } = rule;
    addOwner({
      kind: "in-process",
      source: descriptor.source,
      ids: descriptor.ids,
      ciOnly: false,
      variants: descriptor.variants,
      rule,
    });
  }

  owners.sort((a, b) => a.source.localeCompare(b.source));
  return { owners, byRule };
}
