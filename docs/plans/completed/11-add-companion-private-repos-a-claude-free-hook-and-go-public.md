# 11 — Add companion private repos, a Claude-free hook and /go-public

## Context

Source issue: #11

BleakLoop (`ianbleaker/bleakloop`, private) is ready to go public. An audit on 2026-10-27 found that its commit messages, authors and PR bodies are clean, but 12 plan docs under `docs/plans/` mention Claude: `CLAUDE.md` references, the Claude-free rule written out, and `claude.ai/artifact/...` mockup links. Issues #52 and #53 also link to a mockup. GitHub keeps every merged PR's original commits (`refs/pull/*`), and only GitHub Support can delete them. So rewriting history in place doesn't clean a repo that is about to go public. This plan builds the general method into snoozy-dev and makes BleakLoop its first run.

Decisions already made (do not re-litigate):

- **The Claude-free rule applies to every project except snoozy-dev itself.** No mention of Claude or Anthropic, no attribution footers, no `Co-Authored-By` trailers, and no session or artifact links in commits, PRs, issues, comments or tracked files. This replaces the current global "`Co-Authored-By` is fine to keep" line. Why: any private repo might go public later, and one rule is simpler than a per-project setting. snoozy-dev is exempt because it is public Claude Code tooling and its skills have to name Claude.
- **Claude links (artifacts, mockups, brainstorm pages) live only in plan docs.** Issues refer to "the plan for #N". Why: plans are versioned but never published (next decision).
- **A project may have a private companion repo**: a sibling folder `../<repo>-private` with its own private GitHub repo. It holds `CLAUDE.md`, `CLAUDE.local.md` (if any), `.claude/`, `plans/` and `plans/completed/`. The public repo gets `CLAUDE.md` and `.claude` as symlinks into it, listed in `.git/info/exclude`. Why: plans and Claude config stay versioned and backed up without being published. A submodule would show a dead link to a private repo, and a private branch would be public along with the rest of the repo.
- **The companion repo is a sibling folder, not an ignored folder inside the project.** Why: `/batch-tasks` workers run in separate worktrees, and an ignored folder wouldn't exist there. Plan paths are therefore resolved from the main checkout and passed around as absolute paths.
- **Plans location setting:** the project's `CLAUDE.md` `## Plans` section may contain the line `Private repo: ../<repo>-private`. With it, plans live in `<companion>/plans/`; without it, in `docs/plans/` as today. One helper script resolves this, so no skill parses `CLAUDE.md` itself.
- **Plan commits in a companion repo go straight to its `main`** (`pull --rebase --autostash`, commit only the plan file, push), including the archive move to `plans/completed/`. Why: the companion holds only docs and config and never takes PRs. `checkout -B main origin/main` is not used there, because it would discard unpushed local `CLAUDE.md` commits.
- **Enforced by a global hook** (`global/hooks/claude-free.py`, PreToolUse). Messages, titles and bodies are checked against a broad pattern. Staged file content is checked against a narrow pattern so that product code using an API isn't caught (patterns below). A repo is exempt when a file named `.claude-free-exempt` exists at its top level. Companion repos and snoozy-dev carry that file. Why a marker file and not a `CLAUDE.md` line: the companion's `CLAUDE.md` is the same file the public repo symlinks to, so a line in it would exempt the public repo too.
  - Broad (case-insensitive): `\b(claude|anthropic)\b|co-authored-by|claude\.(ai|com)/`
  - Narrow (case-insensitive): `claude\.(ai|com)/|\bCLAUDE\.md\b|(^|[\s/"'(])\.claude/|co-authored-by:.*(claude|anthropic)|generated with \[?claude`
