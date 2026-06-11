#!/usr/bin/env bash
# MER-BE-030 — transport calls use cases only; no repositories/DbContext at the edge
# DOC: backend-pa-vsa.md#inside-a-module
root="$1"; [ -d "$root" ] || exit 2
[ -n "$(find "$root" -type d -name Modules -not -path '*/node_modules/*' 2>/dev/null | head -1)" ] || exit 0
rg -n --no-heading -e '\bI[A-Z][A-Za-z]*Repository\b' -e '\bDbContext\b' \
  -g '*Controller.cs' -g '*Endpoints.cs' -g '!**/obj/**' "$root" 2>/dev/null \
| while IFS=: read -r f l _; do
  printf 'MER-BE-030\terror\t%s:%s\ttransport must depend on use cases/queries, not repositories or DbContext\tbackend-pa-vsa.md#inside-a-module\n' "${f#"$root"/}" "$l"
done
exit 0
