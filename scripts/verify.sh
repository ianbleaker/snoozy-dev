#!/bin/sh
# Syntax-check every tracked shell script and Node ESM module, then run the
# node:test files.
# Usage: scripts/verify.sh [file ...]   (no args = all tracked files; with
# args, only the *.test.mjs files among them run)
cd "$(git rev-parse --show-toplevel)" || exit 1
rc=0
files=${*:-$(git ls-files '*.sh' '*.mjs')}
tests=""
for f in $files; do
  case "$f" in
    *.sh)  bash -n "$f" || rc=1 ;;
    *.mjs) node --check "$f" || rc=1 ;;
  esac
done
if [ $# -gt 0 ]; then
  for f in "$@"; do
    case "$f" in *.test.mjs) tests="$tests $f" ;; esac
  done
else
  tests=$(git ls-files '*.test.mjs')
fi
if [ -n "$tests" ]; then
  # shellcheck disable=SC2086
  node --test $tests || rc=1
fi
exit $rc
