# Plumb

Plumb is Meridian's multi-language architecture and tooling policy checker.

It builds one invocation-scoped model of a repository, then runs rule families over shared TypeScript, Vue, C#, .NET project, configuration, and dependency-graph analysis. Most rules execute in process; ast-grep handles declarative syntax checks, and two checks still execute as isolated producers.

Check mode does not retain source changes. `--write-baseline` writes the requested baseline, while the CI-only freshness check temporarily regenerates output from a snapshot and restores it before returning. `plumb init` is a separate repository composer that creates files, initializes Git, and runs Plumb against the result.

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
- `task` and the target repository's toolchain for the CI-only Rivet freshness check

Install Plumb's Node dependencies:

```sh
pnpm install
```

The installed runtime dependencies have explicit jobs:

- `typescript`: TypeScript and JavaScript parsing, tsconfig loading, and module resolution
- `@vue/compiler-sfc`: Vue SFC extraction
- `dependency-cruiser`: frontend dependency graphs
- `fast-xml-parser`: `.csproj` and `Directory.Build.props` parsing
- `ignore`: `.plumbignore` and command-line exclusion semantics

If TypeScript, the Vue compiler, or dependency-cruiser is unavailable, only the affected rules are skipped and Plumb emits a diagnostic. `fast-xml-parser` and `ignore` are required runtime dependencies. If ast-grep is unavailable, YAML rules are skipped with a diagnostic.

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

### Repository Inventory

In a Git repository, Plumb scans tracked files and visible untracked files from `git ls-files`; Git-ignored paths are excluded. Outside Git, it falls back to one filesystem traversal with standard build and dependency directories excluded.

A `.plumbignore` at the checked repository root adds persistent exclusions using gitignore syntax, including negation. Repeatable `--exclude <pattern>` options add invocation-specific patterns after `.plumbignore`.

All rule engines and executable producers receive the same canonical inventory. A finding outside that inventory is discarded.

### Baselines

Capture existing findings and then fail only on new ones:

```sh
./plumb /path/to/repo --write-baseline .plumb-baseline.json
./plumb /path/to/repo --baseline .plumb-baseline.json
```

## Fidelity Boundaries

TypeScript and Vue rules use the TypeScript compiler API and Vue SFC compiler. Frontend graph rules use dependency-cruiser, with compiler-backed Vue import extraction when dependency-cruiser cannot parse an SFC itself.

C# source checks are syntax-light: they preserve offsets while masking comments and literals, then apply convention-specific structural checks. They do not compile source or provide Roslyn semantic analysis.

.NET project analysis parses project XML and models project ownership, references, package references, test evidence, and the nearest inherited `Directory.Build.props`. It does not perform full MSBuild evaluation, evaluate arbitrary imports or conditions, or construct an `MSBuildWorkspace`.

`dotnet/Meridian.Analyzers/` is a separate optional build-time Roslyn analyzer. It has its own test harness and is not a mirror of the Node rule engine.

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
- `dotnet/` contains the optional build-time Roslyn analyzer and its independent test harness.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rule API, capability model, finding contract, and fixture workflow.

## Create A Repository

`plumb init` composes a new repository, initializes Git, creates the first commit when Git identity is available, and runs Plumb against the result:

```sh
./plumb init /path/to/new-repo --name example --ts-backend
./plumb init /path/to/new-repo --name example --dotnet-backend
./plumb init /path/to/new-repo --name example --no-api
```

The TypeScript backend is the default. `--force` passes forced creation through to the underlying scaffold command. `MERIDIAN_RIVET_TS` and `MERIDIAN_GOLDEN` override the default Rivet scaffold and .NET exemplar locations.

## Verify Plumb

Run the Node test gate:

```sh
node --test "test/*.test.mjs"
```

Run every accepted fixture through the full CLI:

```sh
./plumb --self-test
```

The Node suite is the practical local gate. The fixture self-test starts the complete runner for all 96 fixture pairs and is intentionally slower.
