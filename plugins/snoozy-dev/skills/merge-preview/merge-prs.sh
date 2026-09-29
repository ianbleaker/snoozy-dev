#!/usr/bin/env bash
# Squash-merge an already-approved list of PRs in order, each pinned to the
# head commit that was smoke-tested on preview. Stops at the first failure —
# never resolves a conflict or retries. Bash script, no project-specific
# content — see plugins/snoozy-dev/skills/merge-preview/SKILL.md for the skill that
# drives this.
#
# Usage:
#   merge-prs.sh <pr>:<head-sha> [<pr>:<head-sha>...]
#
# Output: one `MERGED #<pr>` / `FAILED #<pr>: <reason>` / `NOT RUN #<pr>`
# line per argument. Exit 1 if any PR did not merge.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: merge-prs.sh <pr>:<head-sha> [<pr>:<head-sha>...]" >&2
  exit 1
fi

REPO="$(git remote get-url origin | sed -E 's#.*[:/]([^/]+/[^/.]+)(\.git)?$#\1#')"

failed=0
for arg in "$@"; do
  pr="${arg%%:*}"
  sha="${arg#*:}"
  if [[ $failed -eq 1 ]]; then
    echo "NOT RUN #${pr}"
    continue
  fi
  # --match-head-commit refuses the merge if the branch moved since it was
  # staged, so an untested push can never slip through.
  if out="$(gh pr merge "$pr" --repo "$REPO" --squash --delete-branch \
      --match-head-commit "$sha" 2>&1)"; then
    echo "MERGED #${pr}"
  elif [[ "$(gh pr view "$pr" --repo "$REPO" --json state --jq .state)" == MERGED ]]; then
    # Remote merge landed; only the local cleanup failed (e.g. a worker
    # worktree still has the branch checked out). Not a reason to stop.
    echo "MERGED #${pr} (local cleanup failed: $(echo "$out" | tail -1))"
  else
    echo "FAILED #${pr}: $(echo "$out" | tail -3 | tr '\n' ' ')"
    failed=1
  fi
done

exit $failed
