#!/usr/bin/env bash
# MER-BE-031 — no EF/Npgsql usings in controllers or endpoint classes
# DOC: backend-pa-vsa.md#inside-a-module
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e 'using Microsoft\.EntityFrameworkCore' -e 'using Npgsql' \
  -g '*Controller.cs' -g '*Endpoints.cs' -g '!**/obj/**' "$root" 2>/dev/null \
| while IFS=: read -r f l _; do
  printf 'MER-BE-031\terror\t%s:%s\tpersistence imports do not belong at the transport edge\tbackend-pa-vsa.md#inside-a-module\n' "${f#"$root"/}" "$l"
done
exit 0
