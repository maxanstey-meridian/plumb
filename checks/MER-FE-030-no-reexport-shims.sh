#!/usr/bin/env bash
# MER-FE-030 — "Never re-export from a shim file. Consumers import from the real location."
# DOC: frontend-pa-vsa.md#promotion
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e '^\s*export\s+(type\s+)?\{[^}]*\}\s+from\s' -e '^\s*export\s+\*\s+from\s' \
  -g '**/shared/**/*.ts' -g '**/ports/**/*.ts' -g '**/logic/**/*.ts' -g '!**/generated/**' \
  "$root" 2>/dev/null | while IFS=: read -r f l _; do
  printf 'MER-FE-030\terror\t%s:%s\tre-export shim hides provenance — consumers must import from the real owner; delete the shim\tfrontend-pa-vsa.md#promotion\n' "${f#"$root"/}" "$l"
done
exit 0
