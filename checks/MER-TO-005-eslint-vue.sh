#!/usr/bin/env bash
# MER-TO-005 — eslint is the Vue layer only. Repos with .vue files need an eslint
# flat config referencing the Vue layer (@nuxt/eslint / eslint-plugin-vue /
# withNuxt) because oxlint cannot lint Vue templates yet (oxc RFC, verified
# 2026-06-10); an eslint config whose own subtree has NO .vue files is a finding —
# oxlint owns non-Vue linting. Vue-ness is judged per config subtree, not per repo
# (§7, calibration 2026-06-10, coingroup: coinwatcher-api's eslint sat beside a Vue
# sibling app and was blamed for the wrong reason). Generated configs (.nuxt/) and
# node_modules are never findings.
# DOC: tools.md#linting-and-formatting
root="$1"; [ -d "$root" ] || exit 2

vue_under() { find "$1" -name '*.vue' -not -path '*/node_modules/*' -not -path '*/.nuxt/*' -not -path '*/dist/*' 2>/dev/null | head -1 | grep -q .; }

configs=$(find "$root" -maxdepth 4 \( -name 'eslint.config.mjs' -o -name 'eslint.config.js' -o -name 'eslint.config.ts' -o -name '.eslintrc*' \) \
  -not -path '*/node_modules/*' -not -path '*/.nuxt/*' 2>/dev/null)

vue_layer_present=0
vue_config_seen=0
if [ -n "$configs" ]; then
  while IFS= read -r c; do
    if vue_under "$(dirname "$c")"; then
      vue_config_seen=1
      if grep -qE '@nuxt/eslint|eslint-plugin-vue|withNuxt' "$c"; then
        vue_layer_present=1
      else
        printf 'MER-TO-005\twarn\t%s:1\teslint config does not reference the Vue layer (@nuxt/eslint / eslint-plugin-vue) — that layer is eslint'"'"'s only job here\ttools.md#linting-and-formatting\n' "${c#"$root"/}"
      fi
    else
      printf 'MER-TO-005\twarn\t%s:0\teslint config in an app with no .vue files — oxlint owns non-Vue linting; remove the eslint layer\ttools.md#linting-and-formatting\n' "${c#"$root"/}"
    fi
  done <<<"$configs"
fi

# the per-config "does not reference the Vue layer" finding is the actionable one;
# only report missing-entirely when no vue-subtree config exists at all
if vue_under "$root" && [ "$vue_layer_present" -eq 0 ] && [ "$vue_config_seen" -eq 0 ]; then
  printf 'MER-TO-005\twarn\teslint.config.mjs:0\trepo has .vue files but no Vue-layer eslint config — oxlint cannot lint Vue templates; add the @nuxt/eslint layer\ttools.md#linting-and-formatting\n'
fi
exit 0
