---
name: merge-preview
description: After the user has smoke-tested preview, squash-merge every open PR whose exact head is on preview (task/* and ad hoc fix branches alike) in one confirmed pass, in dependency order (stacked branches, Blocked by), each pinned to the tested commit. Use when the user says preview looks good, wants to merge what's on preview, or ship the staged PRs. No arguments.
---

Merge what the user just smoke-tested on preview — and only that. The
user running this skill (plus the one confirmation below) is the approval
that clicking merge on each PR used to be.

## Steps

1. **Determine the repo.** `git remote get-url origin` (same as `/log-task`).

2. **List.** Run `${CLAUDE_PLUGIN_ROOT}/skills/merge-preview/staged-prs.sh` from the
   project root. One line per open PR: `pr`, `issue` (`-` for a non-task
   branch), `head-sha`, `staged`, `checks`, `mergeable`, `base`, `after`,
   `blocked`, `title`. Then an `ORDER` line (or `CYCLE`), and any
   `UNCOVERED` preview commits. See the script header for the values.
   `after` holds any required merge order between staged PRs, drawn from
   stacked branches (a PR based on, or containing, another PR's branch) and
   the issues' `Blocked by:` lines. `ORDER` puts each PR after the PRs it
   depends on. `CYCLE` → report the looping PRs and stop. Don't guess an
   order.

3. **Recheck preview.** Run the sense check against the `Preview URL:` from
   CLAUDE.md's `## Deploy`, exactly as `/stage-preview` step 4 does (one
   Bash call, `timeout: 600000`). `FAIL` → stop: preview is broken now, so
   the smoke test doesn't hold. Point the user to `/stage-preview` to
   restage and fix. No `Preview URL:` → say it was skipped and go on.

4. **Gate.** A PR is eligible only if all hold:
   - `staged` — its head commit is on preview (what was tested);
   - `checks` is `pass` or `none` — `fail` and `pending` are held back
     (`pending`: tell the user to rerun once CI finishes);
   - `mergeable` is not `CONFLICTING` (`UNKNOWN` is fine — GitHub is still
     computing, and the merge itself refuses a conflict);
   - `blocked` is `-` — otherwise a `Blocked by:` issue is still open and
     isn't being merged here;
   - `base` is `main`, or the branch of an eligible PR it comes after
     (stacked);
   - every PR in its `after` list is eligible too. Holding a PR back holds
     back its dependents, and so on down the chain — this includes a PR the
     user leaves out in step 5.

   Every other PR gets a one-line reason: `stale` → "pushed after staging,
   head untested — restage"; `not-staged` → "not on preview"; `blocked` →
   "blocked by #N, still open"; a held dependency → "needs #P first". Any
   `UNCOVERED` line → warn that preview contains that commit but no open PR
   does, so it won't ship. It may be something the tested behavior relies
   on.

5. **Confirm once.** One `AskUserQuestion`: list the eligible PRs (number,
   issue, title) in merge order, noting each required ordering ("#22 after
   #20 — Blocked by"), with every held-back PR and `UNCOVERED`
   commit in the question text. Options: "Merge all N (Recommended)",
   "Cancel". The user names PRs to leave out via "Other".
   No eligible PRs → report the step 4 reasons and stop; don't ask.

6. **Merge.** In `ORDER` order, keeping only eligible PRs. Run
   `${CLAUDE_PLUGIN_ROOT}/skills/merge-preview/merge-prs.sh <pr>:<head-sha> ...` and
   relay its output verbatim. It squash-merges with `--delete-branch` and
   `--match-head-commit`, so a branch that moved since the listing is
   refused. It stops at the first failure: `FAILED` gets the reason, the
   rest are `NOT RUN`. A merge whose only failure was local branch cleanup
   counts as merged. Never retry with other flags. On a repo whose branch
   protection requires branches to be up to date, each merge makes the
   next PR out of date, so only the first will merge. Report that as the
   cause, and don't update branches to get around it. The user decides
   (e.g. relax the setting, or restage and rerun). For a stacked PR,
   deleting its parent's branch on merge makes GitHub retarget it to
   `main`. If that retarget or its merge fails, it's an ordinary `FAILED`.

7. **Sync and report.** If the working tree is clean, `git checkout main &&
   git pull --ff-only` (`/stage-preview` leaves the checkout on `preview`);
   otherwise say so and leave it alone. Report one row per PR: `merged` |
   `held: <reason>` | `failed: <reason>` | `not run`. Task PRs close their
   issues via `Closes #N`, and `/sweep-tasks` catches any that don't. Then
   offer, without running either:
   - `/deploy <project>` to ship the merged work to production;
   - `/stage-preview` if open PRs remain — preview still holds the old
     merge, not `main`.

## Rules

- Never merge a PR whose head commit isn't on preview.
- Never merge a PR before a PR listed in its `after`, or while its
  `blocked` column is set.
- Never merge without the step 5 confirmation.
- Never resolve a conflict, rebase, or update a branch to make a merge go
  through — stop and report.
- Never use `--admin` or bypass branch protection or failing checks.
- Never deploy from this skill — offer `/deploy` only.
- Never edit labels; issue closing is GitHub's `Closes #N` handling.
