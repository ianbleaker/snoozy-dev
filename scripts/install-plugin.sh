#!/usr/bin/env bash
# Install the snoozy-dev plugin into the current user's Claude Code config.
# Used for (a) a local machine and (b) the setup script of a Claude Code cloud
# environment (cloud sessions do not read repo-declared plugins; see README).
#
# Idempotent: re-running updates the checkout and plugin.
set -euo pipefail

# Default to the checkout this script runs from, so any clone location works;
# with no checkout around it (e.g. piped from curl), the standard location.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-.}")/.." 2>/dev/null && pwd || true)"
if [[ -n "$ROOT" && -d "$ROOT/.git" ]]; then
  DEFAULT_DIR="$ROOT"
else
  DEFAULT_DIR="$HOME/development/snoozy-dev"
fi
DIR="${SNOOZY_DEV_DIR:-$DEFAULT_DIR}"
URL="https://github.com/ianbleaker/snoozy-dev.git"

if [[ -d "$DIR/.git" ]]; then
  # A local checkout may sit on a task branch (branch-workflow.md); only main
  # tracks anything worth pulling.
  branch="$(git -C "$DIR" branch --show-current)"
  if [[ "$branch" == main ]]; then
    git -C "$DIR" pull --ff-only -q
  else
    echo "Note: $DIR is on $branch — installing that branch's unmerged skills." >&2
  fi
else
  git clone -q --depth 1 "$URL" "$DIR"
fi

claude plugin marketplace add "$DIR" >/dev/null 2>&1 || claude plugin marketplace update snoozy-dev
# install succeeds as a no-op when the plugin is already installed, so update
# must run unconditionally or a re-run never picks up a new version.
claude plugin install snoozy-dev@snoozy-dev >/dev/null 2>&1 || true
claude plugin update snoozy-dev@snoozy-dev
echo "snoozy-dev plugin installed from $DIR"
