# FABLE_CONTRACT.md — plumb

**plumb** is the mechanical enforcement arm of the Meridian skill
(`~/.config/opencode/skills/meridian/`). A plumb line tells you whether a structure
is true; plumb tells you whether a repo is true to Meridian doctrine — the
mechanically checkable subset of it.

This file is the golden spec. Like `~/.meridian/CONTRACT.md` is for the handon
harness: **every behavior change to plumb amends this contract first.** Rule
inventory lives in the skill at `meridian/FABLE_CHECKS.md`; this contract defines
how rules are packaged, discovered, run, and reported.

---

## 1. Purpose and non-goals

plumb answers one question: **"is there boundary/naming/hygiene drift?"** — with
high precision, from outside the repo, with zero per-project setup.

A green run means "no drift in the rules plumb knows". It does NOT mean "Meridian
compliant". plumb never judges whether a seam is earned, whether a port is too wide,
whether missing files should exist, or any other taste call. Those stay with the
model and the human. plumb's job is to make those the *only* remaining questions.

Non-goals:

- not a framework with a plugin API ("ESLint for Meridian")
- not a formatter or fixer (v1 reports; it does not rewrite)
- not a build gate by default (callers choose what severity fails)

The no-fixer ruling is about repos plumb **checks**: it never rewrites a repo it
is asked to inspect. It does NOT forbid plumb from **creating** a fresh repo —
that is what `plumb init` (the project composer) does: it scaffolds a new repo
that passes plumb by construction. Create ≠ fix. plumb still never mutates an
existing repo it checks; init only writes into a new directory it owns.

## 2. Architecture: the output contract IS the framework

plumb is a thin runner over independent **producers**. Anything that emits finding
lines and exits sanely is a producer. There is no plugin API to learn; there is only
the line format.

Producers, in order of preference:

