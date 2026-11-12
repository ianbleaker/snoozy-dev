#!/usr/bin/env bash
# Read a project's `## Deploy` section from its CLAUDE.md and print the
# deploy settings as eval-able KEY=value lines. The single parser for the
# convention in deploy-scripts.md: path defaults, the deployer-name rule
# and `{host}` resolution live here and nowhere else.
#
# Lines are `- Key: value` list items; the legacy bare `Key: value` form is
# still accepted. Only lines between `## Deploy` and the next `## ` heading
# count.
#
# Prints:
#   DEPLOY_HOST           Host: (an ~/.ssh/config alias)
#   REMOTE_PATH           Remote path: (trailing / stripped)
#   PREVIEW_PATH          Preview path:, else <REMOTE_PATH>-preview
#   DEPLOY_USER           <basename of REMOTE_PATH>-deployer
#   PREVIEW_DEPLOY_USER   <basename of PREVIEW_PATH>-deployer
#   PREVIEW_URL           Preview URL:, with {host} replaced by the alias's
#                         HostName from `ssh -G` (empty, with a warning, if
#                         it can't be resolved)
#   PREVIEW_CHECK         Preview check:, raw ({url} left in place)
#
# A missing CLAUDE.md or `## Deploy` section prints every var empty and
# exits 0; callers decide what's fatal. Lines joined onto one line (e.g. by
# a markdown unwrapper) exit 1.
#
# Usage:
#   eval "$(deploy-config.sh [project-dir])"   # default: git toplevel of cwd

set -euo pipefail

PROJECT_DIR="${1:-$(git rev-parse --show-toplevel)}"
CLAUDE_MD="$PROJECT_DIR/CLAUDE.md"

section=""
if [[ -f "$CLAUDE_MD" ]]; then
  section=$(awk '/^## Deploy[[:space:]]*$/{f=1; next} /^## /{f=0} f' "$CLAUDE_MD")
fi

# First `Key:` line in the section, list-item or bare form, value trimmed.
get() {
  printf '%s\n' "$section" \
    | sed -nE "/^(- )?$1:/{s/^(- )?$1:[[:space:]]*//;s/[[:space:]]+\$//;p;q;}"
}

KEYS_RE='(^|[[:space:]])(Host|Remote path|Preview path|Preview URL|Preview check):'

DEPLOY_HOST=$(get 'Host')
REMOTE_PATH=$(get 'Remote path')
PREVIEW_PATH=$(get 'Preview path')
PREVIEW_URL=$(get 'Preview URL')
PREVIEW_CHECK=$(get 'Preview check')

for v in "$DEPLOY_HOST" "$REMOTE_PATH" "$PREVIEW_PATH" "$PREVIEW_URL" "$PREVIEW_CHECK"; do
  if [[ "$v" =~ $KEYS_RE ]]; then
    echo "deploy-config: ## Deploy lines in $CLAUDE_MD were joined onto one line; rewrite them as '- Key: value' list items (see deploy-scripts.md)" >&2
    exit 1
  fi
done

strip_slash() {
  local p="$1"
  while [[ "$p" == */ && "$p" != / ]]; do p="${p%/}"; done
  printf '%s' "$p"
}

REMOTE_PATH=$(strip_slash "$REMOTE_PATH")
PREVIEW_PATH=$(strip_slash "$PREVIEW_PATH")
if [[ -z "$PREVIEW_PATH" && -n "$REMOTE_PATH" ]]; then
  PREVIEW_PATH="${REMOTE_PATH}-preview"
fi

DEPLOY_USER=""
[[ -n "$REMOTE_PATH" ]] && DEPLOY_USER="$(basename "$REMOTE_PATH")-deployer"
PREVIEW_DEPLOY_USER=""
[[ -n "$PREVIEW_PATH" ]] && PREVIEW_DEPLOY_USER="$(basename "$PREVIEW_PATH")-deployer"

if [[ "$PREVIEW_URL" == *"{host}"* ]]; then
  resolved=""
  if [[ -n "$DEPLOY_HOST" ]] && ssh_out=$(ssh -G "$DEPLOY_HOST" 2>/dev/null); then
    resolved=$(printf '%s\n' "$ssh_out" | awk '$1=="hostname"{print $2; exit}')
  fi
  if [[ -n "$resolved" ]]; then
    PREVIEW_URL="${PREVIEW_URL//"{host}"/$resolved}"
  else
    echo "deploy-config: can't resolve {host} in Preview URL (no Host: line, or 'ssh -G ${DEPLOY_HOST}' failed); PREVIEW_URL left empty" >&2
    PREVIEW_URL=""
  fi
fi

for var in DEPLOY_HOST REMOTE_PATH PREVIEW_PATH DEPLOY_USER PREVIEW_DEPLOY_USER PREVIEW_URL PREVIEW_CHECK; do
  printf '%s=%q\n' "$var" "${!var}"
done
