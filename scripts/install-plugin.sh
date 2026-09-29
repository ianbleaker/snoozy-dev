#!/usr/bin/env bash
# Install or refresh the snoozy-dev plugin for the current user's Claude Code.
#
# Runs in three places, always safe to repeat:
#   - a cloud environment's setup script (pre-warms the cached snapshot)
#   - each repo's SessionStart hook (pulls the latest commit every session, so
#     edits to this repo reach new sessions with no manual step)
#   - a local machine, once
# The plugin has no fixed version, so every commit counts as a new version.
# Never fails the caller: a hook or setup script must not block session start.

DIR="${SNOOZY_DEV_DIR:-$HOME/snoozy-dev}"
REPO="${SNOOZY_DEV_REPO:-https://github.com/ianbleaker/snoozy-dev.git}"

if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull -q --ff-only 2>/dev/null || true
else
  git clone -q --depth 1 "$REPO" "$DIR" || { echo "snoozy-dev: clone failed" >&2; exit 0; }
fi

if claude plugin list 2>/dev/null | grep -q "snoozy-dev@snoozy-dev"; then
  claude plugin marketplace update snoozy-dev >/dev/null 2>&1
  claude plugin update snoozy-dev@snoozy-dev >/dev/null 2>&1
else
  claude plugin marketplace add "$DIR" >/dev/null 2>&1
  claude plugin install snoozy-dev@snoozy-dev >/dev/null 2>&1
fi
exit 0
