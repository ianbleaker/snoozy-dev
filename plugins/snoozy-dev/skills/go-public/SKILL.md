---
name: go-public
description: Move a private project to a new public GitHub repo with no trace of Claude - plans and Claude config go to a private companion repo (with their history), issue/PR text is cleaned, history is rewritten without the stripped paths, issues are transferred keeping every number, then the new repo is published and the old one archived. Use when the user wants to make a private repo public. Argument - <new-repo-name> [--strip <path>]... [--copy <path>:<companion-path>]...
---

Publish a private project as a **new** public repo. The old repo can't be cleaned in place: GitHub keeps every merged PR's original commits (`refs/pull/*`) and only GitHub Support can delete them. So the old repo is left untouched and becomes a private archive, and a rewritten copy goes public.

Run from the project's main checkout. Every step is outward-facing and not idempotent: **stop on the first error** and report exactly where things stand (what exists on GitHub, what was transferred, what the local clone points at).

## Arguments

- `<new-repo-name>` (required) — name of the public repo, same owner as the old one. The companion is `<new>-private`, cloned to `../<new>-private`.
- `--strip <path>` (repeatable, default `docs/plans`) — removed from public history and moved into the companion with its history (`docs/plans/` lands at `plans/`).
- `--copy <path>:<companion-path>` (repeatable) — history copied into the companion at `<companion-path>`; public history untouched (remove it from the public tree with an ordinary commit beforehand if it shouldn't be in the published `main`).

## Patterns

The same patterns as `global/hooks/claude-free.py` (case-insensitive):

- **Broad** (messages, titles, bodies, comments, authors, blobs): `\b(claude|anthropic)\b|co-authored-by|claude\.(ai|com)/`

Use a scratchpad directory for every clone below; delete them at the end.

Helpers next to this file: `audit.py` (the step 2/5/9 scan: `python3 -I "${CLAUDE_PLUGIN_ROOT}/skills/go-public/audit.py" <owner/repo | /local/clone> <workdir>`) and `transfer.py` (step 7). Run them from a script path, not inline, so their patterns don't trip the Claude-free hook.

## Steps

### 1. Preflight

- On `main`, clean (`git status --porcelain` empty apart from ignored/excluded files), and `git rev-parse main` equals `git rev-parse origin/main` after `git fetch origin`.
- Record `OLD=<owner>/<repo>` from `gh repo view --json nameWithOwner`.
- `gh repo view <owner>/<new>` and `gh repo view <owner>/<new>-private` must both fail (not found); `../<new>-private` must not exist locally.
- `git filter-repo --version` works (otherwise use `uvx git-filter-repo` everywhere below).
- If `CLAUDE.md` or `.claude/` is tracked (`git ls-files CLAUDE.md .claude`), it must be named in `--strip`; ask before adding it.

**Done when** all checks pass; report `OLD`, the new names and the strip/copy lists.

### 2. Audit

- Run `audit.py OLD <workdir>`, which does all of the following.
- Bare scratchpad clone of `OLD`; fetch PR heads into temporary refs: `git fetch origin '+refs/pull/*/head:refs/audit/pull/*'`.
- Scan with the broad pattern:
  - every commit message and author/committer across all refs (`git log --all --format='%H%x00%an <%ae>%x00%cn <%ce>%x00%B%x00'`);
  - every historical blob (`git grep -I -n -i -E '<broad>' $(git rev-list --all)`, grouped by path);
  - every PR title and description (`gh pr list --repo OLD --state all --limit 1000 --json number,title,body`) and PR comments/review comments;
  - every issue title, body and comment (`gh issue list --repo OLD --state all --limit 1000 --json number,title,body,comments`).
- Delete the temporary refs (`git for-each-ref --format='delete %(refname)' refs/audit | git update-ref --stdin`) and the clone.

**Done when** the hits are reported grouped by file (marking which fall under `--strip` and will disappear), by PR and by issue. Hits outside `--strip` in blobs or messages are handled in step 5.

### 3. Companion

- Scratchpad clone of `OLD`, then `git filter-repo --path <each strip> --path <each copy source> --path-rename docs/plans/:plans/ --path-rename <copy source>:<companion path> ...`.
- Add in one commit: `CLAUDE.md`, `CLAUDE.local.md` (if present), `.claude/` (all from the project's working copy) and an empty `.claude-free-exempt`. Ensure `plans/completed/` exists (`.gitkeep` if empty).
- **Confirm** (its own question), then `gh repo create <owner>/<new>-private --private`, add it as `origin` in the scratchpad clone and `git push -u origin main`.
- `git clone` it to `../<new>-private`.
- In the project, replace `CLAUDE.md` and `.claude` (and `CLAUDE.local.md` if present) with relative symlinks into `../<new>-private/`, and make sure `.git/info/exclude` lists each of them without a trailing slash (`.claude/` matches only a directory, not the symlink).
- Add `Private repo: ../<new>-private` to the `## Plans` section of `CLAUDE.md` (now the companion's file), commit and push it in the companion.

**Done when** `ls -l CLAUDE.md .claude` shows symlinks, `git status` in the project is clean, `plans-dir.sh` prints the companion paths, and `git -C ../<new>-private log --oneline -- plans | head` shows the plans' history.

### 4. Text cleanup

- For every issue and PR hit from step 2, propose new text: each Claude link (artifact, mockup, session) moves into that issue's plan doc in the companion (add a `Mockup:` line to its Context if it lacks one), the issue says "see the plan for #N", and any other mention is dropped. Same for comments.
- **Confirm** the whole batch (its own question), then apply it: `gh issue edit <n> --body-file <f>`, `gh pr edit <n> --body-file <f>` / `--title`, and `gh api -X PATCH repos/OLD/issues/comments/<id> -f body=...` (or `pulls/comments/<id>` for review comments). Fetch bodies to a file and edit the file; never retype a body.
- Commit the plan-doc changes in the companion (only those files) and push.
- Re-run the issue/PR part of step 2.

**Done when** the issue and PR scan shows zero hits.

### 5. Rewrite

- Fresh scratchpad clone of `OLD` (`main` and tags only), then `git filter-repo --invert-paths --path <each strip>`.
- Re-run step 2's message, author and blob scan on the result (`audit.py <absolute path of the clone> <workdir>`).
- If anything remains, stop and propose `--replace-text` / `--replace-message` rules (one rule per hit, showing before/after); apply only what the user approves, then re-scan.

**Done when** the rewritten clone has zero message, author and blob hits, and `git log --oneline | wc -l` is reported next to the old count.

### 6. New repo

- **Confirm** (its own question), then `gh repo create <owner>/<new> --private`.
- From the rewritten clone push `main` and all tags (`git push <new-url> main --tags`) — no other branches.
- `gh label clone OLD --repo <owner>/<new>`.
- Copy the description and topics (`gh repo view OLD --json description,repositoryTopics`, then `gh repo edit <owner>/<new> --description ... --add-topic ...`).
- Apply `/onboard`'s repo-settings step (squash-only, delete branch on merge, squash message from PR title/body).

**Done when** `gh repo view <owner>/<new> --json visibility,defaultBranchRef` shows `PRIVATE` and `main`, `git ls-remote <new-url>` lists only `main` and the tags, and the label count matches `OLD`.

### 7. Issues

The new repo stays private here: GitHub won't transfer an issue from a private repo to a public one. Numbers must match because commit subjects say "(#65)" and GitHub links `#N` by number.

- **Confirm** (its own question), then run `python3 -I "${CLAUDE_PLUGIN_ROOT}/skills/go-public/transfer.py" OLD <owner>/<new> <workdir> [start]`, which goes through `n = 1 .. max(number across OLD's issues and PRs)`, strictly in order:
  - **Issue:** `gh issue transfer <n> <owner>/<new> --repo OLD`.
  - **PR:** `gh issue create --repo <owner>/<new> --title "PR #<n>: <title>"` with body `Pull request from before the move, <state> <mergedAt or closedAt>.` followed by a blank line and the PR's description; then `gh issue close`.
  - **Missing number** (deleted issue): create a placeholder issue, then `gh issue delete <it> --repo <owner>/<new> --yes`.
- After each step, check that the number produced in the new repo is `n`; **stop at the first mismatch**.
- A GitHub 5xx can hide a create that succeeded. After any stop, check `gh issue view <n> --repo <owner>/<new>` before resuming: if `n` exists, finish it by hand (close the stand-in, delete the placeholder) and resume at `n+1`.

**Done when** every `n` maps, and `gh issue list --repo <owner>/<new> --state all --limit 1000 --json number` covers `1..max` minus the deleted placeholders.

### 8. Local clone

- `git remote set-url origin <new-url>`, `git fetch --prune --force --tags origin`, `git checkout -B main origin/main`.
- Delete every local branch except `main` (never push them anywhere).
- `git reflog expire --expire=now --all && git gc --prune=now`.
- Untracked and excluded files (the symlinks, venvs) stay put.

**Done when** `git branch` shows only `main`, `git status` is clean, and `git log --all --oneline | wc -l` equals the rewritten clone's count.

### 9. Final scan

Repeat step 2 (`audit.py <owner>/<new> <workdir>`) against `<owner>/<new>`: its history (including `refs/pull/*`, which should be empty), the transferred issues and the PR stand-ins with their comments.

**Done when** there are zero hits. Any hit → stop; nothing goes public.

### 10. Publish

**Confirm** (its own question), then `gh repo edit <owner>/<new> --visibility public --accept-visibility-change-consequences`.

**Done when** `gh repo view <owner>/<new> --json visibility` shows `PUBLIC`.

### 11. Archive

**Confirm** (its own question), then `gh repo rename <old>-archive --repo OLD --yes` and `gh repo archive <owner>/<old>-archive --yes`.

**Done when** `gh repo view <owner>/<old>-archive --json isArchived,visibility` shows `true` and `PRIVATE`. Report the public URL, the companion URL and the archive URL, and delete the scratchpad clones.

## Rules

- Never force-push or rewrite `OLD`: every rewrite happens in a scratchpad clone. The old PR copies stay behind in the private archive.
- Never make anything public before step 9 is clean.
- Every **Confirm** step is a separate question (`AskUserQuestion`); approving the run, or an earlier step, is not approval for the next one.
- Stop on the first error and report the state: the steps are not idempotent.
- Commits and text in the new repo follow the Claude-free rule (`global/CLAUDE.md`). The companion carries `.claude-free-exempt` and is never made public.
