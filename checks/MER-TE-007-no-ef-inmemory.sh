#!/usr/bin/env bash
# MER-TE-007 — integration tests run on a real database engine (contract §9.6).
# The EF InMemory provider validates neither SQL nor relational behavior; use
# the production database engine through Testcontainers. Calibration 2026-06-10:
# cohort's 5 hits are real.
# DOC: testing-philosophy.md#test-substrate
root="$1"; [ -d "$root" ] || exit 2

first_call_line() { # $1=file $2=method
  CALL="$2" perl -0777 -ne '
    s{\$*"{3,}.*?"{3,}|//[^\r\n]*|/\*.*?\*/|(?:\$\@|\@\$|\@)"(?:""|[^"])*"|\$?"(?:\\.|[^"\\])*"|q{\x27}(?:\\.|[^\x27\\])*q{\x27}}
     { my $v = $&; $v =~ s/[^\r\n]/ /g; $v }gse;
    my $line = 0;
    for (split /\r?\n/, $_, -1) {
      $line++;
      if (/\b\Q$ENV{CALL}\E\s*\(/) { print "$line\n"; exit; }
    }
  ' "$1"
}

is_test_file() {
  case "/${1#"$root"/}" in
    */[Tt]est/*|*/[Tt]ests/*) return 0 ;;
  esac
  local dir proj name
  dir="$(dirname "$1")"
  while [[ "$dir" == "$root" || "$dir" == "$root"/* ]]; do
    for proj in "$dir"/*.csproj; do
      [ -f "$proj" ] || continue
      name="$(basename "$proj")"
      case "$name" in *Test*.csproj|*test*.csproj) return 0 ;; esac
    done
    [ "$dir" = "$root" ] && break
    dir="$(dirname "$dir")"
  done
  return 1
}

project_uses_postgres() {
  local project="$1" seen="${2:-}"
  case " $seen " in *" $project "*) return 1 ;; esac
  seen="$seen $project"
  if perl -0777 -pe 's/<!--.*?-->//sg' "$project" | rg -q '<PackageReference\b[^>]*\bInclude\s*=\s*[\x22\x27](?:Npgsql\.EntityFrameworkCore\.PostgreSQL|Npgsql)[\x22\x27]'; then
    return 0
  fi
  local reference include dependency
  while IFS= read -r reference; do
    include="${reference#*$'\t'}"
    include="${include//\\//}"
    dependency="$(dirname "$project")/$include"
    [ -f "$dependency" ] || continue
    dependency="$(perl -MCwd=abs_path -e 'print abs_path(shift)' "$dependency")"
    project_uses_postgres "$dependency" "$seen" && return 0
  done < <(perl -0777 -ne '
    s/<!--.*?-->//sg;
    while (/<ProjectReference\b([^>]*)(?:\/>|>.*?<\/ProjectReference>)/sg) {
      my $attrs = $1;
      print "ref\t$1\n" if $attrs =~ /\bInclude\s*=\s*["\x27]([^"\x27]+)["\x27]/i;
    }
  ' "$project")
  return 1
}

# one finding per file (first hit) — a suite built on the provider repeats the
# call dozens of times; per-call findings are noise, the file is the unit of fix
find "$root" -name '*.cs' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while IFS= read -r f; do
  is_test_file "$f" || continue
  l="$(first_call_line "$f" UseInMemoryDatabase)"
  [ -n "$l" ] || continue
  printf 'MER-TE-007\terror\t%s:%s\tEF InMemory provider in integration tests — use the production database engine through Testcontainers, or fake the port when the adapter is not under test\ttesting-philosophy.md#test-substrate\n' "${f#"$root"/}" "$l"
done

# SQLite is mismatched when the owning test project reaches a production
# project selecting Npgsql/Postgres anywhere in its ProjectReference graph.
find "$root" -name '*.csproj' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while IFS= read -r testproj; do
  case "$testproj" in
    *Tests*.csproj|*[Tt]ests/*) ;;
    *) continue ;;
  esac
  project_uses_postgres "$(perl -MCwd=abs_path -e 'print abs_path(shift)' "$testproj")" || continue
  project_dir="$(dirname "$testproj")"
  find "$project_dir" -name '*.cs' -not -path '*/obj/*' -not -path '*/bin/*' 2>/dev/null | while IFS= read -r f; do
    l="$(first_call_line "$f" UseSqlite)"
    [ -n "$l" ] || continue
    printf 'MER-TE-007\terror\t%s:%s\tSQLite test database does not match the referenced production Postgres provider — exercise relational behavior against Postgres through Testcontainers\ttesting-philosophy.md#test-substrate\n' "${f#"$root"/}" "$l"
  done
done
exit 0
