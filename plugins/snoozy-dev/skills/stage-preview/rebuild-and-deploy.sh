#!/usr/bin/env bash
# Rebuild the shared, disposable `preview` environment from an already-chosen
# group of branches, deploy it, and comment on each staged issue. No
# project-specific content — see plugins/snoozy-dev/skills/stage-preview/SKILL.md for the
# skill that drives this.
#
# Usage:
#   rebuild-and-deploy.sh <branch1> [branch2...]

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: rebuild-and-deploy.sh <branch1> [branch2...]" >&2
  exit 1
fi

BRANCHES=("$@")

REPO="$(git remote get-url origin | sed -E 's#.*[:/]([^/]+/[^/.]+)(\.git)?$#\1#')"

git fetch origin --quiet
git checkout -B preview origin/main --quiet

merge_refs=()
for b in "${BRANCHES[@]}"; do
  merge_refs+=("origin/${b}")
done

if ! git merge --no-edit "${merge_refs[@]}" >/tmp/preview-merge.log 2>&1; then
  echo "Merge conflict — branches involved:" >&2
  printf '  %s\n' "${BRANCHES[@]}" >&2
  cat /tmp/preview-merge.log >&2
  exit 1
fi

git push origin preview --force-with-lease

DEPLOY_SECTION="$(awk '/^## Deploy/{flag=1; next} /^## /{flag=0} flag' CLAUDE.md 2>/dev/null || true)"
DEPLOY_HOST="$(echo "$DEPLOY_SECTION" | awk -F': *' '/^Host:/{print $2}')"
PREVIEW_URL="$(echo "$DEPLOY_SECTION" | sed -nE 's/^Preview URL: *//p')"

if [[ -z "$DEPLOY_HOST" ]]; then
  echo "Error: could not determine deploy host from CLAUDE.md's ## Deploy section." >&2
  exit 1
fi

set +e
DEPLOY_OUTPUT="$(ssh "$DEPLOY_HOST" "cd /opt/${REPO##*/}-preview && sudo ./deploy/preview-deploy.sh" 2>&1)"
DEPLOY_STATUS=$?
set -e

if [[ $DEPLOY_STATUS -ne 0 ]]; then
  echo "Preview deploy failed (has preview-setup.sh been run on ${DEPLOY_HOST}?):" >&2
  echo "$DEPLOY_OUTPUT" >&2
  exit 1
fi

# task/<N>-* branches are commented on issue N. Ad hoc branches have no
# issue: they are referenced by their open PR number and get no comment.
issue_numbers=()
refs=()
for b in "${BRANCHES[@]}"; do
  if [[ "$b" =~ ^task/([0-9]+)- ]]; then
    issue_numbers+=("${BASH_REMATCH[1]}")
    refs+=("#${BASH_REMATCH[1]}")
  else
    pr="$(gh pr list --repo "$REPO" --state open --head "$b" --json number --jq '.[0].number // empty')"
    if [[ -n "$pr" ]]; then refs+=("#${pr}"); else refs+=("$b"); fi
  fi
done

for issue in "${issue_numbers[@]}"; do
  others=()
  for ref in "${refs[@]}"; do
    [[ "$ref" != "#${issue}" ]] && others+=("$ref")
  done
  if [[ ${#others[@]} -eq 0 ]]; then
    body="Staged for preview (no other issues this round)."
  else
    other_list="$(IFS=', '; echo "${others[*]}")"
    body="Staged for preview alongside ${other_list}."
  fi
  gh issue comment "$issue" --repo "$REPO" --body "$body" >/dev/null
done

echo "Staged branches: ${BRANCHES[*]}"
echo "Deployed to preview on ${DEPLOY_HOST}."
echo "$DEPLOY_OUTPUT"
if [[ -n "$PREVIEW_URL" ]]; then
  echo "Preview: ${PREVIEW_URL}"
else
  echo "Warning: no 'Preview URL:' line in CLAUDE.md's ## Deploy section — add it to get a link here." >&2
fi
