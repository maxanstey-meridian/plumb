#!/usr/bin/env bash
# MER-BE-022 — use case signature: ExecuteAsync(Command command, CancellationToken cancellationToken)
# Only ExecuteAsync method declarations inside *UseCase class bodies are checked.
# Calls to ExecuteAsync are never interpreted as declarations.
# DOC: backend-pa-vsa.md#net
root="$1"; [ -d "$root" ] || exit 2
find "$root" -path '*/Modules/*' -name '*UseCase.cs' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while read -r f; do
  FILE="$f" perl -0777 -ne '
    sub blank { my $s = shift; $s =~ s/[^\r\n]/ /g; return $s; }
    sub has_token_parameter {
      my ($parameters) = @_;
      my @parts = (); my $part = ""; my ($angle, $paren, $square, $brace) = (0, 0, 0, 0);
      for my $char (split //, $parameters) {
        if ($char eq "," && !$angle && !$paren && !$square && !$brace) { push @parts, $part; $part = ""; next; }
        $part .= $char;
        $angle++ if $char eq "<"; $angle-- if $char eq ">" && $angle;
        $paren++ if $char eq "("; $paren-- if $char eq ")" && $paren;
        $square++ if $char eq "["; $square-- if $char eq "]" && $square;
        $brace++ if $char eq "{"; $brace-- if $char eq "}" && $brace;
      }
      push @parts, $part;
      for my $parameter (@parts) {
        my $top = ""; ($angle, $paren, $square, $brace) = (0, 0, 0, 0);
        for my $char (split //, $parameter) {
          if ($char eq "<") { $angle++; $top .= " "; next; }
          if ($char eq ">" && $angle) { $angle--; $top .= " "; next; }
          if ($char eq "(") { $paren++; $top .= " "; next; }
          if ($char eq ")" && $paren) { $paren--; $top .= " "; next; }
          if ($char eq "[") { $square++; $top .= " "; next; }
          if ($char eq "]" && $square) { $square--; $top .= " "; next; }
          if ($char eq "{") { $brace++; $top .= " "; next; }
          if ($char eq "}" && $brace) { $brace--; $top .= " "; next; }
          $top .= (!$angle && !$paren && !$square && !$brace) ? $char : " ";
        }
        return 1 if $top =~ /\b(?:(?:global::)?System\.Threading\.)?CancellationToken\s*\??\s+[_A-Za-z]\w*(?:\s*=.*)?\s*$/s;
      }
      return 0;
    }
    $code = $_;
    $code =~ s{"{3}.*?"{3}|(?:\$?@|@\$)"(?:""|[^"])*"|\$?"(?:\\.|[^"\\])*"|\x27(?:\\.|[^\x27\\])*\x27|/\*.*?\*/|//[^\r\n]*}{blank($&)}gse;
    while ($code =~ /\bclass\s+(\w*UseCase)\b[^\{]*\{/g) {
      $class_start = $-[0]; $open = pos($code) - 1; $depth = 1; $end = $open + 1;
      while ($end < length($code) && $depth) {
        $depth++ if substr($code, $end, 1) eq "{";
        $depth-- if substr($code, $end, 1) eq "}";
        $end++;
      }
      $body = substr($code, $open + 1, $end - $open - 2);
      $has_execute = 0;
      while ($body =~ /\b(?:public|internal|private|protected)\s+(?:static\s+)?(?:async\s+)?[A-Za-z_][A-Za-z0-9_<>,.?\[\]\s]*\s+ExecuteAsync\s*\(/sg) {
        $has_execute = 1;
        $parameter_open = pos($body) - 1; $parameter_end = $parameter_open + 1; $parameter_depth = 1;
        while ($parameter_end < length($body) && $parameter_depth) {
          $parameter_depth++ if substr($body, $parameter_end, 1) eq "(";
          $parameter_depth-- if substr($body, $parameter_end, 1) eq ")";
          $parameter_end++;
        }
        $parameters = substr($body, $parameter_open + 1, $parameter_end - $parameter_open - 2);
        next if has_token_parameter($parameters);
        $absolute = $open + 1 + $-[0];
        $line = 1 + (substr($code, 0, $absolute) =~ tr/\n//);
        print "$ENV{FILE}\t$line\ttoken\n";
        pos($body) = $parameter_end;
      }
      unless ($has_execute) {
        $line = 1 + (substr($code, 0, $class_start) =~ tr/\n//);
        print "$ENV{FILE}\t$line\tmissing\n";
      }
      pos($code) = $end;
    }
  ' "$f"
done | while IFS=$'\t' read -r f l kind; do
  if [ "$kind" = missing ]; then
    printf 'MER-BE-022\terror\t%s:%s\tUseCase class must declare ExecuteAsync\tbackend-pa-vsa.md#net\n' "${f#"$root"/}" "$l"
  else
    printf 'MER-BE-022\terror\t%s:%s\tExecuteAsync must take a CancellationToken\tbackend-pa-vsa.md#net\n' "${f#"$root"/}" "$l"
  fi
done
exit 0
