#!/usr/bin/env bash
# MER-FE-033 — page-local colocation, not app/features/ sprawl
# DOC: frontend-pa-vsa.md#default-recommendation
root="$1"; [ -d "$root" ] || exit 2
find "$root" -type d -path '*/app/features' -not -path '*/node_modules/*' 2>/dev/null | while read -r d; do
  printf 'MER-FE-033\terror\t%s:0\tno app/features/ — page-local code stays colocated with its page; shared code goes to app/shared/\tfrontend-pa-vsa.md#default-recommendation\n' "${d#"$root"/}"
done
exit 0
