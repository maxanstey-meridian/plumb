#!/usr/bin/env bash
# MER-FE-005 — raw rivetFetch is banned outside generated code; use generated clients
# v1-pinned (contract §5 v8): Rivet v2 has no rivetFetch runtime to leak — suppressed
# under pure v2; runs under v1/both/none (the trigger is a v1 idiom).
# DOC: frontend-pa-vsa.md#rivet-rules
root="$1"; [ -d "$root" ] || exit 2
v="${PLUMB_RIVET_VARIANT:-$(node "$(cd "$(dirname "$0")" && pwd)/_lib/rivet-variant.mjs" "$root" 2>/dev/null || echo none)}"
[ "$v" = "v2" ] && exit 0
rg -n --no-heading -e '\brivetFetch\b' \
  -g '*.ts' -g '*.vue' -g '!**/generated/**' -g '!eslint.config.*' -g '!*.md' \
  "$root" 2>/dev/null | while IFS=: read -r f l _; do
  printf 'MER-FE-005\terror\t%s:%s\tdo not use rivetFetch directly — call the generated clients\tfrontend-pa-vsa.md#rivet-rules\n' "${f#"$root"/}" "$l"
done
exit 0
