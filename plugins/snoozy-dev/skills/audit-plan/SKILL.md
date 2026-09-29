---
name: audit-plan
description: Audit an implementation diff against its plan document - conformance, silent descoping, scope creep, and open escalations. Run in a planner-tier (strongest available model) session after /implement-plan. Argument - path to the plan doc.
---

Audit what an executor session did against what the plan doc said. You are the
quality gate between a cheap implementation and the user's manual testing.
Read and report; change code only for trivial, zero-risk fixes.

## Steps

1. **Read the plan doc fully** — Context, Checklist, Do not do, and any
   `## Discovered during implementation` / `## Escalation` sections.
2. **Get the diff.** Identify the commits or working-tree changes belonging to
   this plan (git log/diff since the plan started; ask if unclear). Review the
   diff, not the codebase — open surrounding code only where the diff demands it.
   If the doc is already in `docs/plans/completed/` (because `implement-plan`
   archived it without waiting for an audit), that's expected — review it in
   place there.
3. **Check conformance item by item.** For each checked item: implemented as
   specified? Does its acceptance criterion actually pass? Re-run cheap verify
   commands rather than trusting reported output.
4. **Hunt the executor failure modes:**
   - Silent descoping — item checked off but partially done or quietly weakened.
   - Scope creep — changes no checklist item calls for.
   - "Do not do" violations.
   - Improvisation where an escalation was warranted.
   - Doc-sync skipped (living docs not updated per the project's table).
   - Evidence gaps — "passes" claims with no command output behind them.
5. **Apply the project rubric** (`docs/review-rubric.md`) if one exists.
6. **Resolve escalations.** Answer each `## Escalation` question: convert the
   resolution into new unchecked checklist items, or flag it for the user if
   it's genuinely their call. New items follow write-plan's phrasing rule —
   action + file first, acceptance criterion second, no repeated rationale.
7. **Report and record.** "Suggestions" (findings not becoming new checklist
   items in this doc) accumulate during the audit instead of going straight
   into the report. Before writing the `## Audit <date>` section, present
   them in one `AskUserQuestion` call (multiSelect, one option per
   suggestion). Call `/log-task` for each approved one. List only `Logged:
   #NN - <title>` under the audit section for those — nothing for rejected
   suggestions.

   Append the `## Audit <date>` section to the doc: verdict (conforming /
   deviations found), each finding labeled **blocking** or **trade-off**, new
   unchecked items for anything that must be fixed, and the `Logged: #NN -
   <title>` lines from the checkpoint above. If the verdict is conforming
   with no new checklist items, move the doc into `docs/plans/completed/`
   (`git mv`) as part of that commit — unless it's already there (see step 2),
   in which case just append the audit section in place, no move needed. Then
   summarize for the user, ending with the exact next prompt —
   `/implement-plan <path>` to work the new items, or "ready for your manual
   smoke test".

## Rules

- Fix only trivial, zero-risk issues yourself (typos, a missed doc-sync line);
  everything else becomes checklist items for an executor session.
- Judge against the doc, not your own redesign. Better ideas go in the report
  as suggestions, never into the code.
- If a finding represents a *class* of bug this codebase repeats, propose a new
  entry for `docs/review-rubric.md`.
