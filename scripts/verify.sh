#!/bin/sh
# Syntax-check every tracked shell script, Node ESM module and Python file,
# then run the node:test files.
# Usage: scripts/verify.sh [file ...]   (no args = all tracked files; with
# args, only the *.test.mjs files among them run)
# VERIFY_FAST=1 skips the node:test run (the Stop hook sets it; pre-commit
# and CI run the full suite).
# Paths may contain spaces: args are never word-split, and the tracked-file
# list is read one line per file.
cd "$(git rev-parse --show-toplevel)" || exit 1
rc=0
check() {
  case "$1" in
    *.sh)  bash -n "$1" || rc=1 ;;
    *.mjs) node --check "$1" || rc=1 ;;
    *.py)  python3 -c 'import ast,sys; ast.parse(open(sys.argv[1]).read(), sys.argv[1])' "$1" || rc=1 ;;
  esac
}
if [ $# -gt 0 ]; then
  for f in "$@"; do check "$f"; done
else
  # Heredoc, not a pipe, so the loop runs in this shell and keeps rc.
  while IFS= read -r f; do
    [ -n "$f" ] && check "$f"
  done <<EOF
$(git ls-files '*.sh' '*.mjs' '*.py')
EOF
fi
if [ -z "$VERIFY_FAST" ]; then
  if [ $# -gt 0 ]; then
    for f in "$@"; do
      case "$f" in *.test.mjs) printf '%s\0' "$f" ;; esac
    done
  else
    git ls-files -z '*.test.mjs'
  fi | xargs -0 -r node --test || rc=1
fi
exit $rc
