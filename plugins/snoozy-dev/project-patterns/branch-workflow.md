# Branch workflow

Every task that changes tracked files — a GitHub issue, a plan doc, or a direct chat request — runs on its own branch, commits per step, and ends in exactly one PR. None of it needs per-instance confirmation, since it never touches `main`. Never commit to or push `main` directly; the only exceptions are plan-doc writes by `/write-plan` and private companion repos (see `global/CLAUDE.md`).

A companion repo (`Private repo:` line) never gets branches or PRs. Plans, tick-offs, audits and its `CLAUDE.md`/`.claude/` (symlinked into the project) commit straight to its `main` after `git -C <companion> pull --rebase --autostash origin main`. Only the project repo runs this workflow, so no change is ever merged twice.

## Name

- Backed by an issue: `task/<issue-number>-<slug>`.
- Anything else: `<type>/<slug>`, where `<type>` is the conventional-commit type of the main change — `feat`, `fix`, `refactor`, `docs`, `chore` or `security`. Preview staging, `/merge-preview` and `/sweep-tasks` recognize exactly these prefixes.

## Start — before the first edit

1. `git status --short`. Uncommitted changes that aren't this task's → stop and ask.
2. `git fetch origin`.
3. Pick the base, in this order — never whatever branch happens to be checked out:
   - Local `<branch>` tracking a live `origin/<branch>` (a resume or a follow-up) → `git checkout <branch>`, then `git pull --ff-only`.
   - Local `<branch>` with no upstream, or one other than `origin/<branch>` (never pushed) → `git checkout <branch>`, keep its commits, `git push -u origin <branch>`.
   - Local `<branch>` whose upstream is `gone` is a merged leftover, not this task → pick a new slug.
   - Only `origin/<branch>` exists → `git checkout -b <branch> --track origin/<branch>`.
   - Neither → `git checkout -b <branch> --no-track origin/main`. `--no-track` matters: tracking `origin/main` would make a later bare `git pull`/`git push` hit `main`.

Running Start again mid-task is safe: it lands on the existing branch with its commits.

## Commit

- One commit per step of the agreed plan — a plan doc's checklist item, or the step list approved in chat (a one-step request is one commit) — made once that step's verify passes. Conventional message.
- In-project plan docs: the step's tick-off goes in the same commit. Companion-repo plans: tick-offs go to the companion as before, never into this branch.
- Pre-existing fixes found mid-task: a separate commit on the same branch.
- Push after each commit (`git push -u origin <branch>` the first time) so a crashed session leaves its work on origin. A pushed branch without a PR doesn't count as In Review. Exception: `task-worker` keeps its commits local until the PR step, so a bail leaves nothing on origin.

## PR — when the planned work is done

Once every step is committed and the whole task's verify passes: `gh pr create --base main --head <branch> --title "<conventional title>" --body "<summary>"`. Task branches start the body with `Closes #N`. Body is the summary only (Claude-free rule, `global/CLAUDE.md`). Exactly one PR per branch, and never before the last planned step.

## Follow-ups

- User changes after the PR is open (a shift in the work, review feedback, a smoke-test failure) → run Start (it lands on the branch), add new commits, push. Same PR — never a second PR, never a force-push. Edit the PR body (`gh pr edit --body-file`) if the summary no longer holds.
- If the branch is staged on preview, it's stale there now: `/merge-preview` refuses it until `/stage-preview` rebuilds.
- A change big enough to be its own task gets its own branch and PR.
