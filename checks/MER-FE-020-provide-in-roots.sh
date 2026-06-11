#!/usr/bin/env bash
# MER-FE-020 — provideX belongs in composition roots (pages/layouts/app.vue), never components
# DOC: frontend-pa-vsa.md#pages-as-composition-roots
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e '\bprovide[A-Z][A-Za-z]*\(' \
  -g '**/components/**/*.vue' "$root" 2>/dev/null \
| grep -v 'provideLocal(' | while IFS=: read -r f l _; do
  printf 'MER-FE-020\terror\t%s:%s\tcomponents must not provide capabilities — wiring belongs in the page/layout composition root\tfrontend-pa-vsa.md#pages-as-composition-roots\n' "${f#"$root"/}" "$l"
done
exit 0
