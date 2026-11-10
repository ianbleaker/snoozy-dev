# 10 — Keep plan docs on their task branch, not main

## Context

- Source issue: #10

`/write-plan` currently pushes every in-project plan doc straight to `main`, which is the only standing exception to "never push `main`". The reason was that the GitHub phone app seemed to show only `main`. Branch files can in fact be reached there, so the exception has no reason left. From now on a plan doc is written, revised, implemented and archived on its `task/<NN>-<slug>` branch, and it reaches `main` only through that task's PR.

Decisions, each with its reason:

- **No draft PR for a branch that is planned but not implemented.** "In Review" means an open PR, and the following all key off open PRs: `/next-task`'s `Conflicts with` check, `/stage-preview`, `/merge-preview` and `select-batch.mjs`. A draft PR would make a planned-only task look In Review unless every one of them learned to skip drafts. For phone access, the issue body gets a `Plan:` link to the plan file on its branch instead (decided in #10).
- **The `Plan:` link.** The URL is exactly `https://github.com/<owner>/<repo>/blob/task/<NN>-<slug>/docs/plans/<NN>-<slug>.md`. It goes on its own line directly above `## Dependencies`, never inside that block, so `select-batch.mjs`'s `section()` parse is unaffected. It is written only for in-project plans: companion plans live in a private repo and their URL must not appear in a possibly-public issue. The link stops working when the merge deletes the branch. That's acceptable because the issue closes at the same moment and the PR is linked from it.
- **One shared lookup, `plugins/snoozy-dev/project-patterns/find-plan.sh <NN>`**, sits next to `plans-dir.sh`. It is the only place that knows where a plan lives. `/next-task`, `/implement-plan` and `select-batch.mjs` all use it, so batch eligibility and next-task detection can't drift apart (the user chose this over inline commands in each skill).
- **Branch slug = plan filename slug.** `/write-plan` picks the slug once: branch `task/<NN>-<slug>` and file `docs/plans/<NN>-<slug>.md`. Every consumer then takes the branch from `find-plan.sh`'s `PLAN_BRANCH` and never derives its own. If a consumer derived a different slug, branch-workflow Start's "Neither" case would create a second `task/<NN>-*` branch, and `group-branches.sh` assumes exactly one per issue (`head -1`). For the same reason `find-plan.sh` errors out, rather than picking one, when more than one `task/<NN>-*` branch is on origin.
- **Planned vs. in progress (batch eligibility) is decided by a plan-only diff.** If `git diff --name-only origin/main...origin/<branch>` lists only `docs/plans/<NN>-<slug>.md`, the plan is approved and not started, so the issue is eligible. Any other file in the diff means work in progress, so it's ineligible as today. The user chose this over counting checkboxes, which misses work committed before the first tick-off.
- **Legacy plans already on `main` (e.g. `docs/plans/1-dual-mode-cloud-skills.md`) are found by a fallback, not migrated.** `find-plan.sh` checks `origin/main:docs/plans/` last. For a plan found there, `implement-plan` branches off `origin/main` exactly as today. The fallback costs one lookup and keeps unmigrated drafts in other onboarded projects working.
- **Companion repos are unchanged.** When `CLAUDE.md` has a `Private repo:` line, plans stay on the companion's `main` with no plan branch, and `PLAN_BRANCH` is empty. branch-workflow already says a companion never gets branches or PRs.
- **`/write-plan` never opens a PR.** It runs branch-workflow Start, then commits and pushes the plan. "PR" stays the implementer's last step. A pushed branch without a PR is not In Review (branch-workflow already says so).
- **This plan doc itself was pushed to `main` using the old flow.** The new flow didn't exist yet, and the old `/next-task` looks only on `main`. The legacy fallback finds it. Don't "fix" this by moving it.
- **Template list items.** `Source issue:` and `Deferred:` lines in Context become `- ` list items. As consecutive plain lines they render as one paragraph, and `global/hooks/md-unwrap.py` joins them into one line.
- **`sweep.sh` gets one guard.** Today it deletes only local branches whose upstream is `gone`, so a pushed plan branch is already safe. The case it misses: a local `task/*` branch whose origin copy was deleted without a merged PR. It falls into "unreconciled" and is still force-deleted, losing the only copy of a plan. Keep such a branch when its diff from `origin/main` contains a `docs/plans/` file.

## Before starting

