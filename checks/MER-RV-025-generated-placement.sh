#!/usr/bin/env bash
# MER-RV-025 — generated Rivet output is a workspace package (packages/contracts),
# not an in-app dir like ui/generated/rivet. Fork settled 2026-06-10: the package
# boundary makes read-only structural. One repo-level finding per offending dir.
# DOC: rivet.md#generated-output
root="$1"; [ -d "$root" ] || exit 2
find "$root" -type d \( -path '*generated/rivet' -o -path '*contracts/generated' \) \
  -not -path '*/node_modules/*' -not -path "*/packages/*" 2>/dev/null \
| while read -r g; do
  printf 'MER-RV-025\twarn\t%s:0\tgenerated output lives in a workspace packages/contracts package, not inside the app — the package boundary makes read-only structural\trivet.md#generated-output\n' "${g#"$root"/}"
done
exit 0
