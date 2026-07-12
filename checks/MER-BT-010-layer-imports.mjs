#!/usr/bin/env node
// PRODUCES: MER-BT-010, MER-BT-011, MER-BT-012
// MER-BT-010/011/012 — TS backend layer + module-boundary rules (contract §11.8;
// .NET parity for BE-001..005). One pass, three IDs:
//   BT-010 (error): domain/ imports only its own module's domain/; known backend
//                   framework packages in domain are also findings.
//   BT-011 (error): application|app must not import infrastructure|infra.
//   BT-012 (error): modules must not import sibling internals; published
//                   contracts and composition-root integration are legal.
// Relative imports retain syntactic resolution. Non-relative aliases are checked
// only when the nearest tsconfig resolves them; unresolved aliases stay silent.
// DOC: backend-pa-vsa.md#non-negotiable-dependency-rules
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { walkFiles } from "./_lib/fs-scan.mjs";
import { resolveTsImport } from "./_lib/ts-resolution.mjs";

const rootArg = process.argv[2];
if (!rootArg || !fs.existsSync(rootArg)) process.exit(2);
const root = path.resolve(rootArg);

const LAYER_NAMES = new Map([
  ["domain", "domain"],
  ["application", "application"], ["app", "application"],
  ["infrastructure", "infrastructure"], ["infra", "infrastructure"],
  ["interface", "interface"], ["interfaces", "interface"],
  ["http", "interface"], ["controllers", "interface"],
  ["contracts", "contracts"],
]);
const DOMAIN_BANNED_PKGS = /^(@nestjs\/|express(?:\/|$)|fastify(?:\/|$)|hono(?:\/|$)|vue$|typed-inject$|inversify$|@vueuse\/|prisma$|@prisma\/|typeorm$|knex$|drizzle-orm(?:\/|$)|sequelize$|@mikro-orm\/|pino(?:\/|$)|winston(?:\/|$)|bunyan(?:\/|$)|log4js(?:\/|$)|@opentelemetry\/)/;
const APPLICATION_TRANSPORT_PKGS = /^(@nestjs\/common$|express(?:\/|$)|fastify(?:\/|$)|hono(?:\/|$))/;
const GENERATED_TRANSPORT_PKGS = /(?:^|\/)(?:generated[-/](?:http|transport)|transport[-/]generated)(?:\/|$)/;

// classify a path into { module, layer } from its segments.
// module = segment after a lowercase "modules" dir (null when no modules tree);
// layer = first recognized layer segment after the module (or anywhere, for
// single-module repos like rivet-ts's src/{domain,application,infrastructure}).
function classify(p) {
  const segs = p.split(path.sep);
  let module = null, layer = null;
  for (let i = 0; i < segs.length; i++) {
    if (segs[i] === "modules" && i + 1 < segs.length) module = segs[i + 1];
    else if (LAYER_NAMES.has(segs[i]) && (module !== null || segs.includes("src"))) {
      if (layer === null) layer = LAYER_NAMES.get(segs[i]);
    }
  }
  return { module, layer };
}

function moduleReferences(sf) {
  const references = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      references.push({ node: node.moduleSpecifier, spec: node.moduleSpecifier.text });
      return;
    }
    if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference) && ts.isStringLiteral(node.moduleReference.expression)) {
      references.push({ node: node.moduleReference.expression, spec: node.moduleReference.expression.text });
      return;
    }
    if (ts.isCallExpression(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0]) &&
        ((ts.isIdentifier(node.expression) && node.expression.text === "require") || node.expression.kind === ts.SyntaxKind.ImportKeyword)) {
      references.push({ node: node.arguments[0], spec: node.arguments[0].text });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return references;
}

function isSharedDomainOrKernel(target) {
  const segs = target.split(path.sep);
  for (let i = 0; i < segs.length - 1; i++) {
    if ((segs[i] === "common" || segs[i] === "shared") && (segs[i + 1] === "domain" || segs[i + 1] === "kernel")) return true;
    if (segs[i] === "src" && (segs[i + 1] === "kernel" || segs[i + 1] === "shared-kernel")) return true;
    if (segs[i] === "modules" && segs[i + 1] === "shared-kernel") return true;
  }
  return false;
}

const findings = [];
for (const f of walkFiles(root, root, { filter: () => true, depth: 12 })) {
  if (!/\.(ts|mts|cts)$/.test(f) || f.endsWith(".d.ts")) continue;
  if (/\.(spec|test)\.[mc]?ts$/.test(f) || /__tests__/.test(f)) continue;
  const from = classify(f);
  if (!from.layer && !from.module) continue;
  const rel = path.relative(root, f);
  const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);

  for (const reference of moduleReferences(sf)) {
    const spec = reference.spec;
    const line = sf.getLineAndCharacterOfPosition(reference.node.getStart(sf)).line + 1;

    if (!spec.startsWith(".")) {
      if (from.layer === "domain" && DOMAIN_BANNED_PKGS.test(spec)) {
        findings.push(`MER-BT-010\terror\t${rel}:${line}\tdomain imports framework package "${spec}" — domain depends on nothing outside itself\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
        continue;
      }
      if (from.layer === "application" && (APPLICATION_TRANSPORT_PKGS.test(spec) || GENERATED_TRANSPORT_PKGS.test(spec))) {
        findings.push(`MER-BT-011\terror\t${rel}:${line}\tapplication must not import transport framework or generated wire package "${spec}" — keep transport ownership at the interface edge\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
        continue;
      }
    }

    const target = resolveTsImport(root, f, spec);
    if (!target) continue;
    const to = classify(target);
    const internal = target === root || target.startsWith(root + path.sep);

    // §7 exception (calibration 2026-06-10, glyphantics game.module.ts): Nest
    // module classes (*.module.ts) ARE the composition root — importing sibling
    // modules there is framework wiring, not a boundary leak.
    const isCompositionFile = /\.module\.[mc]?ts$/.test(f);
    if (from.layer === "domain" && internal && !(
      to.layer === "domain" && ((from.module && from.module === to.module) || (!from.module && !to.module))
    ) && !isSharedDomainOrKernel(target))
      findings.push(`MER-BT-010\terror\t${rel}:${line}\tdomain internal import must remain in its own domain or a genuine shared domain/kernel\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
    else if (!isCompositionFile && from.module && to.module && from.module !== to.module && to.module !== "common" && from.module !== "common" && to.layer !== "contracts")
      findings.push(`MER-BT-012\terror\t${rel}:${line}\tmodule ${from.module} must not import ${to.module} internals — consume its published contracts or bridge a required port at composition\tbackend-pa-vsa.md#across-modules`);
    else if (from.layer === "domain" && to.layer && to.layer !== "domain")
      findings.push(`MER-BT-010\terror\t${rel}:${line}\tdomain must not import ${to.layer} — domain depends on nothing outside itself\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
    else if (from.layer === "application" && (to.layer === "infrastructure" || to.layer === "interface"))
      findings.push(`MER-BT-011\terror\t${rel}:${line}\tapplication must not import ${to.layer} — depend inward on domain and application-owned contracts\tbackend-pa-vsa.md#non-negotiable-dependency-rules`);
  }
}
for (const l of findings) console.log(l);
