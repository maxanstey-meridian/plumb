#!/usr/bin/env bash
# MER-TE-002 — mock-density heuristic: >5 Substitute.For / vi.mock in one test file
# is mock soup. Fork settled 2026-06-10: density is the smell, not presence —
# NSubstitute at a narrow seam is legal; this stays info, advisory only.
# DOC: testing-philosophy.md#mocks
root="$1"; [ -d "$root" ] || exit 2
rg -c --no-heading -e 'Substitute\.For<' -e '\bvi\.mock\s*\(' \
  -g '*.cs' -g '*.ts' -g '!**/obj/**' -g '!**/bin/**' -g '!**/node_modules/**' \
  "$root" 2>/dev/null | while IFS=: read -r f n; do
  case "$f" in
    *Tests.cs|*[Tt]ests/*|*.spec.ts|*.test.ts|*__tests__*) ;;
    *) continue ;;
  esac
  [ "$n" -gt 5 ] || continue
  printf 'MER-TE-002\tinfo\t%s:0\t%s mock constructions in one test file — mock soup; prefer a hand-rolled fake for the dominant collaborator\ttesting-philosophy.md#mocks\n' "${f#"$root"/}" "$n"
done
exit 0
