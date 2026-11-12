---
name: sweep-tasks
description: Manual backup skill — sweeps stale local task/* and ad hoc <type>/* branches and reconciles any issue-close drift left behind by a merged PR. Not part of /next-task's critical path; invoke standalone whenever you suspect drift (a stale local branch, or a merged PR whose issue didn't auto-close). No arguments.
---

Backup skill only. Squash-only + `--delete-branch-on-merge` (set by `/onboard`) plus GitHub's native `Closes #NN` handling should close issues automatically on merge — this skill exists for the rare case that misses.

**CLI-only:** run `${CLAUDE_PLUGIN_ROOT}/project-patterns/cloud-check.sh` first; if it exits 1, relay its line, say this skill needs a local CLI session (reconciles branches and issues with `gh pr`/`gh issue`), and stop before any other step.

Run `${CLAUDE_PLUGIN_ROOT}/skills/sweep-tasks/sweep.sh` and relay its output verbatim.

## Rules

- Never delete a `task/*` branch that holds a plan doc (its diff from `origin/main` touches `docs/plans/`) and has no merged PR — `/write-plan` keeps plans on their task branch, so it may be the only copy. `sweep.sh` lists it under `Kept:`.
- Never run automatically from another skill — the user invokes this directly when they suspect drift.
- Force-delete (`git branch -D`) only applies to a local branch matching `task/<issue-number>-*` or an ad hoc prefix from `${CLAUDE_PLUGIN_ROOT}/project-patterns/branch-workflow.md` whose upstream shows `gone` after `git fetch --prune` — never a blanket branch deletion.
