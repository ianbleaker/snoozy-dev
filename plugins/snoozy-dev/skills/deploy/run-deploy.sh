#!/usr/bin/env bash
# Deploy a project's current main to its production host via its own
# deploy/deploy.sh. No project-specific content — see
# plugins/snoozy-dev/skills/deploy/SKILL.md for the skill that drives this.
#
# Usage:
#   run-deploy.sh <project-name>

set -euo pipefail

DEPLOY_DOC="$(cd "$(dirname "$0")/../.." && pwd)/project-patterns/deploy-scripts.md"

if [[ $# -ne 1 ]]; then
  echo "Usage: run-deploy.sh <project-name>" >&2
  exit 1
fi

PROJECT="$1"
CHECKOUT="${SNOOZY_PROJECTS_DIR:-$HOME/development}/${PROJECT}"

if [[ ! -d "$CHECKOUT" ]]; then
  echo "Error: checkout not found at ${CHECKOUT} (projects root: SNOOZY_PROJECTS_DIR, default \$HOME/development)." >&2
  exit 1
fi

if [[ ! -f "${CHECKOUT}/deploy/deploy.sh" ]]; then
  echo "Error: ${PROJECT} hasn't adopted the deploy-scripts convention yet (no deploy/deploy.sh)." >&2
  echo "See ${DEPLOY_DOC}." >&2
  exit 1
fi

git -C "$CHECKOUT" fetch origin --quiet
AHEAD="$(git -C "$CHECKOUT" rev-list origin/main..main --count)"
if [[ "$AHEAD" -ne 0 ]]; then
  echo "Error: local main is ${AHEAD} commit(s) ahead of origin/main. Push local main first." >&2
  exit 1
fi

# Assigned first so a deploy-config.sh failure (joined lines) stops here.
DEPLOY_CONFIG="$("$(dirname "$0")/../../project-patterns/deploy-config.sh" "$CHECKOUT")"
eval "$DEPLOY_CONFIG"

missing=()
[[ -z "$DEPLOY_HOST" ]] && missing+=("Host")
[[ -z "$REMOTE_PATH" ]] && missing+=("Remote path")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Error: ${PROJECT}'s CLAUDE.md ## Deploy section is missing: ${missing[*]}." >&2
  echo "See ${DEPLOY_DOC}." >&2
  exit 1
fi

set +e
OUTPUT="$(ssh "$DEPLOY_HOST" "cd ${REMOTE_PATH} && sudo -n -u ${DEPLOY_USER} ./deploy/deploy.sh" 2>&1)"
STATUS=$?
set -e

if [[ $STATUS -eq 0 ]]; then
  echo "$OUTPUT" | grep -E "Deploy complete\." || echo "$OUTPUT"
else
  echo "Deploy failed:" >&2
  echo "$OUTPUT" >&2
  if [[ "$OUTPUT" == *"sudo:"* ]]; then
    echo "Hint: is your account on ${DEPLOY_HOST} in the 'deploy' group, and has deploy/setup.sh been re-run since the deployer split? See ${DEPLOY_DOC}." >&2
  fi
  exit "$STATUS"
fi