- Read `plugins/snoozy-dev/project-patterns/branch-workflow.md` (Start, Commit, PR) and `plugins/snoozy-dev/project-patterns/plans-dir.sh`; `find-plan.sh` follows the style of `plans-dir.sh` (eval-able `printf '%q'` output).
- `scripts/verify.sh` must pass before the first item and after each one.
- `~/.claude/CLAUDE.md` is a symlink to `global/CLAUDE.md`, so its edit changes this session's own rules live. That's why it sits in the same item as the write-plan change, after the helper exists.

## Checklist

- [x] **Add `plugins/snoozy-dev/project-patterns/find-plan.sh <NN> [--no-fetch]`.** Header comment states usage and output like `plans-dir.sh`. Behaviour:
  - It resolves `PLANS_REPO`/`PLANS_DIR` by running `plans-dir.sh` from its own directory, then runs `git fetch -q origin` in each repo it reads, unless `--no-fetch` is passed.
  - **Companion** (`PLANS_DIR` ≠ `$PLANS_REPO/docs/plans`): look in `git -C "$PLANS_REPO" ls-tree -r --name-only origin/main plans/` for `plans/<NN>-*.md`, excluding `plans/completed/`. If found: `PLAN_PATH=$PLANS_DIR/<file>` (absolute), `PLAN_REPO=$PLANS_REPO`, `PLAN_REF=origin/main:plans/<file>`, `PLAN_BRANCH=` (empty), `PLAN_ONLY=0`.
  - **In-project, branch:** `git ls-remote --heads origin "task/<NN>-*"`. With 2 or more matches, print `find-plan: multiple task/<NN>-* branches on origin: …` to stderr and exit 2. With exactly one, look in `git ls-tree -r --name-only origin/<branch> docs/plans/` for `docs/plans/<NN>-*.md`, excluding `docs/plans/completed/`. Do not use `git show` with a glob, because it doesn't expand one. If found: `PLAN_PATH=docs/plans/<file>` (repo-relative), `PLAN_REPO=<project root>`, `PLAN_REF=origin/<branch>:docs/plans/<file>`, `PLAN_BRANCH=<branch>`, `PLAN_ONLY=1` if `git diff --name-only origin/main...origin/<branch>` lists exactly that one plan file, else `0`.
  - **In-project, legacy:** if the branch step found nothing, look in `git ls-tree -r --name-only origin/main docs/plans/` for `docs/plans/<NN>-*.md`, excluding `completed/`. If found: same outputs as the branch case with `PLAN_REF=origin/main:docs/plans/<file>`, `PLAN_BRANCH=` and `PLAN_ONLY=0`.
  - **Output** is `printf 'KEY=%q\n'` for `PLAN_PATH PLAN_REPO PLAN_REF PLAN_BRANCH PLAN_ONLY`, exit 0. If no plan is found, print nothing and exit 1.
  - **Done when** `scripts/verify.sh` passes and three cases behave as stated:
    1. `find-plan.sh 1` in this repo prints the legacy `docs/plans/1-dual-mode-cloud-skills.md` with an empty `PLAN_BRANCH`.
    2. `find-plan.sh 9999` exits 1 with no output.
    3. In a scratchpad bare repo plus clone, with a pushed `task/5-x` branch holding only `docs/plans/5-x.md`, it prints `PLAN_BRANCH=task/5-x PLAN_ONLY=1`. Adding a second file to that branch gives `PLAN_ONLY=0`, and adding a second `task/5-y` branch gives exit 2.

    Never push test branches to this repo's real origin.
