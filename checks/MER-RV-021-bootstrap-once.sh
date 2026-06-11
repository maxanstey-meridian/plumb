#!/usr/bin/env bash
# MER-RV-021 — "bootstrap Rivet once at the app boundary" (a plugin)
# Calibration 2026-06-10 (~/Sites sweep, meridian repo: reel + perch-next in one
# repo): the once-count is per APP, not per repo — a monorepo with two frontends
# legitimately has two configureRivet calls. App root = nearest ancestor dir with
# nuxt.config.* or package.json; falls back to the repo root.
# DOC: frontend-pa-vsa.md#rivet-rules
root="$1"; [ -d "$root" ] || exit 2
hits=$(rg -n --no-heading -e '\bconfigureRivet\(' -g '*.ts' -g '!**/generated/**' -g '!*.spec.*' -g '!**/__tests__/**' "$root" 2>/dev/null | grep -v 'function configureRivet' || true)
[ -n "$hits" ] || exit 0
tmp=$(mktemp)
while IFS=: read -r f l _; do
  d=$(dirname "$f"); g="$root"
  while [ "$d" != "/" ] && [ "$d" != "$root" ]; do
    if [ -f "$d/package.json" ] || ls "$d"/nuxt.config.* >/dev/null 2>&1; then g="$d"; break; fi
    d=$(dirname "$d")
  done
  printf '%s\t%s\t%s\n' "$g" "${f#"$root"/}" "$l"
done <<<"$hits" > "$tmp"
awk -F'\t' '
  NR==FNR { n[$1]++; next }
  n[$1] > 1 { printf "MER-RV-021\terror\t%s:%s\tconfigureRivet called %d times in this app — bootstrap Rivet exactly once, in a plugin\tfrontend-pa-vsa.md#rivet-rules\n", $2, $3, n[$1]; next }
  $2 !~ /plugins\// { printf "MER-RV-021\twarn\t%s:%s\tconfigureRivet should be called from a plugin at the app boundary\tfrontend-pa-vsa.md#rivet-rules\n", $2, $3 }
' "$tmp" "$tmp"
rm -f "$tmp"
exit 0
