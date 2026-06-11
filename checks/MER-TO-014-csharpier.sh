#!/usr/bin/env bash
# MER-TO-014 — CSharpier is part of the formatting workflow (tools.md): csproj
# repos must wire it via CSharpier.MsBuild in a csproj / Directory.*.props, or as
# a dotnet tool in .config/dotnet-tools.json. CSharpier is config-free; plumb
# checks only the wiring, never a style file.
# DOC: tools.md#formatting-and-analyzers
root="$1"; [ -d "$root" ] || exit 2

find "$root" -name '*.csproj' -not -path '*/obj/*' -not -path '*/node_modules/*' 2>/dev/null | head -1 | grep -q . || exit 0

if rg -qi --hidden 'csharpier' \
  -g '*.csproj' -g 'Directory.Build.props' -g 'Directory.Packages.props' -g 'dotnet-tools.json' \
  -g '!**/obj/**' -g '!**/bin/**' -g '!**/.git/**' "$root" 2>/dev/null; then
  exit 0
fi
printf 'MER-TO-014\twarn\t.config/dotnet-tools.json:0\tCSharpier not wired — add CSharpier.MsBuild to the project (or a dotnet tool manifest) so formatting is enforced at build\ttools.md#formatting-and-analyzers\n'
exit 0
