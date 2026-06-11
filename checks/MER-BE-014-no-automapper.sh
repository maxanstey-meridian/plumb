#!/usr/bin/env bash
# MER-BE-014 — "no AutoMapper"; map records explicitly
# DOC: backend-pa-vsa.md#net
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e 'using AutoMapper' -e '\bCreateMap<' -e '"AutoMapper' \
  -g '*.cs' -g '*.csproj' -g '!**/obj/**' "$root" 2>/dev/null | while IFS=: read -r f l _; do
  printf 'MER-BE-014\terror\t%s:%s\tno AutoMapper — construct DTOs/records explicitly\tbackend-pa-vsa.md#net\n' "${f#"$root"/}" "$l"
done
exit 0
