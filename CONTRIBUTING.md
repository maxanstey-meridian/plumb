# Contributing

## Test Prerequisites

The test suite and `./plumb --self-test` use every one of Plumb's [requirements](README.md#requirements), with its Node dependencies installed:

- ast-grep on `PATH`
- go-task (`task`) on `PATH`: without it two `MER-RV-024` runner tests are skipped (the one that runs its check script against its fixtures, `producer MER-RV-024-stale-generated.mjs: …`, and the one for conventions it can't check, `MER-RV-024: a convention it can't check exits 2 …`) and its self-test fixture fails, since the self-test runs the CI-only checks
- the `meridian` skill from [workflow-skills](https://github.com/maxanstey-meridian/workflow-skills): the catalog test checks every finding's docRef against its `references/` folder, read from `MERIDIAN_REFERENCES` when set, else `~/.claude/skills/meridian/references`

## Add A Rule

1. Add a descriptor-backed rule under `lib/in-process-rules/` when the existing path, text, configuration, TypeScript, Vue, C#, resolution, frontend graph, or .NET project analysis is sufficient.
2. Use an executable producer under `checks/` only when process isolation or an external tool boundary is required.
3. Declare every owned rule ID and any heavyweight analysis capability it requires.
4. Report findings through the owner-scoped context. Executable producers emit only five-field finding lines on stdout and send diagnostics to stderr.
5. Add `fixtures/MER-XX-NNN/bad` and `fixtures/MER-XX-NNN/good`.
6. Ensure the relevant pack is detected or add a runner harness case.
7. Run `node --test "test/*.test.mjs"` and `./plumb --self-test`.

For an ast-grep-shaped single-file check, add a YAML rule under `rules/<pack>/` instead of a script.

## Rule Shapes

Use `defineFileRule` when each file can be decided independently and `defineRepositoryRule` for cross-file policy. The engine passes file rules `(file, context)` and repository rules `(context)`.

Repository context exposes `root`, `files`, `repositoryFiles` (`files` plus those `.plumbignore` and `--exclude` left out of the run, for asking whether something exists in the repository, never for reporting on it), `rivet`, `file(path)`, static configuration inputs, owner-scoped `report()`, and planned analysis services. File contexts expose `path`, `name`, `directory`, `text()`, `lineMap()`, `json()`, and `config(parser)`.

Basic file, text, line, JSON, and configuration access needs no capability declaration. Declare the narrowest sufficient heavyweight requirement from `Capability`:

- `TYPESCRIPT`
- `FRONTEND_ROOTS`
- `FRONTEND_GRAPH`
- `CSHARP`
- `DOTNET_PROJECTS`

Dependencies close transitively, analysis services initialize lazily, and shared results are memoized for one invocation. Accessing an unplanned analysis capability fails immediately.

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

## Finding Contract

In-process findings are validated centrally. Executable producers write this tab-separated contract:

```text
RULE-ID<TAB>SEVERITY<TAB>PATH:LINE<TAB>MESSAGE<TAB>DOC-REF
```

Example:

```text
MER-BE-005	error	api/Modules/Auth/Application/U.cs:1	module Auth must not use Forms.Application internals - publish a contract or define a required port	backend-pa-vsa.md#across-modules
```

Executable producers exit `0` when they find drift. Non-zero exits are reserved for internal failures.