- **New skill `/go-public <new-repo-name>`**, because this workflow will repeat. It creates the companion repo and moves plans into it with their history (`git filter-repo`). It cleans issue and PR text and rewrites a fresh clone without the stripped paths. It pushes to a **new** repo, kept private until the checks pass, and transfers the issues **1..max in order so every number is kept**. PR numbers become closed stand-in issues titled "PR #N: <title>" holding the PR's description. Then it repoints the local clone, runs a final scan, makes the repo public, and renames the old repo to `<old>-archive` and archives it. Why a new repo: the old PR copies can't be deleted, but they stay behind in the private archive.
  - Why numbers must match: commit messages and squash-merge subjects say "(#65)", and GitHub links `#N` by number.
  - Why the new repo stays private during transfers: GitHub doesn't allow transferring an issue from a private repo to a public one.
- **BleakLoop specifics (first run):**
  - The public repo is `ianbleaker/bleakloop-linnstrument`. The companion is `ianbleaker/bleakloop-linnstrument-private` at `~/development/bleakloop-linnstrument-private`. The old repo becomes `bleakloop-archive`. The local folder stays `~/development/bleakloop`, because Claude's per-project memory is keyed on that path and Live's control-surface folder `src/BleakLoop/` never changes.
  - Why "linnstrument" in the repo name: the code is specific to the LinnStrument (16 × 8 layout, per-pad X faders, User Firmware Mode, firmware colours and NRPN). BleakLoop stays the brand, and GitHub redirects a later rename.
  - `docs/spec.md` (deprecated, the frozen v0.1.0 record) is deleted from the public tree in an ordinary commit, so it stays in history at `v0.1.0`. Its history is copied into the companion as `spec.md`.
  - The README opens with "BleakLoop for LinnStrument" and links `docs/architecture.md` instead of the spec.

## Before starting

