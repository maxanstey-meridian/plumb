# Plumb

Plumb is Meridian's multi-language architecture and tooling policy checker.

It builds one invocation-scoped model of a repository, then runs rule families over shared TypeScript, Vue, C#, .NET project, configuration, and dependency-graph analysis. Most rules execute in process; ast-grep handles declarative syntax checks, and two checks still execute as isolated producers.

Check mode does not retain source changes. `--write-baseline` writes the requested baseline, while the CI-only freshness check temporarily regenerates output from a snapshot and restores it before returning.

## Scope

Plumb mechanically enforces selected Meridian doctrine across these packs:

- `BE`: .NET backend architecture
- `BT`: TypeScript backend architecture
- `FE`: Nuxt/Vue frontend architecture
- `RV`: Rivet contracts and generated artifacts
- `TE`: testing architecture
- `TO`: repository tooling
- `CP`: cross-pack rules

Pack detection limits the default scan to relevant rules. `--rule` bypasses pack detection for one rule; `--pack` selects explicit packs.

Plumb is a policy checker, not a compiler or general-purpose static-analysis framework. Its checks are deliberately shaped around Meridian repository conventions.

## Requirements

- Node.js 20 or newer
- pnpm 11, pinned by `packageManager`
- Git for the normal repository inventory; a filesystem fallback is available
- ast-grep on `PATH` for YAML rules
- go-task (`task`) and the target repository's toolchain for the CI-only Rivet freshness check
- the .NET 10 SDK on `PATH`, and `pnpm build:csharp` run once after install, for the rules that read C# facts. Without either, those rules are skipped and the run is degraded

Install Plumb's Node dependencies and build the C# facts tool:

```sh
pnpm install
pnpm build:csharp
```

`pnpm build:csharp` also restores the fixtures `plumb --self-test` reads, which fetches one NuGet package (`Microsoft.NET.Test.Sdk`) the first time.

The installed runtime dependencies have explicit jobs:

- `typescript`: TypeScript and JavaScript parsing, tsconfig loading, and module resolution
- `@vue/compiler-sfc`: Vue SFC extraction
- `dependency-cruiser`: frontend dependency graphs
- `fast-xml-parser`: `.csproj` and `Directory.Build.props` parsing
- `ignore`: `.plumbignore` and command-line exclusion semantics
- `yaml`: CSharpier YAML config parsing for comment widths, and key positions and duplicate keys in `.plumb-modules.json`
- `picomatch`: CSharpier override and `.editorconfig` section globs
- `braces`: brace expansion for CSharpier override and `.editorconfig` section globs
- `@dagrejs/graphlib`: module dependency loops

If TypeScript, the Vue compiler, or dependency-cruiser is unavailable, only the affected rules are skipped and Plumb emits a diagnostic. `fast-xml-parser`, `ignore`, `yaml`, `picomatch`, `braces` and `@dagrejs/graphlib` are required runtime dependencies. If ast-grep is unavailable, YAML rules are skipped with a diagnostic.

## Run

Check a repository:

```sh
./plumb /path/to/repo
```

Useful options:

```sh
./plumb /path/to/repo --json
./plumb /path/to/repo --fail-on warn
./plumb /path/to/repo --pack FE,BE
./plumb /path/to/repo --rule MER-BE-005
./plumb /path/to/repo --exclude fixtures/ --exclude coverage/
./plumb /path/to/repo --ci
./plumb /path/to/repo --profile
```

`--ci` enables checks that execute the target repository's own toolchain. `--profile` writes phase timings, selected owners, shared-analysis counters, external execution timings, and capability initialization to stderr without changing finding output.

A run is degraded when an analysis it needed is incomplete. Either an engine failed or was missing (ast-grep, a check script, or an analysis dependency such as TypeScript), so the rules it serves report nothing; or a rule ran on partial input, so it can miss findings. A `tsconfig.json` Plumb can't read is the common partial case: one that extends a package which isn't installed (the target repository has no `node_modules`) leaves its path aliases unresolved, so the import rules can't follow aliased imports. stderr names each cause, and the summary line ends `— degraded: N analyses incomplete (see above)` (`1 analysis` for one). Under `--json` the stderr lines alone say so. A degraded run still exits by its findings locally, and exits 2 under `--ci`.

