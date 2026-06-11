#!/usr/bin/env bash
# MER-BT-005 — no vague type names in TS backend module trees: *Service,
# *Interface, Default*, Base* (coding-philosophy §Provenance; backend-pa-vsa TS
# naming: "Do not use vague names like MailerService / MailerInterface /
# DefaultMailer / BaseMailer"). Nest *.module.ts files exempt — the framework
# requires the module class shape, and XModule is not a vague name.
# DOC: backend-pa-vsa.md#typescript--nest-naming-conventions
root="$1"; [ -d "$root" ] || exit 2
rg -n --no-heading \
  -e '\bclass\s+\w+(Service|Interface)\b' \
  -e '\bclass\s+(Default|Base)[A-Z]\w*' \
  -g '*.ts' -g '**/modules/**' \
  -g '!*.module.ts' -g '!*.spec.ts' -g '!*.test.ts' -g '!**/__tests__/**' \
  -g '!**/node_modules/**' -g '!**/dist/**' -g '!**/generated/**' \
  "$root" 2>/dev/null | while IFS=: read -r f l _; do
  printf 'MER-BT-005\twarn\t%s:%s\tname the type after the capability or the concrete implementation — Service/Interface/Default/Base names hide provenance\tbackend-pa-vsa.md#typescript--nest-naming-conventions\n' "${f#"$root"/}" "$l"
done
exit 0
