#!/usr/bin/env bash
# MER-BT-003 — TS file names carry no type tags (contract §9.1, Max's ruling
# 2026-06-11: "no suffixes at all"). Dirs carry the role; files are named after
# the thing: adapters after the concrete implementation (system-clock.ts,
# indexed-db-auth-session-store.ts), ports after the capability in
# application/ports/. Flagged: vagueness names (default-*, base-*, *-interface)
# and the Nest-style tag family (.port.ts, .service.ts, .provider.ts,
# .use-case.ts, .interface.ts). Sole exception: <feature>.module.ts — the Nest
# composition-root idiom. Test/config dotted names are not type tags.
# DOC: backend-pa-vsa.md#typescript--nest-naming-conventions
root="$1"; [ -d "$root" ] || exit 2

find "$root" -type f \
  \( -name 'default-*.ts' -o -name 'base-*.ts' -o -name '*-interface.ts' \
     -o -name '*.port.ts' -o -name '*.service.ts' -o -name '*.provider.ts' \
     -o -name '*.use-case.ts' -o -name '*.interface.ts' \) \
  \( -path '*/modules/*' -o -path '*/src/*' \) \
  -not -name '*.spec.ts' -not -name '*.test.ts' -not -name '*.d.ts' \
  -not -path '*/node_modules/*' -not -path '*/dist/*' -not -path '*/generated/*' \
  -not -path '*/.nuxt/*' -not -path '*/build/*' 2>/dev/null \
| while read -r f; do
  case "$(basename "$f")" in
    *.port.ts|*.service.ts|*.provider.ts|*.use-case.ts|*.interface.ts)
      printf 'MER-BT-003\twarn\t%s:0\tno type-tag suffixes — the directory carries the role; name the file after the thing itself (application/ports/clock.ts, create-form.ts)\tbackend-pa-vsa.md#typescript--nest-naming-conventions\n' "${f#"$root"/}" ;;
    *)
      printf 'MER-BT-003\twarn\t%s:0\tname the file after the concrete implementation (sendgrid-mailer.ts, indexed-db-store.ts) — default-/base-/-interface names hide provenance\tbackend-pa-vsa.md#typescript--nest-naming-conventions\n' "${f#"$root"/}" ;;
  esac
done
exit 0
