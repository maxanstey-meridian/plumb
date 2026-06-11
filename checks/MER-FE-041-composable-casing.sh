#!/usr/bin/env bash
# MER-FE-041 — composable filenames are camelCase useX.ts. Fork settled 2026-06-10:
# casebridge's camelCase won; speechscribe's kebab use-x.ts files are the backlog.
# DOC: frontend-pa-vsa.md#composables
root="$1"; [ -d "$root" ] || exit 2
find "$root" -type f -name 'use-*.ts' -path '*/composables/*' \
  -not -path '*/node_modules/*' -not -path '*/.nuxt/*' -not -path '*/generated/*' 2>/dev/null \
| while read -r f; do
  printf 'MER-FE-041\tinfo\t%s:0\tcomposable filenames are camelCase (useX.ts), not kebab-case\tfrontend-pa-vsa.md#composables\n' "${f#"$root"/}"
done
exit 0