- [x] **Rewrite `/write-plan`'s commit flow and template, and drop the global exception: `plugins/snoozy-dev/skills/write-plan/SKILL.md`, `global/CLAUDE.md`, `plugins/snoozy-dev/project-patterns/branch-workflow.md`.**
  - In write-plan Phase 2, the in-project flow becomes:
    1. Pick the slug once from the issue title.
    2. Run branch-workflow Start for `task/<NN>-<slug>`.
    3. Write `docs/plans/<NN>-<slug>.md`, then commit `docs: add plan for #NN <slug>` and push (`-u` the first time). Never open a PR.
    4. Write the `Plan:` line (URL shape from Context) directly above `## Dependencies` via fetch/edit/`--body-file`. If a `Plan:` line already exists, replace it.
    5. Then do the existing `Decided:` step and relabel `status:ready` → `status:planned`.
  - Revisions: find the branch with `find-plan.sh <NN>`, then use `PLAN_BRANCH`. Run Start on it, commit `docs: revise plan for #NN <slug>` and push. This applies whether or not implementation has started.
  - Delete from write-plan: the "note current branch / return to it" text, `git fetch origin main && git checkout -B main origin/main` and its rationale paragraph, the "standing exception to the never-push-`main` rule" paragraph, and the push-to-`main` revision branch.
  - Keep the companion flow as is.
  - In the template and Phase 1 text, show `Source issue:` and `Deferred:` as `- ` list items. Say why in one clause: md-unwrap joins plain consecutive lines.
  - Update the `/next-task` detection sentence in Phase 2 (the "load-bearing" paragraph) to say detection goes through `find-plan.sh`.
  - `global/CLAUDE.md` line 3: delete the "One exception: `/write-plan` commits and pushes a new plan doc straight to `main` …" sentence. Keep the companion-repo sentence.
  - `branch-workflow.md` line 3: the only `main` exception is now private companion repos. Add one sentence to Start: when the issue already has a plan branch (`find-plan.sh` → `PLAN_BRANCH`), that is `<branch>`. Never derive a new slug.
  - **Done when:**
    - `grep -n 'checkout -B main\|straight to .main.\|exception to the never-push' plugins/snoozy-dev/skills/write-plan/SKILL.md global/CLAUDE.md plugins/snoozy-dev/project-patterns/branch-workflow.md` shows only companion-repo lines.
    - `grep -n 'find-plan.sh' plugins/snoozy-dev/skills/write-plan/SKILL.md` has at least one hit.
    - `scripts/verify.sh` passes.
- [x] **Route `/next-task` and `/implement-plan` through `find-plan.sh`: `plugins/snoozy-dev/skills/next-task/SKILL.md`, `plugins/snoozy-dev/skills/implement-plan/SKILL.md`.**
  - next-task step 4 (`size:medium`/`size:large`): replace the `plans-dir.sh` + `ls "$PLANS_DIR"/<NN>-*.md` check with `eval "$(find-plan.sh <NN>)"`. Exit 0 means it exists: hand off `/implement-plan <PLAN_PATH>`. Exit 1 means it doesn't: `/write-plan`. Exit 2: stop and report the duplicate branches. Update the Rules line about never regenerating a plan to match.
  - implement-plan step 0 and step 2:
    - Take `<NN>` from the plan filename and run `find-plan.sh <NN>`.
    - If `PLAN_BRANCH` is set, run branch-workflow Start on exactly that branch **before step 1 reads the doc**, because the file only exists on that branch. Reorder the steps or say so explicitly.
    - If `PLAN_BRANCH` is empty (legacy-on-main or companion), keep today's derivation (`task/<NN>-<slug>` from Source issue, else `<type>/<slug>`).
    - The archive `git mv` into `docs/plans/completed/` stays the final commit on the branch, inside the same PR. Make that wording explicit.
  - **Done when:**
    - `grep -n 'ls "\$PLANS_DIR"' plugins/snoozy-dev/skills/next-task/SKILL.md` returns nothing.
    - `grep -c 'find-plan.sh'` is ≥1 in both files.
    - `scripts/verify.sh` passes.
- [x] **Make `/batch-tasks` plan-branch aware: `plugins/snoozy-dev/skills/batch-tasks/select-batch.mjs`, `plugins/snoozy-dev/skills/batch-tasks/SKILL.md`, `plugins/snoozy-dev/agents/task-worker.md`.**
  - `select-batch.mjs`:
    - Replace `findPlan()` and the companion/main `ls-tree` lookups with a call to `find-plan.sh <n> --no-fetch`, after one up-front `git fetch -q origin` in the project, plus the companion when configured. Parse its `%q` output the way the existing `plansEnv` parse does. Exit 1 means no plan. Exit 2 makes the issue ineligible with reason `multiple task/<n>-* branches on origin`.
    - Exempt from `hasBranch` an issue whose `PLAN_ONLY=1`.
    - The footprint read at the `git show origin/main:${planRef.ref}` line becomes `git -C PLAN_REPO show PLAN_REF`.
    - Carry `PLAN_BRANCH` into the BATCH output line, e.g. `branch=task/10-x`, or `branch=-` when empty.
    - Update the `size:… without …` ineligibility message to say "no plan (find-plan.sh)".
  - `SKILL.md` step 2:
    - Eligibility text: a `task/<N>-*` branch on origin is in progress unless its diff from `origin/main` is only its plan doc.
    - Plan lookup is `find-plan.sh`.
    - Step 6 passes the plan branch to each worker.
    - Step 7's crash check reports a `task/<N>-*` branch only when it has commits beyond the plan (`PLAN_ONLY=0`). Never delete either kind.
  - `task-worker.md`:
    - Inputs add **plan branch** (or `none`).
    - Plan path rule: absolute for companion plans as today. For an in-project branch plan it is repo-relative and resolved inside the worktree after checkout. That inverts "never resolve it against your worktree" for this case only.
    - Setup step 2: with a plan branch, `git fetch origin <branch>` then `git checkout -B <branch> --no-track origin/<branch>`. Otherwise keep today's `origin/main` line. Fix the "nothing to resume" sentence to match.
    - Route: push is `git push -u origin <branch>`, a fast-forward of the existing plan branch.
    - Bail: still `git reset --hard` / `git clean -fd` locally only. Never delete, reset or force-push the origin plan branch, and replace "a bail leaves nothing on origin" with "a bail leaves origin as it was".
  - **Done when:**
    - `node --check plugins/snoozy-dev/skills/batch-tasks/select-batch.mjs` and `scripts/verify.sh` pass.
    - `select-batch.mjs --dry-run`-style run (`select-batch.mjs 5` with no `--bodies-dir`) from this repo completes without error and lists #10 and #8 with sensible reasons.
    - `grep -n "origin/main:\${planRef" plugins/snoozy-dev/skills/batch-tasks/select-batch.mjs` returns nothing.
