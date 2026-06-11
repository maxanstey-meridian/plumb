#!/usr/bin/env bash
# MER-BE-003/004/005 — "Never cross; always Common" (FABLE_CONTRACT.md §9):
# any Modules.X reference to Modules.Y.* is a violation; cross-module ports live in Common/Ports only.
# DOC: backend-pa-vsa.md#across-modules
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e 'using\s+[A-Za-z0-9_.]*Modules\.[A-Za-z0-9_]+' -g '*.cs' -g '!**/obj/**' "$root" 2>/dev/null \
| while IFS=: read -r f l rest; do
  case "$f" in */Modules/*) ;; *) continue ;; esac
  owner="${f#*/Modules/}"; owner="${owner%%/*}"
  target=$(printf '%s' "$rest" | sed -nE 's/.*Modules\.([A-Za-z0-9_]+).*/\1/p')
  [ -n "$target" ] && [ "$target" != "$owner" ] || continue
  rel="${f#"$root"/}"
  case "$rest" in
    *"Modules.$target.Domain"*)
      printf 'MER-BE-003\terror\t%s:%s\tmodule %s must not use %s.Domain — never cross; always Common\tbackend-pa-vsa.md#across-modules\n' "$rel" "$l" "$owner" "$target" ;;
    *"Modules.$target.Infrastructure"*)
      printf 'MER-BE-004\terror\t%s:%s\tmodule %s must not use %s.Infrastructure — never cross; always Common\tbackend-pa-vsa.md#across-modules\n' "$rel" "$l" "$owner" "$target" ;;
    *)
      printf 'MER-BE-005\terror\t%s:%s\tmodule %s must not reference module %s — cross-module ports live in Common/Ports only\tbackend-pa-vsa.md#across-modules\n' "$rel" "$l" "$owner" "$target" ;;
  esac
done
exit 0
