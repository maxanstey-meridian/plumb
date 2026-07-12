#!/usr/bin/env bash
# MER-BE-009 — explicit System.IServiceProvider fields/constructor parameters in
# Domain/Application indicate service location. The shell check deliberately does
# not infer semantics from GetService-like method names.
# DOC: backend-pa-vsa.md#non-negotiable-dependency-rules
root="$1"; [ -d "$root" ] || exit 2
find "$root" \( -path '*/Modules/*/Domain/*' -o -path '*/Modules/*/Application/*' \) -name '*.cs' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null \
| while IFS= read -r f; do
    FILE="$f" perl -0777 -ne '
      sub blank { my $s = shift; $s =~ s/[^\r\n]/ /g; return $s; }
      $code = $_;
      $code =~ s{"{3}.*?"{3}|(?:\$?@|@\$)"(?:""|[^"])*"|\$?"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27|/\*.*?\*/|//[^\r\n]*}{blank($&)}gse;
      $type = qr/(?:(?:global::)?System\.)?IServiceProvider/;
      %lines = ();
      while ($code =~ /\b(?:private|protected|internal|public)\s+(?:(?:static|readonly)\s+)*$type\s*\??\s+[_A-Za-z]\w*\s*[;=]/g) {
        $lines{1 + (substr($code, 0, $-[0]) =~ tr/\n//)} = 1;
      }
      while ($code =~ /\b(?:public|internal|private|protected)\s+(?:sealed\s+|abstract\s+|partial\s+)*class\s+\w+(?:\s*<[^>{}]+>)?\s*\([^)]*?$type\s*\??\s+[_A-Za-z]\w*/g) {
        $lines{1 + (substr($code, 0, $-[0]) =~ tr/\n//)} = 1;
      }
      while ($code =~ /\b(?:public|internal|private|protected)\s+\w+\s*\([^)]*?$type\s*\??\s+[_A-Za-z]\w*/g) {
        $lines{1 + (substr($code, 0, $-[0]) =~ tr/\n//)} = 1;
      }
      print "$ENV{FILE}\t$_\n" for sort { $a <=> $b } keys %lines;
    ' "$f"
  done | while IFS=$'\t' read -r f l; do
  printf 'MER-BE-009\terror\t%s:%s\tSystem.IServiceProvider hides dependencies; inject the required port directly\tbackend-pa-vsa.md#non-negotiable-dependency-rules\n' "${f#"$root"/}" "$l"
done
exit 0