The summary line reads `plumb: E error, W warn, I info`, then ` (+B baselined by FILE, baseline holds T)` when a baseline applies, with ` — shrunk; re-run with --write-baseline=FILE to ratchet down` inside the parentheses when it shrank (` — shrunk; re-run with --write-baseline=FILE in place of --baseline to ratchet down` when `--baseline FILE` was given), then the degraded note. The hint's FILE is the path that works from the current directory: as given to `--baseline`, or the discovered baseline relative to the current directory, absolute when it's outside it. FILE is quoted for a POSIX shell when it holds a character the shell would split or expand (a space, a quote, `$`, `*` and the like), and joined to the flag with `=` so that one starting with `=` or `-` still pastes back as the one argument.

### Repository Inventory

In a Git repository, Plumb scans tracked files and visible untracked files from `git ls-files`; Git-ignored paths are excluded. Outside Git, it falls back to one filesystem traversal with standard build and dependency directories excluded.

A `.plumbignore` at the checked repository root adds persistent exclusions using gitignore syntax, including negation. Repeatable `--exclude <pattern>` options add invocation-specific patterns after `.plumbignore`.

All rule engines and executable producers receive the same canonical inventory. A finding on a file outside that inventory is discarded. A finding on a directory, or on a file that doesn't exist (a missing required file, say), is kept, even under an excluded path.

### Baselines

Capture existing findings and then fail only on new ones:

```sh
./plumb /path/to/repo --write-baseline /path/to/repo/.plumb-baseline.json
./plumb /path/to/repo
```

A `.plumb-baseline.json` at the checked repository root applies automatically. `--baseline <file>` uses another file instead, and `--no-baseline` reports every finding. The summary line, or a line on stderr under `--json`, always names the baseline and shows how many findings it absorbed. It says the baseline shrank when an entry the run checked didn't all come back, and names the command that ratchets it down: the same one with `--write-baseline <file>` in place of any `--baseline`.

`--write-baseline` replaces only what the run checked: the entries for a rule that ran, at any path but a file `--exclude` left out. On a run narrowed by `--rule`, `--pack` or `--exclude`, or without `--ci`, the existing entries for the rules that did not run and for the files `--exclude` left out are kept. A file a persistent exclusion hides (Git's ignore rules, the fallback's skipped directories, `.plumbignore`) can never be reported, so its entries are checked: a write drops them and they count toward a shrink. An entry at a directory or a file that doesn't exist is always checked, since a finding there is never hidden. A degraded run refuses to write a baseline and exits 2, because entries for the findings its incomplete analyses missed would be dropped. A baseline file that exists but can't be read also exits 2 and is left untouched.

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

There is one finding per edge and file, at the file's first reference. A loop is a gap, so no decision record stands in for its fix; a repository that holds a finding open does it with a hand-made baseline entry and a tracked fix.

### Exit Codes

