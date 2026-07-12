#!/usr/bin/env bash
# MER-BE-054 — Rivet/API repos use one exact canonical ErrorResponse declaration.
# DOC: backend-pa-vsa.md#error-envelope
root="$1"; [ -d "$root" ] || exit 2
if ! rg -q '\[RivetContract\b|\b(MapControllers|AddControllers)\s*\(|\.Map(Get|Post|Put|Delete|Patch)\s*\(' -g '*.cs' -g '!**/obj/**' -g '!**/bin/**' "$root" 2>/dev/null; then
  exit 0
fi
matches=$(rg -n --no-heading -P '\b(?:record\s+(?:class\s+|struct\s+)?|class\s+|struct\s+)ErrorResponse\b' -g '*.cs' -g '!**/obj/**' -g '!**/bin/**' "$root" 2>/dev/null)
[ -z "$matches" ] && exit 0
count=$(printf '%s\n' "$matches" | wc -l | tr -d ' ')
if [ "$count" -gt 1 ]; then
  printf '%s\n' "$matches" | while IFS=: read -r f l _; do
    printf 'MER-BE-054\twarn\t%s:%s\tErrorResponse must have one canonical declaration; duplicate found\tbackend-pa-vsa.md#error-envelope\n' "${f#"$root"/}" "$l"
  done
fi
printf '%s\n' "$matches" | cut -d: -f1 | sort -u | while IFS= read -r f; do
  if ! perl -0777 -ne 'exit(/\bsealed\s+record(?:\s+class)?\s+ErrorResponse\s*\(\s*string\s+Code\s*,\s*string\s+Message\s*,\s*IReadOnlyDictionary\s*<\s*string\s*,\s*string\s*\[\s*\]\s*>\s*\?\s*Errors\s*=\s*null\s*\)\s*;/s ? 0 : 1)' "$f"; then
    printf 'MER-BE-054\twarn\t%s:0\tErrorResponse must be sealed record ErrorResponse(string Code, string Message, IReadOnlyDictionary<string, string[]>? Errors = null)\tbackend-pa-vsa.md#error-envelope\n' "${f#"$root"/}"
  fi
done
exit 0
