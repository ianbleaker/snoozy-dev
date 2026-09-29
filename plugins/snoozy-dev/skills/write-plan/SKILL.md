---
name: write-plan
description: Spar over findings or goals one at a time, then write a checklist plan document (migration/plan doc) for later implementation by /implement-plan. Use when the user wants to plan significant work, review findings into a plan, or "write a migration doc". Does not implement anything.
---

Produce a plan document through structured sparring, then write it. Two phases —
never write the doc while questions remain open.

This skill never leaves its backing issue on `status:draft` — in the
standalone case (change 2 below) it relabels straight to `status:ready`. A
`/write-plan` run always leaves its backing issue labeled `status:planned`
when it finishes.

## Precondition

Confirm `docs/plans/` exists before sparring. If it doesn't, this project
hasn't been onboarded onto snoozy-dev yet — stop and tell the user to run
`/onboard` first (onboard creates `docs/plans/` and `docs/plans/completed/`).
Do not fall back to a legacy directory name or guess a location.

## Phase 1 — Spar

1. Establish the goal and collect the raw material (findings, feature ideas, review output).
2. Go through the items **one at a time**. For each: state the problem, propose an approach, name the trade-offs, and challenge weak assumptions — including the user's. Use AskUserQuestion for decisions that are genuinely the user's.
3. Track resolved decisions as you go. An item is resolved when the approach, scope, and acceptance criteria are unambiguous.
4. Items the user defers accumulate in memory (title + one-line reason), not the checklist. At the end of Phase 1, before Phase 2 writing begins, present them in one `AskUserQuestion` call (multiSelect, one option per candidate). Call `/log-task` for each approved item. The doc's Context section records only `Deferred: logged as #NN - <title>` per approved item — nothing for rejected ones, which are dropped.

If the plan's raw material came from a `/next-task` hand-off, the Context
section must also include `Source issue: #NN` (the issue `/next-task` handed
off) so `implement-plan` knows what to close later.

**Issue backing (end of Phase 1, after the deferred-items checkpoint, before
Phase 2 writing begins):** every plan doc must be backed by a GitHub issue
labeled `status:ready`.

