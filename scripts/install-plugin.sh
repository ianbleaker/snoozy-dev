#!/usr/bin/env bash
# Install the snoozy-dev plugin into the current user's Claude Code config from
# the GitHub marketplace ianbleaker/snoozy-dev#stable (the latest release), with
# marketplace auto-update on, so each new release is picked up at startup.
#
# Works the same on a local machine and as a Claude Code cloud environment's
# setup script (cloud sessions do not read repo-declared plugins; see README),
# run from a checkout or piped from curl: it needs no local clone.
#
# Idempotent. Migrates an older install (a `directory` marketplace pointing at
# a local checkout, or another ref) by removing and re-adding the marketplace.
# SNOOZY_DEV_REF=<branch> installs another ref instead of `stable` (testing).
set -euo pipefail

REPO="ianbleaker/snoozy-dev"
REF="${SNOOZY_DEV_REF:-stable}"
SRC="$REPO#$REF"
SETTINGS="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/settings.json"

command -v jq >/dev/null 2>&1 || { echo "Error: install-plugin.sh needs jq (macOS: brew install jq; Debian/Ubuntu: apt-get install jq)." >&2; exit 1; }

current=""
[[ -f "$SETTINGS" ]] && current="$(jq -c '.extraKnownMarketplaces["snoozy-dev"].source // empty' "$SETTINGS")"
want="$(jq -cn --arg repo "$REPO" --arg ref "$REF" '{source: "github", repo: $repo, ref: $ref}')"

if [[ -n "$current" && "$current" != "$want" ]]; then
  echo "Migrating snoozy-dev marketplace: $current → github $SRC"
  claude plugin marketplace remove snoozy-dev
  current=""
fi
if [[ -z "$current" ]]; then
  claude plugin marketplace add "$SRC"
else
  claude plugin marketplace update snoozy-dev
fi

# Marketplace auto-update (what /plugin → Marketplaces → Enable auto-update
# writes): only the autoUpdate key on this entry changes; the rest of the file
# is left as it is.
if [[ "$(jq '.extraKnownMarketplaces["snoozy-dev"].autoUpdate' "$SETTINGS")" != "true" ]]; then
  tmp="$(mktemp "$(dirname "$SETTINGS")/settings.json.XXXXXX")"
  jq '.extraKnownMarketplaces["snoozy-dev"].autoUpdate = true' "$SETTINGS" > "$tmp"
  chmod "$(stat -c %a "$SETTINGS" 2>/dev/null || stat -f %Lp "$SETTINGS")" "$tmp" # keep the file's mode (mktemp makes 0600)
  mv "$tmp" "$SETTINGS"
fi

# install succeeds as a no-op when the plugin is already installed (and
# re-enables it after a marketplace remove), so update must run
# unconditionally or a re-run never picks up a new version.
claude plugin install snoozy-dev@snoozy-dev >/dev/null 2>&1 || true
claude plugin update -y snoozy-dev@snoozy-dev
echo "snoozy-dev plugin installed from github $SRC (auto-update on)"

# The Claude-free and md-unwrap hooks used to be wired into settings.json from
# a local checkout (global/hooks/*.py); the plugin now ships them in
# hooks/hooks.json. Remove the old entries, but only once the installed plugin
# really has hooks.json, so there is never a gap with no Claude-free guard.
installed="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/plugins/installed_plugins.json"
install_path=""
[[ -f "$installed" ]] && install_path="$(jq -r '(.plugins["snoozy-dev@snoozy-dev"] // []) | (map(select(.scope == "user")) + .)[0].installPath // empty' "$installed")"
if [[ -n "$install_path" && -f "$install_path/hooks/hooks.json" ]]; then
  filter='if has("hooks") then .hooks |= (map_values(map(select(all(.hooks[]; .command | contains("snoozy-dev/global/hooks/") | not)))) | with_entries(select(.value | length > 0))) else . end'
  count='[.hooks // {} | .[][] | select(any(.hooks[]; .command | contains("snoozy-dev/global/hooks/")))] | length'
  removed="$(jq "$count" "$SETTINGS")"
  if [[ "$removed" -gt 0 ]]; then
    tmp="$(mktemp "$(dirname "$SETTINGS")/settings.json.XXXXXX")"
    jq "$filter" "$SETTINGS" > "$tmp"
    chmod "$(stat -c %a "$SETTINGS" 2>/dev/null || stat -f %Lp "$SETTINGS")" "$tmp" # keep the file's mode (mktemp makes 0600)
    mv "$tmp" "$SETTINGS"
    echo "Removed $removed old snoozy-dev/global/hooks entries from $SETTINGS (the plugin's hooks.json replaces them)"
  else
    echo "No old snoozy-dev/global/hooks entries in $SETTINGS"
  fi
else
  echo "Installed plugin has no hooks/hooks.json yet: left the snoozy-dev/global/hooks entries in $SETTINGS alone"
fi
