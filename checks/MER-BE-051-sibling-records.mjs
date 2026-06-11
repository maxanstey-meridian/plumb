#!/usr/bin/env node
// MER-BE-051 — Command/Result records are siblings of the use case, never nested
// inside it. Fork settled 2026-06-10 (FABLE_REVIEW.md): casebridge's sibling
// `CreateFormCommand` style won; speechscribe's `CreateTranscriptionUseCase.Command`
// nesting is the backlog. Brace-depth scan: a `record` named Command/Result/Query/
// Response (exact or suffix) declared while inside another type body is a finding.
// Strings and comments are blanked offset-preserving first, so braces in literals
// don't skew the depth.
// DOC: backend-pa-vsa.md#commands-and-results
import fs from "node:fs";
import path from "node:path";

const root = process.argv[2];
if (!root || !fs.existsSync(root)) process.exit(2);

const SKIP = new Set(["node_modules", ".git", "obj", "bin"]);
function* walk(d) {
  let es;
  try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of es) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { if (!SKIP.has(e.name)) yield* walk(p); }
    else if (e.name.endsWith(".cs")) yield p;
  }
}

// Blank string/char/comment contents, preserving length and newlines.
function blank(src) {
  const re = /"""[\s\S]*?"""|@"(?:[^"]|"")*"|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
  return src.replace(re, (m) => m.replace(/[^\n]/g, " "));
}

const NESTED_NAME = /^(Command|Result|Query|Response)$|(Command|Result)$/;

for (const f of walk(root)) {
  if (!f.includes(`${path.sep}Modules${path.sep}`) && !f.includes(`${path.sep}Application${path.sep}`)) continue;
  const src = blank(fs.readFileSync(f, "utf8"));
  let depth = 0;
  const typeBodyDepths = [];
  let pending = false; // a type decl seen, body brace not yet opened
  for (const m of src.matchAll(/\b(class|record|struct|interface)\s+([A-Za-z_]\w*)|[{};]/g)) {
    if (m[0] === "{") {
      depth++;
      if (pending) { typeBodyDepths.push(depth); pending = false; }
    } else if (m[0] === "}") {
      if (typeBodyDepths[typeBodyDepths.length - 1] === depth) typeBodyDepths.pop();
      depth--;
    } else if (m[0] === ";") {
      if (pending && depth < (typeBodyDepths[typeBodyDepths.length - 1] ?? 0) + 1) pending = false; // bodyless record Foo(...);
      if (pending) pending = false;
    } else {
      if (m[1] === "record" && typeBodyDepths.length > 0 && NESTED_NAME.test(m[2])) {
        const line = src.slice(0, m.index).split("\n").length;
        console.log(`MER-BE-051\twarn\t${path.relative(root, f)}:${line}\tCommand/Result records are siblings of the use case, not nested inside it — lift ${m[2]} to a top-level record\tbackend-pa-vsa.md#commands-and-results`);
      }
      pending = true;
    }
  }
}
