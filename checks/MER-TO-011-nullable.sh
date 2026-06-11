#!/usr/bin/env bash
# MER-TO-011 — nullable + implicit usings enabled in every project
# Exception: a Directory.Build.props that sets them covers all projects beneath it.
# DOC: tools.md#default-stack-1
root="$1"; [ -d "$root" ] || exit 2
if find "$root" -name 'Directory.Build.props' -not -path '*/node_modules/*' 2>/dev/null \
   | xargs grep -l '<Nullable>enable' 2>/dev/null | grep -q .; then
  exit 0
fi
find "$root" -name '*.csproj' -not -path '*/obj/*' -not -path '*/bin/*' -not -path '*/node_modules/*' 2>/dev/null \
| while read -r f; do
  rel="${f#"$root"/}"
  grep -q '<Nullable>enable' "$f" || \
    printf 'MER-TO-011\terror\t%s:0\tenable nullable reference types\ttools.md#default-stack-1\n' "$rel"
  grep -q '<ImplicitUsings>enable' "$f" || \
    printf 'MER-TO-011\terror\t%s:0\tenable implicit usings\ttools.md#default-stack-1\n' "$rel"
done
exit 0
