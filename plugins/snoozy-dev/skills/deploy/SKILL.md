---
name: deploy
description: SSH-deploy a named project to its production host, invoking that project's own deploy/deploy.sh over the standard remote-execution convention. Use for phrases like "deploy X" or "ship X to production". Argument - <project-name> (required).
---

Deploy a project's current `main` to its production host via its own
`deploy/deploy.sh`.

## Steps

1. **Resolve the project name.** If no `<project-name>` argument was given,
   ask via `AskUserQuestion`, listing directories under `~/development/` that
   contain a `deploy/deploy.sh`.

2. Run `${CLAUDE_PLUGIN_ROOT}/skills/deploy/run-deploy.sh <project-name>` and relay its
   output verbatim, treating a nonzero exit as failure per the script's own
   reporting.

## Rules

- No multi-host support, no host-selection logic — exactly one
  `Host:`/`Remote path:` pair per project's `CLAUDE.md`.
- No rollback or retry logic — `deploy.sh` already commits to "no silent
  rollback"; this skill must not paper over that.
- No `AskUserQuestion` confirmation gate before the SSH/restart step —
  running `/deploy <project-name>` is itself the deliberate signal.
- Never invoke `setup.sh` or any first-time-bootstrap path from this skill,
  even if `deploy.sh` fails in a way that looks like "the service isn't
  installed yet" — report and stop.
- No new remote-execution mechanism — plain SSH per
  `project-patterns/deploy-scripts.md`.
