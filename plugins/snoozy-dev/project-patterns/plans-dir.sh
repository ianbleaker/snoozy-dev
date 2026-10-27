#!/usr/bin/env bash
# Resolve where a project's plan docs live. Works from anywhere in a
# project, including a `git worktree add` worktree: paths are always
# resolved from the main checkout.
#
# A project keeps its plans in a private companion repo (a sibling folder
# with its own private GitHub repo) by putting this line in the `## Plans`
# section of its CLAUDE.md:
#
#   Private repo: ../<repo>-private
#
# The path is resolved against the main checkout root. With the line, plans
# live in <companion>/plans/; without it, in docs/plans/.
#
# Usage:
#   eval "$(plans-dir.sh)"   # sets PLANS_REPO and PLANS_DIR (absolute)

set -euo pipefail

ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")

companion=""
if [[ -f "$ROOT/CLAUDE.md" ]]; then
  companion=$(sed -nE 's/^Private repo: +([^[:space:]]+).*/\1/p' "$ROOT/CLAUDE.md" | head -n1)
fi

if [[ -n "$companion" ]]; then
  [[ "$companion" = /* ]] || companion="$ROOT/$companion"
  if [[ ! -d "$companion" ]]; then
    echo "plans-dir: companion repo $companion not found" >&2
    exit 1
  fi
  companion=$(cd "$companion" && pwd -P)
  printf 'PLANS_REPO=%q\nPLANS_DIR=%q\n' "$companion" "$companion/plans"
else
  printf 'PLANS_REPO=%q\nPLANS_DIR=%q\n' "$ROOT" "$ROOT/docs/plans"
fi
