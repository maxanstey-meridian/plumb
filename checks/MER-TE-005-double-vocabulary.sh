#!/usr/bin/env bash
# MER-TE-005 — test doubles are hand-rolled fakes named Fake*/InMemory*/Inline*
# (TestSupport convention). Fork settled 2026-06-10. Mechanical slice: Mock*/Stub*
# class names in test code are the wrong vocabulary — a double that fakes behavior
# is a Fake; NSubstitute (unnamed, at a narrow seam) is legal and never flagged here.
# DOC: testing-philosophy.md#test-doubles
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e '\b(class|record)\s+(Mock|Stub)[A-Z]\w*' \
  -g '*.cs' -g '*.ts' -g '!**/obj/**' -g '!**/bin/**' -g '!**/node_modules/**' \
  "$root" 2>/dev/null | while IFS=: read -r f l _; do
  case "$f" in
    *Tests.cs|*[Tt]ests/*|*__tests__*|*TestSupport/*|*.spec.ts|*.test.ts) ;;
    *) continue ;;
  esac
  printf 'MER-TE-005\twarn\t%s:%s\ttest doubles are Fake*/InMemory*/Inline* — Mock*/Stub* is the wrong vocabulary for a hand-rolled double\ttesting-philosophy.md#test-doubles\n' "${f#"$root"/}" "$l"
done
exit 0