- Read `CLAUDE.md` (skills in `plugins/snoozy-dev/skills/<name>/SKILL.md`, shared helpers in `plugins/snoozy-dev/project-patterns/`, never overwrite a user's config without asking, the doc-sync table).
- Read each file named below in full before editing it.
- `scripts/verify.sh` must pass at the start and after every item that touches a `.sh` or `.mjs`. Check every new `.py` with `python3 -m py_compile <file>`.
- For checks, use stub `gh`/`git` scripts on a temporary `PATH` and throwaway repos in the scratchpad directory. Don't touch real GitHub repos until Part B.
- Part B makes outward-facing, hard-to-reverse changes (new repos, issue transfers, making a repo public, renaming). Each step marked **Confirm** needs the user's explicit go-ahead in the session at that point. Approving this plan is not that go-ahead.
- `uvx` is available. Run filter-repo as `git filter-repo` if installed, otherwise `uvx git-filter-repo`.

## Checklist

### Part A — snoozy-dev

- [x] **Plans-dir helper.** Create `plugins/snoozy-dev/project-patterns/plans-dir.sh` (bash, `set -euo pipefail`, executable). Run from anywhere in a project, including a worktree:
  - The main checkout root is `ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")`.
  - If `$ROOT/CLAUDE.md` exists and has a line matching `^Private repo: +(\S+)`, resolve that path against `$ROOT` and print `PLANS_REPO=<abs companion>` and `PLANS_DIR=<abs companion>/plans`. If the folder is missing, exit 1 with `plans-dir: companion repo <path> not found`.
  - Otherwise print `PLANS_REPO=$ROOT` and `PLANS_DIR=$ROOT/docs/plans`.
  - The header comment documents the `Private repo:` line.
  - Done when `scripts/verify.sh` passes and, in scratchpad repos: no line → `docs/plans`; with the line → companion paths, including from a `git worktree add` worktree; with the line but the folder missing → exit 1.
- [x] **Claude-free hook.** Create `global/hooks/claude-free.py` (run as `python3 -I`, reads the PreToolUse JSON on stdin). Allow with exit 0 when the tool's working directory is outside a git repo, or when `<toplevel>/.claude-free-exempt` exists. Otherwise collect text and block with exit 2 and a stderr message naming each matched snippet and the rule (`global/CLAUDE.md`). What it collects:
  - **Bash:** split the command on `&&`, `||`, `;` and `|`, then `shlex.split` each segment. A segment containing `<<` scans its heredoc body instead. Collection is per command:
    - `git commit`: the values of `-m`/`--message`, plus the contents of the `-F`/`--file` file (broad pattern). Also the added lines from `git diff --cached -U0` (narrow pattern).
    - `git push`: the messages from `git log --format=%B <range>` (broad pattern) and the added lines from `git diff <range>` (narrow pattern). The range is `@{u}..HEAD`, or `origin/main..HEAD` when there is no upstream.
    - `gh issue|pr create|edit|comment|review|close`: the values of `--title`/`-t` and `--body`/`-b`, plus the contents of the `--body-file`/`-F` file (broad pattern).
    - `gh api`: the values of `-f`/`-F`/`--field`/`--raw-field` whose key is `title`, `body` or `message` (broad pattern).
  - **`mcp__github__.*` tools:** the string values of `title`, `body` and `message` (broad pattern) and of `content` (narrow pattern).
  - Use the patterns exactly as written in Context.
  - Done when `py_compile` passes and stdin fixtures in a scratchpad repo give:
    - `git commit -m "fix: x"` → 0
    - a commit message with a `Co-Authored-By: Claude …` trailer → 2
    - a staged file adding a `claude.ai/artifact/x` link → 2
    - a staged file adding `import anthropic` → 0
    - `gh issue create --body "see claude.ai/artifact/x"` → 2
    - `cd ~/.claude && git status` → 0
    - any of the above with `.claude-free-exempt` present → 0
- [x] **Register the hook.** Add the hook to `global/settings.snippet.json` under `hooks.PreToolUse`, matcher `Bash|mcp__github__.*`, command `python3 -I "$HOME/snoozy-dev/global/hooks/claude-free.py"`, timeout 10. Create an empty `.claude-free-exempt` at the snoozy-dev root. Done when `python3 -m json.tool global/settings.snippet.json` passes.
- [x] **Global rules.** Edit `global/CLAUDE.md`:
  - Replace the two attribution bullets (lines 4–5) with one Claude-free bullet. It states the rule from Context and the `.claude-free-exempt` exemption, says Claude links go only in plan docs, says `Co-Authored-By` is never added, and notes that it overrides harness attribution reminders.
  - Extend the `/write-plan` exception bullet: with a companion repo, plan writes, revisions and archive moves push straight to the companion's `main`.
  - Done when `grep -n 'fine to keep' global/CLAUDE.md` prints nothing.
- [x] **`write-plan`.** Edit `plugins/snoozy-dev/skills/write-plan/SKILL.md`:
  - The Precondition and Phase 2 resolve `PLANS_DIR`/`PLANS_REPO` with `"${CLAUDE_PLUGIN_ROOT}/project-patterns/plans-dir.sh"`, and every `docs/plans/` mention becomes `$PLANS_DIR`.
  - The end-of-Phase-2 commit keeps today's `checkout -B` flow when `PLANS_REPO` is the project. For a companion it becomes `git -C "$PLANS_REPO" pull --rebase --autostash origin main`, then `git add plans/<file>`, commit and push. Revisions follow the same branching.
  - Add to Phase 1: links to mockups or artifacts produced while sparring go in the plan's Context, never in the issue.
  - Done when every `docs/plans` mention is gone or written as the fallback.
- [x] **`next-task`.** Edit `plugins/snoozy-dev/skills/next-task/SKILL.md` line 27 to `ls "$PLANS_DIR"/<NN>-*.md` after resolving with `plans-dir.sh`. Add to the PR body rule: no Claude mentions or links (the hook enforces this).
- [x] **`batch-tasks` and `select-batch.mjs`.** In `plugins/snoozy-dev/skills/batch-tasks/select-batch.mjs`:
  - Run `plans-dir.sh` once.
  - If `PLANS_REPO` differs from the project root, run `git -C <PLANS_REPO> fetch -q origin main` and look for plans in `git -C <PLANS_REPO> ls-tree -r --name-only origin/main` under `plans/${n}-`, reporting the plan as the absolute path `<PLANS_DIR>/<name>`. Otherwise keep the current `mainFiles` lookup.
  - Don't touch the `fileSet`/`byBase` Touches logic.
  - Update the eligibility wording in `plugins/snoozy-dev/skills/batch-tasks/SKILL.md` to match.
  - Done when `scripts/verify.sh` passes and, with a scratchpad project plus companion, a `size:medium` ready issue with `plans/<n>-x.md` on the companion's `origin/main` counts as eligible with an absolute plan path. Without a companion, output is unchanged.
- [x] **`task-worker`.** Edit `plugins/snoozy-dev/agents/task-worker.md`:
  - The plan path is now an absolute path, or `none`.
  - When the plan sits in a companion repo, the worker commits its plan-doc edits there (that file only; `pull --rebase --autostash`, then push, retrying up to 3 times on a rejected push or `index.lock`) and never copies the plan into the PR.
  - Add the Claude-free rule for the PR body.
- [x] **`implement-plan` and `audit-plan`.** Edit `plugins/snoozy-dev/skills/implement-plan/SKILL.md` and `plugins/snoozy-dev/skills/audit-plan/SKILL.md`:
  - The archive move to `completed/` uses `$PLANS_DIR`.
  - In a companion, the move is `git -C "$PLANS_REPO" mv plans/<f> plans/completed/<f>`, committed and pushed to the companion's `main`, never part of the project's diff.
  - Checklist tick-offs in a companion plan are committed there the same way.
- [x] **`onboard`.** Edit `plugins/snoozy-dev/skills/onboard/SKILL.md`:
  - If `CLAUDE.md` has a `Private repo:` line, skip `mkdir -p docs/plans/completed`. Check instead that `<companion>/plans/completed/` and `<companion>/.claude-free-exempt` exist, and that `CLAUDE.md` and `.claude` are symlinks listed in `.git/info/exclude`. Report anything missing; don't create a companion (that is `/go-public`'s job).
  - The scaffolded Plans section text mentions the optional `Private repo:` line.
