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
- The .NET 10 SDK on `PATH`, and `pnpm build:csharp` run once after install, for the rules that read C# facts. Without either, those rules are skipped and the run is degraded.

## Install

Install Plumb's Node dependencies and build the C# facts tool:

```sh
pnpm install
pnpm build:csharp
```

`pnpm build:csharp` also restores the fixtures of the rules that read C# facts, which needs nuget.org the first time (for `Microsoft.NET.Test.Sdk` and its dependencies).

Each runtime dependency has one job:

- `typescript`: TypeScript and JavaScript parsing, tsconfig loading, and module resolution.
- `@vue/compiler-sfc`: Vue single-file component extraction.
- `dependency-cruiser`: frontend dependency graphs.
- `fast-xml-parser`: `.csproj` and `Directory.Build.props` parsing.
- `ignore`: `.plumbignore` and `--exclude` matching.
- `yaml`: CSharpier YAML config, read for comment widths, and key positions and duplicate keys in `.plumb-modules.json`.
- `picomatch` and `braces`: CSharpier override and `.editorconfig` section globs.
- `@dagrejs/graphlib`: module dependency loops.

If `typescript`, `@vue/compiler-sfc`, or `dependency-cruiser` is missing, only the rules that need it are skipped, with a diagnostic. The other six are required.

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

### Module order

Module dependencies run one way, and which way is a fact about the domain that no graph can show. A repository writes those facts in `.plumb-modules.json` at its root, beside `.plumbignore` and `.plumb-baseline.json`: a map from a module to the modules it depends on, each with its reason.

```json
{
  "modules": {
    "Cases": {
      "Submissions": "a Case is made from a submission and keeps its id",
      "CaseTypes": "a typed Case's stages, statuses, and permissions come from its pinned Case type version"
    },
    "Submissions": { "Forms": "a submission answers one pinned form version" }
  }
}
```

Each entry is one claim: the module can't keep its rules without the other. A module may depend on what it claims, and through those claims on what they claim; modules with no claim between them stay unordered. The claims apply in every backend root. Edit the file by hand, one claim and its reason at a time, since the reason is what a reviewer checks. A claim may run ahead of the code, and Plumb never writes the file.

Plumb reads the edges from what the compiler binds: a using, a name however it is written or inferred, a type of code outside the modules (host, transport-contract, or `Common/`) that a module uses and that uses another module, and a table mapped by name. The persistence root's type is no route, because meridian allows it. A module that calls one of its members that reads another module's data is. Each finding names one reference and what to do about it:

- `MER-BE-061`: a reference against the claims, because the other module claims, directly or through other claims, to depend on this one.
- `MER-BE-062`: a reference inside a loop the claims don't explain. It is a question: if the module can't keep its rules without the other, add that claim with its reason; if not, replace the reference with a consumer-owned required port bridged at the host.
- `MER-BE-063`: the claims file is wrong, with what happens to the claim: a misspelt or unknown module name, a claim on itself, an empty reason, a duplicate key, claims that loop, or text that isn't the shape above.
- `MER-BE-064`: a module maps another module's table with `ToTable`, `ToView`, or `[Table]`, or two modules both own one. That mapping is also an edge in the graph.
- `MER-BE-065`: a reference outside any loop that no claim covers, in a repository that has a claims file. It is the same question as `MER-BE-062`: add the claim with its reason, or replace the reference with a consumer-owned required port bridged at the host. A repository with no claims file gets only the loops.

There is one finding per edge and file, at the file's first reference. A loop is a gap, so no decision record stands in for its fix; a repository that holds a finding open does it with a hand-made baseline entry and a tracked fix.

## What it doesn't do

