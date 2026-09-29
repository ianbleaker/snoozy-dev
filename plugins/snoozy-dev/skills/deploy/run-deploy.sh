#!/usr/bin/env bash
# Deploy a project's current main to its production host via its own
# deploy/deploy.sh. No project-specific content — see
# plugins/snoozy-dev/skills/deploy/SKILL.md for the skill that drives this.
#
# Usage:
#   run-deploy.sh <project-name>

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: run-deploy.sh <project-name>" >&2
  exit 1
fi

PROJECT="$1"
CHECKOUT="$HOME/development/${PROJECT}"

if [[ ! -d "$CHECKOUT" ]]; then
  echo "Error: checkout not found at ${CHECKOUT}." >&2
  exit 1
fi

if [[ ! -f "${CHECKOUT}/deploy/deploy.sh" ]]; then
  echo "Error: ${PROJECT} hasn't adopted the deploy-scripts convention yet (no deploy/deploy.sh)." >&2
  echo "See project-patterns/deploy-scripts.md." >&2
  exit 1
fi

git -C "$CHECKOUT" fetch origin --quiet
AHEAD="$(git -C "$CHECKOUT" rev-list origin/main..main --count)"
if [[ "$AHEAD" -ne 0 ]]; then
  echo "Error: local main is ${AHEAD} commit(s) ahead of origin/main. Push local main first." >&2
  exit 1
fi

CLAUDE_MD="${CHECKOUT}/CLAUDE.md"
DEPLOY_SECTION="$(awk '/^## Deploy/{flag=1; next} /^## /{flag=0} flag' "$CLAUDE_MD" 2>/dev/null || true)"
HOST="$(echo "$DEPLOY_SECTION" | awk -F': *' '/^Host:/{print $2}')"
REMOTE_PATH="$(echo "$DEPLOY_SECTION" | awk -F': *' '/^Remote path:/{print $2}')"

missing=()
[[ -z "$HOST" ]] && missing+=("Host")
[[ -z "$REMOTE_PATH" ]] && missing+=("Remote path")

if [[ ${#missing[@]} -gt 0 ]]; then
  echo "Error: ${PROJECT}'s CLAUDE.md ## Deploy section is missing: ${missing[*]}." >&2
  echo "See project-patterns/deploy-scripts.md." >&2
  exit 1
fi

set +e
OUTPUT="$(ssh "$HOST" "cd ${REMOTE_PATH} && sudo ./deploy/deploy.sh" 2>&1)"
STATUS=$?
set -e

if [[ $STATUS -eq 0 ]]; then
  echo "$OUTPUT" | grep -E "Deploy complete\." || echo "$OUTPUT"
else
  echo "Deploy failed:" >&2
  echo "$OUTPUT" >&2
  exit "$STATUS"
fi
