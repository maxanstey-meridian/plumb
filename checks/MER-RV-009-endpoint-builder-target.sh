#!/usr/bin/env bash
# MER-RV-009 — endpoint composition extends IEndpointRouteBuilder, not WebApplication.
# DOC: rivet.md#endpoint-composition
root="$1"; [ -d "$root" ] || exit 2
find "$root" -name '*Endpoints.cs' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while IFS= read -r f; do
  FILE="$f" perl -0777 -ne '
    while (/\bMap[A-Za-z_][A-Za-z0-9_]*Endpoints\s*\(\s*this\s+((?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+[A-Za-z_]\w*/g) {
      $type = $1; $type =~ s/^global:://;
      next if $type eq "IEndpointRouteBuilder" || $type eq "Microsoft.AspNetCore.Routing.IEndpointRouteBuilder";
      $line = 1 + (substr($_, 0, $-[0]) =~ tr/\n//);
      print "$ENV{FILE}\t$line\n";
    }
  ' "$f"
done | while IFS=$'\t' read -r f l; do
  printf 'MER-RV-009\twarn\t%s:%s\tMapXEndpoints extensions must target Microsoft.AspNetCore.Routing.IEndpointRouteBuilder\trivet.md#endpoint-composition\n' "${f#"$root"/}" "$l"
done
exit 0
