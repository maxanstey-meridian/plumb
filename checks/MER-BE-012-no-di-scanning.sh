#!/usr/bin/env bash
# MER-BE-012 — "no DI auto-scanning"; explicit registration only
# Calibration 2026-06-10 (casebridge): bare `.Scan(` matched domain methods like
# RetentionRegistry.Scan(); pattern now requires the Scrutor lambda shape.
# DOC: backend-pa-vsa.md#net
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e '\.Scan\(\s*\w+\s*=>' -e '\bScrutor\b' -e 'FromAssembliesOf|AddClassesFromAssembl' \
  -g '*.cs' -g '*.csproj' -g '!**/obj/**' "$root" 2>/dev/null | while IFS=: read -r f l _; do
  printf 'MER-BE-012\terror\t%s:%s\tno DI auto-scanning — register every use case and port explicitly in the module file\tbackend-pa-vsa.md#net\n' "${f#"$root"/}" "$l"
done
exit 0
