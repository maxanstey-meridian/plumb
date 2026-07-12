# plumb

Mechanical Meridian doctrine checks for local repos.

`plumb` is intentionally small: the runner detects repo conventions, runs independent producers, merges their finding lines, and exits. It does not rewrite target repos.

## Install

Install the wrapped tool dependencies in this repo:

```sh
pnpm install
```

`ast-grep` is used for YAML rules and must be available on `PATH` for those rules to run. If it is missing, `plumb` skips YAML rules and prints a diagnostic.

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
./plumb /path/to/repo --ci
```

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

## Layout

- `plumb` is the runner.
- `checks/` contains executable cross-file checks. One file per concern; `_lib/` holds shared helpers and is not run directly.
- `rules/` contains ast-grep YAML rules.
- `fixtures/<rule-id>/bad` and `fixtures/<rule-id>/good` prove each rule fires and does not false-positive.
- `test/runner.test.mjs` verifies runner behavior and every executable check's output contract.
- `configs/` contains golden config fragments checked by tool/config rules.
- `dotnet/` contains the optional Roslyn analyzer mirror and its separate test script.

## Finding Format

Every producer writes tab-separated findings to stdout:

```text
RULE-ID<TAB>SEVERITY<TAB>PATH:LINE<TAB>MESSAGE<TAB>DOC-REF
```

Example:

```text
MER-BE-005	error	api/Modules/Auth/Application/U.cs:1	module Auth must not use Forms.Application internals — publish a contract or define a required port	backend-pa-vsa.md#across-modules
```

Producers exit `0` when they find drift. Non-zero exits are for internal failures only.

## Add A Check

1. Add an executable producer under `checks/` named `MER-XX-NNN-short-name.sh` or `.mjs`.
2. Keep it standalone and narrow. Use `_lib/` only when sharing is already proven.
3. Emit only five-field finding lines on stdout. Diagnostics go to stderr.
4. Add `fixtures/MER-XX-NNN/bad` and `fixtures/MER-XX-NNN/good`.
5. Make sure the relevant pack is detected by `plumb` or add a runner harness case.
6. Run `node --test "test/*.test.mjs"`.

For ast-grep-shaped single-file checks, add a YAML rule under `rules/<pack>/` instead of a script, then add fixtures and run the harness.
