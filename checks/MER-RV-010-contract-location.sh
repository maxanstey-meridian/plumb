#!/usr/bin/env bash
# MER-RV-010 — contracts live in top-level Contracts/{Module}/, never inside Modules/.
# Fork settled 2026-06-10 (FABLE_REVIEW.md §Fork decisions): speechscribe's layout won.
# Casebridge's ~20 module-colocated contracts are migration backlog, like BE-005/RV-002.
# DOC: rivet.md#contract-location
root="$1"; [ -d "$root" ] || exit 2
find "$root" -name '*Contract.cs' -path '*/Modules/*' \
  -not -path '*/obj/*' -not -path '*/bin/*' -not -path '*/node_modules/*' 2>/dev/null \
| while read -r f; do
  printf 'MER-RV-010\terror\t%s:0\tcontract classes live in top-level Contracts/{Module}/ — never inside Modules/\trivet.md#contract-location\n' "${f#"$root"/}"
done
exit 0
