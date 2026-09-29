---
name: next-task
description: Pulls status:ready issues in the current repo, sorted by priority, and routes to direct implementation, /write-plan, or /implement-plan depending on size and whether a plan doc already exists. Use when the user wants to pull work in, start the next task, or asks "what's next" at the start of a session. Argument (optional) - an issue number to pick directly instead of listing.
---

Pull the next unit of work from the current repo's `status:ready` queue and
route it to the right workflow.

## Steps

1. **List candidates.**
   ```bash
   gh issue list --repo <owner>/<repo> --label status:ready --state open \
     --json number,title,labels,body
   ```
   Sort by the `priority:*` label (`high` → `medium` → `low`) — priority is
   unaffected by this migration, still a label.
2. **Drop blocked candidates.** An issue is blocked while any issue it
   depends on is still open (see "Dependencies" in
   `${CLAUDE_PLUGIN_ROOT}/project-patterns/task-labels.md`). Check the native links
   first:
   ```bash
   gh api repos/<owner>/<repo>/issues/<NN>/dependencies/blocked_by \
     --jq '[.[] | select(.state == "open") | .number]'
   ```
   If the issue has no native links, fall back to the body's
   `Blocked by: #a, #b` line and check each with `gh issue view <a> --json
   state`. Blocked issues leave the pick list; mention each in one line
   (`#NN blocked by #a`) so the user sees why a higher-priority item was
   skipped. If every candidate is blocked, stop and report the blockers.
   Then mark candidates that conflict with work already in review: collect
   the issue numbers of open `task/<N>-*` PRs (`gh pr list --state open
   --json headRefName`), and flag any candidate whose `Conflicts with:` line
   names one of them. A flagged task touches the same files as an unmerged
   branch, so starting it now means a merge conflict later. Flagged issues
   stay pickable but rank below every unflagged one.
3. **Pick.** If the caller passed `#NN` as an argument or there is only one issue to pick, use that issue directly (skip the list) — if it is blocked, say so and confirm before proceeding; if it is flagged, name the in-review PR it conflicts with. Otherwise pick the highest-priority, smallest unblocked and unflagged item, falling back to flagged items (with a one-line warning naming the conflicting PR) only when no unflagged item remains. If the body has a `Decision needed:` line other than `none`, ask that question before implementing or planning. Once the user answers, write it back into the body's `## Dependencies` block — set `Decision needed: none` and append `Decided: <question> — <answer>` — by fetching the body (`gh issue view <NN> --repo <repo> --json body --jq .body > <tmp>`), editing that file, and writing it back (`gh issue edit <NN> --repo <repo> --body-file <tmp>`). Never retype the body by hand; no issue comment.
4. **Route by the `size:*` label:**
   - **`size:small`** — implement directly in this session (no plan doc). After verify passes: reset to
     an up-to-date base first — `git fetch origin main && git checkout -B
     task/<issue-number>-<slug> origin/main` — **never branch off whatever
     the session's current branch happens to be**; a stale or unrelated
     branch as the base has produced wrong-base PRs before. Then commit,
     push, `gh pr create --base main
     --head task/<issue-number>-<slug> --title "..." --body "Closes
     #<issue-number>\n\n<summary>"`. That's it — In Review is derived (an
     open PR exists on the `task/*` branch), true automatically the moment
     the PR is open, nothing to set.
   - **`size:medium` / `size:large`** — check whether a plan doc already
     exists for this issue: `ls docs/plans/<NN>-*.md` (the exact
     `<issue-number>-<issue-slug-text>.md` format `/write-plan` enforces).
     - **Exists** (this item was labeled `status:planned` and the user
       reviewed the doc and added `status:ready` to approve it — it may
       still carry `status:planned` too, which is normal, not a warning) —
       skip `/write-plan` entirely. Hand off straight to `/implement-plan
       <path>` against the existing doc; don't regenerate it.
     - **Doesn't exist** — invoke `/write-plan` directly, passing the issue
       number and body as the raw material, with no confirmation prompt
       first (the user already approved pulling this task in when they
       selected it as the candidate in step 2). Note explicitly that the
       resulting doc's Context section must record `Source issue: #NN` (this
       is `/write-plan`'s job to write, not this skill's — see its own
       Phase 1 steps).

## Rules

- This skill reads `status:ready` issues and never closes an issue directly
  or sets any label — In Review/Done are derived, not written by this
  skill. The issue closes when the user merges the PR (on GitHub, or via
  `/merge-preview` after a preview smoke test). The only
  issue write it makes is the `Decision needed:`/`Decided:` lines of the
  body (step 3).
- Never regenerate a plan doc that already exists for a `status:ready`
  issue — its existence means the plan was already written and approved.
- Determine the repo the same way `/log-task` does: `git remote get-url origin`.
