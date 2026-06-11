#!/usr/bin/env bash
# MER-RV-001 — "[RivetClient] is the shortcut mode... not the house-style default for serious APIs"
# Calibration 2026-06-10 (~/Sites sweep, the Rivet framework repo): test projects
# excluded — [RivetClient] in test fixtures exercises the attribute, it is not a
# public API surface; the doctrine targets "serious APIs".
# DOC: rivet.md#rivetclient-vs-rivetcontract
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e '\[RivetClient\]' -g '*.cs' -g '!**/obj/**' -g '!**/*Tests/**' -g '!**/*.Tests.*/**' -g '!**/*Tests.cs' "$root" 2>/dev/null \
| while IFS=: read -r f l _; do
  printf 'MER-RV-001\twarn\t%s:%s\tprefer an explicit [RivetContract] contract class — [RivetClient] is the shortcut mode\trivet.md#rivetclient-vs-rivetcontract\n' "${f#"$root"/}" "$l"
done
exit 0
