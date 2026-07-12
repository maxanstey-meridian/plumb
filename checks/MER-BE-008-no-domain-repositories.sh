#!/usr/bin/env bash
# MER-BE-008 — repository abstractions and implementations do not belong in Domain.
# DOC: backend-pa-vsa.md#non-negotiable-dependency-rules
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e '\binterface\s+I[A-Za-z0-9_]*Repository\b' -e '\bclass\s+[A-Za-z0-9_]*Repository\b' \
  -g '**/Modules/*/Domain/**/*.cs' -g '!**/obj/**' -g '!**/bin/**' "$root" 2>/dev/null \
| while IFS=: read -r f l _; do
  printf 'MER-BE-008\terror\t%s:%s\trepository declarations belong in Application/Ports, not Domain\tbackend-pa-vsa.md#non-negotiable-dependency-rules\n' "${f#"$root"/}" "$l"
done
exit 0
