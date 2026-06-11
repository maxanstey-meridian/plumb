#!/usr/bin/env bash
# MER-FE-043 — useState() is blessed, behind composables (fork settled 2026-06-10):
# useState( may appear only inside composables/ files; everything else consumes the
# owning composable, never the string key. Confirmed target: casebridge couples
# plugins/2.bootstrap.client.ts and app.vue through the bare "app-booted" key.
# DOC: frontend-pa-vsa.md#composables
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e '\buseState\s*(<[^>]*>)?\(' \
  -g '*.ts' -g '*.vue' \
  -g '!**/composables/**' -g '!**/node_modules/**' -g '!**/.nuxt/**' \
  -g '!**/generated/**' -g '!**/tests/**' -g '!**/__tests__/**' -g '!*.spec.*' -g '!*.test.*' \
  "$root" 2>/dev/null | while IFS=: read -r f l _; do
  printf 'MER-FE-043\twarn\t%s:%s\tuseState belongs inside a composable — consume the owning composable, never the state key\tfrontend-pa-vsa.md#composables\n' "${f#"$root"/}" "$l"
done
exit 0
