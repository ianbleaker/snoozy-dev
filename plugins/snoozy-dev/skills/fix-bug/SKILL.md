---
name: fix-bug
description: Disciplined bug fix when the user has already confirmed the reproduction - root cause with cited evidence before patching, cheap regression test when the substrate exists, sibling check. Never reproduces at runtime. Argument - bug description with observed vs expected behavior.
---

The user's report **is** the reproduction — trust it; never start a dev server
or browser to re-confirm. The discipline this skill enforces: no patch before a
root cause, no root cause without cited evidence.

## Steps

1. **Restate** observed vs expected behavior, one line each. If the report
   lacks either, ask now — one round of questions, never mid-fix.
2. **Root-cause from the code.** Trace the path with targeted reads and greps;
   state the cause with evidence (`file.ts:123` + the reasoning) *before*
   editing. Two live hypotheses → distinguish by reading or a unit-level probe,
   not at runtime. No cause found → report what was ruled out; do not patch
   symptoms.
3. **Fix the cause, minimally.** No drive-by refactors in the same diff.
4. **Regression test, when cheap.** If the bug is logic-level and a test file
   or harness already covers the area, add a test that fails pre-fix (state
   that you confirmed it fails). If it would need new scaffolding, skip it and
   say so — don't build test infrastructure inside a bug fix.
5. **Sibling check.** Grep for the same pattern elsewhere. Identical and
   trivial → fix in the same diff and say so; otherwise list the locations for
   the user.
6. **Verify with evidence** — typecheck/lint/test output included — then hand
   back for the user's manual smoke test. Commit only if asked.
