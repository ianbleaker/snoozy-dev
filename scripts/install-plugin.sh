#!/usr/bin/env bash
# Install the snoozy-dev plugin into the current user's Claude Code config.
# Used for (a) a local machine and (b) the setup script of a Claude Code cloud
# environment (cloud sessions do not read repo-declared plugins; see README).
#
# Idempotent: re-running updates the checkout and plugin.
set -euo pipefail

DIR="${SNOOZY_DEV_DIR:-$HOME/snoozy-dev}"
URL="https://github.com/ianbleaker/snoozy-dev.git"

if [[ -d "$DIR/.git" ]]; then
  git -C "$DIR" pull --ff-only -q
else
  git clone -q --depth 1 "$URL" "$DIR"
fi

claude plugin marketplace add "$DIR" >/dev/null 2>&1 || claude plugin marketplace update snoozy-dev
claude plugin install snoozy-dev@snoozy-dev >/dev/null 2>&1 || claude plugin update snoozy-dev@snoozy-dev
echo "snoozy-dev plugin installed from $DIR"