- [x] **Run `/audit-plan` on the plan's branch: `plugins/snoozy-dev/skills/audit-plan/SKILL.md`.**
  - Step 2: the diff is `git diff origin/main...<branch>` on the plan's branch, using `PLAN_BRANCH` from `find-plan.sh <NN>` when set.
  - Step 7: when the PR is still open, the audit section and any `completed/` move are committed on that branch. Keep today's `docs/<slug>-audit` branch rule for after merge.
  - **Done when** `grep -c 'find-plan.sh' plugins/snoozy-dev/skills/audit-plan/SKILL.md` is ≥1 and `scripts/verify.sh` passes.
- [ ] **Protect plan branches in sweep: `plugins/snoozy-dev/skills/sweep-tasks/sweep.sh`, `plugins/snoozy-dev/skills/sweep-tasks/SKILL.md`.**
  - In `sweep.sh`'s `else` (no merged PR) branch: if `git diff --name-only origin/main..."$branch" -- docs/plans/` is non-empty, don't delete. Add `"$branch (kept: holds a plan doc, no merged PR)"` to a new `kept` array, printed as a `Kept:` section, and `continue`.
  - Add a rule line to SKILL.md: never delete a `task/*` branch that holds a plan doc and has no merged PR.
  - **Done when:**
    - `scripts/verify.sh` passes.
    - In a scratchpad clone with a local `task/5-x` holding `docs/plans/5-x.md`, whose upstream was deleted, `sweep.sh` prints it under `Kept:` and `git branch --list task/5-x` still shows it. Stub `gh` on `PATH` to return empty for `pr list`.
- [ ] **Sync the convention docs: `plugins/snoozy-dev/project-patterns/task-labels.md`, `plugins/snoozy-dev/skills/onboard/SKILL.md`, `CLAUDE.md`.**
  - `task-labels.md`: `status:planned` row = "`/write-plan` pushed a plan doc to its `task/<NN>-*` branch". Document the `Plan:` body line: its position directly above `## Dependencies`, only `/write-plan` writes it, and it's in-project only. Update the `gh label create "status:planned"` description only if it still reads correctly; otherwise leave it.
  - onboard's CLAUDE.md snippet (around lines 190–191) and this repo's `CLAUDE.md` `## Plans` section: plan docs live in `docs/plans/` on their `task/<NN>-<slug>` branch and reach `main` through the task's PR.
  - **Done when:**
    - `grep -n 'Plan:' plugins/snoozy-dev/project-patterns/task-labels.md` has a hit.
    - `grep -rn 'task/<NN>' plugins/snoozy-dev/skills/onboard/SKILL.md CLAUDE.md` has hits.
    - `scripts/verify.sh` passes.

## Do not do

- Don't open a draft PR (or any PR) from `/write-plan`.
- Don't change companion-repo plan handling: no branches in a companion and no `Plan:` link for companion plans.
- Don't migrate or move existing plans on `main`, including this one. The legacy fallback covers them.
- Don't change `/stage-preview`, `group-branches.sh` or `/merge-preview`. They key off open PRs, and planned-only branches have none.
- Don't make "In Review" or any open-PR check filter `isDraft`.
- Don't push test branches or test issues to the real origin. Do all `find-plan.sh` and `sweep.sh` testing in scratchpad repos.
- Don't add `find-plan.sh` lookups to `/log-task`, `/brainstorm` or `/wrap-up`.
