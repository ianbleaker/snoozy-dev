#!/usr/bin/env bash
# List every open PR and whether what's on origin/preview is exactly what
# would merge, so /merge-preview only merges smoke-tested code — and in
# what order. Not just task/* — an ad hoc fix branch staged alongside them
# counts too. Bash 3.2-safe (macOS), no project-specific content — see
# plugins/snoozy-dev/skills/merge-preview/SKILL.md for the skill that drives this.
#
# Usage:
#   staged-prs.sh
#
# Output: one tab-separated line per open PR:
#   <pr> <issue> <head-sha> <staged> <checks> <mergeable> <base> <after> <blocked> <title>
# issue:     N for a task/<N>-* branch, `-` otherwise
# staged:    staged      head commit is contained in origin/preview
#            stale       preview has earlier commits of the branch, but not
#                        its head — pushed to after staging, head untested
#            not-staged  none of the branch is on preview
# checks:    pass | fail | pending | none   (none = no CI configured)
# mergeable: MERGEABLE | CONFLICTING | UNKNOWN   (GitHub's own field)
# base:      the PR's base branch (`main`, or another PR's branch if stacked)
# after:     staged PRs that must merge before this one, comma-separated, or
#            `-`. Sources: stacked on that PR's branch; that PR's head is
#            inside this head; or this task's issue `Blocked by:` names that
#            PR's issue (task-labels.md "Dependencies").
# blocked:   `Blocked by:` issues still open with no staged PR, or `-` —
#            this PR must not merge yet.
# Staged-only columns (after, blocked) are `-` for other PRs.
#
# Then:
#   ORDER\t<pr> <pr> ...     every staged PR, dependencies first; ties go
#                            non-task PRs first, then ascending PR number
#   CYCLE\t<pr> <pr> ...     instead of ORDER, if the `after` edges loop
#   UNCOVERED\t<sha>\t<subject>   per commit on preview that is neither on
#                            main nor in any open PR (e.g. a branch pushed
#                            without a PR) — merging the PRs would ship
#                            something different from what was tested.

set -euo pipefail

REPO="$(git remote get-url origin | sed -E 's#.*[:/]([^/]+/[^/.]+)(\.git)?$#\1#')"

git fetch origin --quiet --prune

if ! git rev-parse --verify --quiet origin/preview >/dev/null; then
  echo "No origin/preview branch — nothing has been staged (run /stage-preview)." >&2
  exit 1
fi