1. **ast-grep** (`sg scan`) — the primary engine. All single-file, pattern-shaped
   rules are declarative YAML files in `rules/`. Polyglot (TS, Vue script blocks,
   C#) via tree-sitter. Adding a rule = dropping a YAML file.
2. **`checks/` scripts** — the escape hatch for anything cross-file: import graphs,
   single-consumer detection, file-existence, config assertions. Standalone
   executables (bash/node/whatever), one concern each.
3. **wrapped third-party tools** — invoked *from inside a check script* (CLI or JS
   API), output translated into finding lines. Tools are wrapped, never integrated.
   Wrapped tools are used in their dumbest mechanical mode, never their
   config/rule-DSL mode — e.g. dependency-cruiser is a **graph builder only**
   (parse + resolve imports → edge list, via its JS API in `checks/_lib/`); the
   Meridian judgments over those edges are plain JS in plumb's own checks. A
   wrapped tool's per-project config mode is off-limits — it would smuggle back
   the per-repo setup that §5 bans.

The runner (`plumb`, a single script ≤ ~150 lines) does only: convention detection →
run applicable producers → merge/format output → exit code. If the runner grows
opinions beyond that, it has become a framework and the design has failed.

## 3. Finding line format

Producers emit one finding per line on stdout, tab-separated, five fields:

```
RULE-ID<TAB>SEVERITY<TAB>PATH:LINE<TAB>MESSAGE<TAB>DOC-REF
```

Example:

```
MER-FE-001	error	app/pages/index/logic/recording-status.ts:1	logic/ must not import framework code	frontend-pa-vsa.md#logic
```

Rules:

- `RULE-ID` — `MER-<PACK>-<NNN>` as catalogued in `FABLE_CHECKS.md`. IDs are stable
  forever; retired rules are never reused.
- `SEVERITY` — `error` | `warn` | `info` (semantics in §6).
- `PATH` — relative to repo root. `LINE` may be `0` for file/repo-level findings.
- `MESSAGE` — one sentence, imperative, self-contained.
- `DOC-REF` — skill reference file + anchor the rule enforces. This is what makes
  the small-AI loop work: a weak model gets the finding plus the doctrine paragraph,
  not "has it followed Meridian?".

Anything a producer writes to stderr is diagnostics, never findings.

## 4. Repository layout

```
~/.meridian/plumb/
├── FABLE_CONTRACT.md     ← this file
├── plumb                 ← the runner (executable)
├── sgconfig.yml          ← points ast-grep at rules/
├── package.json          ← wrapped-tool deps only (v2+: dependency-cruiser)
├── node_modules/         ← installed wrapped tools; checks resolve them by path
├── rules/                ← ast-grep YAML, one rule per file
│   └── <pack>/<rule-id>-<slug>.yml      e.g. fe/MER-FE-001-logic-pure.yml
├── checks/               ← cross-file scripts, one concern per file
│   ├── <rule-id>-<slug>(.sh|.mjs)       e.g. MER-BE-003-cross-module.sh
│   └── _lib/             ← shared helpers for checks; NOT run by the runner
├── configs/              ← golden base config files (see §11.7) — the canonical
│                            lint/format configs repos must contain at least
├── fixtures/             ← minimal pass/fail samples per rule (see §8)
├── test/                 ← runner harness, node:test (see §8; run: node --test "test/*.test.mjs")
└── dotnet/               ← v3a in-build mirror (separate distribution channel, §11.4)
    ├── Meridian.Analyzers/   ← Roslyn analyzer source (MERBE001/002/005)
    ├── fixtures/{bad,good}/  ← consumer fixture projects
    ├── test.sh               ← dotnet-side self-test (needs SDK; not part of --self-test)
    └── nupkg/                ← packed Meridian.Analyzers.<version>.nupkg (local feed)
```

Conventions:

- one rule per file; filename starts with the rule ID. A script MAY emit a small
  family of sibling rule IDs when they share one analysis pass (precedent:
  MER-BE-005-cross-module.sh emits BE-003/004/005; MER-FE-031 emits FE-031/022).
- every rule file/script carries a header comment: rule ID, doctrine quote, DOC-REF
- check scripts receive the repo root as `$1`, emit finding lines, exit `0` even
  when findings exist (exit non-zero only on internal failure)
- the runner executes only regular executable files directly under `checks/`;
  directories and `_`-prefixed entries are skipped (that's where shared lib code
  lives)
- wrapped third-party tools (§2.3) are declared in plumb's own `package.json` and
  installed under plumb, never in the target repo. A check that needs a missing
  tool prints a one-line stderr diagnostic and exits 0 with no findings — a target
  repo must never fail because plumb's optional deps aren't installed.

## 5. Invocation and convention detection

```
plumb <repo-root> [--json] [--fail-on error|warn|info] [--pack FE,BE,...] [--rule MER-FE-001] [--ci]
```

- Default `--fail-on error`.
- `--json` emits findings as a JSON array (same five fields) for AI loops/CI.
- `--ci` (added 2026-06-10 for v3c) enables **CI-tier checks** — checks that may
  build/regenerate (slow, may invoke the repo's own toolchain). The runner's only
  involvement is setting `PLUMB_CI=1` in the environment of check scripts;
  CI-tier checks self-gate on that variable and exit 0 silently without it. The
  default local run never builds anything. `--self-test` always sets `PLUMB_CI=1`
  so CI-tier fixtures are exercised. CI-tier checks must leave the target repo's
  working tree exactly as they found it (snapshot/restore), and skip with a
  stderr diagnostic if the relevant paths have uncommitted-looking state they
  cannot safely restore.
- Exit codes: `0` clean (at/above fail level), `1` findings at/above fail level,
  `2` runner/producer internal error.
- `--baseline <file>` (added 2026-06-11, Max's 6b call) — legacy-adoption
  ratchet. The file (JSON: `{version, entries: {"RULE\tPATH": count}}`) is
  written with `--write-baseline <file>` and passed EXPLICITLY — never
  auto-discovered from the target repo (§5's zero-config rule stands; the
  baseline is state the caller owns, e.g. committed and passed in CI).
  Semantics: each finding consumes one allowance for its `RULE\tPATH` key
  (line numbers excluded — they shift); findings over the allowance are NEW
  and count toward the exit code; suppressed findings are never hidden — the
  summary reports `N baselined (baseline holds M)` so the count visibly
  shrinks, and when N < M the run suggests re-writing the baseline to
  ratchet down. `--json` emits only actionable (non-baselined) findings.
  This is the entire feature: matching is count-per-(rule,path), no fuzzing,
  no per-rule config, no suppression comments — if it ever needs more than
  that, it has become a mini-PHPStan and the answer is no.

**Convention-triggered, zero config.** Packs activate on detected markers; absence
of a convention is never a violation:

| Marker | Packs |
|---|---|
| `nuxt.config.*` | FE, TO(ts) |
| `pages/**/{logic,ports,adapters}/` | FE purity rules for those dirs |
| `*.csproj` + `Modules/` | BE, TO(dotnet) |
| `*Contract.cs` / `Rivet.Attributes` reference | RV |
| RV(v1) artifact fingerprint: a `generated/` or `generated/rivet/` dir containing `rivet.ts`, a `client/` subdir, or a `types/` subdir | RV, variant v1 |
| RV(v2) artifact fingerprint: any dir containing BOTH `openapi.json` and `schema.d.ts` (added v8 — Rivet v2's openapi-typescript pipeline) | RV, variant v2 |
| `typed-inject` in package.json, `*.port.ts`, lowercase `application/ports/` dirs, or a layer-shaped TS tree (lowercase `domain/` + `application|app/` siblings under `src/` or `modules/<x>/` — added v7a for glyphantics-style layered backends) | BT |
| test project / tests dir | TE |
| always | CP |

No config file in the target repo. Ever. If a rule needs per-repo tuning, the rule
is wrong (see §7 — encode the exception or delete the rule).

**Rivet variant (added v8).** Rivet v2 replaced the generated TS client
(`generated/{client/,types/,rivet.ts}`) with `generated/openapi.json` +
openapi-typescript `schema.d.ts` + a thin hand-written openapi-fetch facade.
Several rules pin generation-specific conventions, so the runner detects a
**Rivet variant** per repo (per repo, not per app — pack detection in §5 is
repo-scoped, and `both` covers mid-migration monorepos):

- **v1** — only RV(v1) artifact fingerprints found (table above).
- **v2** — only RV(v2) fingerprints found.
- **both** — both fingerprints found (mid-migration multi-app monorepo).
- **none** — RV pack active without artifact fingerprints (e.g. `*Contract.cs`
  only, pre-generation checkout).

Artifact fingerprints are the PRIMARY signal; an `openapi-fetch` dependency in a
package.json is corroborating only and never required. Detection lives in
`checks/_lib/rivet-variant.mjs` (shared helper, §4 — the runner stays thin); the
runner communicates the variant to producers exactly like `PLUMB_CI`: env var
`PLUMB_RIVET_VARIANT=v1|v2|both|none` in every check's environment. A
version-sensitive check invoked directly (harness, ad-hoc) computes the variant
itself via the helper when the env var is absent — same self-gating shape as
CI-tier checks.

Gating policy (precision-first):

- **v1-pinned rules (MER-FE-005, MER-FE-006) are suppressed only under pure
  `v2`.** They run under `v1`, `both`, and `none` — their trigger patterns
  (`rivetFetch`, `generated/{rivet/,}client` imports) are v1 idioms a v2 repo
  cannot produce. Exception: FE-006 matches bare `@scope/contracts` package
  imports only under confirmed `v1` — under `none` a pre-generation v2 checkout
  would otherwise get v1 advice (`unwrap: false` is unsatisfiable under
  openapi-fetch, which never throws on HTTP errors).
- **v2-pinned rules (MER-FE-007) run only under `v2` or `both`.**
- Variant-neutral RV/FE rules keep firing on whatever their own triggers match
  (MER-FE-003 carries specifier patterns for both variants; the v2 contracts
  package NAME is derived from the package.json nearest each detected artifact
  dir, never hardcoded).

## 6. Severity semantics

- `error` — hard doctrine rule, zero legitimate exceptions after the exception list
  is applied. A small model should fix these unprompted.
- `warn` — default-with-exceptions; a model fixes it or states the exception it
  matched.
- `info` — heuristic/advisory; never fails a run; surfaced for humans and big
  models, suppressed in small-AI loops by default.

## 7. Precision policy (the prime directive)

**A checker that cries wolf gets ignored, which is worse than no checker.**

- Ship few high-precision rules, grow from real findings. v1 is the T1 list in
  `FABLE_CHECKS.md` §Rollout, nothing more.
- Every false positive found in calibration becomes, within the same session,
  exactly one of: (a) an encoded exception in the rule, (b) a severity downgrade,
  or (c) a deleted rule. Never a mental note.
- Known encoded exceptions live in the rule file itself with a comment naming the
  real-world case that earned them (e.g. MER-BE-020 sealed-class: Temporal workflow
  classes, open-generic validators).
- Calibration baseline: `~/Sites/medway/casebridge` and
  `~/Sites/medway/speechscribe-azure`. A rule does not ship until it has been run
  against both.

## 8. Fixtures and self-test

Every rule has a fixture pair under `fixtures/<rule-id>/`: `bad/` (must produce the
finding) and `good/` (must not). `plumb --self-test` runs all rules against their
fixtures and fails on any mismatch. No rule merges without fixtures — this is the
watchdog-core.test.mjs equivalent for plumb.

Two further requirements (added 2026-06-10):

- **Every §7-encoded exception has a matching case in the rule's `good/`
  fixture.** The exception comment in the rule names the real-world case that
  earned it; the good fixture reproduces that case's minimal shape. This is what
  stops a later refactor of the rule from silently reintroducing a known false
  positive — self-test guards the precision policy, not just detection. Encoding
  an exception (§7a) and adding its good-fixture case are one change.
- **The runner itself is tested.** `test/runner.test.mjs` uses node's built-in
  `node:test` (no test deps, no mocks — near-metal per the skill's testing
  philosophy: invoke `plumb` as a subprocess against synthetic temp repos and
  assert on real output). Coverage: pack detection/gating per the §5 marker
  table, the exit-code contract (0/1/2 with `--fail-on`), `--rule`/`--pack`
  filters, `--json` output shape, the §3 five-field TSV format, and §4
  degradation (an AST-tier check whose optional dep cannot resolve exits 0
  with a stderr diagnostic and no findings). `--ci` gating is exercised by
  self-test itself (RV-024's fixture passes only because `--self-test` sets
  `PLUMB_CI=1`). The harness also tests every producer directly: each check
  script run against its own fixtures must exit 0, fire its ID on `bad/`, stay
  silent on `good/`, and emit only well-formed §3 five-field lines on stdout.
  Run both gates together: `plumb --self-test && node --test "test/*.test.mjs"`.

## 9. Doctrine amendments encoded in plumb

Amendments agreed with Max that supersede the current skill prose. Each must flow
back into the skill reference files; until then, plumb is the source of truth for
these:

1. **No type-tag suffixes in TS file names — dirs carry the role, full stop**
   (2026-06-11, MAX'S RULING — supersedes the 2026-06-10 model-delegated
   "dir-based with `.port.ts` escape hatch" version of this amendment). The
   `.port.ts` suffix is binned entirely, along with the whole Nest-style
   tagging family it implies (`.service.ts`, `.provider.ts`, `.use-case.ts`,
   `.interface.ts`, and — added 2026-06-11, scaffolder-plan decision D1 —
   `.handler.ts`; golden's pattern is suffix-free `<module>-routes.ts`):
   "I'm all or nothing — no suffixes at all." Ports live in
   `application/ports/` (FE: `ports/`) named after the capability; use cases,
   adapters, and everything else are named after the thing itself, and the
   directory says what kind of thing it is. Sole exception:
   `<feature>.module.ts` — the Nest composition-root idiom plumb keys its
   BT-005/BT-012 exemptions on. Test/config dotted names (`.spec.ts`,
   `.test.ts`, `.config.ts`, `.d.ts`) are not type tags. Mechanical slice:
   MER-BT-003 extended to flag the tag family.
2. **"Never cross; always Common"** (2026-06-10). Cross-module access NEVER goes
   through a sibling module's `Application/Ports`. Cross-module ports live in
   `Common/Ports` only. Supersedes backend-pa-vsa.md §Cross-module ports ("or expose
   it deliberately from the owning module's `Application/Ports`") — that nuance
   hurts small models; the absolute rule is the doctrine now.
   - MER-BE-005 therefore simplifies to: any `using Modules.Y.*` from `Modules.X`
     is an `error`, full stop.
   - Frontend analogue: any import from another page's subtree is an `error`; the
     fix is always promotion to `app/shared/` (MER-FE-031/032 merge into one rule).
   - Skill sync DONE 2026-06-10: backend-pa-vsa.md (§Across modules,
     §Cross-module ports, §Enforcement) and frontend-pa-vsa.md (§Promotion) now
     state the absolute rule; the skill prose and plumb agree.

3. **Declared failures are results; undeclared failures are exceptions**
   (2026-06-10, model-delegated; BLESSED by Max 2026-06-11). If the contract
   declares the failure (`.Returns<ErrorResponse>(4xx)`), the use case
   returns it as a value the endpoint maps; exceptions are reserved for
   "should never happen" (and are translated once by the error middleware).
   Replaces the prose's previous "domain results **or** exceptions" fork.
   - **The canonical result type is FluentResults** (Max, 2026-06-11) — no
     homegrown `Result<T>`. FluentResults is **furniture**: like Zod in TS,
     it may live in domain and application freely; the minimal-dependencies
     rule does not apply to blessed furniture libraries. Don't reinvent the
     wheel just because ports-and-adapters sometimes makes you.
4. **Persistence ownership** (2026-06-10, model-delegated, veto-able). One
   host-level DbContext is acceptable as the persistence root, but each
   module owns its entities' mapping: `IEntityTypeConfiguration<T>`
   implementations live in the owning module's `Infrastructure/`
   (casebridge already does this — the ruling formalizes existing
   practice). Cross-module DATA access follows "never cross; always
   Common": module X never queries module Y's entities/DbSets; it calls a
   `Common/Ports` port.
5. **A use case is one transaction; no in-process event bus**
   (2026-06-10, model-delegated, veto-able). Cross-module consistency is
   never a shared transaction — it is an explicit port call from a use
   case that may fail independently. No MediatR notifications, no domain
   event dispatchers, until a real async boundary (queue) exists.
6. **Integration tests run on a real database engine** (2026-06-10,
   model-delegated; BLESSED by Max 2026-06-11). The EF InMemory provider is
   banned for integration tests — it validates neither SQL nor relational
   behavior. Use Testcontainers (casebridge's PostgresFixture is the golden
   example) or SQLite-in-memory where containers are impractical. Max's
   corollary: if a test wants to fake persistence, the fake is the
   repository/query PORT, never a fake database underneath the real adapter.
   §9.2 (never cross; always Common), §9.4 (persistence ownership), and §9.5
   (one transaction; no event bus) likewise BLESSED 2026-06-11.
7. **Frontends are SPAs** (Max, 2026-06-11). The doctrine prose assumes
   `ssr: false`; SSR idioms are not house style and the references should
   not be read as ruling on them.
8. **Tests are exempt from purity rules** (Max, 2026-06-11): "tests can
   basically do what they like." Resolves the long-open FE-001 question —
   the `__tests__`/spec exemption inside `logic/` is permanent, not
   provisional. Test code is judged by testing-philosophy.md (doubles
   vocabulary, density, location), never by layer-purity rules.

Forks still undecided (see `meridian/FABLE_REVIEW.md` decision table) stay
unenforced — plumb ships no rule for a fork until Max picks the winner.

9. **Edge-only observability** (2026-06-11, agreed with Max alongside the
   proper-scaffold package). Logging/metrics/tracing live at the EDGES —
   transport middleware (hono/logger on TS server entries, ASP.NET request
   logging) and infrastructure adapters. Domain and application stay silent:
   no console/logger imports, no log statements. The composition entries
   decide what observability exists per environment (the in-browser transport
   ships none; the server entry ships request logging). Prose-only for now —
   no mechanical rule until a real incident earns one (a domain-console rule
   would be the natural first slice). Synced to backend-pa-vsa.md.

10. **Module-local HTTP edge — top-level `src/interface/` dies in TS backends**
    (2026-06-12, Max's ruling — rivet HANDOVER decision D1). HTTP registration
    and edge validation are module-local, mirroring golden .NET
    (`Modules/Notes/NotesEndpoints.cs` + `NotesModule.cs`):
    `src/modules/<m>/<m>-routes.ts` owns registration,
    `src/modules/<m>/<m>-validation.ts` owns the Zod edge schemas, and
    `src/modules/<m>/<m>.module.ts` (the §9.1 suffix exemption) owns the
    module's internal wiring WHERE the module has wiring to own — composition
    roots only choose the adapters the environments disagree on. A module of
    standalone handler functions (scaffold-mock output) emits no `.module.ts`:
    seams must be earned. The api package's `./validation` export stays a
    stable barrel (`src/validation.ts`) so UForm consumers never track the
    move. Prose-only — no mechanical rule until drift is observed. Synced to
    backend-pa-vsa.md §File naming the same change.

## 10. Relationship to the skill

- `meridian/FABLE_CHECKS.md` — the rule inventory: every rule's intent, severity,
  tier, doctrine source. Adding/changing a rule updates that file and this contract
  (if behavior-level) in the same change.
- DOC-REFs must point at sections that exist; if a skill file is restructured, rules
  referencing it are updated in the same change.
- The skill should eventually instruct models: "after completing changes in a
  Meridian repo, run `plumb . --json` and fix all error-level findings" — that line
  is the entire integration.

## 11. Roadmap (from FABLE_CHECKS.md §Rollout)

1. **v1 — SHIPPED 2026-06-10.** Runner + 3 ast-grep rules + 22 check scripts
   covering 27 rule IDs, fixtures for all, `--self-test` green. Calibrated against
   both baseline repos: speechscribe 4 errors (all verified real), casebridge 121
   errors + 80 warns (cross-module sweep verified real; three rules tuned during
   calibration — BE-012 Scan-lambda shape, RV-020 build-artifact exclusion, RV-002
   downgraded to warn pending the contract-location fork).
2. **v2 FE graph pack — SHIPPED 2026-06-10.** dependency-cruiser wrapped per §2.3
   (declared in plumb's `package.json` with `typescript` — its optional peer for
   gathering .ts; missing deps degrade to a stderr diagnostic, never a target-repo
   failure). `checks/_lib/fe-graph.mjs` builds the per-FE-root import graph:
   dependency-cruiser for TS/JS, a regex extractor with the FE-032 alias
   conventions for .vue (dependency-cruiser cannot parse SFCs), edges deduped per
    from→to pair. Three new checks: MER-FE-004 (layer ordering, error),
    MER-FE-021 (port-bypass, warn — flags component-to-composable imports; if a
    matching `injectX` exists, use it, otherwise model the missing port capability),
    MER-FE-031-single-consumer (emits FE-031 + FE-022, warn — zero-consumer
   shared files exempt because Nuxt auto-imports make absence-of-import
   unprovable; the useProvideInject helper exempt as doctrine infrastructure).
   Remaining for v2: C# namespace-graph scanner (BE-001..006 full coverage).
3. **v2 BE namespace pack — SHIPPED 2026-06-10.** MER-BE-001-layer-usings.sh emits
   BE-001 (Domain purity) + BE-002 (Application must not touch Infrastructure) from
   one namespace-using scan — only `using Foo.Bar;` lines match, never disposal
   `using var`. MER-BE-006-common-single-consumer.mjs flags Common types referenced
   by exactly one module (backend analogue of FE-031). Encoded exceptions earned in
   calibration: in interface-declaring Common files only the interfaces are
   candidates (port signature DTOs are received via `var`, so consumer counts
   systematically undercount); `*Exception` types exempt (doctrine lists base error
   types as a legitimate Common use). v2 is now complete.
4. **v3 — deeper-integration tier — SHIPPED 2026-06-10.** Three independent
   pieces, each trading some of plumb's zero-setup principle for earlier or
   sharper enforcement:
   - **v3a — In-build .NET mirror (NuGet), `dotnet/`.** A Roslyn analyzer package
     (`Meridian.Analyzers`, diagnostics MERBE001/MERBE002/MERBE005 mirroring
     MER-BE-001/002/005) so the compiler rejects Domain impurity,
     Application→Infrastructure, and any `using Modules.Y.*` from `Modules.X` at
     build time. Module and layer derive from the file path
     (`Modules/<X>/<Layer>/…`), exactly like plumb's checks; alias usings are
     also caught (stricter than plumb's regex — the dependency is just as real).
     Strictly a *separate, optional distribution channel*: plumb remains the
     source of truth and works unchanged on repos that don't install it.
     `dotnet/test.sh` is the dotnet-side self-test (bad fixture must fail with
     all three IDs, good must build clean); it needs the dotnet SDK and is
     deliberately NOT part of `plumb --self-test`. Distribution: the packed
     nupkg in `dotnet/nupkg/` consumed as a local folder feed (verified
     end-to-end); pushing to a real feed is Max's call.
   - **v3b — AST-tier FE rules — MER-FE-010 + MER-FE-015.** Both use the
     TypeScript compiler API (already under plumb's `node_modules` as
     dependency-cruiser's peer; missing → §4 degrade). FE-010 (`error`): port
     files contain ONLY type definitions + the provide/inject tuple — encoded
     exceptions from calibration: `declare`-modified ambient statements, and
     hand-written `const injectX = () => …` helpers (speechscribe's desktop.ts
     wires through a Nuxt plugin; the inject function IS the injection helper).
     FE-015 (`info`, per FABLE_CHECKS): port whose ≥2 method names are all
     exported functions of a single generated Rivet client module = fake API
     abstraction.
   - **v3c — MER-RV-024 Rivet staleness check (`info`, CI-tier).** Re-runs the
     repo's own Taskfile generation task (the task whose command matches
     `rivet … --output`; output path resolved via `task --dry`), diffs against
     checked-in output, then restores the output dir byte-for-byte from a
     snapshot. Self-gates on `PLUMB_CI=1` — see the `--ci` flag in §5. A failing
     generation build (e.g. unrestored packages locally) is a stderr diagnostic
     and exit 0, never a finding.

5. **v4 — fork-decision rule pack (settled forks → enforced doctrine).** Twelve
   rule IDs, ten new:
   - **MER-RV-010** (`error`, T1) — `*Contract.cs` under `Modules/` is misplaced;
     contracts live in top-level `Contracts/{Module}/`.
   - **MER-RV-002** re-escalated `warn` → `error` (the fork it was waiting on is
     settled; casebridge's 78 literal routes become migration backlog,
     BE-005-style).
   - **MER-RV-025** (`warn`, T1) — generated Rivet output living inside an app
     dir instead of a workspace `packages/contracts` package. One repo-level
     finding per offending generated dir, not per file.
   - **MER-FE-006** (`warn`, AST-tier) — `try/catch` wrapped around a
     generated-client call; house style is `{ unwrap: false }` + `.isOk()`
     narrowing. Uses the TS compiler API; `.vue` script blocks extracted by
     regex with line-offset correction; missing typescript degrades per §4.
   - **MER-FE-041** (`info`, T1) — kebab-case `use-*.ts` composable filenames;
     house style is camelCase `useX.ts`.
   - **MER-FE-043** (`warn`, T1) — `useState(` outside `composables/` files;
     framework state is owned by a composable, consumers never touch the key.
   - **MER-BE-050** (`warn`, T1) — `Result.Validation(` in `Application/` code;
     shape validation is FluentValidation at the transport edge, use cases keep
     domain invariants only.
   - **MER-BE-051** (`warn`, brace-depth scan) — `record *Command`/`*Result`
     declared nested inside another type; house style is sibling records.
   - **MER-BE-052** (`warn`, T1) — `*ErrorDto` type declarations; the canonical
     error envelope is `ErrorResponse(Code, Message, Errors)`.
   - **MER-TE-002** (`info`, T1) — mock-density heuristic: >5 `Substitute.For<`
     / `vi.mock(` in one test file. Density is the smell, not presence —
     NSubstitute presence alone is never a finding.
   - **MER-TE-005** (`warn`, T1) — test-double classes named `Mock*`/`Stub*`;
     the vocabulary is `Fake*`/`InMemory*`/`Inline*`.
   - **MER-TE-006** (`warn`, T1) — colocated `__tests__/` dirs or spec files in
     an FE app tree; frontend tests live in top-level `tests/`.
   - **Runner change:** `detectPacks` now implements the §5 TE marker (test
     project / tests dir / spec files / TestSupport), which the table promised
     but the runner never detected — TE findings were silently pack-filtered.
   - DOC-REFs for the new rules point at prose sections added to the skill
     references in the same change (fork-winner sync, §10).

6. **v5 — BE-TS pack (MER-BT-001..005).** TS backends enforce the same PA/VSA
   doctrine; the framework is irrelevant because the triggers are plumb's own
   conventions (§5 BT marker: typed-inject, `*.port.ts`, or lowercase
   `application/ports/` dirs — the lowercase distinguishes TS from C#'s
   `Application/Ports`). Where the markers are absent, no rules fire.
   - **MER-BT-001** (`error`, AST-tier) — port files (anything under a
     lowercase `application/ports/` dir, or `*.port.ts` anywhere): every
     exported class is `abstract`, carries a `private constructor()`, and has
     only abstract methods — no fields, no non-abstract methods, no statics.
     Type/interface exports alongside are fine. Uses the TS compiler API
     (§4 degrade applies).
   - **MER-BT-002** (`error`, AST-tier) — adapters `implements` ports; a class
     `extends` a name imported from a `/ports/` path is a finding.
   - **MER-BT-003** (`warn`, T1) — vague file names in TS module trees:
     `default-*.ts`, `base-*.ts`, `*-interface.ts`. Adapters are named after
     the concrete implementation (`system-clock.ts`, `indexed-db-*.ts`).
   - **MER-BT-004** (`warn`, AST-tier) — scoped to typed-inject repos only:
     classes declaring `static inject` must mark it `as const`, and their
     constructor params must be `private readonly` promoted.
   - **MER-BT-005** (`warn`, T1) — vague type names in TS module trees:
     `*Service`, `*Interface`, `Default*`, `Base*` class declarations
     (`*.module.ts` Nest module classes exempt — framework-required).
   - Port file naming per §9.1 — originally "dir-based, `.port.ts` legal
     outside ports dirs"; SUPERSEDED 2026-06-11 by Max's no-suffix ruling:
     `.port.ts` is now a BT-003 finding. BT-001 still shape-checks `*.port.ts`
     files (shape and naming are separate sins).
   - Calibration targets: confer `packages/api` (inversify, abstract-class
     ports — the live target), plus any typed-inject repo found in the ~/Sites
     sweep. Both .NET baselines must be unaffected (BT must not fire on C#
     `Application/Ports`).

7. **v6 — config-sanitation pack (golden base configs).** plumb becomes the
   one-stop repo-sanitisation check: it carries canonical base config files in
   `configs/` and verifies scanned repos (1) have the file and (2) contain *at
   least* the golden settings, with the golden values — repos may extend, never
   contradict. Goldens are derived from the live common base across Max's repos
   (2026-06-10); tools.md's previous golden-example links pointed at waduno,
   which no longer exists on disk — plumb's `configs/` is now the durable home,
   and tools.md links here. eslint stays Vue-only: oxlint lints `.vue` script
   blocks natively but template-aware rules are still RFC-stage (verified
   2026-06-10, oxc-project RFC "Embedded Framework Support").
   - **Goldens:** `configs/oxlintrc.json` (correctness=warn, no-unused-vars,
     curly all), `configs/oxfmtrc.json` (printWidth 100, 2-space, semi, double
     quotes, trailingComma all, sortImports with the standard group order),
     `configs/editorconfig.dotnet` (the 116-line canonical, byte-identical in
     casebridge api + speechscribe today). No CSharpier golden — CSharpier is
     deliberately config-free; a repo-local `.csharpierrc` must not contradict
     `.editorconfig` (tools.md rule), but plumb checks only the wiring.
   - **MER-TO-002** (`warn`) — TS toolchain: repos with TS/Vue source and a
     package.json need `.oxlintrc.json` + `.oxfmtrc.json` (at root or app
     roots), each a superset of its golden; competing formatter/linter configs
     (`.prettierrc*`, `biome.json`) are findings. Superset semantics: every
     golden key-path must exist with the golden value; a golden scalar rule
     severity matches a repo `[severity, options]` tuple (confer's
     no-unused-vars shape); unparseable JSON is itself a finding.
   - **MER-TO-005** (`warn`) — eslint is the Vue layer only: repos with `.vue`
     files need an eslint flat config referencing the Vue layer
     (`@nuxt/eslint` / `eslint-plugin-vue` / `withNuxt`); an eslint config in
     a repo with no `.vue` files is a finding (oxlint owns non-Vue linting).
   - **MER-TO-012** (`warn`) — .NET style authority: csproj repos need
     `.editorconfig` (repo root or above the csproj) containing every golden
     section/key=value line, plus analyzers enabled
     (`EnforceCodeStyleInBuild` or `AnalysisLevel` in a csproj or
     Directory.Build.props).
   - **MER-TO-014** (`warn`) — CSharpier wired: csproj repos must reference
     csharpier in a csproj / `Directory.*.props` / `.config/dotnet-tools.json`.
   - All warn-severity; all self-gate on their stack markers (TO pack is
     always-on per §5). Goldens changing is a behavior change — amend this
     section and recalibrate.

8. **v7 — TS layer rules + delegated-ruling slices.** Two halves:
   - **v7a — BT layer/boundary rules** (the missing half of TS backend
     support; .NET parity for BE-001..005). One analysis pass
     (`MER-BT-010-layer-imports.mjs`) emitting three IDs, resolving
     RELATIVE imports only (non-relative specs are external or
     alias-mapped; skipped for precision):
     - **MER-BT-010** (`error`) — TS domain purity: `domain/` imports only
       its own module's `domain/`; also flags known framework imports in
       domain (`@nestjs/*`, `express`, `fastify`, `vue`, `typed-inject`,
       `inversify`).
     - **MER-BT-011** (`error`) — `application/` (or `app/`) must not
       import `infrastructure/` (or `infra/`).
     - **MER-BT-012** (`error`) — never cross; always common: module X
       (under a lowercase `modules/` dir) must not import module Y;
       `modules/common` is the sanctioned shared location.
     Layer dirs recognized: `domain`, `application`/`app`,
     `infrastructure`/`infra`, `interface`/`interfaces` (glyphantics
     abbreviates). Gated by the BT pack marker.
   - **v7b — mechanical slices of the §9.3–9.6 rulings:**
     - **MER-BE-060** (`warn`) — entity-config ownership per §9.4:
       `IEntityTypeConfiguration<T>` in module X configuring an entity
       declared in module Y's `Domain/` is a finding; configs living
       outside any module (centralised persistence dirs) are a finding.
     - **MER-TE-007** (`warn`) — `UseInMemoryDatabase(` in test code per
       §9.6.
     §9.3 (results vs exceptions) and §9.5 (transactionality/no-bus) ship
     as prose only — no mechanical slice is high-precision yet.

9. **v8 — Rivet variant awareness (v1/v2).** Rivet v2 (rivet + rivet-ts `v2`
   branches; `~/Sites/golden` branch `rivet-v2` is the migrated exemplar)
   changed the generated-artifact shape and the frontend result-handling
   convention. Four pieces:
   - **Variant detection** per §5 (fingerprints, `PLUMB_RIVET_VARIANT`,
     `checks/_lib/rivet-variant.mjs`). Regression guard in
     `test/runner.test.mjs` for the variant logic (the v4 detectPacks bug
     class: runner detects wrong → findings silently filtered/suppressed).
   - **Gating + v2 rules.** MER-FE-005/006 v1-gated per §5. MER-FE-003's
     specifier patterns cover both variants (v1 path-shaped specs + the
     detected v2 contracts package name; `import type`-only lines exempt —
     a component importing a DTO type is not calling a client).
     **MER-FE-007** (`warn`, AST-tier) is FE-006's v2 analogue: an awaited
     contracts-client `.GET/.POST/...` call whose result discards the error
     channel — destructuring that binds `data` but not `error`, or direct
     `.data` access on the awaited call expression. openapi-fetch returns
     `{ data, error, response }` and never throws on HTTP errors; taking
     `data` and discarding `error` silently maps HTTP failures to undefined.
     Golden's convention (capture the result, narrow on `result?.data`
     truthiness, `.catch(() => null)` for transport) is compliant — `data`
     and `error` are mutually exclusive, so a data-truthiness check IS the
     error check. Deliberately NOT mechanized (below the §7 precision bar):
     "every result must handle the error path" in general — requires flow
     analysis; and `.then()`-chaining — style, not doctrine, and golden's
     `.catch()` transport guard is a legitimate then/catch member. Also NOT
     ported to v2: MER-FE-005 has no v2 analogue (there is no `rivetFetch`
     runtime to leak; the facade's `client` is the intended import).
   - **MER-RV-026 supported-version tripwire** (RV pack, check script). The
     pack declares what it supports: `SUPPORTED_RIVET` in
     `checks/MER-RV-026-supported-version.mjs` —
     `{ dotnetMax: 0.35.x, tsMax: 0.11.x, v2DotnetMin: 0.35.0, v2TsMin: 0.11.0 }`.
     Generation cutoff: `Rivet.Attributes >= 0.35.0` / `rivet-ts >= 0.11.0`
     declare the v2 generation; below is v1-era (the v2 branches still sit at
     0.34.3/0.10.0 pre-release — bumping them is the release act). Declared
     versions read from `*.csproj` `Rivet.Attributes` PackageReference and
     `rivet-ts` in package.json dependency blocks; unparseable specs
     (`*`, `file:`, `workspace:`) are unknown and produce no finding. Emits:
     (a) `info` when a declared version is NEWER than the supported max ("RV
     pack written against Rivet <= X; repo declares Y — findings may be
     stale"); (b) `warn` when the artifact fingerprint generation and a
     declared version's generation disagree (v2 artifacts + v1-era
     Rivet.Attributes = golden's current state; fires until the package bump).
     **Policy: `SUPPORTED_RIVET` MUST be bumped — with a contract amendment
     here — whenever RV/FE rules are revised for a new Rivet release.** The
     constant is the pack's self-declaration of what its rules were written
     against; a stale constant makes the tripwire lie.
   - **Fixtures/self-test** per §8: positive AND negative per new/changed rule
     and per variant; FE-005/006 bad fixtures carry v1 artifacts; the v2-gate
     negatives live in the runner harness (adding v2 artifacts to FE-006's
     `good/` would skip the whole check and make the §7-exception cases pass
     vacuously). Verification exemplars: golden (v2 — RV-026 mismatch warn
     fires, FE-005/006 do not, pre-existing 6 TO warns persist, nothing else
     new) and a minimal v1-shaped fixture repo (v1 rules still fire).
   - **v8 continuation (2026-06-11, second pass): remaining v1-assuming rules
     audited for v2.**
     - **MER-RV-020** rewritten variant-aware (.sh → .mjs on the shared
       fingerprints): v1 dirs keep the header rule; v2 artifact dirs must
       contain ONLY `openapi.json` + `schema.d.ts` (the facade lives in
       `src/` — golden's shape), and `schema.d.ts` must carry its
       openapi-typescript header. A stray hand-written file in a v2 artifact
       dir is the same sin the v1 header rule catches.
     - **MER-RV-025** rewritten variant-aware: placement (under `packages/`)
       is enforced from the fingerprints, not path-name luck — a v2 artifact
       dir named anything, anywhere, is held to the same rule.
     - **MER-RV-021** audited, unchanged: golden's v2 facade deliberately
       keeps `configureRivet` as the bootstrap surface, so the once-per-app
       rule works under both variants as written.
     - **MER-RV-024** audited, unchanged, LIVE-VERIFIED under v2: golden's
       two-command generation task (Rivet.Tool → openapi-typescript) matches
       the existing `rivet … --output` heuristic, `task --dry` resolves the
       output dir, regeneration ran end-to-end with the tree restored
       byte-for-byte.
     - **MER-FE-015** explicitly NOT ported to v2 (FE-005 precedent): the
       port-mirrors-generated-client heuristic compares against v1 client
       module exports; the v2 facade is hand-authored, so "mirroring" it is
       not mechanically distinguishable from legitimately wrapping it.
     - **MER-FE-010** audited, unchanged: port-shape rules are
       variant-agnostic (no artifact assumptions).

## 12. Status and next steps (updated 2026-06-10)

### Done

- v1 + v2 + v3 shipped per §11. Implemented rule IDs (37):
  FE 001/002/003/004/005/010/011/012/015/020/021/022/030/031/032/033 ·
  RV 001/002/020/021/024 · BE 001/002/003/004/005/006/012/013/014/020/022/030/031 ·
  TO 001/010/011. Self-test: all 37 fixtures pass. Plus the v3a in-build mirror
  (MERBE001/002/005 Roslyn analyzers, `dotnet/test.sh` green, nupkg consumption
  verified from a local folder feed).
- v3 calibration (2026-06-10): FE-010 clean on both repos after the two encoded
  exceptions (desktop.ts ambient declarations + hand-written inject helpers) —
  fires nowhere, fixtures prove the mechanism (FE-021 precedent). FE-015 fires in
  neither repo. RV-024: speechscribe regeneration ran end-to-end, output fresh,
  working tree untouched; casebridge generation fails locally (unrestored
  packages) → stderr diagnostic + exit 0, the contract-correct degrade.
- ~/Sites sweep calibration (2026-06-10): plumb run against every other repo under
  `~/Sites/` (15 repos beyond the two baselines). Non-Meridian repos (PHP, plain
  packages) returned zero findings — convention-triggered activation holds. Three
  false positives found, all encoded per §7 the same session:
  - **MER-FE-010**: skips `/application/ports/` paths — BE-TS port territory
    (abstract classes, MER-BT-001's shape), reachable by an FE walk when
    nuxt.config sits at a workspace root (earned by confer's `packages/api`).
  - **MER-RV-021**: the once-count is per app (nearest ancestor with
    nuxt.config.*/package.json), not per repo — a monorepo with two frontends
    legitimately bootstraps twice (earned by the meridian repo: reel + perch-next).
  - **MER-RV-001**: test projects excluded — `[RivetClient]` in test fixtures
    exercises the attribute, it is not an API surface (earned by the Rivet
    framework repo; casebridge's 2 RV-001 warns are outside tests, baseline
    unchanged).
  Baselines re-verified after the fixes: speechscribe 5/4, casebridge 123/87,
  self-test all 37 fixtures pass. Known boundary, accepted: running plumb on the
  Rivet framework repo itself flags the tool's own sources (EndpointWalker.cs) —
  the framework that implements the convention is out of plumb's domain.
- The §9 amendment is now synced into the skill prose, and SKILL.md +
  SKILL_SMALL.md carry the §10 integration line ("run `~/.meridian/plumb/plumb .
  --json`, fix all error-level findings") — both done 2026-06-10.
- Calibration baseline recorded (after full v2, 2026-06-10):
  - speechscribe-azure: **5 errors / 4 warns** — 1× FE-001 (`recording-status.ts`),
    3× FE-032 (`pages/recordings/index.vue` reaching into `pages/index/`),
    1× FE-004 (`logic/summary-chat.ts` imports its port's `ChatMessage` type —
    type-only, but the layer order says ports import logic shapes, not the
    reverse); 1× FE-022 (`shared/composables/use-app-error-handler.ts` consumed
    only by plugins), 3× FE-031 (`shared/infrastructure/photino-{desktop,rpc}.ts`
    consumed only by the photino plugin; `shared/logic/auth.ts` only by
    pages/index). BE-001/002/006 all clean. All verified real.
  - casebridge: **123 errors / 87 warns** — v1 breakdown plus 1× FE-004
    (`pages/f/logic/resume-state.ts` imports value guards from
    `~/composables/usePublicFormFields` — pure guards living in a composable;
    the fix is moving them into logic/), 1× BE-001
    (`Workflow/Domain/RoutingEvaluator.cs` using `Forms.Application` — a Domain
    file reaching into a sibling's Application layer), 7× BE-006 warns
    (Forms-domain types `BranchCase`/`OutputMapping`/
    `PublishedFormFieldOptionSnapshot`/`SlugGenerator` parked in Common;
    `JwtOptions`/`AuthMethod` only used by Auth; `IAddressLookupService` port
    consumed only by its own module — premature promotion). v1 breakdown: 86×
    BE-003/004/005 cross-module usings (61 of those are old-doctrine-legal
    sibling-port references, i.e. the migration backlog created by the §9
    amendment, not new sloppiness), 17× BE-030 repositories injected into
    controllers, 7× FE-003, 4× FE-011, 4× FE-032, 2× BE-031, 1× FE-001,
    78× RV-002 (warn), 2× RV-001 (warn). No app/shared/ in casebridge's ui, so
    FE-022/031 are inert there.
  - FE-021 fires in neither repo — the injectX-capability qualifier keeps it
    quiet until a real bypass exists. Acceptable; fixtures prove the mechanism.
- Verified-real spot checks: FE-032 on both repos, BE-004 `Files` →
  `Submissions.Infrastructure` (illegal even pre-amendment — drift the repo's own
  arch tests miss), every v2 finding above checked by reading the import/using.
- **v4 SHIPPED + calibrated (2026-06-10), per §11.5.** Self-test: all 48
  fixtures pass. Four FPs found in calibration, all encoded same-session per §7:
  - **MER-RV-002**: `Program.cs` excluded — speechscribe's health/root
    endpoints have no contract to come from; inline handlers there are
    RV-008's territory.
  - **MER-FE-006** (two exceptions): calls already passing `unwrap: false` are
    compliant (try/catch around them is network handling — earned by
    speechscribe's use-access-groups.ts, 20 hits); only awaited calls are
    findings (sync client helpers like `loginUrl()` return no result to narrow —
    earned by use-rivet-auth.ts).
  - **MER-TE-006**: only app-tree paths scanned — with nuxt.config at a
    workspace root, sibling packages' test dirs (confer `packages/api/test/`)
    are BE-TS territory, not colocated frontend tests. casebridge's `ui/e2e/`
    specs also correctly out of scope (not colocated).
  - Verified-real spot checks: speechscribe's nested `Command`/`Result` records
    (BE-051, 39×), `ErrorDtos.cs` (BE-052), literal `[HttpDelete]` route in
    RecordingsController (RV-002); casebridge's `StubAddressLookupService`
    (TE-005), un-narrowed awaited client call in useAddressLookup (FE-006),
    and the app.vue/plugin `"app-booted"` key (FE-043 — the predicted target).
  - Sweep re-run over ~/Sites: non-Meridian repos stay quiet apart from
    doctrine-true TE/TO-style hits (acquire's `MockWayfinderMesh`, lagon's
    `StubAddressLookup`); rehd's `app/tests/` specs correctly flagged (top-level
    `tests/` is the rule); confer's `ui/state/feedback.ts` `useState` calls are
    true FE-043 findings under the no-state-dir ruling.
- **Post-v4 calibration baselines (2026-06-10, supersede the v2 numbers above):**
  - speechscribe-azure: **6 errors / 55 warns / 23 info.** New errors: 1× RV-002
    (literal `[HttpDelete]` route). New warns dominated by its losing forks:
    39× BE-051 nested records, 4× FE-006, 3× BE-052, 2× BE-050, 3× TE-005;
    23× FE-041 kebab composables (info).
  - casebridge: **224 errors / 111 warns / 17 info.** New errors: 79× RV-002
    (re-escalated), 22× RV-010 module-colocated contracts. New warns: 76×
    FE-006 unwrap-and-throw, 15× TE-006 colocated `__tests__`, 8× TE-005,
    2× FE-043, 1× RV-025; 17× TE-002 (info).
  Both repos moved as predicted — each sits on the losing side of the forks the
  other won. The casebridge error count (123→224) sharpens the §12.2 backlog
  question.
- **v5 SHIPPED + calibrated (2026-06-10), per §11.6.** Self-test: all 53
  fixtures pass (48 + 5 BT). Runner change: BT pack detection per the §5
  marker. TS port naming settled dir-based (§9.1, model-delegated; prose
  synced into backend-pa-vsa.md §TS naming the same change). Calibration:
  - **confer `packages/api`: zero BT findings** — abstract-class ports with
    private constructors throughout; the live target validates the rules by
    being clean (FE-021 precedent: fixtures prove the mechanism).
  - **rivet-ts: 6 errors, all verified real** — three `protected constructor()`
    ports (BT-001) and their three `extends`-instead-of-`implements` adapters
    (BT-002), a coupled pair: fixing the ports to private forces the adapters
    to implements. rivet-ts uses application/ports for its own architecture, so
    it is in-domain (unlike the .NET Rivet framework repo's EndpointWalker
    boundary, which is about the framework's own API surface).
  - **perch-next (typed-inject): 5 findings** — 1× BT-004 (constructor arg
    manually assigned to a field — the doctrine's avoid-list verbatim), 4×
    BT-005 (`PetStateMachineService`-style names). perch, glyphantics,
    coingroup add 5 more BT-005s (`BitcoinApiService implements
    BitcoinApiServiceInterface` is the canonical double violation).
  - Both .NET baselines byte-stable (casebridge 224/111/17, speechscribe
    6/55/23) — the lowercase `application/ports` path test keeps C# out of BT
    scope. Zero FPs this calibration; no new encoded exceptions needed.

- **Test hardening (2026-06-10), per the §8 additions.** Two gaps closed:
  - **FP-regression fixtures**: every §7-encoded exception now has a matching
    case in its rule's `good/` fixture (previously only BE-020 and FE-006's
    unwrap:false case were covered). Added: FE-006 sync-call, FE-010
    declare/inject-helper/application-ports (desktop.ts + clock.ts), FE-031
    zero-consumer + useProvideInject, RV-001 test-project, RV-002 Program.cs,
    RV-021 two-app monorepo, TE-006 non-app-tree spec, BE-006
    Exception-suffix + interface-file DTO, RV-020 `.d.ts`. The subtle ones
    (RV-002, RV-021, BE-006, FE-010) were but-for verified: removing the
    exception trigger from a copy makes the rule fire, proving each case sits
    on the exception boundary rather than passing vacuously.
  - **Runner harness** `test/runner.test.mjs` (node:test, no deps, no mocks —
    plumb invoked as a subprocess against temp repos assembled from fixtures):
    exit-code contract incl. `--fail-on`, pack gating both ways for FE/BE plus
    detection for TE/BT/RV (the v4 detectPacks bug class), `--rule`/`--pack`
    filters, `--json` shape, per-producer §3 line-format + bad/good behavior
    for all 36 check scripts, and §4 degradation (AST check with unresolvable
    typescript → stderr + exit 0 + no findings). 58 tests green; self-test
    still 53/53; all three calibration baselines byte-stable
    (casebridge 224/111/17, speechscribe 6/55/23, confer 9/3/0).

- **v6 SHIPPED + calibrated (2026-06-10), per §11.7.** Golden base configs in
  `configs/` (oxlintrc.json + oxfmtrc.json derived from the live common base
  across all five oxlint repos; editorconfig.dotnet crowned from the
  casebridge/speechscribe byte-identical canonical). Four rules:
  MER-TO-002/005/012/014. Self-test 57/57; harness 62/62 (new producers
  auto-covered). Calibrated across 17 repos; two FPs, both encoded per §7
  with §8 good-fixture cases:
  - **MER-TO-012**: severity-TIGHTENING is compliant (reel's `.editorconfig`
    sets error where golden says warning — that's adherence, not drift).
    Handles pure (`warning`) and suffixed (`file_scoped:warning`) forms.
  - **MER-TO-005**: Vue-ness judged per config subtree, not per repo
    (coingroup: coinwatcher-api's eslint sat beside a Vue sibling and was
    blamed for the wrong reason).
  Everything else verified real: confer's empty `.oxfmtrc.json` (7 golden
  gaps), speechscribe missing oxfmt/eslint-layer/analyzers/CSharpier,
  glyphantics+acquire still on prettier, lagon/HPA `.editorconfig` 7
  naming-rule lines behind golden, CSharpier unwired everywhere except
  casebridge (dotnet tool manifest, the true negative that validated the
  check). tools.md golden-example links pointed at waduno, which is gone from
  disk — links now point at plumb `configs/`; prose synced
  (§Linting-and-formatting base-config rule, §Formatting-and-analyzers).
- **Post-v6 calibration baselines (2026-06-10, supersede post-v4 above):**
  casebridge 224e/112w/17i · speechscribe 6e/59w/23i · confer 9e/11w ·
  rivet-ts 6e (unchanged — TS toolchain fully compliant) · perch-next 0e/8w ·
  perch 1e/4w · glyphantics 3e/5w · coingroup 0e/4w.

- **v7 SHIPPED + calibrated (2026-06-10), per §11.8 and §9.3–9.6.** Self-test
  62/62; harness 65/65. v7a: BT-010/011/012 from one relative-import analysis
  pass; §5 BT marker extended to layer-shaped TS trees (without it,
  glyphantics' 5 real BT-010 findings — `domain/*.service.ts` importing
  `@nestjs/common` and infrastructure — were pack-filtered into silence). One
  FP, encoded per §7 with a §8 fixture case: `*.module.ts` files are Nest
  composition roots, exempt from BT-012 (earned by glyphantics
  `game.module.ts`). confer and rivet-ts layer-clean (verified non-vacuous by
  planting violations in a temp copy — both fired). v7b: BE-060 fires nowhere
  (casebridge's colocated entity configs are already the golden shape);
  TE-007 confirmed 5 files in cohort (per-file dedupe — per-call was noise).
  The §9.3/§9.5 rulings (results-vs-exceptions, one-transaction/no-bus) are
  prose-only by design. rivet-ts baseline moved 6e→4e independently — Max's
  rewrite fixed one port pair (repo drift, verified via git log, not a rule
  change).
- **Post-v7 baselines:** casebridge 224e/112w/17i · speechscribe 6e/59w/23i ·
  confer 9e/11w · rivet-ts 4e · perch-next 0e/8w · glyphantics 8e/5w (3
  TO-001 + 5 BT-010) · cohort +5 TE-007 warns · coingroup 0e/4w.

- **v8 SHIPPED + verified (2026-06-11), per §11.9.** Rivet variant awareness:
  `checks/_lib/rivet-variant.mjs` (fingerprints + contracts-package-name
  derivation), runner exports `PLUMB_RIVET_VARIANT` and adds RV on any
  fingerprint (runner at 160 lines — detection logic lives in _lib).
  MER-FE-005/006 v1-gated; MER-FE-003 rewritten variant-neutral
  (.sh → .mjs, both specifier families, `import type` exempt); MER-FE-007
  (v2 result-shape) and MER-RV-026 (SUPPORTED_RIVET tripwire) added.
  Self-test 64/64; harness 70/70 (three new variant regression-guard tests
  incl. RV-pack detection from the v2 fingerprint alone). Verification:
  golden (rivet-v2 branch) = exactly the RV-026 mismatch warn (Rivet.Attributes
  0.34.3 vs v2 artifacts) + the 6 pre-existing TO warns; FE-005/006 suppressed,
  FE-007 clean (golden's result?.data narrowing is the compliant shape).
  Minimal v1-shaped repo: FE-003/005/006 all fire under the v1 fingerprint.
  Baselines byte-stable: casebridge 224e/112w/17i (FE-003 still 7×, declared
  `Version="*"` is unknown → no RV-026), speechscribe 6e/59w/23i (0.34.3 +
  v1 artifacts = consistent → no RV-026).

- **Scaffolder-plan D1 encoded (2026-06-11).** Max settled the five
  rivet-ts scaffolder-plan decisions (`~/Sites/medway/rivet-ts/SCAFFOLDER_PLAN.md`);
  D1 = `.handler.ts` joins the §9.1 banned tag family. §9.1 amended, MER-BT-003
  extended, bad/good fixture pair added (`get-quote.handler.ts` /
  `quotes-routes.ts` — golden's suffix-free routes idiom), FABLE_CHECKS +
  backend-pa-vsa synced. Calibration sweep: zero hits in casebridge /
  speechscribe / glyphantics / golden; only rivet-ts `samples/myapp` (scaffold
  output — the plan's own target). Baselines untouched. Gates: self-test 64/64,
  harness 73/73.

- **Decisions batch actioned (2026-06-11).** §9.1 vetoed→replaced (no-suffix
  ruling; BT-003 extended to the tag family — 39 new findings across 6 repos,
  all true, zero FPs); §9.3 gained the FluentResults blessing (furniture-tier,
  prose in backend-pa-vsa + coding-philosophy §Furniture Dependencies); §9.7
  SPA assumption and §9.8 tests-exempt-from-purity added; testing-philosophy
  gained the fake-the-port-never-the-database corollary; SKILL.md +
  SKILL_SMALL.md Core Rules carry the new one-liners. **`--baseline` ratchet
  shipped** per §5: count-per-(rule,path), `--write-baseline` to generate,
  suppressed count always visible, shrink prompts a re-write; 3 harness tests;
  live-proven on casebridge (353 findings → 0 actionable, exit 0; a planted
  new violation still fails). Deliberately NOT built: auto-discovery,
  suppression comments, per-rule config — the mini-PHPStan line.

- **v8 continuation SHIPPED (2026-06-11), per the §11.9 second-pass bullet.**
  plumb is now a git repo (initial commit = full v1–v8 state; this work on
  branch `v8`). RV-020 + RV-025 variant-aware rewrites with v2 fixture cases
  (RV-020 bad: smuggled `helpers.ts` + headerless schema in an artifact dir;
  RV-025 bad: artifact dir inside `apps/ui/`); RV-021/RV-024/FE-010 audited
  unchanged (RV-024 live-verified under PLUMB_CI=1 against golden); FE-015
  recorded not-ported. Self-test 64/64; harness 73/73. Calibration: golden
  shows exactly RV-026 + 6 TO + 3 BT-003 (the `.use-case.ts` files in
  `apps/api-ts` — true under the §9.1 no-suffix ruling, golden's TS-backend
  migration backlog); casebridge 224/112/17 and speechscribe 6/59/23
  byte-stable.

- **MER-RV-026 redefined (2026-06-16), v1 detector (supersedes the §11.9 v8 tripwire).**
  Max's ruling: the only thing this rule should detect is "you're on Rivet v1 — migrate to
  the v2 (openapi-typescript) generation." The v8 design conflated *patch version* with
  *generation* — it fired an `info` whenever a declared version exceeded the `dotnetMax`
  patch ceiling (0.35.x), so every routine v2 minor bump (0.36, 0.37, …) cried "stale"
  though the RV/FE rules key off generation, not patch line, and nothing was actually stale.
  Removed: the patch-ceiling `info` and the artifact-fingerprint mismatch `warn` (and the
  `rivet-variant` import). Kept: a single `warn` when a declared Rivet is **below the v2
  floor** (`Rivet.Attributes` < 0.35.0 / `rivet-ts` < 0.11.0). The whole v2 generation
  (≥ floor) is supported; minor bumps never flag; unparseable specs never flag. The old
  "bump `SUPPORTED_RIVET` on every release" policy is retired — there is nothing to chase
  within a generation; the floor only changes when Rivet ships a new *generation*. Fixtures
  rewritten (bad: 0.34.3 + rivet-ts 0.10.0; good: 0.35.0/0.37.0/`*`). Self-test 65/65.
  Calibration: ot-rota + speechscribe (both Rivet.Attributes 0.37.0) now clean; golden's
  rivet-v2 branch (0.34.3) correctly flags "migrate". FABLE_CHECKS updated both skill homes.

- **MER-BE-053 shipped (2026-06-16), use-case-return-shape.** A use case's
  `Execute`/`ExecuteAsync` returning a transport-shaped `*Response`/`*Dto` (application
  coupled to the published HTTP contract) is a `warn`: return a domain type or `*Result`
  and map at the edge, or drop the use case if it only maps. Scope mirrors BE-022
  (`*/Modules/*UseCase.cs`); the return-type suffix is the tell (BE-052 precedent — no
  type graph needed). DOC-REF `backend-pa-vsa.md#commands-and-results`. Self-test 65/65.
  Calibration: casebridge 1× (`GetCurrentUserUseCase` → `AuthUserDto`, verified real),
  speechscribe clean (27 UCs return `*Result`) — 1 TP / 0 FP. Deliberately out of v1: the
  wrapped variant (a `*Result` whose properties are `*Dto`s) needs field-type inspection
  and is lower-precision. FABLE_CHECKS updated both skill homes.

### Next steps, in order

1. ~~Build the v4 rule pack~~ — **DONE 2026-06-10** (§11.5 and the calibration
   record above). All ten settled forks are enforced, the prose is synced, both
   baselines recalibrated.
2. **Decide the casebridge backlog strategy.** Now 224 errors (was 123 — RV-002
   re-escalation and RV-010 added ~101) will drown the small-AI
   loop on day one. Options: (a) fix-forward campaign (the 86 cross-module findings
   are mostly mechanical port moves to Common/Ports), or (b) add a baseline/ratchet
   mechanism to plumb (`--baseline file` that suppresses known findings and fails
   only on new ones). (b) is a behavior change — amend §5 before building it.
3. **Distribute Meridian.Analyzers** (Max's call): push `dotnet/nupkg/` to a real
   feed (or keep the local folder feed) and add the `PackageReference` to the
   next fresh .NET repo's `Directory.Build.props`. The package is built and
   verified (§11.4); only the publishing decision remains.
4. **Wire `plumb . --ci` into the repos' CI pipelines** so MER-RV-024 actually
   runs where builds are restored (locally casebridge can't build, so the check
   degrades to silence there).
5. ~~v5 candidate: the BE-TS pack~~ — **DONE 2026-06-10** (§11.6 and the
   calibration record above). TS backends are now supported; the framework-
   arbitrariness worry dissolved as predicted — the triggers are plumb's own
   conventions, and the calibration proved it across inversify (confer, clean),
   typed-inject (perch-next, real findings), Nest (glyphantics), and standalone
   (rivet-ts).

### Decisions log (2026-06-11, Max)

All five §9 delegated rulings blessed; §9.1 vetoed-and-replaced with the
stronger no-suffix ruling. FluentResults blessed as the canonical .NET result
type (furniture-tier dependency). Frontends are SPAs (§9.7). Tests exempt from
purity (§9.8 — closes the old FE-001 open question). `--baseline` approved
(6b, "if it becomes a mini-PHPStan, don't"). Deferred by Max: Connectors
dissolution and refactoring generally ("another day"), Meridian.Analyzers
feed (stays local), CI wiring, `meridian init` (needs more thought — the
rivet-ts scaffolder was already half-trying to be this), long-tail rules
(demand-driven), any fixer tier (never).

### Decisions log (2026-06-12, Max)

§9.10 added: module-local HTTP edge (rivet HANDOVER decision D1) —
`modules/<m>/<m>-routes.ts` + `<m>-validation.ts` + `<m>.module.ts` (where
wiring exists); top-level `src/interface/` is dead in TS backends. Prose-only;
backend-pa-vsa.md §File naming synced the same change. The rivet-ts scaffolder
emitters and lifecycle gates moved to the new shape in the same batch.

### Open questions

(none — both prior entries resolved 2026-06-11: baseline shipped per §5;
FE-001 test exemption made permanent per §9.8)
