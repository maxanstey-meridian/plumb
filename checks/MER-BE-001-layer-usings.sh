#!/bin/bash
# MER-BE-001 — Domain/ files: no using of any *.Application.* / *.Infrastructure.*
# namespace and no framework/SDK usings (AspNetCore, EF Core, Npgsql, Azure, HTTP
# clients). "Domain depends on nothing outside itself."
# MER-BE-002 — Application/ files: no using of *.Infrastructure.* namespaces or
# infrastructure packages (EF Core, Npgsql, Azure).
# One pass, two sibling IDs (FABLE_CONTRACT.md §4). Only namespace usings match
# (`using Foo.Bar;`) — disposal `using var x = ...` and alias usings do not.
# DOC: backend-pa-vsa.md#non-negotiable-dependency-rules
set -u
root="$1"

# path<TAB>lineno<TAB>using-target for every namespace using under Modules/
scan() { # $1=layer  $2=forbidden-using regex  $3=rule id  $4=message
  find "$root" -path "*/Modules/*/$1/*" -name "*.cs" \
      -not -path "*/obj/*" -not -path "*/bin/*" -not -path "*/node_modules/*" 2>/dev/null |
  while IFS= read -r f; do
    grep -nE '^[[:space:]]*(global[[:space:]]+)?using[[:space:]]+(static[[:space:]]+)?[A-Za-z_][A-Za-z0-9_.]*[[:space:]]*;' "$f" |
    grep -E "$2" |
    while IFS=: read -r ln line; do
      ns=$(printf '%s' "$line" | sed -E 's/^[[:space:]]*(global[[:space:]]+)?using[[:space:]]+(static[[:space:]]+)?//; s/[[:space:]]*;.*$//')
      rel="${f#"$root"/}"
      printf 'MER-BE-%s\terror\t%s:%s\t%s (%s)\tbackend-pa-vsa.md#non-negotiable-dependency-rules\n' "$3" "$rel" "$ln" "$4" "$ns"
    done
  done
}

FRAMEWORK='Microsoft\.AspNetCore|Microsoft\.EntityFrameworkCore|Npgsql|Azure\.|System\.Net\.Http'
scan "Domain" "\.(Application|Infrastructure)\b|using[[:space:]]+(static[[:space:]]+)?($FRAMEWORK)" \
  "001" "Domain depends on nothing outside itself — remove this using"
scan "Application" "\.Infrastructure\b|using[[:space:]]+(static[[:space:]]+)?(Microsoft\.EntityFrameworkCore|Npgsql|Azure\.)" \
  "002" "Application must not depend on Infrastructure — depend on a port instead"
exit 0
