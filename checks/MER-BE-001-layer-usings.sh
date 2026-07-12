#!/bin/bash
# PRODUCES: MER-BE-001, MER-BE-002
# MER-BE-001 — Domain/ files: no using of any *.Application.* / *.Infrastructure.*
# namespace and no framework/SDK usings (AspNetCore, EF Core, Npgsql, Azure, HTTP
# clients). "Domain depends on nothing outside itself."
# MER-BE-002 — Application/ files: no using of *.Infrastructure.* namespaces or
# infrastructure and transport packages (EF Core, Npgsql, Azure, ASP.NET Core,
# System.Net.Http). Logging abstractions and FluentResults remain allowed.
# One pass, two sibling IDs (FABLE_CONTRACT.md §4). Namespace usings (including
# aliases) and fully qualified references are checked; disposal `using` is not.
# DOC: backend-pa-vsa.md#non-negotiable-dependency-rules
set -u
root="$1"

# lineno<TAB>reference for namespace usings and dotted references, after masking
# comments and C# literals while retaining newlines for stable diagnostics.
lexical_refs() {
  perl -0777 -ne '
    s{\$*"{3,}.*?"{3,}|//[^\r\n]*|/\*.*?\*/|(?:\$\@|\@\$|\@)"(?:""|[^"])*"|\$?"(?:\\.|[^"\\])*"|q{\x27}(?:\\.|[^\x27\\])*q{\x27}}
     { my $v = $&; $v =~ s/[^\r\n]/ /g; $v }gse;
    my $line_no = 0;
    for my $line (split /\r?\n/, $_, -1) {
      $line_no++;
      my %seen;
      if ($line =~ /^\s*(?:global\s+)?using\s+(?:static\s+)?(?:[A-Za-z_]\w*\s*=\s*)?((?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/) {
        my $target = $1; $target =~ s/^global:://;
        print "$line_no\t$target\n" unless $seen{$target}++;
      }
      while ($line =~ /\b((?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+)\b/g) {
        my $target = $1; $target =~ s/^global:://;
        print "$line_no\t$target\n" unless $seen{$target}++;
      }
    }
  ' "$1"
}

global_using_refs() {
  perl -0777 -ne '
    s{\$*"{3,}.*?"{3,}|//[^\r\n]*|/\*.*?\*/|(?:\$\@|\@\$|\@)"(?:""|[^"])*"|\$?"(?:\\.|[^"\\])*"|q{\x27}(?:\\.|[^\x27\\])*q{\x27}}
     { my $v = $&; $v =~ s/[^\r\n]/ /g; $v }gse;
    my $line_no = 0;
    for my $line (split /\r?\n/, $_, -1) {
      $line_no++;
      if ($line =~ /^\s*global\s+using\s+(?:static\s+)?(?:[A-Za-z_]\w*\s*=\s*)?((?:global::)?[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/) {
        my $target = $1; $target =~ s/^global:://; print "$line_no\t$target\n";
      }
    }
  ' "$1"
}

scan() { # $1=layer  $2=forbidden-reference regex  $3=rule id  $4=message
  find "$root" -path "*/Modules/*/$1/*" -name "*.cs" \
      -not -path "*/obj/*" -not -path "*/bin/*" -not -path "*/node_modules/*" 2>/dev/null |
  while IFS= read -r f; do
    lexical_refs "$f" | while IFS=$'\t' read -r ln ns; do
      [[ "$ns" =~ $2 ]] || continue
      rel="${f#"$root"/}"
      printf 'MER-BE-%s\terror\t%s:%s\t%s (%s)\tbackend-pa-vsa.md#non-negotiable-dependency-rules\n' "$3" "$rel" "$ln" "$4" "$ns"
    done
  done
}

DOMAIN_FRAMEWORK='^(Microsoft\.AspNetCore|Microsoft\.EntityFrameworkCore|Microsoft\.Extensions\.Logging|OpenTelemetry|FluentResults|Npgsql|Azure|System\.Net\.Http)(\.|$)'
APP_FRAMEWORK='^(Microsoft\.AspNetCore|Microsoft\.EntityFrameworkCore|System\.Net\.Http|Npgsql|Azure)(\.|$)'
scan "Domain" "\.(Application|Infrastructure)(\.|$)|$DOMAIN_FRAMEWORK" \
  "001" "Domain depends on nothing outside itself — remove this reference"
scan "Application" "\.Infrastructure(\.|$)|$APP_FRAMEWORK" \
  "002" "Application must not depend on Infrastructure or transport frameworks — depend on a port instead"

# Root global usings apply to every source file in the backend project. When the
# project contains Domain, forbidden global imports violate Domain purity even
# though the directive itself is outside Modules/<Feature>/Domain.
find "$root" -type d -path '*/Modules/*/Domain' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null |
  sed 's#/Modules/.*$##' | sort -u | while IFS= read -r backend; do
    find "$backend" -maxdepth 1 -type f -name '*.cs' 2>/dev/null | while IFS= read -r f; do
      global_using_refs "$f" | while IFS=$'\t' read -r ln ns; do
        [[ "$ns" =~ $DOMAIN_FRAMEWORK ]] || [[ "$ns" =~ \.(Application|Infrastructure)(\.|$) ]] || continue
        printf 'MER-BE-001\terror\t%s:%s\tDomain depends on nothing outside itself — remove this global using (%s)\tbackend-pa-vsa.md#non-negotiable-dependency-rules\n' "${f#"$root"/}" "$ln" "$ns"
      done
    done
  done
exit 0
