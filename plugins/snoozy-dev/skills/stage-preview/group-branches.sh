#!/usr/bin/env bash
# Bucket the current repo's In Review task branches into the largest
# groups where no two branches in a group touch the same file. Bash script,
# no project-specific content — see plugins/snoozy-dev/skills/stage-preview/SKILL.md for
# the skill that drives this.
#
# Usage:
#   group-branches.sh              # group all In Review issues
#   group-branches.sh <issue-num>  # bypass grouping, print just that branch
#   group-branches.sh <n1> <n2> ...  # group only these issues' branches
#
# Output: one group per line, branch names space-separated.

set -euo pipefail

REPO="$(git remote get-url origin | sed -E 's#.*[:/]([^/]+/[^/.]+)(\.git)?$#\1#')"

git fetch origin --quiet

# Resolve an issue number to its task/<N>-<slug> branch on origin.
# Assumes exactly one task/<N>-* branch per issue (this plan's naming
# convention). Prints the bare branch name, or nothing if not found.
resolve_branch() {
  local issue="$1"
  git ls-remote --heads origin "task/${issue}-*" \
    | head -1 \
    | sed -E 's#.*refs/heads/##'
}

if [[ $# -eq 1 ]]; then
  branch="$(resolve_branch "$1")"
  if [[ -z "$branch" ]]; then
    echo "No branch found matching task/${1}-* on origin." >&2
    exit 1
  fi
  echo "$branch"
  exit 0
fi

if [[ $# -ge 2 ]]; then
  issue_numbers=$(printf '%s\n' "$@" | tr -d '#')
else
  issue_numbers=$(gh pr list --repo "$REPO" --state open \
    --json headRefName --jq '.[].headRefName' \
    | { grep -oE '^task/[0-9]+' || true; } | { grep -oE '[0-9]+' || true; } | sort -un)
fi

branches=()
while IFS= read -r issue; do
  [[ -z "$issue" ]] && continue
  branch="$(resolve_branch "$issue")"
  if [[ -z "$branch" ]]; then
    echo "Warning: no branch found for issue #${issue} (expected task/${issue}-*), skipping." >&2
    continue
  fi
  branches+=("$branch")
done <<< "$issue_numbers"

if [[ ${#branches[@]} -eq 0 ]]; then
  exit 0
fi

# group_files[i] = space-separated changed files for group i (parallel to group_branches[i])
group_branches=()
group_files=()

for branch in "${branches[@]}"; do
  files="$(git diff --name-only "origin/main...origin/${branch}")"

  placed=0
  for i in "${!group_branches[@]}"; do
    overlap=0
    while IFS= read -r f; do
      [[ -z "$f" ]] && continue
      if grep -qxF "$f" <<< "${group_files[$i]}"; then
        overlap=1
        break
      fi
    done <<< "$files"

    if [[ $overlap -eq 0 ]]; then
      group_branches[$i]="${group_branches[$i]} ${branch}"
      group_files[$i]="${group_files[$i]}
${files}"
      placed=1
      break
    fi
  done

  if [[ $placed -eq 0 ]]; then
    group_branches+=("$branch")
    group_files+=("$files")
  fi
done

for g in "${group_branches[@]}"; do
  echo "$g" | sed -E 's/^ +//'
done
