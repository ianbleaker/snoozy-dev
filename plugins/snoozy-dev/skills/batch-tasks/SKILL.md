---
name: batch-tasks
description: Implements up to N (default 5) eligible status:ready tickets unattended — one task-worker agent and one PR each, in parallel worktrees — then offers to stage the resulting PRs on preview (never automatically) for a single smoke-test pass. Use when the user wants to batch several ready tasks at once. Argument (optional) - [N] [--dry-run].
---

Select a batch of non-overlapping ready tickets, confirm it once, fan out one
`task-worker` agent per ticket, then offer to stage the successes on preview
(and sense-check it). Staging deploys, so it's asked, never automatic.

## Steps

1. **Determine the repo.** `git remote get-url origin` (same as `/log-task`).

2. **Select.** From the repo root run
   `${CLAUDE_PLUGIN_ROOT}/skills/batch-tasks/select-batch.mjs [N] --bodies-dir <scratchpad>`.
   It prints BATCH (with each member's predicted footprint), DROPPED,
   WAITING, INELIGIBLE and SHARED DOCS, and writes each batch member's
   issue body to `<scratchpad>/body-<N>.md`. Don't re-derive
   what it prints — no reading `/next-task`, `task-labels.md` or analysis
   docs to rebuild eligibility or footprints. The rules it applies:
   - **Eligible** only if all hold: no open PR already exists for it (a
     `task/<N>-*` head branch or a `Closes #N` link — such tickets are
     skipped, listed under INELIGIBLE); a `## Dependencies` block (see
     "Dependencies" in `${CLAUDE_PLUGIN_ROOT}/project-patterns/task-labels.md`) —
     no block means unknown, not safe; no open blocker (native
     `blocked_by` links or the `Blocked by:` line); `Decision needed: none`;
     `size:small`, or `size:medium`/`size:large` with a
     `docs/plans/<N>-*.md` on `main` (an approved plan is the "doesn't need
     the human" signal); its `Conflicts with:` names no issue with an open
     `task/*` PR (it would collide on preview).
   - **Order:** `priority:*` high → low, then `size:*` small → large, then
     more `Blocks:` entries (merging it opens up the next batch), then
     lower issue number. Filled greedily in that order up to N, so a drop
     refills from the next eligible issue.
   - **Footprint:** the plan doc's paths (plan-backed), the issue's
     `## Touches` section, plus file paths the body names; `[body,
     estimate]` when only the body supplied them.
   - **Drop** a candidate when it clashes with an already-kept one: an
     in-batch `Conflicts with:`, or a shared non-`.md` file. Shared living
     docs (`*.md`) are kept and listed under SHARED DOCS — `/stage-preview`'s
     real-diff grouping catches true conflicts. Dropped tickets are
     untouched and stay `status:ready` for a later batch.

3. **Review the footprints.** The one judgement call left:
   - **Generated/hotspot pairs** the script can't see — e.g. one member
     lists `tokens.ts` and another the generated `theme.css`; regeneration
     always conflicts. Re-run with `--skip <n>` to drop the lower-ranked one.
   - **`[none — estimate by grep]`** → a quick Grep/Glob from nouns in the
     issue body (component/file names), labelled as an estimate; a clash
     found this way → `--skip` and re-run.

4. **`--dry-run`** → print the batch, every drop/ineligible issue with its
   reason, and each task's predicted footprint (run step 2 without
   `--bodies-dir`). Stop. No workers, no writes.

5. **Confirm once.** One `AskUserQuestion` showing the final batch and each
   drop with a one-line reason (`#131 dropped — shares CodexView.tsx with
   #128`). Let the user re-add dropped items (multiSelect over the drops, or
   an explicit "run as shown" option). `AskUserQuestion` allows 4 options
   per question and 4 questions per call — spread the drops across up to 4
   questions in this one call; the user names any beyond that via "Other".
   This is the only interaction before the workers finish. A re-added item
   needs its body on disk: `gh issue view <N> --repo <repo> --json body
   --jq .body > <scratchpad>/body-<N>.md`.

6. **Spawn workers.** One Agent call per ticket, **all in one message** so
   they run in parallel in the background: `subagent_type: "task-worker"`,
   `isolation: "worktree"`. Each prompt carries the worker's Inputs (see
   `${CLAUDE_PLUGIN_ROOT}/agents/task-worker.md`): repo, issue number, the path to its
   `body-<N>.md` from step 2 (authoritative — the worker reads it there),
   plan path or `none`, its predicted footprint, and every other batch
   member's footprint. Never print the bodies into this session (`cat`,
   `jq`) — they're already on disk.

7. **Finish.** Wait for every worker to report.
   - **Crash / no parseable report** → `bailed: worker failed`. Don't edit the
     issue body. Check for a stray `task/<N>-*` branch (`git ls-remote --heads
     origin "task/<N>-*"`) or PR (`gh pr list --head <branch>`) and report
     any found — never delete them.
   - **Actual-footprint overlap:** compare `files_touched` pairwise across the
     successful PRs and report any shared files. Report only — this
     calibrates the footprint heuristic (`## Touches` + body paths).
   - **Discovered items:** one multiSelect `AskUserQuestion` over every
     worker's `discovered` list → `/log-task` per approved item. Spread
     items across up to 4 questions in the one call (4 options each); the
     user names any beyond that via "Other".
   - **Stage (prompt, never automatic):** 0 successes → skip. Otherwise add
     one question — "Stage PRs #a, #b on preview now?" (Stage / Not now) —
     to the same `AskUserQuestion` call as the discovered-items questions
     (or alone if there are none). Never run `/stage-preview` without a
     "Stage" answer. On "Stage": `/stage-preview <issue numbers of
     successful PRs>` (1 success → its single-arg bypass). A deploy failure
     is relayed verbatim; the PRs stay open. `/stage-preview` runs the sense
     check (its steps 4–5). On failure it asks whether to `/fix-bug` a
     ticket, using the ticket's own branch; any fix restages and rechecks
     there. On "Not now": skip; the user can run `/stage-preview` later.

8. **Final report.** A table with one row per ticket considered: `PR #…` |
   `bailed: <reason>` | `dropped: <reason>`. Then the merged smoke-test
   checklist (every worker's `smoke_test` items, grouped by ticket). If
   staged: the preview URL (the `Preview:` line from `/stage-preview`'s
   output; if it warned that none is configured, say so), with the final
   sense-check result first, above the table. If it still fails (the user
   chose "Leave it"), lead with the failure and say preview is not ready
   for smoke testing, instead of presenting the checklist as ready. If not
   staged: say preview was not touched and end with `/stage-preview <issue
   numbers>` as the next step. Once staged and the smoke test passes, `/clear` then `/merge-preview` merges everything staged —
   it needs nothing from this session (it reads preview and the PRs), and
   starting fresh skips re-reading this whole batch on every merge turn.

## Rules

- Never merge a PR. Merging is `/merge-preview`, which the user runs after
  the smoke test.
- Never resolve a conflict — stop and report.
- Dropped and bailed tickets keep their labels; this skill never edits labels.
- Never stage or deploy preview without an explicit "Stage" answer to
  step 7's prompt.
- The confirmation in step 5 is the only question before the workers
  finish. After that: step 7's discovered-items and stage questions (one
  call), and `/stage-preview`'s fix question only when the sense check fails.
