#!/usr/bin/env bash

manifest_require() {
  if [ -z "${PLUMB_FILE_MANIFEST:-}" ] || [ ! -r "$PLUMB_FILE_MANIFEST" ] || [ -z "${PLUMB_REPO_ROOT:-}" ]; then
    printf 'plumb: producer requires a runner-provided file manifest\n' >&2
    exit 2
  fi
}

manifest_paths() {
  local relative
  manifest_require
  while IFS= read -r -d '' relative; do
    printf '%s\0' "$PLUMB_REPO_ROOT/$relative"
  done < "$PLUMB_FILE_MANIFEST"
}

manifest_rg_paths() {
  xargs -0 rg --with-filename "$@" --
}
