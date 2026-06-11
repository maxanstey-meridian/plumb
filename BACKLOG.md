# plumb backlog report — 2026-06-10

> **v6 config-sanitation addendum (same day):** new TO-002/005/012/014 warns on
> top of the numbers below — casebridge +1 (analyzers off), speechscribe +4
> (no oxfmtrc, no eslint Vue layer, analyzers off, CSharpier unwired), confer +8
> (empty `.oxfmtrc.json` → copy the golden base; no eslint Vue layer),
> perch-next +1, perch +2, glyphantics +5 (still on prettier), coingroup +4.
> Fixes are all "copy the golden from ~/.meridian/plumb/configs/ and extend" or
> one-line wiring (`dotnet tool install csharpier`; `EnforceCodeStyleInBuild`
> in Directory.Build.props).

Counts go stale; regenerate with `plumb <repo>`. The **Fix** column is the recorded
decision per finding class — that's the durable part. Order within a repo = fix order.

## casebridge — 224e / 111w / 17i  (~/Sites/medway/casebridge)

| # | Rule | n | What | Fix (decision) |
|---|------|---|------|----------------|
| 1 | RV-010 | 22e | `*Contract.cs` under `Modules/` | Move to top-level `Contracts/{Module}/`. Do FIRST — RV-002 fixes reference these files. |
| 2 | RV-002 | 79e | Route literals in `[HttpGet("...")]` etc. | Replace with route constants from the moved contract classes. Pure mechanical; ideal small-AI-loop batch. |
| 3 | BE-005 | 61e | Modules referencing the `Connectors` module | Extract each cross-module capability as a port in `Common/Ports`; adapter stays in `Connectors`; DI wires. 61 findings ≈ a handful of distinct ports (AddressLookup, StreetLookup, …) — count collapses fast. |
| 4 | BE-004 | 17e | Cross-module `using X.Infrastructure` | Same port-extraction treatment. `EfFileAccessQuery` reaching into Auth+Submissions is the worst offender. |
| 5 | BE-003 | 8e | Cross-module `using X.Domain` | Move genuinely shared types to `Common/Domain`; otherwise duplicate per module (doctrine prefers duplication over coupling). |
| 6 | BE-030 | 17e | Controllers injecting repos/DbContext | Introduce a use case / query class per endpoint. `PublicAddressController`, `SsoAuthController` lead. Largest real refactor in the repo. |
| 7 | FE-003 | 7e | Components importing generated clients | Move the call into a composable (or inject a port). |
| 8 | FE-011/032/001/004, BE-001/031, RV-001/025 | 16e+3w | Misc one-offs | Fix individually; each message is self-explanatory. |
| 9 | FE-006 | 76w | try/catch around generated client calls | Convert to `{ unwrap: false }` + `.isOk()` narrowing; keep try/catch only where it's genuinely network-failure handling. Mechanical batch. |
| 10 | TE-006 | 15w | Colocated `__tests__/` dirs | Move specs to top-level `tests/` mirroring app structure. |
| 11 | TE-005 | 8w | `Stub*`/`Mock*` class names | Rename/convert to hand-rolled `Fake*` per testing-philosophy.md. TE-002's 17 infos resolve as a side effect. |

**Strategy (proposed, not yet decided):** build `--baseline` ratchet first (needs §5
contract amendment) so CI goes green day one and only blocks *new* drift, then burn
the backlog down in campaigns #1→#11. Alternative: pure fix-forward, no ratchet.

## speechscribe-azure — 6e / 55w / 23i

| Rule | n | Fix |
|------|---|-----|
| BE-051 | 39w | Lift nested Command/Result records to siblings of the use case. Fully mechanical. |
| FE-041 | 23i | Rename `use-x.ts` → `useX.ts` composables + update imports. |
| FE-032 ×3, FE-001, FE-004, RV-002 | 6e | Individual fixes; RV-002 is one literal route. |
| BE-052 ×3, BE-050 ×2, FE-006 ×4, FE-031 ×3, TE-005 ×3, FE-022 | 16w | `ErrorDto`→`ErrorResponse` envelope; validation out of Application; unwrap:false; Fake* renames. |

## confer — 9e / 3w

| Rule | n | Fix |
|------|---|-----|
| FE-005 | 4e | `useConferGrants`/`useConferOffers` call `rivetFetch` directly — switch to generated clients. |
| FE-011 | 4e | Port tuples export `[useX, provideX]` — rename inject side to `injectX`. |
| TO-001 | 1e | Add `packageManager` pin to package.json. |
| FE-043 | 3w | `useState` outside composables — wrap in a composable. |

## rivet-ts — 6e

BT-001 ×3: ports have `protected`/missing-private constructors → make `private constructor() {}`.
BT-002 ×3: adapters `extends` their port → change to `implements` (forced anyway once constructors go private). Both fixes land together per file pair.

## perch-next — 7w
BT-005 ×4 (`*Service` class names in modules — rename to role names, e.g. `PetStateMachine`), BT-004 ×1 (constructor param not `private readonly`), RV-021, RV-025.

## perch — 1e / 2w
TO-001 (packageManager pin), BT-005 ×2.

## glyphantics — 3e
TO-001 ×3 (packageManager pins across workspace package.jsons).

## coingroup — clean ✓
