#!/usr/bin/env node
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadRuleOwners } from "../lib/rule-catalog.mjs";
import { inProcessRules } from "../lib/in-process-rules/index.mjs";
import { spawnProducer } from "./helpers/run-producer.mjs";

const HOME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHECKS = path.join(HOME, "checks");
const FIXTURES = path.join(HOME, "fixtures");
const REFERENCES = path.join(os.homedir(), ".config/opencode/skills/meridian/references");
const catalogCandidates = process.env.MERIDIAN_CHECK_CATALOG
  ? [process.env.MERIDIAN_CHECK_CATALOG]
  : [
      path.join(os.homedir(), ".config/opencode/skills/meridian/FABLE_CHECKS.md"),
      path.join(os.homedir(), ".claude/skills/meridian/FABLE_CHECKS.md"),
    ];
const catalogPath = catalogCandidates.find((candidate) => fs.existsSync(candidate));

function loadAlignment() {
  assert.ok(catalogPath, `Meridian rule catalogue not found; checked: ${catalogCandidates.join(", ")}`);
  const { byRule: owners } = loadRuleOwners(CHECKS, path.join(HOME, "rules"), inProcessRules);

  const catalog = fs.readFileSync(catalogPath, "utf8");
  const entries = new Map();
  const matches = [...catalog.matchAll(/^- \*\*(MER-[A-Z]{2}-\d{3})\*\*([^\n]*(?:\n(?!- \*\*MER-)[^\n]*)*)/gm)];
  for (const match of matches) {
    assert.ok(!entries.has(match[1]), `duplicate catalogue entry ${match[1]}`);
    entries.set(match[1], match[0]);
  }
  return { owners, entries };
}

function catalogueSeverities(id, entry) {
  const variable = {
    "MER-BE-024": new Set(["error", "warn"]),
    "MER-TO-011": new Set(["error", "warn"]),
  }[id];
  if (variable) return variable;
  const declared = [...entry.split("—", 1)[0].matchAll(/`(error|warn|info)`/g)].map((match) => match[1]);
  assert.ok(declared.length, `catalogue entry ${id} has no declared severity`);
  return new Set(declared);
}

function githubHeadingSlugs(markdown) {
  const counts = new Map();
  const slugs = new Set();
  for (const match of markdown.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const heading = match[1]
      .replace(/!?(?:\[([^\]]*)\])\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, "")
      .replace(/[`*_~]/g, "")
      .toLowerCase();
    const base = heading.replace(/[^\p{L}\p{N}\s_-]/gu, "").trim().replace(/\s/g, "-");
    const count = counts.get(base) ?? 0;
    counts.set(base, count + 1);
    slugs.add(count ? `${base}-${count}` : base);
  }
  return slugs;
}

function runOwner(owner, fixture, id) {
  if (owner.kind === "script") {
    const out = spawnProducer(owner.file, fixture, {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
      env: { ...process.env, PLUMB_CI: "1" },
    });
    assert.equal(out.status, 0, `${owner.source} exited ${out.status}: ${out.stderr}`);
    return (out.stdout || "").split("\n").filter((line) => line.trim()).map((line) => {
      const [id, severity, location, message, docRef] = line.split("\t");
      assert.ok(id && severity && location && message && docRef, `${owner.source} emitted a malformed finding: ${JSON.stringify(line)}`);
      return { id, severity, docRef };
    });
  }

  if (owner.kind === "in-process") {
    const out = spawnSync(path.join(HOME, "plumb"), [fixture, "--rule", id, "--json", "--ci"], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    assert.ok([0, 1].includes(out.status), `${owner.source} exited ${out.status}: ${out.stderr}`);
    return JSON.parse(out.stdout || "[]").map((finding) => ({
      id: finding.rule,
      severity: finding.severity,
      docRef: finding.docRef,
    }));
  }

  const out = spawnSync("ast-grep", ["scan", "--rule", owner.file, "--json", "."], {
    cwd: fixture,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.ok([0, 1].includes(out.status), `${owner.source} exited ${out.status}: ${out.stderr}`);
  return JSON.parse(out.stdout || "[]").map((finding) => ({
    id: finding.ruleId,
    severity: finding.severity === "warning" ? "warn" : finding.severity,
    docRef: finding.note,
  }));
}

function verifyFinding(owner, finding, entries, slugCache) {
  assert.ok(owner.ids.includes(finding.id), `${owner.source} emitted undeclared ID ${finding.id}`);
  const entry = entries.get(finding.id);
  assert.ok(entry, `${owner.source} emitted uncatalogued ID ${finding.id}`);
  assert.ok(catalogueSeverities(finding.id, entry).has(finding.severity),
    `${owner.source} emitted ${finding.id} as ${finding.severity}, contrary to its catalogue severity`);

  const ref = finding.docRef?.match(/^([^#]+\.md)#(.+)$/);
  assert.ok(ref, `${owner.source} emitted invalid docRef ${JSON.stringify(finding.docRef)}`);
  const reference = path.join(REFERENCES, ref[1]);
  assert.ok(fs.existsSync(reference), `${owner.source} docRef file does not exist: ${finding.docRef}`);
  if (!slugCache.has(reference)) slugCache.set(reference, githubHeadingSlugs(fs.readFileSync(reference, "utf8")));
  assert.ok(slugCache.get(reference).has(ref[2]), `${owner.source} docRef anchor does not exist: ${finding.docRef}`);
}

test("every implemented ID has exactly one owner, catalogue entry, and fixture pair", () => {
  const { owners, entries } = loadAlignment();
  for (const [id, owner] of owners) {
    assert.ok(entries.has(id), `${owner.source} ID ${id} is missing from FABLE_CHECKS.md`);
    assert.ok(fs.existsSync(path.join(FIXTURES, id, "bad")), `implemented ID ${id} has no fixtures/${id}/bad`);
    assert.ok(fs.existsSync(path.join(FIXTURES, id, "good")), `implemented ID ${id} has no fixtures/${id}/good`);
  }

  const explicitlyNotProduced = /\b(?:retired|model-only|planned|delegated\b|covered by)\b/i;
  for (const [id, entry] of entries) {
    if (explicitlyNotProduced.test(entry)) continue;
    assert.ok(owners.has(id), `active catalogue rule ${id} has no producer or YAML definition`);
  }
});

test("each owner emits its declared ID with catalogue-aligned severity and a resolvable docRef", () => {
  const { owners, entries } = loadAlignment();
  const slugCache = new Map();
  const findingFailures = [];
  for (const [id, owner] of owners) {
    const bad = runOwner(owner, path.join(FIXTURES, id, "bad"), id);
    assert.ok(bad.some((finding) => finding.id === id), `${owner.source} did not emit ${id} on fixtures/${id}/bad`);
    for (const finding of bad) {
      try { verifyFinding(owner, finding, entries, slugCache); }
      catch (error) { findingFailures.push(error.message); }
    }

    const good = runOwner(owner, path.join(FIXTURES, id, "good"), id);
    assert.ok(!good.some((finding) => finding.id === id), `${owner.source} emitted ${id} on fixtures/${id}/good`);
    for (const finding of good) {
      try { verifyFinding(owner, finding, entries, slugCache); }
      catch (error) { findingFailures.push(error.message); }
    }
  }
  assert.deepEqual([...new Set(findingFailures)], []);
});
