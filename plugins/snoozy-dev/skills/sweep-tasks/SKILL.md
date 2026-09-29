---
name: sweep-tasks
description: Manual backup skill — sweeps stale local task/* branches and reconciles any issue-close drift left behind by a merged PR. Not part of /next-task's critical path; invoke standalone whenever you suspect drift (a stale local branch, or a merged PR whose issue didn't auto-close). No arguments.
---

Backup skill only. Squash-only + `--delete-branch-on-merge` (set by
`/onboard`) plus GitHub's native `Closes #NN` handling should close issues
automatically on merge — this skill exists for the rare case that misses.

Run `${CLAUDE_PLUGIN_ROOT}/skills/sweep-tasks/sweep.sh` and relay its output verbatim.

## Rules

- Never run automatically from another skill — the user invokes this
  directly when they suspect drift.
- Force-delete (`git branch -D`) only applies to a local branch matching
  `task/<issue-number>-*` whose upstream shows `gone` after `git fetch
  --prune` — never a blanket branch deletion.