- `0`: no finding at or above `--fail-on` after the baseline, or a baseline written.
- `1`: at least one finding at or above `--fail-on` (default `error`).
- `2`: a usage error (an unknown or incomplete option, an invalid value, conflicting baseline options, no repository root or more than one, a root that doesn't exist), a rule catalogue that can't load, an unreadable baseline, a failed scan, a refused `--write-baseline`, or a degraded `--ci` run. A degraded `--ci` run exits 2 even when it also has findings.

`--self-test` exits 1 when any fixture fails, including one reported as `ERROR`, and 0 when all pass.

## Fidelity Boundaries

TypeScript and Vue rules use the TypeScript compiler API and Vue SFC compiler. Frontend graph rules use dependency-cruiser, with compiler-backed Vue import extraction when dependency-cruiser cannot parse an SFC itself.

Most C# source checks are syntax-light: they preserve offsets while masking comments and literals, then apply convention-specific structural checks, without compiling. The rules that decide what a name refers to read Roslyn instead, through `dotnet/Plumb.CSharpFacts`. They are the module-boundary rules (MER-BE-003 to 005), the module rules (MER-BE-061 to 064), MER-BE-001, 002, 006, 007, 009, and 016, and MER-RV-003, 007, 011, and 027. Roslyn gives them every type each file uses, however its name is written or inferred, each type's base types, and each EF `ToTable`/`ToView`. Types from outside the repo are seen only where a rule judges them: the framework namespaces of MER-BE-001 and 002, any type with an `Application` or `Infrastructure` segment in its name, and `System.IServiceProvider`, and never inside EF migrations code. These rules need the .NET 10 SDK and every project restored, test projects included; without them the run is degraded. They see what the compiler binds, so they don't see a dependency made by reflection or a name in a string. The strings they read are table names given as constants to `ToTable`, `ToView`, or `[Table]`, and the tables in the EF migrations snapshot. In a repo with no migrations snapshot, a table EF names by convention has no owner, so another module mapping it isn't caught: only running the repo's own EF model would name it. A call through a virtual member depends on the member the compiler binds, not on an override, so an override in the persistence root routes nowhere. A file outside every project isn't compiled, so they don't read it.

Loading a project runs its design-time build, as an IDE does when it opens the project, so the MSBuild targets the project's packages and the repo hook into compilation run, `<Exec>` included, and the build's output goes where the project puts it, `obj/` and `bin/` as a rule. So a checkout that was never built has to be writable. A build step that writes in the project folder still writes there. The usual case is Reqnroll, a test package that generates a C# class from each `.feature` file: it writes each `.feature.cs` beside its `.feature` file unless the project sets `ReqnrollUseIntermediateOutputPathForCodeBehind` to `true`, which puts it under `obj/`.

The rules that read Roslyn read a project under each of its target frameworks, and the facts are the union. A type's kind, namespace, and containing type are the first framework's, except that a type that is an interface under any framework reads as one; a type whose namespace or containing type differs by framework (a namespace `A.B` holding `C` under one, a class `B` in `A` holding `C` under another) makes the run degraded, naming the first such type, because a rule can misjudge it. A project whose code doesn't compile as Plumb loads it gets no facts, and the run is degraded, naming the first compiler error. That's what a stale restore, a `<Reference>` or generator whose file is missing, or a generator or referenced project that hasn't been built comes to, so run `dotnet build` first, in the configuration the run reads: the project's default, or `Configuration` from the environment. A file `.plumbignore` leaves out still counts, as it's compiled into the project. Two shapes stay unbound however often the project is built: a build step that adds code only outside what a design-time build runs, and a reference to a multi-target project whose frameworks share one output or intermediate path. Such a project stays degraded, and the run names what doesn't bind, as Plumb can't read that code without running the real build. A restore that's out of date but leaves every name bound changes nothing these rules read, and isn't reported. A warning the project promotes to an error doesn't count. The tool doesn't read generated files in the folders a project builds into unless they're in Plumb's file inventory, which in a git repo means git doesn't ignore them, and the rules skip any file under a folder named `obj` or `bin` whatever the inventory says, so keep `obj/` and `bin/` in `.gitignore`.

.NET project analysis parses project XML and models project ownership, references, package references, test evidence, and the nearest inherited `Directory.Build.props`. The C# facts tool loads projects with MSBuildWorkspace, and its restore check runs dotnet msbuild evaluations; nothing else evaluates MSBuild.

## Architecture

One scan creates a repository snapshot that interns visible files and memoizes text, line maps, JSON, configuration, TypeScript sources, Vue blocks, C# masks, project XML, and graph results for that invocation.

- `plumb` owns CLI parsing, pack and rule selection, orchestration, baselines, rendering, and profiling.
- `lib/engine/` owns the repository snapshot, heavyweight capability planning, shared analysis services, dispatch, and finding validation.
- `lib/in-process-rules/` contains the built-in rule families.
- `rules/` contains ast-grep YAML rules.
- `checks/` contains two executable producers:
  - `MER-FE-003` is the remaining legacy manifest-backed frontend producer.
  - `MER-RV-024` is deliberately process-isolated because it invokes the target repository's generation task, compares output, and restores the original files.
- `fixtures/<rule-id>/bad` and `fixtures/<rule-id>/good` define accepted behavior for every rule.
- `test/` verifies the engine, runner, catalogue, inventory, degradation behavior, and fixture contracts.
- `configs/` contains canonical configuration fragments consumed by tooling rules.
- `dotnet/` contains the C# facts tool that the C# rules in "Fidelity Boundaries" read.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rule API, capability model, finding contract, and fixture workflow.

## Verify Plumb

Run the Node test gate:

```sh
node --test "test/*.test.mjs"
```

Run every accepted fixture through the full CLI:

```sh
./plumb --self-test
```

The Node suite is the practical local gate. The fixture self-test starts the complete runner for every fixture pair and is intentionally slower.
