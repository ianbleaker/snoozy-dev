#!/usr/bin/env bash
# Detect whether this session can use `gh issue` / `gh pr` (CLI mode) or
# must use the `gh api` REST forms in environments.md (cloud mode).
#
# In Claude Code cloud sessions `gh` is authenticated through a proxy that
# rejects the GraphQL-backed `gh issue`/`gh pr` subcommands, so this probes
# exactly that call instead of trusting an env var. An unauthenticated or
# offline CLI also reads as cloud mode; the message says so.
#
# Skills run it once per run, from the project root:
#   "${CLAUDE_PLUGIN_ROOT}/project-patterns/cloud-check.sh"
# Exit 0, no output: CLI mode, use commands as written.
# Exit 1, one CLOUD: line: use the cloud forms in environments.md.
set -uo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "CLOUD: gh is not installed — use the cloud forms in project-patterns/environments.md"
  exit 1
fi

if ! gh issue list --limit 1 --json number >/dev/null 2>&1; then
  echo "CLOUD: gh issue/pr commands are unavailable (cloud session, or gh not authenticated/offline) — use the cloud forms in project-patterns/environments.md"
  exit 1
fi

exit 0
