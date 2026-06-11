#!/usr/bin/env bash
# MER-BE-052 — the canonical error envelope is ErrorResponse(Code, Message, Errors):
# one general type for .Returns<>(4xx) and one edge conversion. Fork settled
# 2026-06-10: flag *ErrorDto declarations (speechscribe's ValidationErrorDto style).
# DOC: backend-pa-vsa.md#error-envelope
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e '\b(record|class|struct)\s+\w*ErrorDto\b' \
  -g '*.cs' -g '!**/obj/**' -g '!**/bin/**' \
  "$root" 2>/dev/null | while IFS=: read -r f l _; do
  printf 'MER-BE-052\twarn\t%s:%s\tuse the canonical ErrorResponse(Code, Message, Errors) envelope — no *ErrorDto variants\tbackend-pa-vsa.md#error-envelope\n' "${f#"$root"/}" "$l"
done
exit 0
