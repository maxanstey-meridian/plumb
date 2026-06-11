#!/usr/bin/env bash
# MER-TE-006 — frontend tests live in top-level tests/, not colocated. Fork settled
# 2026-06-10: speechscribe's layout won; casebridge's colocated __tests__/ dirs are
# backlog. One finding per offending dir; loose colocated spec files flagged per file.
# Encoded exception (calibration 2026-06-10, confer): only app source subtrees are
# scanned (app/pages/components/composables/layouts/plugins/shared/src) — when
# nuxt.config sits at a workspace root, sibling packages' test dirs (packages/api/
# test/) are BE-TS territory, not colocated frontend tests.
# DOC: testing-philosophy.md#test-location
root="$1"; [ -d "$root" ] || exit 2
in_app_tree() {
  case "$1" in
    app/*|pages/*|components/*|composables/*|layouts/*|plugins/*|shared/*|src/*) return 0 ;;
    *) return 1 ;;
  esac
}
find "$root" -name 'nuxt.config.*' -maxdepth 6 -not -path '*/node_modules/*' 2>/dev/null \
| while read -r cfg; do
  fe="$(dirname "$cfg")"
  find "$fe" -type d -name '__tests__' -not -path '*/node_modules/*' -not -path '*/.nuxt/*' 2>/dev/null \
  | while read -r d; do
    in_app_tree "${d#"$fe"/}" || continue
    printf 'MER-TE-006\twarn\t%s:0\tfrontend tests live in top-level tests/ — colocated __tests__/ dirs are not house style\ttesting-philosophy.md#test-location\n' "${d#"$root"/}"
  done
  find "$fe" \( -name '*.spec.ts' -o -name '*.test.ts' \) -type f \
    -not -path '*/node_modules/*' -not -path '*/.nuxt/*' -not -path '*/__tests__/*' 2>/dev/null \
  | while read -r f; do
    in_app_tree "${f#"$fe"/}" || continue
    printf 'MER-TE-006\twarn\t%s:0\tfrontend tests live in top-level tests/ — move this colocated spec\ttesting-philosophy.md#test-location\n' "${f#"$root"/}"
  done
done
exit 0
