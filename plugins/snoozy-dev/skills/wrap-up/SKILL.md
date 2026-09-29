---
name: wrap-up
description: End-of-session ritual - reconcile memory into lean pointers, check living-doc sync, report uncommitted work, and emit a short handoff with a suggested opening prompt for the next session. Use when the user says wrap up, hand off, or is ending a work session.
---

Close out the session so the next one starts clean. Four steps, then a short report.

## 1. Reconcile memory

Review the memory directory against what happened this session:

- **Update** entries this session invalidated or advanced.
- **Convert copies to pointers**: if an entry restates what the repo now records (a doc, a plan doc, git history), replace the content with a one-line pointer to that file. Target ~100 words per entry.
- **Delete** entries that are done, wrong, or fully captured by the repo.
- Only **add** an entry for genuinely new durable facts (user preferences, project direction, non-obvious discoveries not written anywhere). Keep MEMORY.md index lines in sync.

## 2. Doc-sync check

If code changed this session and the project has a doc-sync table (in project
CLAUDE.md or its architecture overview), verify each mapped living doc was
updated. Fix gaps now — don't defer.

## 3. Working-tree status

`git status` + the project's verify commands (typecheck/lint/tests). Report
uncommitted changes and whether verification passes. Do not commit unless asked.

## 4. Handoff

End with exactly this, and nothing verbose around it:

- **Done:** one line on what this session accomplished.
- **Open:** one line on what's unfinished or awaiting the user (e.g. manual smoke test).
- **Next:** the exact opening prompt to paste into a fresh session (e.g. `/implement-plan docs/plans/32-foo.md`), or "nothing queued".
