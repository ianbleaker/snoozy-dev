---
name: implement-plan
description: Implement a checklist plan document (migration/plan doc) in order, checking items off, staying strictly in scope. Use when asked to implement, continue, or resume a migration or plan doc. Argument - path to the plan doc.
---

Implement the plan document at the given path. The doc is the contract: its
checklist is the scope, its "Do not do" section is binding.

## Steps

1. **Read the whole doc first** — Context, Before starting, Checklist, Do not do. If "Before starting" names prerequisite docs or commands, do those before touching code.
2. **Find the starting point.** Fresh run: first item. Resume: first unchecked item. Trust the checkboxes over memory.
3. **Implement checklist items strictly in order.** After completing each item:
   - Run the project's verify commands (typecheck/lint/tests as defined in project CLAUDE.md or the doc).
   - Edit the doc to check the item off (`- [ ]` → `- [x]`). Check-off happens immediately, not batched at the end — a crashed session must resume cleanly.
4. **Stay in scope.** Implement only what the checklist lists. If necessary out-of-scope work is discovered (a blocking bug, a missing prerequisite):
   - Blocking → fix minimally, note it in the doc under a `## Discovered during implementation` section, keep it in a separate commit if committing.
   - Non-blocking → accumulate it in memory (title + one-line reason) instead of writing it to the doc immediately. Move on. Never expand scope silently.
5. **Escalate instead of improvising.** If the doc conflicts with reality, or an item is ambiguous with more than one plausible reading: stop that item, ask the user directly via `AskUserQuestion` with the options you see, record the question and the answer in a `## Escalation` section in the doc, and continue with the next independent item (end the turn if truly blocked). Never leave a question unanswered by the time Finish runs — guessing past the doc is the one failure this workflow cannot recover from.
6. **Sync living docs.** If the project has a doc-sync table (edited file → living doc), update the mapped docs as part of the item that touched the code, not as an afterthought.
7. **Finish.** Before the final report, present the accumulated non-blocking discovered-item candidates (from step 4) in one `AskUserQuestion` call (multiSelect, one option per candidate). Call `/log-task` for each approved item. The `## Discovered during implementation` section keeps only the resulting `Logged: #NN - <title>` lines (plus any blocking items already written there in step 4) — nothing for rejected candidates.

   All items checked and every escalation from this run answered → run the full verify suite once more, then report: what was implemented, verify results, anything in "Discovered during implementation" or "Escalation", and what manual testing remains for the user. Archive the doc into `docs/plans/completed/` (`git mv`) as part of the final commit — this no longer waits on whether `audit-plan` will run; `audit-plan` remains available as an optional deeper pass and reviews the doc in place in `completed/` if invoked later. If the plan doc's Context names a `Source issue: #NN`, this is where the same branch/commit/push/PR mechanics as `/next-task`'s size:small path apply: first `git fetch origin main && git checkout -B task/<issue-number>-<slug> origin/main` — **never branch off whatever the session's current branch happens to be**, a stale or unrelated branch as the base has produced wrong-base pushes before — then commit (including the archival move), push, `gh pr create --base main --head task/<issue-number>-<slug> --title "..." --body "Closes #NN\n\n<summary>"`. Open exactly one PR here, only after the whole-task verify above has passed — never earlier, and never push further commits to it afterward within this run. That's it — In Review is derived, nothing to set. The archival to `docs/plans/completed/` still happens in the same commit/session regardless of review state — the issue closes when the user merges the resulting PR on GitHub. Commit/push only if the user or the doc explicitly says to.

## Rules

- Report with evidence, not assertions: any "passes"/"works" claim includes the command output that shows it.
- Never reorder or skip checklist items without asking.
- Never fold unrelated fixes into the main diff.
- The "Do not do" section overrides any better idea you have mid-flight.
