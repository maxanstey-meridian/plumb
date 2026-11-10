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
const DEFAULT_REFERENCES = path.join(os.homedir(), ".claude/skills/meridian/references");
const REFERENCES = process.env.MERIDIAN_REFERENCES || DEFAULT_REFERENCES;
const ownersByRule = () => loadRuleOwners(CHECKS, path.join(HOME, "rules"), inProcessRules).byRule;

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

function verifyFinding(owner, finding, slugCache) {
  assert.ok(owner.ids.includes(finding.id), `${owner.source} emitted undeclared ID ${finding.id}`);
  assert.ok(["error", "warn", "info"].includes(finding.severity), `${owner.source} emitted ${finding.id} with severity ${finding.severity}`);

  const ref = finding.docRef?.match(/^([^#]+\.md)#(.+)$/);
  assert.ok(ref, `${owner.source} emitted invalid docRef ${JSON.stringify(finding.docRef)}`);
  const reference = path.join(REFERENCES, ref[1]);
  assert.ok(fs.existsSync(reference), `${owner.source} docRef ${finding.docRef}: file does not exist: ${reference}`);
  if (!slugCache.has(reference)) slugCache.set(reference, githubHeadingSlugs(fs.readFileSync(reference, "utf8")));
  assert.ok(slugCache.get(reference).has(ref[2]), `${owner.source} docRef ${finding.docRef}: anchor #${ref[2]} does not exist in ${reference}`);
}

test("every implemented ID has exactly one owner and a fixture pair", () => {
  for (const id of ownersByRule().keys()) {
    assert.ok(fs.existsSync(path.join(FIXTURES, id, "bad")), `implemented ID ${id} has no fixtures/${id}/bad`);
    assert.ok(fs.existsSync(path.join(FIXTURES, id, "good")), `implemented ID ${id} has no fixtures/${id}/good`);
  }
});

test("each owner emits its declared ID on bad, not on good, with a valid severity and a resolvable docRef", () => {
  assert.ok(
    fs.existsSync(REFERENCES),
    `Meridian references not found at ${REFERENCES}: set MERIDIAN_REFERENCES to the meridian skill's references folder, or install the skill at ${DEFAULT_REFERENCES}`,
  );
  const slugCache = new Map();
  const findingFailures = [];
  for (const [id, owner] of ownersByRule()) {
    const bad = runOwner(owner, path.join(FIXTURES, id, "bad"), id);
    assert.ok(bad.some((finding) => finding.id === id), `${owner.source} did not emit ${id} on fixtures/${id}/bad`);
    for (const finding of bad) {
      try { verifyFinding(owner, finding, slugCache); }
      catch (error) { findingFailures.push(error.message); }
    }

    const good = runOwner(owner, path.join(FIXTURES, id, "good"), id);
    assert.ok(!good.some((finding) => finding.id === id), `${owner.source} emitted ${id} on fixtures/${id}/good`);
    for (const finding of good) {
      try { verifyFinding(owner, finding, slugCache); }
      catch (error) { findingFailures.push(error.message); }
    }
  }
  assert.deepEqual([...new Set(findingFailures)], []);
});

// Fixtures reach only some docRefs; this reads every rules/<folder>/<file>.md literal in plumb's
// tracked sources, the analyzer's constants, the DOC comments, and CONTRIBUTING's worked example
// included, and each must name a heading. A slug runs to whitespace, a backtick, ), ], a comma,
// a semicolon, or a quote (a docRef sits inside a string literal), less one trailing full stop.
test("every docRef literal in plumb's sources names an existing heading", () => {
  assert.ok(
    fs.existsSync(REFERENCES),
    `Meridian references not found at ${REFERENCES}: set MERIDIAN_REFERENCES to the meridian skill's references folder, or install the skill at ${DEFAULT_REFERENCES}`,
  );
  const tracked = spawnSync("git", ["ls-files", "lib", "checks", "rules", "dotnet/Meridian.Analyzers", "CONTRIBUTING.md"], { cwd: HOME, encoding: "utf8" });
  assert.equal(tracked.status, 0, `git ls-files failed: ${tracked.stderr}`);
  const sources = tracked.stdout.split("\n").filter((file) => /\.(?:mjs|yml|cs|md)$/.test(file));
  const slugCache = new Map();
  const failures = [];
  let checked = 0;
  for (const file of sources) {
    for (const match of fs.readFileSync(path.join(HOME, file), "utf8").matchAll(/rules\/[a-z-]+\/[a-z0-9-]+\.md(?:#[^\s`)\],;"']+)?/g)) {
      const docRef = match[0].replace(/\.$/, "");
      const [docPath, slug] = docRef.split("#");
      const reference = path.join(REFERENCES, docPath);
      checked++;
      if (slug === undefined) {
        failures.push(`${file}: ${docRef}: names no heading`);
        continue;
      }
      if (!fs.existsSync(reference)) {
        failures.push(`${file}: ${docRef}: file does not exist: ${reference}`);
        continue;
      }
      if (!slugCache.has(reference)) slugCache.set(reference, githubHeadingSlugs(fs.readFileSync(reference, "utf8")));
      if (!slugCache.get(reference).has(slug)) failures.push(`${file}: ${docRef}: anchor #${slug} does not exist in ${reference}`);
    }
  }
  assert.ok(checked > 0, "no docRef literals found in plumb's sources");
  assert.deepEqual(failures, []);
});