- **Most C# is read without compiling.** Those checks mask comments and literals while keeping offsets, then apply structural checks for house conventions. Only the rules that decide what a name refers to read Roslyn (see [How C# is read](#how-c-is-read)).
- **.NET projects are parsed, not evaluated, outside the C# facts tool.** Plumb reads project XML and models ownership, project and package references, test evidence, and the nearest inherited `Directory.Build.props`. Only the C# facts tool loads projects with `MSBuildWorkspace` and runs MSBuild evaluations.
- **TypeScript and Vue get real parsers.** Those rules use the TypeScript compiler API and the Vue SFC compiler. Frontend graph rules use dependency-cruiser, with compiler-backed import extraction for a component dependency-cruiser can't parse.
- **A wired port isn't proven reachable.** `MER-FE-046` reports a port pair whose `injectX` is used in app code while its `provideX` is used nowhere outside tests, and the reverse. A side is used by any reference to its name outside an import or export: a call, a value alias, or a call in a template expression. An orphaned inject is an error inside a Nuxt app, since it throws at runtime, and a warning for a pair no Nuxt app owns, since its host application may provide it; an orphaned provide is a warning. It asks only whether each side is used anywhere in the repository. It doesn't check that the provider is an ancestor of the injector, so a pair provided in one page and injected in another passes and still throws. It follows imports, renames, namespace imports, and re-exports across relative paths and Nuxt's `~` and `@` aliases, and a name reached through a specifier it can't resolve, such as a workspace package or a tsconfig path, is matched by the names the repository's own modules export the pair under.
- **Rivet rules read the OpenAPI output only.** A generated folder is one that holds `openapi.json` and `schema.d.ts`.

### How C# is read

The rules that decide what a name refers to read Roslyn, through `dotnet/Plumb.CSharpFacts`. They are the module-boundary rules (MER-BE-003 to 005), the module rules (MER-BE-061 to 065), MER-BE-001, 002, 006, 007, 009, 016, 018, and 066, and MER-RV-003, 007, 011, and 027. Roslyn gives them every type each file uses, however its name is written or inferred, each type's base types, and each EF `ToTable`/`ToView`. Types from outside the repo are seen only where a rule judges them: the framework namespaces of MER-BE-001 and 002, any type with an `Application` or `Infrastructure` segment in its name, and `System.IServiceProvider`, and never inside EF migrations code. These rules need the .NET 10 SDK and every project restored, test projects included; without them the run is degraded. They see what the compiler binds, so they don't see a dependency made by reflection or a name in a string. The strings they read are table names given as constants to `ToTable`, `ToView`, or `[Table]`, and the tables in the EF migrations snapshot. In a repo with no migrations snapshot, a table EF names by convention has no owner, so another module mapping it isn't caught: only running the repo's own EF model would name it. A call through a virtual member depends on the member the compiler binds, not on an override, so an override in the persistence root routes nowhere. A file outside every project isn't compiled, so they don't read it.

Loading a project runs its design-time build, as an IDE does when it opens the project, so the MSBuild targets the project's packages and the repo hook into compilation run, `<Exec>` included, and the build's output goes where the project puts it, `obj/` and `bin/` as a rule. So a checkout that was never built has to be writable. A build step that writes in the project folder still writes there. The usual case is Reqnroll, a test package that generates a C# class from each `.feature` file: it writes each `.feature.cs` beside its `.feature` file unless the project sets `ReqnrollUseIntermediateOutputPathForCodeBehind` to `true`, which puts it under `obj/`.

The rules that read Roslyn read a project under each of its target frameworks, and the facts are the union. A type's kind, namespace, and containing type are the first framework's, except that a type that is an interface under any framework reads as one; a type whose namespace or containing type differs by framework (a namespace `A.B` holding `C` under one, a class `B` in `A` holding `C` under another) makes the run degraded, naming the first such type, because a rule can misjudge it. A project whose code doesn't compile as Plumb loads it gets no facts, and the run is degraded, naming the first compiler error. That's what a stale restore, a `<Reference>` or generator whose file is missing, or a generator or referenced project that hasn't been built comes to, so run `dotnet build` first, in the configuration the run reads: the project's default, or `Configuration` from the environment. A file `.plumbignore` leaves out still counts, as it's compiled into the project. Two shapes stay unbound however often the project is built: a build step that adds code only outside what a design-time build runs, and a reference to a multi-target project whose frameworks share one output or intermediate path. Such a project stays degraded, and the run names what doesn't bind, as Plumb can't read that code without running the real build. A restore that's out of date but leaves every name bound changes nothing these rules read, and isn't reported. A warning the project promotes to an error doesn't count. The tool doesn't read generated files in the folders a project builds into unless they're in Plumb's file inventory, which in a git repo means git doesn't ignore them, and the rules skip any file under a folder named `obj` or `bin` whatever the inventory says, so keep `obj/` and `bin/` in `.gitignore`.

## Also in the box

- [`dotnet/Plumb.CSharpFacts/`](dotnet/Plumb.CSharpFacts): the C# facts tool the Roslyn-backed rules read.
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
