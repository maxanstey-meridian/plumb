#!/usr/bin/env bash
# MER-TO-010 — SDK pinned with global.json: .NET 10, rollForward latestFeature
# DOC: tools.md#default-stack-1
root="$1"; [ -d "$root" ] || exit 2
cs=$(find "$root" -name '*.csproj' -not -path '*/obj/*' -not -path '*/node_modules/*' 2>/dev/null | head -1)
[ -n "$cs" ] || exit 0
gj=$(find "$root" -maxdepth 3 -name 'global.json' -not -path '*/node_modules/*' 2>/dev/null | head -1)
if [ -z "$gj" ]; then
  printf 'MER-TO-010\terror\t.:0\tno global.json — pin the SDK (.NET 10, rollForward latestFeature)\ttools.md#default-stack-1\n'
else
  rel="${gj#"$root"/}"
  grep -q '"10\.' "$gj" || printf 'MER-TO-010\terror\t%s:0\tglobal.json does not pin .NET 10\ttools.md#default-stack-1\n' "$rel"
  grep -q 'latestFeature' "$gj" || printf 'MER-TO-010\twarn\t%s:0\tset rollForward to latestFeature\ttools.md#default-stack-1\n' "$rel"
fi
exit 0
