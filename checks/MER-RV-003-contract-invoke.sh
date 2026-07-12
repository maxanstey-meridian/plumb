#!/usr/bin/env bash
# MER-RV-003 — when a controller handler attribute references Contract.Member.Route,
# that following handler block should call the same Contract.Member.Invoke.
# This is a lexical, handler-scoped review warning, not semantic coverage proof.
# DOC: rivet.md#practical-rules
root="$1"; [ -d "$root" ] || exit 2
find "$root" \( -name '*Controller.cs' -o -name '*Endpoints.cs' \) -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while read -r f; do
  FILE="$f" perl -0777 -ne '
    sub inspect {
      my ($route, $start, $block) = @_;
      return if $block =~ /\Q$route\E\.Invoke\s*\(/;
      my $line = 1 + (substr($_, 0, $start) =~ tr/\n//);
      print "$ENV{FILE}\t$line\t$route\n";
    }
    sub method_block {
      my ($text) = @_;
      return $text unless $text =~ /\b(?:public|internal|private|protected)\s+[^;{}=]+?\b[A-Za-z_]\w*\s*\(/s;
      my $start = $-[0]; my $after = $+[0];
      if (substr($text, $after) =~ /\b(?:public|internal|private|protected)\s+[^;{}=]+?\b[A-Za-z_]\w*\s*\(/s) {
        return substr($text, $start, $after + $-[0] - $start);
      }
      return substr($text, $start);
    }
    while (/\[Http(?:Get|Post|Put|Delete|Patch)\s*\([^\]]*?\b([A-Za-z_]\w*Contract\.[A-Za-z_]\w*)\.Route\b[^\]]*\)\s*\](.*?)(?=\[Http(?:Get|Post|Put|Delete|Patch)\b|\z)/sg) {
      my ($route, $start, $tail) = ($1, $-[0], $2);
      inspect($route, $start, method_block($tail));
    }
    pos($_) = 0;
    while (/\[Route\s*\([^\]]*?\b([A-Za-z_]\w*Contract)\.BaseRoute\b[^\]]*\)\s*\][^\{]*\bclass\b[^\{]*\{/g) {
      my $contract = $1; my $open = pos($_) - 1; my $depth = 1; my $end = $open + 1;
      while ($end < length($_) && $depth) {
        $depth++ if substr($_, $end, 1) eq "{";
        $depth-- if substr($_, $end, 1) eq "}";
        $end++;
      }
      my $body = substr($_, $open + 1, $end - $open - 2);
      while ($body =~ /\[Http(?:Get|Post|Put|Delete|Patch)(?:\s*\(([^\]]*)\))?\s*\](.*?)(?=\[Http(?:Get|Post|Put|Delete|Patch)\b|\z)/sg) {
        my ($attribute_route, $tail, $attribute_start) = ($1, $2, $-[0]);
        my $handler = method_block($tail);
        next if defined($attribute_route) && $attribute_route =~ /\b[A-Za-z_]\w*Contract\.[A-Za-z_]\w*\.Route\b/;
        next unless $handler =~ /\b(?:public|internal|private|protected)\s+[^;{}=]+?\b([A-Za-z_]\w*)\s*\(/s;
        my $method = $1;
        inspect("$contract.$method", $open + 1 + $attribute_start, $handler);
      }
      pos($_) = $end;
    }
    pos($_) = 0;
    while (/\bMap(?:Get|Post|Put|Delete|Patch)\s*\(\s*\b([A-Za-z_]\w*Contract\.[A-Za-z_]\w*)\.Route\b\s*,/g) {
      my $route = $1; my $start = $-[0]; my $open = index($_, "(", $start);
      my $depth = 1; my $end = $open + 1;
      while ($end < length($_) && $depth) {
        $depth++ if substr($_, $end, 1) eq "(";
        $depth-- if substr($_, $end, 1) eq ")";
        $end++;
      }
      inspect($route, $start, substr($_, $open + 1, $end - $open - 2));
      pos($_) = $end;
    }
  ' "$f"
done | while IFS=$'\t' read -r f l route; do
  printf 'MER-RV-003\twarn\t%s:%s\thandler route references %s but the following handler block has no matching .Invoke call\trivet.md#practical-rules\n' "${f#"$root"/}" "$l" "$route"
done
exit 0
