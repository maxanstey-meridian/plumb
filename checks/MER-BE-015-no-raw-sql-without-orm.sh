#!/usr/bin/env bash
# MER-BE-015 — "no raw ADO.NET without an ORM"; adopt EF Core or Dapper
# DOC: backend-pa-vsa.md#net
# Repo-level: if no .csproj references EF Core or Dapper, yet raw ADO.NET SQL is
# hand-rolled in .cs files, shout once — hand-mapped readers are the kind of
# bespoke plumbing that needlessly loads an AI agent's context.
root="$1"; [ -d "$root" ] || exit 2

# already on an ORM / micro-ORM (EF Core or any provider package, or Dapper)? — nothing to say
if rg -lq -e 'PackageReference[^>]*Include="[^"]*(EntityFrameworkCore|Dapper)' \
     -g '*.csproj' -g '!**/obj/**' "$root" 2>/dev/null; then
  exit 0
fi

# no ORM declared — is there hand-rolled ADO.NET SQL in .cs? point at the first hit
hit=$(rg -n --no-heading --no-messages --sort path \
  -e '\bNpgsqlCommand\b' -e '\bSqlCommand\b' -e '\bNpgsqlDataReader\b' \
  -e '\.ExecuteReaderAsync?\b' -e '\.ExecuteScalarAsync?\b' -e '\.ExecuteNonQueryAsync?\b' \
  -e '\bGetOrdinal\b' -e '\bCommandText\b' \
  -g '*.cs' -g '!**/obj/**' "$root" 2>/dev/null | head -n 1)
[ -z "$hit" ] && exit 0

f="${hit%%:*}"; rest="${hit#*:}"; l="${rest%%:*}"
printf 'MER-BE-015\twarn\t%s:%s\tno EF Core or Dapper referenced but raw ADO.NET SQL is hand-rolled here — adopt EF Core or Dapper to reduce AI agent cognitive load\tbackend-pa-vsa.md#net\n' "${f#"$root"/}" "$l"
exit 0
