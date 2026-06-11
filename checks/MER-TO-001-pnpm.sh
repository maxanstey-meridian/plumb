#!/usr/bin/env bash
# MER-TO-001 — pnpm is the package manager
# DOC: tools.md#default-stack
root="$1"; [ -d "$root" ] || exit 2
[ -f "$root/package.json" ] || exit 0
grep -q '"packageManager"[[:space:]]*:[[:space:]]*"pnpm' "$root/package.json" || \
  printf 'MER-TO-001\terror\tpackage.json:0\tpin pnpm via the packageManager field\ttools.md#default-stack\n'
find "$root" -maxdepth 3 \( -name package-lock.json -o -name yarn.lock \) -not -path '*/node_modules/*' 2>/dev/null \
| while read -r f; do
  printf 'MER-TO-001\terror\t%s:0\tnon-pnpm lockfile — the package manager is pnpm\ttools.md#default-stack\n' "${f#"$root"/}"
done
exit 0
