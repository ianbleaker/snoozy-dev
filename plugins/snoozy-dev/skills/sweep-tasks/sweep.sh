#!/usr/bin/env bash
# Sweep stale local task/* branches and reconcile any issue-close drift left
# behind by a merged PR. No project-specific content — see
# plugins/snoozy-dev/skills/sweep-tasks/SKILL.md for the skill that drives this.
#
# Usage:
#   sweep.sh   # no args
#
# Prints its own final summary: branches swept, issues reconciled, anything
# unreconciled, or "nothing to sweep" if no gone-upstream task/* branches
# exist.

set -euo pipefail

REPO="$(git remote get-url origin | sed -E 's#.*[:/]([^/]+/[^/.]+)(\.git)?$#\1#')"

git fetch --prune --quiet

stale_branches="$(git branch -vv | awk '/: gone\]/ {print $1}' | grep -E '^task/' || true)"

if [[ -z "$stale_branches" ]]; then
  echo "nothing to sweep"
  exit 0
fi

reconciled=()
unreconciled=()
swept=()

while IFS= read -r branch; do
  [[ -z "$branch" ]] && continue
  issue="$(echo "$branch" | sed -E 's#^task/([0-9]+)-.*#\1#')"

  merged_pr="$(gh pr list --repo "$REPO" --state merged \
    --search "head:task/${issue}-" --json number,url --jq '.[0]')"

  if [[ -n "$merged_pr" && "$merged_pr" != "null" ]]; then
    pr_url="$(echo "$merged_pr" | jq -r '.url')"
    issue_state="$(gh issue view "$issue" --repo "$REPO" --json state --jq '.state' 2>/dev/null || echo "")"
    if [[ "$issue_state" == "OPEN" ]]; then
      gh issue close "$issue" --repo "$REPO" \
        --comment "Closed by sweep-tasks: merged PR $pr_url." >/dev/null
      reconciled+=("#${issue} (closed, merged PR $pr_url)")
    fi
  else
    unreconciled+=("$branch (no merged PR found for issue #${issue})")
  fi

  git branch -D "$branch" >/dev/null
  swept+=("$branch")
done <<< "$stale_branches"

echo "Branches swept: ${#swept[@]}"
for b in "${swept[@]}"; do
  echo "  - $b"
done

if [[ ${#reconciled[@]} -gt 0 ]]; then
  echo "Issues reconciled: ${#reconciled[@]}"
  for r in "${reconciled[@]}"; do
    echo "  - $r"
  done
fi

if [[ ${#unreconciled[@]} -gt 0 ]]; then
  echo "Unreconciled: ${#unreconciled[@]}"
  for u in "${unreconciled[@]}"; do
    echo "  - $u"
  done
fi
