#!/usr/bin/env bash
# MER-RV-020 — generated output is read-only; every file carries the generated header
# Calibration 2026-06-10 (casebridge): compiled artifacts (build/, dist/, *.d.ts) are
# derived from generated code, not hand-written — excluded.
# DOC: coding-philosophy.md#generated-code
root="$1"; [ -d "$root" ] || exit 2
find "$root" -type d \( -path '*generated/rivet' -o -path '*contracts/generated' \) -not -path '*/node_modules/*' 2>/dev/null \
| while read -r g; do
  find "$g" -name '*.ts' -not -name '*.d.ts' -not -path '*/build/*' -not -path '*/dist/*' | while read -r f; do
    head -5 "$f" | grep -qiE 'generated|do not edit' || \
      printf 'MER-RV-020\terror\t%s:1\thand-written or header-stripped file inside generated output — generated dirs are read-only\tcoding-philosophy.md#generated-code\n' "${f#"$root"/}"
  done
done
exit 0
