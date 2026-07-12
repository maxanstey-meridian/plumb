#!/usr/bin/env bash
# MER-BE-010 — every XModule.cs exposes an IServiceCollection extension named
# AddX*Module; executables compose it directly or through one aggregate extension.
# DOC: backend-pa-vsa.md#standard-module-shape
root="$1"; [ -d "$root" ] || exit 2
find "$root" -type d -name Modules -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while read -r modules; do
  project=$(dirname "$modules")
  find "$modules" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while read -r module; do
    name=$(basename "$module")
    registration="$module/${name}Module.cs"
    extension=""
    if [ -f "$registration" ]; then
      extension=$(perl -0777 -ne 'if (/\b(Add'"$name"'[A-Za-z0-9_]*Module)\s*\(\s*this\s+(?:[A-Za-z_][A-Za-z0-9_.]*\.)?IServiceCollection\b/s) { print $1 }' "$registration")
    fi
    if [ -z "$extension" ]; then
      printf 'MER-BE-010\twarn\t%s:0\tmodule %s must expose an Add%s*Module IServiceCollection extension from %sModule.cs\tbackend-pa-vsa.md#standard-module-shape\n' "${module#"$root"/}" "$name" "$name" "$name"
      continue
    fi
    program=$(find "$project" -name Program.cs -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | head -1)
    if [ -n "$program" ] && ! rg -q "\\.${extension}\\s*\\(" "$program"; then
      composed=0
      while IFS= read -r aggregate; do
        rg -q "\\.${aggregate}\\s*\\(" "$program" && { composed=1; break; }
      done < <(rg -l "\\.${extension}\\s*\\(" -g '*.cs' -g '!**/obj/**' -g '!**/bin/**' "$project" 2>/dev/null \
        | while IFS= read -r f; do
            perl -0777 -ne 'while (/\b(Add[A-Za-z0-9_]+)\s*\(\s*this\s+(?:[A-Za-z_][A-Za-z0-9_.]*\.)?IServiceCollection\b[\s\S]*?\.'"$extension"'\s*\(/g) { print "$1\n" }' "$f"
          done | sort -u)
      if [ "$composed" -eq 0 ]; then
        printf 'MER-BE-010\twarn\t%s:0\texecutable must compose %s directly or through a called aggregate extension\tbackend-pa-vsa.md#standard-module-shape\n' "${program#"$root"/}" "$extension"
      fi
    fi
  done
done
exit 0
