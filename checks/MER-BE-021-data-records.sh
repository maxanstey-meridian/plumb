#!/usr/bin/env bash
# MER-BE-021 — immutable message/data shapes are records, not concrete classes.
# *Entity is deliberately exempt: persistence entities may require class semantics.
# DOC: backend-pa-vsa.md#net
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -P '^\s*(?:public|internal|private|protected)?\s*(?:sealed\s+|partial\s+)*class\s+[A-Za-z_][A-Za-z0-9_]*(?:Command|Result|Request|Response|Dto|Data|Snapshot)\b' \
  -g '**/Modules/**/*.cs' -g '!**/obj/**' -g '!**/bin/**' "$root" 2>/dev/null \
| while IFS=: read -r f l _; do
  printf 'MER-BE-021\twarn\t%s:%s\tmessage and data shapes (*Command/*Result/*Request/*Response/*Dto/*Data/*Snapshot) should be records\tbackend-pa-vsa.md#net\n' "${f#"$root"/}" "$l"
done
exit 0
