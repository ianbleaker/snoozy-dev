---
name: stage-preview
description: Rebuild the disposable `preview` environment from a group of non-conflicting In Review task branches and deploy it, then sense-check it (reachable, loads without console errors, project's preview check passes; offers /fix-bug on failure) so the user can smoke-test several tasks in one pass (or a single task immediately). Use when the user wants to test in-review task branches, stage tasks for review, or rebuild preview. Argument (optional) - one issue number to stage just that branch immediately, bypassing grouping; or a list of 2+ issue numbers to group only those branches and stage the largest group without asking (used by /batch-tasks).
---

Stage one or more in-review task branches onto the shared, disposable
`preview` environment for manual smoke testing.

## Steps

1. **Determine the repo.** `git remote get-url origin` (same as `/log-task`).

2. **Compute groups.** Run
   `${CLAUDE_PLUGIN_ROOT}/skills/stage-preview/group-branches.sh [issue-number...]` — pass
   the issue-number argument(s) through unchanged if the caller gave any.
   With no args the script discovers candidates from open PRs on `task/*`
   branches (`gh pr list --state open`), not a board Status field.
   - **With one issue-number arg:** the script prints a single-branch group.
     Skip straight to step 3 with that one branch.
   - **With 2+ issue-number args:** the script groups only those issues'
     branches. One group → stage it. Multiple groups → pick the one with the
     most branches (tie → first printed) **without asking**, and report every
     left-out branch by name.
   - **No arg, one group returned:** stage it, no need to ask.
   - **No arg, multiple groups returned:** list them (branches + which
     issues they cover) and ask the user via `AskUserQuestion` which group to
     stage now. Default/first option: the smallest group.

3. Run `${CLAUDE_PLUGIN_ROOT}/skills/stage-preview/rebuild-and-deploy.sh <chosen
   branches>` and relay its output verbatim. After step 4, end with the
   preview link (the script's `Preview:` line) and each staged issue linked
   to its PR — one shared preview serves every staged branch, so there's one
   link, not one per branch. No `Preview:` line → relay the script's warning, and say
   the sense check was skipped (no URL — never treat that as a pass).

4. **Sense check.** Before the user sees preview, run
   `node ${CLAUDE_PLUGIN_ROOT}/skills/stage-preview/sense-check.mjs <Preview URL>` from
   the project root (one Bash call, `timeout: 600000`; reach polling plus the
   project check can take minutes) and relay its `REACH` / `BROWSER` /
   `PROJECT` / `SENSE CHECK` lines. It polls the URL until it answers, loads
   it headlessly with the project's own Playwright (console errors, uncaught
   page errors, 4xx/5xx same-origin requests, blank page, screenshot), then
   runs the project's `Preview check:` command from CLAUDE.md's `## Deploy`
   (see `${CLAUDE_PLUGIN_ROOT}/project-patterns/deploy-scripts.md`).
   - **`BROWSER: unavailable`** (no Playwright in the project) → one batched
     Chrome pass instead. Load `tabs_context_mcp`, `tabs_create_mcp` and
     `browser_batch` in one ToolSearch; `tabs_context_mcp`, then
     `tabs_create_mcp`, then a single `browser_batch` on that tab:
     `navigate` → `read_console_messages` (`onlyErrors: true`, `clear: true`,
     arms capture) → `navigate` again (reload) → `read_console_messages`
     (`onlyErrors: true`, `pattern: "."`) → `computer` screenshot. Any error
     or a blank screenshot is a `BROWSER` failure. Never drive it further
     one step per turn. Chrome not connected either → the result stays
     `PARTIAL` with "console unchecked" named.
   - **`PROJECT: none`** → say "basic functionality unchecked — add a
     `Preview check:` line" in the output. Don't invent clicks.
   - **PASS** → one line (`Sense check: pass`) before the preview link, and
     a closing line: once the smoke test passes, `/merge-preview` merges
     everything staged.

5. **On sense-check failure.** Lead the output with the failure: the failing
   layer, its error lines and the screenshot path. Say preview is **not
   ready for smoke testing**. Then attribute: for each staged PR, `gh pr diff
   <pr> --name-only`, and match those files against paths in the error lines
   (with one staged branch, it's that one). Then ask one `AskUserQuestion`:
   run `/fix-bug` on which ticket — one option per staged ticket (the
   suspected one first, marked "(suspected)"; up to 3), plus "Leave it —
   report only".
   - **Ticket chosen** → `git fetch origin`, then check `git worktree list`
     for a worktree that holds the task branch (a finished worker's
     worktree can). If one does, fix inside that worktree after `git pull
     --ff-only`. If none does, `git checkout -B <task branch>
     origin/<task branch>` in the project root (rebuild-and-deploy leaves it
     on `preview`). Then follow
     `${CLAUDE_PLUGIN_ROOT}/skills/fix-bug/SKILL.md`. The sense-check output is the
     confirmed reproduction. Show the diff and confirm before committing and
     pushing to that same task branch (its open PR picks the commit up).
     Then rerun this skill with the same argument(s): restage and recheck.
     Still failing → back to this step's question. No automatic retry loop.
   - **Leave it** → stop. The PRs stay open. Preview stays deployed as it is.

## Rules

- One `preview` environment, always. Never create a second preview branch or
  a second preview instance — rebuild the same one on demand.
- Never auto-resolve a merge conflict here — stop and report.
- Never hand preview to the user as ready without a sense check that
  passed (or `PARTIAL`, with what went unchecked named). The sense check is
  the one sanctioned automatic browser run. Every other browser test still
  needs the user's say-so.
- Never fix a sense-check failure without the user picking the ticket in
  step 5.
- Never attempt first-time host setup (`preview-setup.sh`) from this skill —
  that's a separate, deliberate action.
- Group membership is transient — it's recomputed every run and only
  recorded as an issue comment, never a label.