- [x] **`wrap-up`.** Edit `plugins/snoozy-dev/skills/wrap-up/SKILL.md`: when a companion exists, include `git -C "$PLANS_REPO" status --short` and its unpushed commits in the uncommitted-work report. The example prompt on line 31 uses the resolved plan path.
- [x] **`log-task` and `brainstorm`.** In `plugins/snoozy-dev/skills/log-task/SKILL.md`, widen the attribution rule to the full Claude-free rule: no artifact or mockup links in issue bodies, which say "see the plan" instead. In `plugins/snoozy-dev/skills/brainstorm/SKILL.md`, add that mockup or artifact links are handed to `/write-plan` for the plan's Context, never put in issues.
- [x] **`/go-public` skill.** Create `plugins/snoozy-dev/skills/go-public/SKILL.md`.
  - **Arguments:** `<new-repo-name>` (required), `--strip <path>` (repeatable, default `docs/plans`: removed from public history and moved into the companion with its history) and `--copy <path>:<companion-path>` (repeatable: history copied into the companion, public history untouched).
  - Steps, in order, each with its done check:
    1. **Preflight.** On a clean `main` that matches `origin/main`. Record `OLD=<owner>/<repo>`. The new name and `<new>-private` must not exist on GitHub, and `../<new>-private` must not exist locally.
    2. **Audit.** Fetch `refs/pull/*` into temporary refs (deleted afterwards). Scan every commit message, author, historical blob, PR title and description, and issue body and comment with the broad pattern. Report the hits grouped by file, PR or issue.
    3. **Companion.** In a scratchpad clone, run filter-repo with `--path <strip>` and each `--copy` source, plus `--path-rename` so `docs/plans/` becomes `plans/` and each copy lands at its companion path. Add `CLAUDE.md`, `CLAUDE.local.md` (if present), `.claude/` (from the working copy) and an empty `.claude-free-exempt` in one commit.
       - **Confirm:** then `gh repo create <owner>/<new>-private --private` and push.
       - Clone it to `../<new>-private`.
       - Replace `CLAUDE.md` and `.claude` in the project with symlinks into it, confirming `.git/info/exclude` lists them.
       - Set the `Private repo:` line in `CLAUDE.md`.
    4. **Text cleanup.** For every issue or PR hit from step 2, propose new text that moves each Claude link into that issue's plan doc in the companion (adding a `Mockup:` line to Context if the plan lacks it) and drops other mentions. **Confirm** the batch, apply it with `gh issue edit` / `gh pr edit` / `gh api` comment PATCH, commit the plan changes to the companion, and re-scan until there are no hits.
    5. **Rewrite.** Make a fresh scratchpad clone of `OLD` and run `filter-repo --invert-paths --path <each strip>`. Re-run the step 2 message and blob scan on the result. If anything remains, stop and propose `--replace-text`/`--replace-message` rules for the user to approve.
    6. **New repo.** **Confirm**, then `gh repo create <owner>/<new> --private`.
       - Push `main` and all tags from the rewritten clone, but no other branches.
       - Run `gh label clone OLD --repo <owner>/<new>`.
       - Copy the description and topics with `gh repo edit`, and apply onboard's repo-settings step.
    7. **Issues.** **Confirm**, then go through `n = 1..max(number across OLD's issues and PRs)` in order. Each step must produce issue number `n` in the new repo; stop at the first mismatch.
       - **Issue:** `gh issue transfer n <owner>/<new>`.
       - **PR:** create an issue titled `PR #n: <title>`, with body `Pull request from before the move, <state> <mergedAt or closedAt>.` and then the PR's description, then close it.
       - **Missing number:** create a placeholder and delete it with `gh issue delete --yes`.
    8. **Local clone.**
       - `git remote set-url origin <new>`, `git fetch --prune --force --tags origin` and `git checkout -B main origin/main`.
       - Delete every local branch except `main`.
       - Run `git reflog expire --expire=now --all && git gc --prune=now`.
       - Untracked and excluded files (symlinks, venvs) stay put.
    9. **Final scan.** Repeat step 2 against the new repo (including its `refs/pull/*`, which should be empty) and the moved issues. There must be zero hits.
    10. **Publish.** **Confirm**, then `gh repo edit <owner>/<new> --visibility public --accept-visibility-change-consequences`.
    11. **Archive.** **Confirm**, then `gh repo rename <old>-archive --repo OLD` and `gh repo archive <owner>/<old>-archive --yes`.
  - The `## Rules` section:
    - Never force-push or rewrite `OLD`.
    - Never make anything public before step 9 is clean.
    - Every **Confirm** step is a separate question.
    - Stop on the first error and report the state, because the steps are not idempotent.
  - Done when the file exists with these 11 steps, each with its done check.
