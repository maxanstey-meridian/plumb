#!/usr/bin/env bash
# MER-BE-020 — "sealed on all concrete types"
# Encoded exceptions (calibrated 2026-06-10 on casebridge): Temporal workflow classes
# (proxy generation requires unsealed), open-generic validators (AbstractValidator<T>).
# DOC: backend-pa-vsa.md#net
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e '^\s*public\s+(partial\s+)?class\s+[A-Za-z0-9_]+' \
  -g '**/Modules/**/*.cs' -g '!**/obj/**' "$root" 2>/dev/null \
| grep -vE 'class\s+[A-Za-z0-9_]*Workflow\b|AbstractValidator<' \
| while IFS=: read -r f l _; do
  printf 'MER-BE-020\twarn\t%s:%s\tconcrete classes in Modules must be sealed (exceptions: Temporal workflows, open-generic validators)\tbackend-pa-vsa.md#net\n' "${f#"$root"/}" "$l"
done
exit 0
