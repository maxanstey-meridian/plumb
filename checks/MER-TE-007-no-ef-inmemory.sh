#!/usr/bin/env bash
# MER-TE-007 — integration tests run on a real database engine (contract §9.6).
# The EF InMemory provider validates neither SQL nor relational behavior; use
# Testcontainers (casebridge PostgresFixture is the golden example) or
# SQLite-in-memory. Calibration 2026-06-10: cohort's 5 hits are real.
# DOC: testing-philosophy.md#test-substrate
root="$1"; [ -d "$root" ] || exit 2
# one finding per file (first hit) — a suite built on the provider repeats the
# call dozens of times; per-call findings are noise, the file is the unit of fix
rg -n --no-heading '\bUseInMemoryDatabase\s*\(' -g '*.cs' -g '!**/obj/**' -g '!**/bin/**' "$root" 2>/dev/null \
| sort -t: -k1,1 -k2,2n | awk -F: '!seen[$1]++' | while IFS=: read -r f l _; do
  printf 'MER-TE-007\twarn\t%s:%s\tEF InMemory provider in tests — it validates neither SQL nor relational behavior; use Testcontainers or SQLite-in-memory\ttesting-philosophy.md#test-substrate\n' "${f#"$root"/}" "$l"
done
exit 0
