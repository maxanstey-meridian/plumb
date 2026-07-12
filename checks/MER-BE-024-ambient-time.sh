#!/usr/bin/env bash
# MER-BE-024 — domain time is explicit; Application receives time through a port/input.
# Test files and test projects are excluded.
# DOC: backend-pa-vsa.md#resilience-and-time
root="$1"; [ -d "$root" ] || exit 2
for layer in Domain Application; do
  severity=error; [ "$layer" = Application ] && severity=warn
  find "$root" -path "*/Modules/*/$layer/*" -name '*.cs' -not -path '*Tests*/*' -not -name '*Tests.cs' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null \
  | while IFS= read -r f; do
      FILE="$f" perl -ne '
        if ($block) { if (s/^.*?\*\///) { $block = 0 } else { next } }
        s/@?"(?:[^"]|"")*"//g; s/"(?:\\.|[^"\\])*"//g;
        while (/\/\*/) { $before = $`; $after = $"; if ($after =~ s/^.*?\*\///) { $_ = $before . $after } else { $_ = $before; $block = 1; last } }
        s{//.*$}{};
        if (/\b(?:DateTime|DateTimeOffset)\.(?:Now|UtcNow|Today)\b|\bTimeProvider\.System\b/) { print "$ENV{FILE}\t$.\n" }
      ' "$f"
    done | while IFS=$'\t' read -r f l; do
    printf 'MER-BE-024\t%s\t%s:%s\tambient time in %s; pass time explicitly or depend on an application time port\tbackend-pa-vsa.md#resilience-and-time\n' "$severity" "${f#"$root"/}" "$l" "$layer"
  done
done
exit 0
