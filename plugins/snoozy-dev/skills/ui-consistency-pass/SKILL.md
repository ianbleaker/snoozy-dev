---
name: ui-consistency-pass
description: Audit a user-named UI area against the project's visual-language doc — findings-first, violations vs rule gaps. Use when the user wants a consistency pass over a component, screen, or feature area.
---

Audit a user-named UI area against the project's visual-language doc, then
fix what's approved. Findings-first: nothing gets changed before it's
reported and, where the doc is silent, ruled on.

## Steps

1. **Locate the project's visual-language doc.** Look for a pointer to it in
   the project's `CLAUDE.md` (styling invariants section). If there is no
   pointer and no such doc exists, offer to seed one via a bounded
   primitives inventory (modals/dialogs, buttons, spacing, forms,
   cards/sections/empty states, or whatever primitives this project actually
   has) before auditing anything. Don't audit against an undocumented,
   inferred standard.
2. **Read the doc and the design-token source it names** (theme file,
   token map, whatever the project calls its single source of truth for
   colors/spacing/type). The token source defines values; the
   visual-language doc defines usage — read both before judging the area.
3. **Audit the named area** against the doc: spacing, action placement,
   visual hierarchy, token discipline (no hard-coded values where a token
   exists), and duplicated JSX/markup (reuse-first — a repeated pattern is a
   signal to extract, not fix in place twice).
4. **Report findings in two buckets, before changing anything:**
   - **Violations** — the doc has a rule and the area breaks it. Cite the
     specific rule and where it's broken. These can be fixed on approval
     without further discussion.
   - **Rule gaps** — the doc is silent on the question, or the area makes a
     case that the documented rule itself should shift. Spar these **one at
     a time** (use AskUserQuestion for genuinely the user's call). Write
     each ruling into the visual-language doc **before** implementing the
     fix that depends on it — the doc must never fall behind a decision made
     during a pass.
5. **Implement the approved fixes.** Run the project's doc-sync conventions
   (update whichever docs the project's own sync table maps the changed
   files to). Respect the project's testing policy (don't launch a dev
   server or browser automation unless the project's own conventions call
   for it on this kind of change). Keep any unrelated pre-existing errors
   discovered along the way in separate commits, per standard policy.

## Rules

- Never fix a violation or rule gap before it's been reported (and, for rule
  gaps, ruled on and written into the doc).
- Don't expand the audit beyond the user-named area.
- No project-specific content belongs in this skill — the protocol is
  generic; specifics live in the project's own CLAUDE.md and
  visual-language doc.