- [x] **Docs.** Make these edits:
  - `SETUP.md`: add `go-public` to the skills table.
  - `README.md`: if it lists hooks, add `claude-free.py`.
  - snoozy-dev's `CLAUDE.md`: under `## Plans`, note the optional `Private repo:` line, and add an Invariants line saying `.claude-free-exempt` marks this repo exempt.
  - Done when `grep -n go-public SETUP.md` shows the row.
- [x] **Install the hook globally.** **Confirm** with the user, then merge the new `PreToolUse` entry into `~/.claude/settings.json`, keeping every existing entry. Done when `python3 -m json.tool ~/.claude/settings.json` passes and a commit attempt with a Claude trailer in a scratchpad repo is blocked.
- [x] **Verify Part A.** `scripts/verify.sh` passes and every new `.py` compiles. Commit and push according to `/implement-plan`'s flow.

### Part B — BleakLoop, the first run

- [x] **README and spec PR** (in `~/development/bleakloop`, branch `chore/prepare-public-repo` from `origin/main`):
  - Delete `docs/spec.md`.
  - Rewrite `README.md`: the title becomes `# BleakLoop for LinnStrument`; the status line lists the current modes (Session, Mixer, FX, Sequencer and Linnstrument Mode, taken from `docs/manual.md`'s headings); line 9 becomes a pointer to `docs/architecture.md` for how it's built. Keep Credits and Licence.
  - Run the BleakLoop verify (`uvx ruff@0.14.0 check src/ tests/ tools/`, `uvx --python 3.11 pytest@8.3.3`, `PYTHONPATH=src python3 -m tools.docs --check`). Done when all three pass and `git grep -n 'spec\.md'` prints nothing.
  - **Confirm**, then push, open the PR, and merge it once the user approves.
- [x] **Run `/go-public`** from `~/development/bleakloop` as `/go-public bleakloop-linnstrument --strip docs/plans --copy docs/spec.md:spec.md`.
  - The companion is `~/development/bleakloop-linnstrument-private` (`ianbleaker/bleakloop-linnstrument-private`).
  - Expected text cleanup: issues #52 and #53 (their mockup link moves into `plans/completed/52-*.md` and `53-*.md`).
  - The old repo ends as `ianbleaker/bleakloop-archive`, archived.
- [x] **BleakLoop `CLAUDE.md`** (now in the companion; commit and push there):
  - **Behaviour:** the spec bullet now reads: "`spec.md` in the companion repo is the frozen v0.1.0 record (tag `v0.1.0`)…". The rest of the bullet is unchanged.
  - **Plans:** add `Private repo: ../bleakloop-linnstrument-private`, with plans in `plans/` and completed ones in `plans/completed/`.
  - **Invariants:** replace the "published with no trace of Claude" bullet with: "`CLAUDE.md` and `.claude/` are symlinks into the companion repo, excluded via `.git/info/exclude`. The Claude-free rule is global (snoozy-dev)."
  - Done when `grep -n 'docs/plans\|docs/spec' CLAUDE.md` prints nothing.
- [x] **Memory pointers.** In `~/.claude/projects/-Users-ianleake-development-bleakloop/memory/`, update every entry that names `docs/plans/` or `docs/spec.md` to the companion paths, or delete it if the repo docs already cover it.
- [x] **User checks.** Hand these to the user:
  - Open a new Claude session in `~/development/bleakloop` and check that `CLAUDE.md` loads (`/memory`).
  - Check that the clean-room guard hook still blocks a read of the old script.
  - Check that the GitHub CI run on the new repo's `main` is green.
  - Check the public page at `github.com/ianbleaker/bleakloop-linnstrument`.

## Discovered during implementation

- Hook working directory: "the tool's working directory" is read per command, not only the session `cwd` — a leading `cd X` segment and `git -C X` move it, and the diff/log checks run there. Otherwise a `cd ~/development/bleakloop && git commit …` from a snoozy-dev session would pass on snoozy-dev's exemption.
- Hook push diff uses `<base>...HEAD` (merge-base) rather than `<base>..HEAD`, so commits that landed on `main` meanwhile don't show as added lines. `git commit -a` scans `git diff HEAD` instead of the staged diff. Hook bugs exit 1 (allow, error shown); an unparseable command is blocked only if it is a `git commit`/`gh issue|pr|api` that matches the broad pattern.

- Hook `cd $VAR`: the first live check (`S=…; cd $S && git commit …` from the exempt snoozy-dev session) passed a Claude trailer, because the unexpanded target looked like a missing folder, which counts as exempt. Fixed: variables set earlier in the same command are expanded, and an unresolved `cd`/`-C` target is never exempt. Fixtures now cover both cases (24 cases, all pass).
- `/go-public` BleakLoop run, progress (2026-10-27): steps 1–9 are done. The companion `ianbleaker/bleakloop-linnstrument-private` is cloned at `~/development/bleakloop-linnstrument-private`, with symlinks in place and the `Private repo:` line pushed. Issues #52 and #53 are cleaned. The new repo `ianbleaker/bleakloop-linnstrument` holds 37 commits and `v0.1.0`, and issues 1–66 map exactly. The local clone is repointed, and the final scan has zero hits. **Step 10 (publish): the user said "not yet"; the repo is still private.** Step 11 (archive) is pending.
- `/go-public` run notes:
  - `spec.md` had to be restored in the companion's setup commit, because #66 deleted it and filter-repo carried the deletion over.
  - `.git/info/exclude` had `.claude/` (directory-only), so the `.claude` symlink showed as untracked. A bare `.claude` entry was added, and the skill now says so.
  - Number 23 returned a GitHub 504 although the issue was created. It was checked, closed, and the run resumed at 24.
  - Before deleting local branches, every local `task/*` commit was confirmed present in the old repo's `refs/pull/*`, which the archive keeps.

- End-of-run candidates. The user chose "do them all now" instead of logging them:
  - `/go-public` helpers: `audit.py` and `transfer.py` now sit next to the skill, generalized from this run's scratchpad scripts, and `SKILL.md` steps 2, 5, 7 and 9 call them.
  - `.gitignore`: added `__pycache__/`.
  - Plugin version bumped to 1.1.0.
  - Why this plan doc was untracked: in the session that wrote it, auto mode blocked `/write-plan`'s commit and push to `main`. The settings snippet has no auto-mode allow rule for plan-doc pushes, unlike the one for `/sweep-tasks`. Adding that rule here was itself blocked as self-modification, so the rule text is handed to the user.

## Escalation

- **Q (2026-10-27):** The plan says to commit and push after "Verify Part A", but `/implement-plan` wants exactly one PR, opened after the whole task, with the archive move in it. PR after Part A, or one PR at the end? **A:** One PR at the end. Part A stays uncommitted while Part B runs from this working copy, then one `task/11-*` PR carries everything, including the archive move.
- **Q (2026-10-27):** The README/spec item's done check `git grep -n 'spec\.md'` can't print nothing, because frozen `docs/plans/completed/*` files mention `docs/spec.md` until `/go-public` strips them. How should it be read? **A:** Exclude `docs/plans`: done when `git grep -n 'spec\.md' -- ':!docs/plans'` prints nothing (it does). BleakLoop PR #66 opened; it merges only after the user approves.
- **Q (2026-10-27):** `/go-public` step 10 (publish) and step 11 (archive). **A:** At step 10 the user said "not yet". They will check the repo on GitHub and make it public themselves, then rename the old repo to `bleakloop-archive` and archive it. The run item is ticked, with those two steps handed to the user.
- Memory pointers: `~/.claude/projects/-Users-ianleake-development-bleakloop/` has no `memory/` directory, so there was nothing to update.

## Do not do

- Don't edit, rewrite or force-push the old repo's history. It becomes the archive as-is.
- Don't push the stale local `task/*` branches anywhere.
- Don't make anything public, transfer issues, or rename or archive a repo without the **Confirm** step at that point.
- Don't apply the Claude-free hook to snoozy-dev or to companion repos (they carry `.claude-free-exempt`).
- Don't restructure BleakLoop for other devices, and don't rename `src/BleakLoop/` or the local `~/development/bleakloop` folder.
- Don't change `docs/manual.md`, `docs/architecture.md` or any code in BleakLoop beyond the README and spec PR.
- Don't add a `Private repo:` setting to any other project.