- If raw material came from a `/next-task` hand-off, that issue is already
  `status:ready` (that's why it was pullable) — use its number, don't create
  a second issue.
- Otherwise (a standalone `/write-plan` invocation with no prior issue), call
  `/log-task` now using the sparred summary as the issue body (creates the
  issue with `status:draft`), then immediately:
  ```bash
  gh issue edit <NN> --remove-label status:draft --add-label status:ready
  ```
  invoking `/write-plan` directly is itself the user's decision to act on
  it, so it skips the normal draft triage step.

Either way, the plan doc's Context section records `Source issue: #NN` before
Phase 2 begins.

**Invoked from brainstorming:** if the design arrives already approved through brainstorming's per-section dialogue, treat those decisions as resolved — don't re-litigate the approach or trade-offs the user already confirmed. Spend Phase 1 only on what brainstorming doesn't cover: breaking the design into checklist items and sequencing them.

## Phase 2 — Write the doc

Only after every item is resolved. Location: `docs/plans/` — the only
supported location (see Precondition above). Filename:
`<issue-number>-<issue-slug-text>.md` (regex: `^[0-9]+-[a-z0-9-]+\.md$`),
using the `Source issue: #NN` established in the issue-backing step above. No
date component — the issue already carries a creation timestamp on GitHub.

**This exact format is load-bearing, not a convention.** `/next-task`
detects an already-planned issue by testing whether
`docs/plans/<issue-number>-*.md` exists; that glob only works reliably if
every plan doc is named this way with no variation. Do not fall back to a
sequential-number lookup or any other naming scheme.

Once implemented (and audited, if `audit-plan` runs), the doc moves to
`docs/plans/completed/` — see `implement-plan`/`audit-plan` for when that happens.

**End of Phase 2, once the doc is written and the checklist is complete:**
first, unconditionally reset the local `main` to match the remote — **never
assume the session's current branch is already an up-to-date `main`**, even
mid-session, even if nothing else seemed to touch branches. This has caused
real stale-branch pushes before (committing the plan doc onto a leftover
`task/*` branch from earlier work in the same session instead of `main`):
```bash
git fetch origin main && git checkout -B main origin/main
```
`checkout -B` here is deliberate, not `checkout` — it force-resets local
`main` to exactly `origin/main`'s tip regardless of what the local `main`
pointer currently is or what branch was checked out a moment ago. Only
after that: commit and push the plan doc, no confirmation prompt —
`git add docs/plans/<file>.md && git commit -m "docs: add plan for #NN
<slug>" && git push`. This is a standing exception to the normal
confirm-before-push rule (see `global/CLAUDE.md`): plan docs are never
wrapped in a PR (see the planning-flow decision in past plans for why), so
a direct push to `main` is the only way the doc becomes visible on GitHub
— needed so the user can review it away from a machine before approving.
Before relabeling, record a resolved decision: if the backing issue's
`Decision needed:` line is not `none` and the plan resolves it, set it to
`none` and append `Decided: <question> — <answer>` inside the `##
Dependencies` block — fetch the body (`gh issue view <NN> --repo <repo>
--json body --jq .body > <tmp>`), edit that file, write it back (`gh issue
edit <NN> --repo <repo> --body-file <tmp>`); never retype the body, no
comment. If the plan doesn't resolve it, leave the line alone.
Then relabel the backing issue `status:ready` → `status:planned`:
```bash
gh issue edit <NN> --remove-label status:ready --add-label status:planned
```
This is the *only* place that sets `status:planned` — it signals to the user
that a plan now exists and needs their review/approval (approval = the user
adding `status:ready` themselves, outside this skill — often keeping
`status:planned` alongside it; both labels together means "plan reviewed and
approved" and is normal, not something to warn about or clean up).

**Same applies to a revision** (see the revising-an-existing-doc rule
above): run the same `git fetch origin main && git checkout -B main
origin/main` reset first, then commit and push straight to `main` with no
confirmation (`git commit -m "docs: revise plan for #NN <slug>"`). No label
change needed if the issue is already `status:planned` (with or without
`status:ready` alongside it); if the revision comes in while the issue is
`status:ready` *without* `status:planned`, that's a pre-existing-plan-doc
edge case out of scope for this plan — flag it as an escalation if hit,
don't invent new label-swap logic for it here.

Template — exactly these sections:

```markdown
# NN — Title

## Context
Why this work exists. Current state, what's wrong, decisions already made (with rationale).

## Before starting
Prerequisites: docs to read, invariants to respect, commands that must pass.

## Checklist
- [ ] Ordered, independently verifiable items. Each names the files it touches.

## Do not do
Explicit out-of-scope list — the binding fence for the implementing session.
```

Checklist items must be small enough that "is it done?" has a yes/no answer.

**Write for a literal-minded implementer.** Assume a weaker model executes this
doc in a fresh session with no memory of the sparring:

- Exact file paths and symbol names, not "the relevant module".
- Per-item acceptance criteria: the command to run and what output means done.
- Enumerate known edge cases inside the item — don't rely on inference.
- Every resolved decision goes in Context **with its why**, so the implementer
  never re-litigates it. Anything still ambiguous enough to improvise on
  belongs back in Phase 1, not in the checklist.

**Checklist item phrasing: terse, not bare.** Lead with the action and the
file(s) it touches, then the acceptance criterion — don't repeat Context's
rationale inside each item; the implementer already read Context once. This
does not apply to Context itself: its rationale is load-bearing (the user
reviews and approves the plan from it), so keep decisions there in full,
each with its why.

**Revising an existing, unimplemented plan doc** (user asks for changes
before `/implement-plan` runs) is still this skill's job, not an ad hoc
edit — re-apply Phase 2's template and phrasing rule to whatever checklist
items get added or rewritten, same as a first-time write.

## Rules

- Do not implement anything, not even "quick wins" discovered while sparring.
- Do not write the doc until sparring is complete.
- End by telling the user the doc path and the exact prompt to start implementation:
  `/implement-plan <path>` in a fresh session.
