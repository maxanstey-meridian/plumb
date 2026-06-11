#!/usr/bin/env bash
# MER-RV-002 — anti-pattern: "mapping routes manually instead of using Contract.Endpoint.Route"
# DOC: rivet.md#practical-rules
# Re-escalated to error 2026-06-10: the contract-location fork is settled (top-level
# Contracts/, controllers source routes from contract constants). Casebridge's 78
# relative-literal attribute routes are migration backlog, BE-005-style.
# Scope change with the fork: contracts no longer sit beside their modules, so the
# trigger is repo-level (any *Contract.cs) and the scan is repo-wide .cs.
# Encoded exception (calibration 2026-06-10, speechscribe Program.cs health/root
# endpoints): Program.cs is excluded — bootstrap ops endpoints (/api/health, /) have
# no contract to come from; inline handlers there are MER-RV-008's territory.
root="$1"; [ -d "$root" ] || exit 2
find "$root" -name '*Contract.cs' -not -path '*/obj/*' -not -path '*/node_modules/*' 2>/dev/null \
| head -1 | grep -q . || exit 0
rg -n --no-heading -e '\[Http(Get|Post|Put|Delete|Patch)\(\s*"' -e '\.Map(Get|Post|Put|Delete|Patch)\(\s*"' \
  -g '*.cs' -g '!**/obj/**' -g '!**/bin/**' -g '!**/Program.cs' "$root" 2>/dev/null | while IFS=: read -r f l _; do
  printf 'MER-RV-002\terror\t%s:%s\tliteral route in a contract-bearing repo — use the contract route (e.g. [HttpPost(XContract.CreateRoute)] / Contract.X.Route)\trivet.md#practical-rules\n' "${f#"$root"/}" "$l"
done
exit 0
