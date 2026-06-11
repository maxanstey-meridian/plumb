#!/usr/bin/env bash
# MER-BE-013 — "no MediatR"; explicit calls, explicit dependencies
# DOC: backend-pa-vsa.md#net (and SKILL.md CQRS-lite)
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading -e 'using MediatR' -e '\bIMediator\b' -e '\bISender\b' -e '"MediatR' \
  -g '*.cs' -g '*.csproj' -g '!**/obj/**' "$root" 2>/dev/null | while IFS=: read -r f l _; do
  printf 'MER-BE-013\terror\t%s:%s\tno MediatR — call use cases directly: useCase.ExecuteAsync(command, ct)\tbackend-pa-vsa.md#net\n' "${f#"$root"/}" "$l"
done
exit 0
