#!/usr/bin/env bash
# MER-BE-023 — Manager/Helper class names conceal responsibility inside modules.
# DOC: backend-pa-vsa.md#coding-style-rules
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -P '\bclass\s+[A-Za-z_][A-Za-z0-9_]*(?:Manager|Helper)\b' \
  -g '**/Modules/**/*.cs' -g '!**/obj/**' -g '!**/bin/**' "$root" 2>/dev/null \
| while IFS=: read -r f l _; do
  printf 'MER-BE-023\twarn\t%s:%s\tManager/Helper class name is vague; name the concrete responsibility\tbackend-pa-vsa.md#coding-style-rules\n' "${f#"$root"/}" "$l"
done
exit 0