# Capture first: a failed gh call (auth, network) must stop here, not read
# as an empty list.
prs="$(gh pr list --repo "$REPO" --state open --limit 100 \
  --json number,headRefName,headRefOid,baseRefName,title,mergeable,statusCheckRollup \
  --jq 'sort_by(.number) | .[]
    | [ .number, .headRefName, .headRefOid, .baseRefName, .mergeable,
        ( [ .statusCheckRollup[]? | (.conclusion // .state // "") ] as $c
          | [ .statusCheckRollup[]? | (.status // "COMPLETED") ] as $s
          | if ($c | length) == 0 then "none"
            elif any($c[]; test("FAILURE|ERROR|CANCELLED|TIMED_OUT|ACTION_REQUIRED|STARTUP_FAILURE")) then "fail"
            elif any($s[]; . != "COMPLETED") or any($c[]; test("^$|PENDING|EXPECTED")) then "pending"
            else "pass" end ),
        .title ] | @tsv')"

# Parallel arrays, one entry per open PR (bash 3.2: no associative arrays).
P=(); ISSUE=(); SHA=(); BRANCH=(); BASE=(); STAGED=(); CHECKS=(); MERGEABLE=(); TITLE=()
exclude=(^origin/main)
while IFS=$'\t' read -r pr branch sha base mergeable checks title; do
  [[ -z "$pr" ]] && continue
  if [[ "$branch" =~ ^task/([0-9]+)- ]]; then issue="${BASH_REMATCH[1]}"; else issue=-; fi
  if git merge-base --is-ancestor "$sha" origin/preview 2>/dev/null; then
    staged=staged
  elif [[ "$(git merge-base "$sha" origin/preview)" != "$(git merge-base "$sha" origin/main)" ]]; then
    staged=stale
  else
    staged=not-staged
  fi
  P+=("$pr"); ISSUE+=("$issue"); SHA+=("$sha"); BRANCH+=("$branch"); BASE+=("$base")
  STAGED+=("$staged"); CHECKS+=("$checks"); MERGEABLE+=("$mergeable"); TITLE+=("$title")
  exclude+=("^$sha")
done <<< "$prs"

n=${#P[@]}
AFTER=(); BLOCKED=()
for ((i = 0; i < n; i++)); do
  AFTER+=("-"); BLOCKED+=("-")
  [[ "${STAGED[$i]}" == staged ]] || continue

  after=""
  # This task's `Blocked by:` issues, from its issue body.
  blockers=""
  if [[ "${ISSUE[$i]}" != - ]]; then
    blockers="$(gh issue view "${ISSUE[$i]}" --repo "$REPO" --json body --jq .body \
      | sed -nE 's/^Blocked by:(.*)/\1/p' | grep -oE '#[0-9]+' | tr -d '#' || true)"
  fi

  for ((j = 0; j < n; j++)); do
    [[ $i -eq $j || "${STAGED[$j]}" != staged ]] && continue
    dep=0
    [[ "${BASE[$i]}" == "${BRANCH[$j]}" ]] && dep=1
    if [[ "${SHA[$i]}" != "${SHA[$j]}" ]] && git merge-base --is-ancestor "${SHA[$j]}" "${SHA[$i]}"; then
      dep=1
    fi
    if [[ "${ISSUE[$j]}" != - ]] && grep -qx "${ISSUE[$j]}" <<< "$blockers"; then dep=1; fi
    [[ $dep -eq 1 ]] && after="${after:+$after,}${P[$j]}"
  done
  [[ -n "$after" ]] && AFTER[$i]="$after"

  # Blockers with no staged PR: fine if already closed, otherwise blocking.
  blocked=""
  for b in $blockers; do
    covered=0
    for ((j = 0; j < n; j++)); do
      [[ "${STAGED[$j]}" == staged && "${ISSUE[$j]}" == "$b" ]] && covered=1
    done
    [[ $covered -eq 1 ]] && continue
    if [[ "$(gh issue view "$b" --repo "$REPO" --json state --jq .state)" != CLOSED ]]; then
      blocked="${blocked:+$blocked,}#$b"
    fi
  done
  [[ -n "$blocked" ]] && BLOCKED[$i]="$blocked"
done

for ((i = 0; i < n; i++)); do
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "${P[$i]}" "${ISSUE[$i]}" "${SHA[$i]}" \
    "${STAGED[$i]}" "${CHECKS[$i]}" "${MERGEABLE[$i]}" "${BASE[$i]}" "${AFTER[$i]}" \
    "${BLOCKED[$i]}" "${TITLE[$i]}"
done

# Topological order over staged PRs. Candidates are scanned non-task first,
# then ascending PR number (P is already number-sorted), taking the first
# whose `after` PRs are all placed.
scan=()
for ((i = 0; i < n; i++)); do [[ "${STAGED[$i]}" == staged && "${ISSUE[$i]}" == - ]] && scan+=("$i"); done
for ((i = 0; i < n; i++)); do [[ "${STAGED[$i]}" == staged && "${ISSUE[$i]}" != - ]] && scan+=("$i"); done
order=" "
remaining=${#scan[@]}
while [[ $remaining -gt 0 ]]; do
  progressed=0
  for i in "${scan[@]+"${scan[@]}"}"; do
    [[ "$order" == *" ${P[$i]} "* ]] && continue
    ready=1
    for d in ${AFTER[$i]//,/ }; do
      [[ "$d" == - ]] && continue
      [[ "$order" == *" $d "* ]] || ready=0
    done
    if [[ $ready -eq 1 ]]; then
      order="$order${P[$i]} "
      remaining=$((remaining - 1))
      progressed=1
      break
    fi
  done
  if [[ $progressed -eq 0 ]]; then
    left=""
    for i in "${scan[@]}"; do [[ "$order" == *" ${P[$i]} "* ]] || left="$left ${P[$i]}"; done
    printf 'CYCLE\t%s\n' "${left# }"
    order=""
    break
  fi
done
[[ -n "$order" ]] && printf 'ORDER\t%s\n' "$(echo "$order" | xargs)"

# Non-merge commits on preview not reachable from main or any open PR head.
git log --no-merges --format='UNCOVERED%x09%h%x09%s' origin/preview "${exclude[@]}"
