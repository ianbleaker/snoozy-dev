#!/usr/bin/env bash
# Find the plan doc for issue <NN>, wherever it lives. The one place that
# knows plan locations: /next-task, /implement-plan, /write-plan revisions,
# /audit-plan and select-batch.mjs all go through it.
#
# Lookup order:
#   1. Companion repo (CLAUDE.md has a `Private repo:` line, see plans-dir.sh):
#      origin/main:plans/<NN>-*.md. No plan branch.
#   2. In-project plan branch: the single task/<NN>-* branch on origin,
#      holding docs/plans/<NN>-*.md. More than one such branch is an error.
#   3. In-project legacy: origin/main:docs/plans/<NN>-*.md (plans written
#      before plan branches existed).
# docs/plans/completed/ and plans/completed/ are never matched.
#
# Usage:
#   eval "$(find-plan.sh <NN> [--no-fetch])"
#   Fetches origin in each repo it reads unless --no-fetch is passed.
#
# Output (exit 0), printf %q, eval-able:
#   PLAN_PATH    absolute for companion plans; repo-relative (docs/plans/...)
#                for in-project plans
#   PLAN_REPO    repo holding the plan (companion or project root)
#   PLAN_REF     <ref>:<path>, readable with `git -C "$PLAN_REPO" show`
#   PLAN_BRANCH  task/<NN>-<slug> for a branch plan, else empty
#   PLAN_ONLY    1 when the branch's diff from origin/main is only the plan
#                doc (planned, not started), else 0
# Exit 1 with no output: no plan. Exit 2: multiple task/<NN>-* branches.

set -euo pipefail

nn="${1:-}"
fetch=1
[[ "${2:-}" == "--no-fetch" ]] && fetch=0
if [[ ! "$nn" =~ ^[0-9]+$ ]]; then
  echo "usage: find-plan.sh <NN> [--no-fetch]" >&2
  exit 64
fi

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
eval "$("$here/plans-dir.sh")"

emit() {
  printf 'PLAN_PATH=%q\nPLAN_REPO=%q\nPLAN_REF=%q\nPLAN_BRANCH=%q\nPLAN_ONLY=%q\n' "$@"
  exit 0
}

# First top-level <NN>-*.md in <dir>/ of <ref> (completed/ excluded).
match_in_tree() {
  local repo=$1 ref=$2 dir=$3
  git -C "$repo" ls-tree -r --name-only "$ref" "$dir/" 2>/dev/null \
    | grep -E "^${dir//./\\.}/${nn}-[^/]*\.md$" | head -n1 || true
}

if [[ "$PLANS_DIR" != "$PLANS_REPO/docs/plans" ]]; then
  ((fetch)) && git -C "$PLANS_REPO" fetch -q origin
  f=$(match_in_tree "$PLANS_REPO" origin/main plans)
  [[ -n "$f" ]] || exit 1
  emit "$PLANS_REPO/$f" "$PLANS_REPO" "origin/main:$f" "" 0
fi

repo=$PLANS_REPO
((fetch)) && git -C "$repo" fetch -q --prune origin

branches=$(git -C "$repo" ls-remote --heads origin "task/${nn}-*" | sed -E 's#^.*refs/heads/##')
count=$(printf '%s' "$branches" | grep -c . || true)
if ((count > 1)); then
  echo "find-plan: multiple task/${nn}-* branches on origin: $(echo $branches)" >&2
  exit 2
fi

if ((count == 1)); then
  f=$(match_in_tree "$repo" "origin/$branches" docs/plans)
  if [[ -n "$f" ]]; then
    changed=$(git -C "$repo" diff --name-only "origin/main...origin/$branches")
    only=0
    [[ "$changed" == "$f" ]] && only=1
    emit "$f" "$repo" "origin/$branches:$f" "$branches" "$only"
  fi
fi

f=$(match_in_tree "$repo" origin/main docs/plans)
[[ -n "$f" ]] || exit 1
emit "$f" "$repo" "origin/main:$f" "" 0
