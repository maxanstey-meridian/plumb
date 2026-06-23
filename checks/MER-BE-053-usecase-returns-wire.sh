#!/usr/bin/env bash
# MER-BE-053 — a use case takes a Command and returns a domain type or *Result, never a
# transport-shaped *Response/*Dto. Returning the wire shape couples the application layer to
# the published HTTP contract; map at the edge, or drop the use case if it only maps.
# DOC: backend-pa-vsa.md#commands-and-results
root="$1"; [ -d "$root" ] || exit 2
find "$root" -path '*/Modules/*UseCase.cs' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while read -r f; do
  rg -n --no-heading -e 'public\s+(async\s+)?(Task<\s*)?[A-Za-z0-9_]*(Response|Dto)>?\s+(Execute|ExecuteAsync)\s*\(' "$f" 2>/dev/null \
  | while IFS=: read -r l _; do
    printf 'MER-BE-053\twarn\t%s:%s\tuse case returns a transport-shaped type (*Response/*Dto); return a domain type or *Result and map at the edge, or drop the use case if it only maps\tbackend-pa-vsa.md#commands-and-results\n' "${f#"$root"/}" "$l"
  done
done
exit 0
