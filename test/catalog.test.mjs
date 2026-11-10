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

// A docRef names one rule file under meridian's references/, and nothing else: each file states
// one rule, so a heading anchor has nothing to add.
function verifyFinding(owner, finding) {
  assert.ok(owner.ids.includes(finding.id), `${owner.source} emitted undeclared ID ${finding.id}`);
  assert.ok(["error", "warn", "info"].includes(finding.severity), `${owner.source} emitted ${finding.id} with severity ${finding.severity}`);

  assert.ok(/^rules\/[a-z-]+\/[a-z0-9-]+\.md$/.test(finding.docRef ?? ""), `${owner.source} emitted invalid docRef ${JSON.stringify(finding.docRef)}`);
  const reference = path.join(REFERENCES, finding.docRef);
  assert.ok(fs.existsSync(reference), `${owner.source} docRef ${finding.docRef}: file does not exist: ${reference}`);
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
  const findingFailures = [];
  for (const [id, owner] of ownersByRule()) {
    const bad = runOwner(owner, path.join(FIXTURES, id, "bad"), id);
    assert.ok(bad.some((finding) => finding.id === id), `${owner.source} did not emit ${id} on fixtures/${id}/bad`);
    for (const finding of bad) {
      try { verifyFinding(owner, finding); }
      catch (error) { findingFailures.push(error.message); }
    }

    const good = runOwner(owner, path.join(FIXTURES, id, "good"), id);
    assert.ok(!good.some((finding) => finding.id === id), `${owner.source} emitted ${id} on fixtures/${id}/good`);
    for (const finding of good) {
      try { verifyFinding(owner, finding); }
      catch (error) { findingFailures.push(error.message); }
    }
  }
  assert.deepEqual([...new Set(findingFailures)], []);
});

// Fixtures reach only some docRefs; this reads every rules/<folder>/<file>.md literal in plumb's
// tracked sources, the analyzer's constants, the DOC comments, and CONTRIBUTING's worked example
// included, and each must name a rule file that exists, with no anchor. An anchor runs to whitespace, a
// backtick, ), ], a comma, a semicolon, or a quote (a docRef sits inside a string literal).
test("every docRef literal in plumb's sources names an existing rule file", () => {
  assert.ok(
    fs.existsSync(REFERENCES),
    `Meridian references not found at ${REFERENCES}: set MERIDIAN_REFERENCES to the meridian skill's references folder, or install the skill at ${DEFAULT_REFERENCES}`,
  );
  const tracked = spawnSync("git", ["ls-files", "lib", "checks", "rules", "dotnet/Meridian.Analyzers", "CONTRIBUTING.md"], { cwd: HOME, encoding: "utf8" });
  assert.equal(tracked.status, 0, `git ls-files failed: ${tracked.stderr}`);
  // git still lists a tracked file that is deleted but not yet committed.
  const sources = tracked.stdout.split("\n").filter((file) => /\.(?:mjs|yml|cs|md)$/.test(file) && fs.existsSync(path.join(HOME, file)));
  const failures = [];
  let checked = 0;
  for (const file of sources) {
    for (const match of fs.readFileSync(path.join(HOME, file), "utf8").matchAll(/rules\/[a-z-]+\/[a-z0-9-]+\.md(?:#[^\s`)\],;"']+)?/g)) {
      const [docPath, anchor] = match[0].split("#");
      const reference = path.join(REFERENCES, docPath);
      checked++;
      if (anchor !== undefined) failures.push(`${file}: ${match[0]}: carries an anchor: a docRef names the rule file only`);
      else if (!fs.existsSync(reference)) failures.push(`${file}: ${docPath}: file does not exist: ${reference}`);
    }
  }
  assert.ok(checked > 0, "no docRef literals found in plumb's sources");
  assert.deepEqual(failures, []);
});
