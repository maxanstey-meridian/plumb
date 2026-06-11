#!/usr/bin/env bash
# MER-BE-022 — use case signature: ExecuteAsync(Command command, CancellationToken cancellationToken)
# File-level heuristic: a *UseCase.cs with ExecuteAsync but no CancellationToken anywhere.
# DOC: backend-pa-vsa.md#net
root="$1"; [ -d "$root" ] || exit 2
find "$root" -path '*/Modules/*' -name '*UseCase.cs' -not -path '*/obj/*' 2>/dev/null | while read -r f; do
  grep -q 'ExecuteAsync(' "$f" && ! grep -q 'CancellationToken' "$f" && \
    printf 'MER-BE-022\terror\t%s:0\tExecuteAsync must take a CancellationToken\tbackend-pa-vsa.md#net\n' "${f#"$root"/}"
done
exit 0
