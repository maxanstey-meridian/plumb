#!/usr/bin/env bash
# MER-BE-050 — shape validation is FluentValidation at the transport edge; use cases
# keep domain invariants only. Fork settled 2026-06-10: flag inline Result.Validation
# factories in Application/ code (speechscribe's inline style is the migration side).
# DOC: backend-pa-vsa.md#validation
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e 'Result\.Validation\s*\(' \
  -g '*.cs' -g '**/Application/**' -g '!**/obj/**' -g '!**/bin/**' \
  "$root" 2>/dev/null | while IFS=: read -r f l _; do
  printf 'MER-BE-050\twarn\t%s:%s\tshape validation belongs to FluentValidation at the transport edge — use cases keep domain invariants only\tbackend-pa-vsa.md#validation\n' "${f#"$root"/}" "$l"
done
exit 0
