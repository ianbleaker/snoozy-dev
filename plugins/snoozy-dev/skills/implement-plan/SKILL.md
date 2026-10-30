---
name: implement-plan
description: Implement a checklist plan document (migration/plan doc) in order, checking items off, staying strictly in scope. Use when asked to implement, continue, or resume a migration or plan doc. Argument - path to the plan doc.
---

Implement the plan document at the given path. The doc is the contract: its checklist is the scope, its "Do not do" section is binding.

## Steps

0. **Resolve the plans location.** `eval "$("${CLAUDE_PLUGIN_ROOT}/project-patterns/plans-dir.sh")"` sets `PLANS_DIR` and `PLANS_REPO`. When `PLANS_REPO` is a private companion repo (the project's `CLAUDE.md` has a `Private repo:` line), every plan-doc change — tick-offs, `## Discovered`/`## Escalation` notes, the archive move — is committed and pushed in the companion, straight to its `main` and never part of the project's diff: `git -C "$PLANS_REPO" pull --rebase --autostash origin main`, `git -C "$PLANS_REPO" add plans/<f>` (only the plan file), commit, push. Don't `checkout -B` there: it would discard unpushed local `CLAUDE.md` commits.
1. **Read the whole doc first** — Context, Before starting, Checklist, Do not do. If "Before starting" names prerequisite docs or commands, do those before touching code.
2. **Find the starting point and branch.** Fresh run: first item. Resume: first unchecked item. Trust the checkboxes over memory. Then run Start from `${CLAUDE_PLUGIN_ROOT}/project-patterns/branch-workflow.md` before touching code: `task/<NN>-<slug>` when the doc's Context names `Source issue: #NN`, otherwise `<type>/<slug>` from the doc's filename. On a resume it lands on the existing branch with the earlier items' commits.
3. **Implement checklist items strictly in order.** After completing each item:
   - Run the project's verify commands (typecheck/lint/tests as defined in project CLAUDE.md or the doc).
   - Edit the doc to check the item off (`- [ ]` → `- [x]`). Check-off happens immediately, not batched at the end — a crashed session must resume cleanly. In a companion repo, commit and push the tick-off there (step 0) right away.
   - Commit the item and push (branch-workflow "Commit") — one commit per item, carrying the tick-off when the doc lives in the project.
4. **Stay in scope.** Implement only what the checklist lists. If necessary out-of-scope work is discovered (a blocking bug, a missing prerequisite):
   - Blocking → fix minimally, note it in the doc under a `## Discovered during implementation` section, keep it in a separate commit.
   - Non-blocking → accumulate it in memory (title + one-line reason) instead of writing it to the doc immediately. Move on. Never expand scope silently.
5. **Escalate instead of improvising.** If the doc conflicts with reality, or an item is ambiguous with more than one plausible reading: stop that item, ask the user directly via `AskUserQuestion` with the options you see, record the question and the answer in a `## Escalation` section in the doc, and continue with the next independent item (end the turn if truly blocked). Never leave a question unanswered by the time Finish runs — guessing past the doc is the one failure this workflow cannot recover from.
6. **Sync living docs.** If the project has a doc-sync table (edited file → living doc), update the mapped docs as part of the item that touched the code, not as an afterthought.
7. **Finish.** Before the final report, present the accumulated non-blocking discovered-item candidates (from step 4) in one `AskUserQuestion` call (multiSelect, one option per candidate). Call `/log-task` for each approved item. The `## Discovered during implementation` section keeps only the resulting `Logged: #NN - <title>` lines (plus any blocking items already written there in step 4) — nothing for rejected candidates.

   All items checked and every escalation from this run answered → run the full verify suite once more, then report: what was implemented, verify results, anything in "Discovered during implementation" or "Escalation", and what manual testing remains for the user. Archive the doc into `$PLANS_DIR/completed/` (`git mv`) in a final commit on the branch — in a companion repo instead `git -C "$PLANS_REPO" mv plans/<f> plans/completed/<f>`, committed and pushed to the companion's `main` (step 0), not part of the project's commit or PR — this no longer waits on whether `audit-plan` will run; `audit-plan` remains available as an optional deeper pass and reviews the doc in place in `completed/` if invoked later. Push, then open the PR (branch-workflow "PR"): `gh pr create --base main --head <branch> --title "..." --body "<summary>"`, with the body starting `Closes #NN\n\n` when Context names `Source issue: #NN`. PR body is that only — no "Generated with Claude Code" line, session URL, or attribution footer. Open exactly one PR, only after the whole-task verify above has passed — never earlier. Changes the user asks for afterward are follow-up commits on the same branch and PR (branch-workflow "Follow-ups"). That's it — In Review is derived, nothing to set; the issue closes when the user merges the PR.

## Rules

- Report with evidence, not assertions: any "passes"/"works" claim includes the command output that shows it.
- Never reorder or skip checklist items without asking.
- Never fold unrelated fixes into the main diff.
- The "Do not do" section overrides any better idea you have mid-flight.
