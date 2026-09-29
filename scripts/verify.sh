#!/bin/sh
# Syntax-check every tracked shell script and Node ESM module.
# Usage: scripts/verify.sh [file ...]   (no args = all tracked files)
cd "$(git rev-parse --show-toplevel)" || exit 1
rc=0
files=${*:-$(git ls-files '*.sh' '*.mjs')}
for f in $files; do
  case "$f" in
    *.sh)  bash -n "$f" || rc=1 ;;
    *.mjs) node --check "$f" || rc=1 ;;
  esac
done
exit $rc
