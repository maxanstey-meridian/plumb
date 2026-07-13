# plumb

Mechanical Meridian doctrine checks for local repos.

`plumb` is intentionally small: check mode builds one visible repository inventory, runs built-in in-process rules plus remaining external producers, merges their findings, and exits. It does not rewrite source files; `--write-baseline` writes only the requested baseline file. The separate `plumb init` command creates a new repository.

## Install

Install the wrapped tool dependencies in this repo:

```sh
pnpm install
```

`ast-grep` is used for YAML rules and must be available on `PATH` for those rules to run. If it is missing, `plumb` skips YAML rules and prints a diagnostic.

TypeScript-backed rules and frontend graph rules use the local `typescript`, `@vue/compiler-sfc`, and `dependency-cruiser` packages installed by `pnpm install`. If one is unavailable, only the affected rules are skipped and `plumb` prints one diagnostic; other rule families still run.

## Run

Check a repo:

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

`--profile` writes setup, repository inventory, selected in-process rule, remaining producer, external CI, rendering, and total timings to stderr. It also reports shared text/configuration work, TypeScript parsing, C# reads/masking/classification, Vue extraction, tsconfig and module resolution, frontend graphs, `.csproj` parsing and graphs, inherited props parsing, external adapter runs, and capability initialization. Finding stdout and JSON output remain unchanged.

Add a `.plumbignore` at the checked repository root for persistent exclusions. It uses gitignore syntax, including negation. Repeatable `--exclude <pattern>` options add invocation-specific patterns after `.plumbignore`.

Baseline an existing repo and then fail only on new findings:

```sh
./plumb /path/to/repo --write-baseline .plumb-baseline.json
./plumb /path/to/repo --baseline .plumb-baseline.json
```

Run the test harness:

```sh
node --test "test/*.test.mjs"
```

Run fixture self-test:

```sh
./plumb --self-test
```

The Node harness is the practical local gate. `--self-test` scans every fixture through the full runner and can be slow.

## Create A Repository

`plumb init` composes a new repository, initializes Git, creates the first commit when Git identity is available, and runs `plumb` against the result:

```sh
./plumb init /path/to/new-repo --name example --ts-backend
./plumb init /path/to/new-repo --name example --dotnet-backend
./plumb init /path/to/new-repo --name example --no-api
```

The TypeScript backend is the default. Use `--force` to pass forced creation through to the underlying scaffold command. `MERIDIAN_RIVET_TS` and `MERIDIAN_GOLDEN` override the default Rivet scaffold and .NET exemplar locations.

## Layout

- `plumb` is the runner.
- `lib/engine/` owns heavyweight analysis capability planning, the invocation-local repository snapshot, lazy text/configuration/TypeScript/Vue/C# services, frontend roots and graphs, the syntax-light .NET project graph, dispatch, and central findings.
- `lib/in-process-rules/` contains path, text, configuration, TypeScript, Vue, C#, frontend graph, and .NET project rules that share the engine snapshot.
- `checks/` contains remaining executable cross-file checks. One file per concern; `_lib/` holds shared helpers and is not run directly.
- `rules/` contains ast-grep YAML rules.
- `fixtures/<rule-id>/bad` and `fixtures/<rule-id>/good` prove each rule fires and does not false-positive.
- `test/runner.test.mjs` verifies runner behavior and every executable check's output contract.
- `configs/` contains golden config fragments checked by tool/config rules.
- `dotnet/` contains the optional Roslyn analyzer mirror and its separate test script.

## Finding Format

The engine's logical finding contract, and the stdout contract for remaining executable producers, is:

```text
RULE-ID<TAB>SEVERITY<TAB>PATH:LINE<TAB>MESSAGE<TAB>DOC-REF
```

Example:

```text
MER-BE-005	error	api/Modules/Auth/Application/U.cs:1	module Auth must not use Forms.Application internals — publish a contract or define a required port	backend-pa-vsa.md#across-modules
```

Executable producers exit `0` when they find drift. Non-zero exits are for internal failures only.

## Add A Check

1. Add a descriptor-backed rule under `lib/in-process-rules/` when built-in path, text, configuration, TypeScript, Vue, C#, resolution, frontend graph, or syntax-light .NET project capabilities are sufficient. Use an executable producer under `checks/` only when process isolation or a separate external tool boundary is required.
2. Declare every owned rule ID and any heavyweight analysis capability it requires. Basic file, text, line, JSON, and configuration access needs no declaration. In-process rules consume only the provided repository/file contexts; executable producers consume the runner-provided manifest.
3. Report in-process findings through the owner-scoped context. Executable producers emit only five-field finding lines on stdout; diagnostics go to stderr.
4. Add `fixtures/MER-XX-NNN/bad` and `fixtures/MER-XX-NNN/good`.
5. Make sure the relevant pack is detected by `plumb` or add a runner harness case.
6. Run `node --test "test/*.test.mjs"`.

For ast-grep-shaped single-file checks, add a YAML rule under `rules/<pack>/` instead of a script, then add fixtures and run the harness.

### In-Process Context

Use `defineFileRule` when each file can be decided independently and `defineRepositoryRule` for cross-file policy. The engine passes file rules `(file, context)` and repository rules `(context)`.

Repository context exposes `root`, `files`, `rivet`, `file(path)`, static configuration inputs, owner-scoped `report()`, and the planned analysis services. File contexts expose `path`, `name`, `directory`, `text()`, `lineMap()`, `json()`, and `config(parser)`.

Declare the narrowest sufficient requirement from `Capability`: `TYPESCRIPT`, `FRONTEND_ROOTS`, `FRONTEND_GRAPH`, `CSHARP`, or `DOTNET_PROJECTS`. Dependencies close transitively, expensive services initialize lazily, and shared results are memoized for one invocation. Accessing an unplanned analysis capability fails immediately.

```js
defineFileRule({
  descriptor: createRuleDescriptor({ id: "MER-XX-001", source: "in-process/xx.mjs" }),
  files: (path) => path.endsWith(".ts"),
  analyze(file, context) {
    for (const [index, line] of file.lineMap().lines.entries()) {
      if (!line.includes("forbidden")) continue;
      context.report({
        severity: "warn",
        path: file.path,
        line: index + 1,
        message: "explain the mechanical violation",
        docRef: "doctrine.md#rule",
      });
    }
  },
});
```
