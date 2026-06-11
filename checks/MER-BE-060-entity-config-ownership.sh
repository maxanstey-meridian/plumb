#!/usr/bin/env bash
# MER-BE-060 — entity-config ownership (contract §9.4): IEntityTypeConfiguration<T>
# lives in the Infrastructure of the module that owns T. A config in module X for
# an entity declared in module Y's Domain is a boundary leak; a config outside any
# module (centralised persistence dir) erodes module ownership of the mapping.
# casebridge's Modules/<X>/Infrastructure/Persistence/ layout is the golden shape.
# DOC: backend-pa-vsa.md#persistence
root="$1"; [ -d "$root" ] || exit 2

configs=$(rg -n --no-heading -o 'class\s+\w+\s*:[^{]*IEntityTypeConfiguration<(\w+)>' -r '$1' \
  -g '*.cs' -g '!**/obj/**' -g '!**/bin/**' "$root" 2>/dev/null)
[ -n "$configs" ] || exit 0

while IFS=: read -r f l entity; do
  relf="${f#"$root"/}"
  case "$relf" in
    *Modules/*)
      cfg_mod=$(printf '%s' "$relf" | sed -E 's|.*Modules/([^/]+)/.*|\1|')
      # find the entity's declaring module (class/record <entity> under Modules/*/Domain)
      decl=$(rg -l --no-heading "\b(class|record)\s+$entity\b" -g '*.cs' -g '!**/obj/**' "$root" 2>/dev/null | grep "Modules/.*/Domain/" | head -1)
      if [ -n "$decl" ]; then
        ent_mod=$(printf '%s' "${decl#"$root"/}" | sed -E 's|.*Modules/([^/]+)/.*|\1|')
        if [ "$ent_mod" != "$cfg_mod" ]; then
          printf 'MER-BE-060\twarn\t%s:%s\tentity config for %s lives in module %s but the entity belongs to %s — the owning module maps its own entities\tbackend-pa-vsa.md#persistence\n' "$relf" "$l" "$entity" "$cfg_mod" "$ent_mod"
        fi
      fi
      ;;
    *)
      # config outside any module tree — centralised mapping erodes ownership
      printf 'MER-BE-060\twarn\t%s:%s\tentity config for %s lives outside Modules/ — entity mapping belongs in the owning module'"'"'s Infrastructure\tbackend-pa-vsa.md#persistence\n' "$relf" "$l" "$entity"
      ;;
  esac
done <<<"$configs"
exit 0
