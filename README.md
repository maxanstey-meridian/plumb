<h1 align="center">Plumb</h1>

**An architecture rule is only real when a machine checks it.**

Plumb checks a repository against Meridian's house rules for .NET, TypeScript, Nuxt, and Vue code. It builds one model of the repository per run, then runs its rules over shared TypeScript, Vue, C#, .NET project, configuration, and dependency-graph analysis. Every finding names the rule it broke: under `--json`, a `docRef` such as `rules/backend/never-reach-into-another-modules-internals.md`, a file under the `references/` folder of the `meridian` skill in [workflow-skills](https://github.com/maxanstey-meridian/workflow-skills).

It sits where a folder of lint configs and a review checklist would, but the checks know the house layout: modules, ports, adapters, and generated contracts. It's a policy checker shaped around Meridian conventions, not a compiler and not a general static-analysis framework. When an analysis it needed is incomplete, it says so, and under `--ci` it exits 2 instead of passing.

## Prerequisites

- Node.js 20 or newer.
- pnpm 11, pinned by `packageManager`.
- Git, for the file inventory. Outside a Git repository Plumb walks the filesystem instead.
- [ast-grep](https://ast-grep.github.io/) on `PATH`, for the YAML rules. Without it those rules are skipped with a diagnostic.
- go-task (`task`) and the target repository's own toolchain, only for the `--ci` check that regenerates Rivet output. Rivet is the generator that turns C# routes into an OpenAPI document and a typed client.

## Install

```sh
pnpm install
```

Each runtime dependency has one job:

- `typescript`: TypeScript and JavaScript parsing, tsconfig loading, and module resolution.
- `@vue/compiler-sfc`: Vue single-file component extraction.
- `dependency-cruiser`: frontend dependency graphs.
- `fast-xml-parser`: `.csproj` and `Directory.Build.props` parsing.
- `ignore`: `.plumbignore` and `--exclude` matching.
- `yaml`: CSharpier YAML config, read for comment widths.
- `picomatch` and `braces`: CSharpier override and `.editorconfig` section globs.

If `typescript`, `@vue/compiler-sfc`, or `dependency-cruiser` is missing, only the rules that need it are skipped, with a diagnostic. The other five are required.

## What it checks

Rules come in packs, one per area. Plumb detects which packs a repository needs and runs only those.

| Pack | Covers |
|---|---|
| `BE` | .NET backend architecture |
| `BT` | TypeScript backend architecture |
| `FE` | Nuxt and Vue frontend architecture |
| `RV` | Rivet contracts and generated output |
| `TE` | Testing architecture |
| `TO` | Repository tooling |
| `CP` | Rules that cross packs, such as each module's `INVARIANTS.md` |

Most rules run in process. ast-grep runs the declarative syntax rules in `rules/`, and two checks in `checks/` run as their own processes.

## Run it

```sh
./plumb /path/to/repo
```

Each finding is one tab-separated line (rule, severity, location, and message), and the last line is the summary:

```text
MER-BE-005	error	api/Modules/Auth/Domain/UsesFormsContract.cs:1	module Auth Domain must not use Forms.Contracts — published contracts are for Application and integration consumers

plumb: 1 error, 0 warn, 0 info
```

`--json` prints the same findings as an array, each with its `docRef`:

```json
{
  "rule": "MER-BE-005",
  "severity": "error",
  "location": "api/Common/GlobalUsings.cs:1",
  "message": "module outside module must not use Forms.Application internals — publish a contract under Forms.Contracts or define a consumer-owned required port",
  "docRef": "rules/backend/never-reach-into-another-modules-internals.md"
}
```

Options:

```sh
./plumb /path/to/repo --json
./plumb /path/to/repo --fail-on warn
./plumb /path/to/repo --pack FE,BE
./plumb /path/to/repo --rule MER-BE-005
./plumb /path/to/repo --exclude fixtures/ --exclude coverage/
./plumb /path/to/repo --ci
./plumb /path/to/repo --profile
```

- `--pack` picks the packs yourself, and `--rule` runs one rule whatever packs were detected.
- `--ci` adds the checks that run the target repository's own toolchain.
- `--profile` writes phase timings, selected rules, shared-analysis counters, external run timings, and capability start-up to stderr. Findings are unchanged.

A check never leaves source changed. The `--ci` freshness check regenerates Rivet output from a snapshot and restores it before returning; only `--write-baseline` writes a file.

### Exit codes

- `0`: no finding at or above `--fail-on` (default `error`) after the baseline, or a baseline written.
- `1`: at least one finding at or above `--fail-on`.
- `2`: a usage error (an unknown or incomplete option, an invalid value, conflicting baseline options, no repository root or more than one, or a root that doesn't exist), a rule catalogue that can't load, an unreadable baseline, a failed scan, a refused `--write-baseline`, or a degraded `--ci` run, even one that also has findings.

### Degraded runs

A run is degraded when an analysis it needed is incomplete. Either an engine was missing or failed (ast-grep, a check script, or a dependency such as TypeScript), so its rules report nothing, or a rule ran on partial input and can miss findings. The common partial case is a `tsconfig.json` that extends a package which isn't installed: its path aliases stay unresolved, so the import rules can't follow aliased imports.

stderr names each cause, and the summary line ends `— degraded: N analyses incomplete (see above)` (`1 analysis` for one). Under `--json` only the stderr lines say so. A degraded run exits by its findings locally and exits 2 under `--ci`.

### Which files are scanned

In a Git repository, Plumb scans tracked files and visible untracked files from `git ls-files`; Git-ignored paths are out. Outside Git, it walks the filesystem once and skips the standard build and dependency directories.

A `.plumbignore` at the repository root adds lasting exclusions in gitignore syntax, negation included. Each `--exclude <pattern>` adds one for this run, applied after `.plumbignore`.

Every rule engine and check process gets the same file list. A finding on a file outside it is discarded. A finding on a directory, or on a file that doesn't exist (a missing required file, say), is kept, even under an excluded path.

### Baselines

A baseline is a file of known findings, so a run fails only on new ones:

```sh
./plumb /path/to/repo --write-baseline /path/to/repo/.plumb-baseline.json
./plumb /path/to/repo
```

A `.plumb-baseline.json` at the repository root applies by itself. `--baseline <file>` uses another file, and `--no-baseline` reports every finding.

With a baseline, the summary line gains ` (+B baselined by FILE, baseline holds T)`; under `--json` a stderr line says the same. When an entry the run checked didn't come back, the baseline has shrunk, and the line adds ` — shrunk; re-run with --write-baseline=FILE to ratchet down` (`in place of --baseline` when you passed `--baseline FILE`). FILE is the path that works from your current directory, quoted for a POSIX shell when it needs it, and joined with `=` so a name starting with `=` or `-` still pastes back as one argument.

`--write-baseline` replaces only what the run checked:

- Entries for a rule that ran are replaced, at any path except a file `--exclude` left out.
- On a run narrowed by `--rule`, `--pack`, or `--exclude`, or one without `--ci`, entries for the rules that didn't run and the files `--exclude` left out are kept.
- A file hidden by a lasting exclusion (Git's ignore rules, the fallback's skipped directories, or `.plumbignore`) can never be reported, so a write drops its entries and they count toward a shrink.
- An entry at a directory or a missing file is always checked, since a finding there is never hidden.
- A degraded run refuses to write and exits 2, because it would drop entries for findings it missed. A baseline that exists but can't be read also exits 2 and is left untouched.

## What it doesn't do

- **C# is read without compiling.** The C# checks mask comments and literals while keeping offsets, then apply structural checks for house conventions. There is no Roslyn semantic analysis.
- **.NET projects are parsed, not evaluated.** Plumb reads project XML and models ownership, project and package references, test evidence, and the nearest inherited `Directory.Build.props`. It runs no MSBuild evaluation, follows no arbitrary imports or conditions, and builds no `MSBuildWorkspace`.
- **TypeScript and Vue get real parsers.** Those rules use the TypeScript compiler API and the Vue SFC compiler. Frontend graph rules use dependency-cruiser, with compiler-backed import extraction for a component dependency-cruiser can't parse.
- **Rivet rules read the OpenAPI output only.** A generated folder is one that holds `openapi.json` and `schema.d.ts`.

## Also in the box

- [`dotnet/Meridian.Analyzers/`](dotnet/Meridian.Analyzers): an optional Roslyn analyzer that rejects the module-boundary breaks at build time. It has its own test harness (`dotnet/test.sh`) and isn't a mirror of the Node rules.
- [`configs/`](configs): the canonical `.editorconfig`, oxlint, and oxfmt settings the tooling rules compare a repository against.
- [`fixtures/`](fixtures): a `bad` and a `good` repository for every rule, which define what each rule accepts.

### How it's laid out

One scan makes a repository snapshot that reads each file once and remembers text, line maps, JSON, configuration, TypeScript sources, Vue blocks, C# masks, project XML, and graph results for that run.

- `plumb`: CLI parsing, pack and rule selection, orchestration, baselines, rendering, and profiling.
- `lib/engine/`: the snapshot, capability planning, shared analysis services, dispatch, and finding validation.
- `lib/in-process-rules/`: the built-in rule families.
- `rules/`: the ast-grep YAML rules.
- `checks/`: the two checks that run as their own processes. `MER-FE-003` is the last manifest-backed frontend check. `MER-RV-024` is isolated on purpose: it runs the target repository's generation task, compares the output, and restores the original files.
- `test/`: the engine, runner, catalogue, inventory, degradation, and fixture contracts.

### Check Plumb itself

```sh
./plumb --self-test
```

This runs every fixture pair through the full CLI, in under a minute. It exits 1 when any fixture fails, including one reported as `ERROR`, and 0 when all pass.

```sh
node --test "test/*.test.mjs"
```

This is the full suite and takes a couple of minutes. It needs the `meridian` skill installed, because the catalogue test checks every `docRef` against the skill's rule files. It reads them from `MERIDIAN_REFERENCES` when set, else `~/.claude/skills/meridian/references`.

## Documentation

[Contributing](CONTRIBUTING.md) (the rule API, capability model, finding contract, and fixture workflow) · [Meridian rules](https://github.com/maxanstey-meridian/workflow-skills) · [Limits](#what-it-doesnt-do) (what it deliberately doesn't do)
