---
name: log-task
description: Records a finding or idea as a GitHub issue on the current repo's tracker, always landing on status:draft. Callable standalone (ad hoc capture) or from inside another skill (write-plan, implement-plan, audit-plan logging deferred/discovered items). Use when the user wants to log a task, file an issue, or capture something for later without acting on it now.
---

Create one GitHub issue on the current repo's tracker, always landing on
`status:draft`. Draft is what keeps "Claude noticed this" separate from
"user decided to act on it" — draft items never surface in `/next-task`'s
list until the user relabels them to `status:ready`.

## Steps

1. **Determine the repo.** `git remote get-url origin` (or the remote the
   project's already configured with `gh`). If there's no GitHub remote,
   stop and tell the caller — there's nowhere to file the issue.
2. **Guess the labels** from the description and whatever context the caller
   gives you (surrounding conversation, diff, plan doc item). See
   `${CLAUDE_PLUGIN_ROOT}/project-patterns/task-labels.md` for the full taxonomy —
   don't re-derive or re-list the values here.
   - `status:draft` — every created issue gets this, unconditionally.
   - `type:*` — feature vs fix vs update.
   - `priority:*` — default `priority:medium` unless something in context
     signals otherwise (explicitly urgent → high, explicitly minor → low).
   - `size:*` — best guess from scope described. This guess can't be trusted
     from a one-line description, so the body (step 3) must carry enough
     non-obvious detail for the user to verify it at triage — terse, not
     bare.
   - Only ask the user via `AskUserQuestion` if literally no signal exists to
     guess from (e.g. a bare one-word input with no surrounding context).
     Otherwise guess and move on — relabeling later is cheap.
3. **Create the issue, terse:**
   - Title: imperative, ≤10 words.
   - Body: lead line is a one-sentence imperative summary. Add detail below
     only where non-obvious — a constraint, a scoping question, why the size
     guess landed where it did. Don't restate what the title/labels already
     say.
   - The body carries the `## Dependencies` block (the five-line
     template in `task-labels.md`, no `Decided:` line at creation). `Blocked
     by`/`Blocks`/`Conflicts with`: only issue numbers the caller's context
     names, else `none`. `Decision needed`: the scoping question if the body
     carries one, else `none`. Without the block the issue is never
     `/batch-tasks`-eligible.
   - Then the `## Touches` section (see `task-labels.md`): the repo-relative
     files the work will change, backticked and comma-separated — from the
     caller's context (diff, plan item, finding evidence), plus a quick
     Grep/Glob for any component or file the description names. `unknown`
     if neither yields a path. `/batch-tasks` uses it as the predicted
     footprint, so a missing file means a missed conflict.
   ```bash
   gh issue create --repo <repo> \
     --title "<imperative, ≤10 words>" \
     --body "<one-sentence summary, then only non-obvious detail>

   ## Dependencies
   Blocked by: none
   Blocks: none
   Conflicts with: none
   Decision needed: none

   ## Touches
   \`src/path/a.ts\`, \`src/path/b.tsx\`" \
     --label "status:draft" --label "type:<x>" --label "priority:<y>" --label "size:<z>"
   ```
4. **Report back** the created issue number and URL (`gh issue create` prints
   the URL; parse the number from it) to whoever called this skill — a
   standalone invocation reports to the user directly; a skill-internal call
   returns it to the caller for use in its own checkpoint/log line.

## Rules

- `status:draft` is set directly in the `gh issue create` call in step 3 —
  there is no longer a separate step to skip.
- Issue body is only the summary, `## Dependencies` and `## Touches` — no "Generated with Claude Code" line, session URL, or other attribution footer.
- No cross-issue search to fill the `## Dependencies` lines — use only what
  the caller's context names; finding relationships is triage's job.
- Never create more than one issue per call. Batch callers (write-plan's
  Phase 1 checkpoint, implement-plan's Finish step, audit-plan's report step)
  call this once per approved item.
- Don't ask the user to confirm the create itself — that confirmation already
  happened at the caller's checkpoint (the `AskUserQuestion` multiSelect in
  write-plan/implement-plan/audit-plan, or the user's direct ask-task
  request). This skill's job is just to guess labels and file.
