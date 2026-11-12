#!/bin/sh
# Syntax-check every tracked shell script, Node ESM module and Python file,
# then run the node:test files.
# Usage: scripts/verify.sh [file ...]   (no args = all tracked files; with
# args, only the *.test.mjs files among them run)
# VERIFY_FAST=1 skips the node:test run (the Stop hook sets it; pre-commit
# and CI run the full suite).
cd "$(git rev-parse --show-toplevel)" || exit 1
rc=0
files=${*:-$(git ls-files '*.sh' '*.mjs' '*.py')}
tests=""
for f in $files; do
  case "$f" in
    *.sh)  bash -n "$f" || rc=1 ;;
    *.mjs) node --check "$f" || rc=1 ;;
    *.py)  python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$f" || rc=1 ;;
  esac
done
if [ $# -gt 0 ]; then
  for f in "$@"; do
    case "$f" in *.test.mjs) tests="$tests $f" ;; esac
  done
else
  tests=$(git ls-files '*.test.mjs')
fi
if [ -n "$tests" ] && [ -z "$VERIFY_FAST" ]; then
  # shellcheck disable=SC2086
  node --test $tests || rc=1
fi
exit $rc
