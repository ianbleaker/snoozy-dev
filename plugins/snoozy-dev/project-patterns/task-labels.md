# Task label taxonomy

Task status lives entirely in the `status:*` labels below — no GitHub
Projects board is read or written. Cross-repo visibility is
`gh search issues --owner <owner> --label status:ready --state open` (see
"Status" below).

Single source of truth for the GitHub Issues label taxonomy used across every
project onboarded with `/onboard`. `/log-task`, `/next-task`, `/write-plan`,
`/implement-plan`, `/audit-plan`, and `/onboard` all point here instead of
repeating the list. Four groups, 12 labels total.

## `type:*` — what kind of work this is

| Label | For |
| --- | --- |
| `type:feature` | New capability that didn't exist before. |
| `type:fix` | Something broken, behaving wrong, or regressed. |
| `type:update` | Changing/improving something that already works as intended. |

## `priority:*` — how urgent

| Label | For |
| --- | --- |
| `priority:high` | Blocking, user-facing, or time-sensitive. |
| `priority:medium` | Should get done, no hard deadline. |
| `priority:low` | Nice to have, no pressure. |

## `size:*` — how much work

| Label | For |
| --- | --- |
| `size:small` | `/next-task` implements directly in-session, no plan doc (same shape as `/fix-bug`). |
| `size:medium` | Routed through `/write-plan` → `/implement-plan`. |
| `size:large` | Routed through `/write-plan` → `/implement-plan`. |

## `status:*` — where a task sits in the workflow

| Label | For |
| --- | --- |
| `status:draft` | Needs triage before it can be pulled. Set unconditionally at creation by `/log-task`. |
| `status:ready` | Approved to be pulled by `/next-task` — either "small enough, just implement it" or "plan doc reviewed and approved." |
| `status:planned` | `/write-plan` finished a doc for this issue. On its own: awaiting the user's review/approval of the plan. Alongside `status:ready`: plan reviewed and approved. Only `/write-plan` adds this. |

## Status

`Draft`, `Ready`, and `Planned` are the `status:*` labels above — the only
three genuinely human decisions (triage, plan approval). Set/read via `gh
issue edit --add-label/--remove-label` and `gh issue list --label status:X`.

**`status:planned` + `status:ready` together is normal, not drift.** The user
approves a plan by adding `status:ready`; removing `status:planned` at the
same time is optional. Keeping both is the preferred way to show at a glance
that a plan exists *and* has been reviewed. Skills never warn about the
combination, never "fix" it, and treat it exactly like `status:ready` for
pulling.

`In Review` and `Done` are never stored — they're derived, live-queried:

- **In Review** = an open PR exists on a branch matching
  `task/<issue-number>-*`: `gh pr list --repo <repo> --state open --json
  headRefName`, filtered by that prefix.
- **Done** = the issue's own `state == "closed"`: `gh issue view <NN> --json
  state`. Set by GitHub's native `Closes #NN` handling on a squash-merged PR
  — untouched by this taxonomy.

**Cross-repo view.** To see everything in flight across repos:

```bash
gh search issues --owner <owner> --label status:ready --state open
```

(swap `status:ready` for `status:draft`/`status:planned` as needed).

## Dependencies

Ordering beyond priority lives in GitHub's native issue dependencies plus a
mirrored body block, so it reads the same in the UI and to `/next-task`:

```
## Dependencies
Blocked by: #a, #b        (or "none") — must be merged first (/merge-preview orders by it)
Blocks: #c                (or "none")
Conflicts with: #d        (or "none") — same files; either order, never staged together
Decision needed: <question>   (or "none")
Decided: <question> — <answer>   (zero or more; accumulate)
```

Who writes each line:

- `/log-task` at creation — all lines except `Decided:` (`none` where the
  caller's context names nothing).
- The user at triage — any line.
- `/next-task` (after the user answers) and `/write-plan` (when the plan
  resolves it) — set `Decision needed:` to `none` and append a `Decided:`
  line.
- A `/batch-tasks` worker when it bails — writes the blocking question into
  `Decision needed:`.

The block is required for `/batch-tasks` eligibility: an issue without it is
ineligible (a missing block means unknown, not safe). `Decided:` lines are
binding on implementers, like a plan's "Do not do".

Set the native link for every `Blocked by` entry:
`gh api -X POST repos/<repo>/issues/<NN>/dependencies/blocked_by -F issue_id=<blocker's .id>`
(the REST `id`, not the issue number). `/next-task` skips issues with an open
blocker, and ranks an issue below the rest while its `Conflicts with` names an
issue that has an open `task/*` PR. `/stage-preview` ignores the line: it
groups by the branches' real diffs, which is more accurate once code exists.

## Touches

Every issue body ends with a `## Touches` section after the Dependencies
block — the repo-relative files the work will change, backticked and
comma-separated (`unknown` if not known yet):

```
## Touches
`src/lib/maps.ts`, `src/components/map/ConnectionLayer.tsx`
```

`/log-task` writes it at creation; the user corrects it at triage.
`/batch-tasks` takes it (plus file paths named elsewhere in the body, and
the plan doc's paths for plan-backed issues) as the predicted footprint for
its overlap drops, so a missing file means a missed conflict and an extra
one means a needless drop.

## `gh label create` invocations

Run against `<repo>` (`owner/name` form). Skip any that already exist.

```bash
# type:*
gh label create "type:feature" --repo <repo> --color 1D76DB --description "New capability that didn't exist before"
gh label create "type:fix" --repo <repo> --color D73A4A --description "Something broken, behaving wrong, or regressed"
gh label create "type:update" --repo <repo> --color 5319E7 --description "Changing/improving something that already works as intended"

# priority:*
gh label create "priority:high" --repo <repo> --color B60205 --description "Blocking, user-facing, or time-sensitive"
gh label create "priority:medium" --repo <repo> --color FBCA04 --description "Should get done, no hard deadline"
gh label create "priority:low" --repo <repo> --color 0E8A16 --description "Nice to have, no pressure"

# size:*
gh label create "size:small" --repo <repo> --color C2E0C6 --description "Implement directly in-session, no plan doc"
gh label create "size:medium" --repo <repo> --color FEF2C0 --description "Routed through /write-plan then /implement-plan"
gh label create "size:large" --repo <repo> --color F9D0C4 --description "Routed through /write-plan then /implement-plan"

# status:*
gh label create "status:draft" --repo <repo> --color D4C5F9 --description "Needs triage before it can be pulled"
gh label create "status:ready" --repo <repo> --color 0E8A16 --description "Approved to be pulled by /next-task"
gh label create "status:planned" --repo <repo> --color FBCA04 --description "Plan doc exists; with status:ready, plan is approved"
```
