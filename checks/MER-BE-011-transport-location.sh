#!/usr/bin/env bash
# MER-BE-011 — controllers sit at the module root; Interface/ is not a transport layer.
# DOC: backend-pa-vsa.md#standard-module-shape
root="$1"; [ -d "$root" ] || exit 2
find "$root" -path '*/Modules/*/*' -name '*Controller.cs' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while read -r f; do
  suffix="${f#*/Modules/}"; after_module="${suffix#*/}"
  if [[ "$after_module" == */* ]]; then
    printf 'MER-BE-011\twarn\t%s:0\tcontrollers live at the module root; do not create an Interface/ transport folder\tbackend-pa-vsa.md#standard-module-shape\n' "${f#"$root"/}"
  fi
done
find "$root" -path '*/Modules/*/Interface/*' -name '*.cs' ! -name '*Controller.cs' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while read -r f; do
  printf 'MER-BE-011\twarn\t%s:0\ttransport must not be placed in an Interface/ folder; keep endpoints/controllers at the module root\tbackend-pa-vsa.md#standard-module-shape\n' "${f#"$root"/}"
done
exit 0
