#!/usr/bin/env bash
# MER-RV-008 — Program composes MapXEndpoints; business handlers do not live inline.
# Simple root and health endpoints are operational exceptions.
# DOC: rivet.md#endpoint-composition
root="$1"; [ -d "$root" ] || exit 2
find "$root" -name Program.cs -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while read -r program; do
  project=$(dirname "$program")
  FILE="$program" perl -0777 -ne '
    sub blank { my $s = shift; $s =~ s/[^\r\n]/ /g; return $s; }
    $source = $_; $scan = $_;
    $scan =~ s{"{3}.*?"{3}|(?:\$?@|@\$)"(?:""|[^"])*"|\$?"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27|/\*.*?\*/|//[^\r\n]*}{blank($&)}gse;
    while ($scan =~ /\.Map([A-Za-z_]\w*)\s*\(/g) {
      $name = $1; next if $name eq "Group" || $name =~ /Endpoints$/;
      $start = $-[0]; $open = pos($scan) - 1;
      $argument = $open + 1; $argument++ while substr($scan, $argument, 1) =~ /\s/;
      next if substr($scan, $argument, 1) eq ")";
      $tail = substr($source, $open + 1);
      if ($tail =~ /^\s*"((?:\\.|[^"\\])*)"/s) {
        $route = $1; next if $route eq "/" || $route =~ m{^/(?:api/)?health(?:/|$)};
      }
      $line = 1 + (substr($scan, 0, $start) =~ tr/\n//); print "$ENV{FILE}\t$line\n";
    }
  ' "$program" | while IFS=$'\t' read -r _ l; do
    printf 'MER-RV-008\twarn\t%s:%s\tcompose MapXEndpoints in Program.cs instead of inline business endpoint handlers\trivet.md#endpoint-composition\n' "${program#"$root"/}" "$l"
  done
  rg -o --no-filename '\bMap[A-Za-z_][A-Za-z0-9_]*Endpoints\s*\(' -g '*Endpoints.cs' -g '!**/obj/**' -g '!**/bin/**' "$project" 2>/dev/null \
  | sed -E 's/[[:space:]]*\($//' | sort -u | while read -r mapping; do
    if ! PROGRAM="$program" MAPPING="$mapping" perl -0777 -ne '
      sub blank { my $s = shift; $s =~ s/[^\r\n]/ /g; return $s; }
      s{"{3}.*?"{3}|(?:\$?@|@\$)"(?:""|[^"])*"|\$?"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27|/\*.*?\*/|//[^\r\n]*}{blank($&)}gse;
      exit 0 if /\.\Q$ENV{MAPPING}\E\s*\(/;
      exit 1;
    ' "$program"; then
      printf 'MER-RV-008\twarn\t%s:0\tProgram.cs must compose %s\trivet.md#endpoint-composition\n' "${program#"$root"/}" "$mapping"
    fi
  done
done
exit 0
