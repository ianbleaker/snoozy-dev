---
name: onboard
description: Set up a project for efficient Claude Code work - detect the stack, write .claude/settings.json with verify hooks and a read-only permissions baseline, and scaffold a minimal project CLAUDE.md. Use when joining a new project or when the user asks to onboard/set up Claude for a repo.
---

Instantiate the per-project layer of the snoozy-dev repo's `SETUP.md` (https://github.com/ianbleaker/snoozy-dev/blob/main/SETUP.md). Never overwrite
existing config — merge, and ask before replacing anything the user wrote.

**Idempotent by design.** Re-running this on an already-onboarded project must
not treat "something with the right name exists" as "done." For each of steps
2–4, if the artifact already exists: verify it still does its job (prove it
against a deliberate failure, or check its commands match the stack detected
in step 1) before moving on. Fix drift found this way directly — that's
different from *creating* something new, which still follows the merge/ask
rules above.

## 1. Detect the stack

Check for `package.json` + `tsconfig.json` (TypeScript), `pyproject.toml`/`requirements.txt` (Python), `Cargo.toml` (Rust), `go.mod` (Go). Note the test runner and linter actually configured (don't assume).

## 2. Write `.claude/settings.json`

Merge into any existing file. Two hooks plus a permissions baseline.

**Verify hooks (TypeScript example — adapt the commands per the table below):**

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "f=$(jq -r '.tool_input.file_path // \"\"'); echo \"$f\" | grep -qE '\\.(ts|tsx)$' && cd \"$CLAUDE_PROJECT_DIR\" && npx tsc --noEmit --incremental --tsBuildInfoFile .claude/.tsbuildinfo 2>&1 | tail -5 || true",
            "timeout": 30,
            "statusMessage": "Type-checking..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "cd \"$CLAUDE_PROJECT_DIR\" && npx tsc --noEmit --incremental --tsBuildInfoFile .claude/.tsbuildinfo 2>&1 | tail -3; { git diff --name-only HEAD; git ls-files -o --exclude-standard; } | grep -E '\\.(ts|tsx)$' | head -20 | xargs -r npx eslint 2>&1 | tail -10 || true",
            "timeout": 60,
            "statusMessage": "Final type-check + lint..."
          }
        ]
      }
    ]
  }
}
```

Add `.claude/.tsbuildinfo` to `.gitignore`.

| Stack | Per-edit check (fast, changed file's language) | Stop check (final gate) |
| --- | --- | --- |
| TypeScript | `npx tsc --noEmit --incremental` | tsc + eslint on changed files |
| Python | `ruff check <file>` | `ruff check` + `pyright` on changed files |
| Rust | `cargo check --quiet 2>&1 \| tail -10` | `cargo check` + `cargo clippy --quiet` |
| Go | `go vet ./... 2>&1 \| tail -10` | `go vet` + `go build ./...` |

Principles: per-edit hooks must be fast (incremental, single-file where possible)
and truncated (`tail`); Stop hooks are the thorough gate; always `|| true` so a
tooling failure never blocks the session; only hook languages the repo contains.

**Trap — verify the check actually checks.** If `tsconfig.json` is
solution-style (`"files": []` + `references`, the Vite template default), plain
`tsc --noEmit` compiles *nothing* and always passes — use `npx tsc -b` instead
(build mode; composite projects are already incremental, no extra flags).
Before wiring any verify hook, prove it fails: introduce a deliberate error and
confirm non-zero/error output. **This applies just as much to hooks already
present as to ones you're about to write** — a hook that existed before this
session doesn't get a pass just because its name is right; run the same
prove-it-fails check on it and fix the command if it's a no-op.

**Permissions baseline** (read-only allows; deny for secrets and history
rewrites; ask for destructive commands):

```json
{
  "permissions": {
    "allow": [
      "Bash(git status*)", "Bash(git log*)", "Bash(git diff*)", "Bash(git show*)",
      "Bash(git branch*)", "Bash(ls*)", "Bash(grep*)", "Bash(rg*)", "Bash(find*)",
      "Bash(wc*)", "Bash(which*)", "Bash(cat package.json)"
    ],
    "deny": [
      "Read(**/.env)", "Read(**/.env.*)", "Read(**/*.pem)", "Read(**/id_rsa*)",
      "Bash(git push --force*)", "Bash(git push -f*)"
    ],
    "ask": [
      "Bash(git reset --hard*)", "Bash(git clean*)", "Bash(rm -rf*)"
    ]
  }
}
```

Add the stack's read-only commands to `allow` (`npx tsc --noEmit*`, `npm test*`,
`cargo check*`, …). Deny beats allow, so `.env.example` becomes unreadable too —
acceptable; describe its contents in the project CLAUDE.md if Claude needs them.

## 3. Git pre-commit gate

Write `.git/hooks/pre-commit` running the stack's verify commands (if husky or
`core.hooksPath` is configured, extend that instead). TypeScript example:

```sh
#!/bin/sh
set -e
cd "$(git rev-parse --show-toplevel)"
npx tsc --noEmit --incremental --tsBuildInfoFile .claude/.tsbuildinfo
npx eslint . --quiet
npm test --silent -- --run 2>&1 | tail -20
```

`chmod +x .git/hooks/pre-commit`. If the test suite is slow (>~60 s), gate on
typecheck + lint only and leave tests to CI. `.git/hooks` isn't versioned —
fine for solo work; use husky when collaborators need the gate too.

If a pre-commit hook already exists, don't assume it still works: read it,
check its commands match what step 1 detected (right typecheck invocation for
the current tsconfig shape, right test runner), and prove it blocks a
deliberate error before trusting it. Fix stale commands directly; only ask
before replacing a hook that does something unrelated to verification.

## 4. CI workflow (if the repo has a GitHub remote)

The strongest model-independent check: catches whatever every hook, model, and
human missed. Create `.github/workflows/ci.yml` with the verify commands
(TypeScript example — adapt per stack):

```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx tsc --noEmit
      - run: npx eslint . --quiet
      - run: npm test -- --run
```

Skip silently if there's no GitHub remote. If CI already exists, don't just ask
and stop — check whether its steps actually cover the stack's current verify
commands (typecheck/lint/test). Report what's missing or stale (e.g. a test
step that was never added, or a command that predates a tsconfig change), then
ask before editing — the check-and-report is not optional, only the edit is.

Once `ci.yml` exists and has run at least once on the repo (so its check
name is known — **do not guess the check name**; fetch it via `gh api
repos/<owner>/<repo>/commits/<sha>/check-runs --jq '.check_runs[].name'`
against the most recent commit that ran CI), set branch protection on
`main` so a red run actually blocks merge (`ci.yml` alone doesn't — it just
runs):
```bash
gh api --method PUT repos/<owner>/<repo>/branches/main/protection \
  -f required_status_checks.strict=true \
  -f 'required_status_checks.contexts[]=<exact check name from above>' \
  -F enforce_admins=true \
  -f required_pull_request_reviews='null' \
  -F allow_force_pushes=false \
  -F allow_deletions=false
```
Same "confirm with the user before mutating a live repo" guard as the other
repo-mutation commands in this section. If `ci.yml` was just created in this
same onboard run (no commit has triggered it yet), note that this step must
wait for the first PR/push to run CI once, and either come back to it or ask
the user to re-run this step after that happens — don't block the rest of
onboarding on it.

## 5. Bootstrap task tracking

Create the labels defined in
`${CLAUDE_PLUGIN_ROOT}/project-patterns/task-labels.md` (`type:*`, `priority:*`,
`size:*`, `status:*`) on the repo if missing (`gh label create` — skip any
that already exist). Also restrict the repo's merge method to squash-only
and enable auto-delete of the head branch on merge — this is what makes
merging a PR on GitHub equivalent to `gh pr merge --squash --delete-branch`:
```bash
gh repo edit <owner>/<repo> --enable-squash-merge --enable-merge-commit=false \
  --enable-rebase-merge=false --delete-branch-on-merge
```
Also set the squash-commit message to the PR title/description rather than
GitHub's default of concatenating every commit's full message. The default
(`COMMIT_MESSAGES`) repeats a `Co-Authored-By` trailer once per commit on
any multi-commit branch (routine here, since pre-existing fixes and
verify-pass commits are kept separate per CLAUDE.md) — `PR_BODY` uses the
PR description once instead:
```bash
gh api -X PATCH repos/<owner>/<repo> \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY
```
(`squash_merge_commit_title=PR_TITLE` is required — GitHub only allows
`PR_BODY` paired with `PR_TITLE`, not `COMMIT_OR_PR_TITLE`.)
**Before running any of these commands against any real repo, confirm with
the user** — they mutate a live GitHub repo, not local files.

Going forward, don't scaffold a per-project "open questions" doc — task
capture goes through `/log-task`/`/next-task` against GitHub Issues instead.

**Re-running on an already-onboarded project:** ask the user whether an "open
questions"-style doc exists in this repo (name varies by project, not
standardized). If yes, offer to migrate each entry to a `/log-task` issue
(lands on `Draft` automatically), then delete the doc and its
doc-sync-table line.

## 6. Create the plan-doc directories

`mkdir -p docs/plans/completed`. If `docs/plans/` doesn't exist yet, this is
what makes `write-plan`/`implement-plan`/`audit-plan` usable in this project —
without it those skills have nowhere defined to put or find plan docs. Add a
`.gitkeep` to `docs/plans/completed/` if it would otherwise be empty and thus
unstaged by git. Naturally idempotent — if both directories already exist,
this step is a no-op; just confirm and move on.

## 7. Scaffold project CLAUDE.md (only if absent)

Budget ~60 lines. Invariants and pointers, never reference content:

```markdown
# <Project>

<One line: what this is.>

## Verify
<typecheck / lint / test commands>

## Invariants
<Hard rules only — things that must never be violated. If a rule is mechanical,
make it a hook instead (see snoozy-dev SETUP.md) and don't list it here.>

## Pointers
<- Data model: docs/...  - Architecture entry point: docs/...>

## Doc-sync table
| Edited area | Update this doc |
| --- | --- |

## Plans
Plan docs live in `docs/plans/` — written via /write-plan, executed via
/implement-plan. Completed plans move to `docs/plans/completed/`.
```

If CLAUDE.md already exists, don't recreate it — but check its Plans and
Doc-sync sections (if present) for drift against the current convention
(`docs/plans/`, `docs/plans/completed/`) and flag anything stale for the user
rather than silently leaving it.

## 8. Offer (don't auto-create)

- Invariant guard hooks for any mechanical rules found in an existing CLAUDE.md.
- A smoke-test scenario driver if it's a UI app (`${CLAUDE_PLUGIN_ROOT}/project-patterns/smoke-driver.md`).
- The architecture-docs + component-reuse convention if it's a UI project with
  a components directory (`${CLAUDE_PLUGIN_ROOT}/project-patterns/architecture-docs.md`).
- The deploy-scripts convention
  (`${CLAUDE_PLUGIN_ROOT}/project-patterns/deploy-scripts.md`): if the repo has no
  `deploy/` folder yet, offer the full four-script scaffold (`setup.sh`,
  `deploy.sh`, `preview-setup.sh`, `preview-deploy.sh`, a `.service` unit
  template). Remind the user to add the `Preview URL:` line to `## Deploy`
  once `preview-setup.sh` has run and printed its port, plus an optional
  `Preview check:` smoke command (see deploy-scripts.md). If `deploy/setup.sh`/`deploy.sh` already exist, leave them
  untouched — offer only the two preview scripts (`preview-setup.sh`,
  `preview-deploy.sh`) alongside.
- When `deploy/preview-setup.sh` and `deploy/preview-deploy.sh` already exist
  (or are being scaffolded in the same step), also offer the Tier 1 preview-
  automation workflow described in
  `${CLAUDE_PLUGIN_ROOT}/project-patterns/preview-workflow.md`
  (`.github/workflows/preview.yml`) — don't auto-create, same offer-don't-
  create posture as the rest of this step.

## 9. Report

List what was created/merged, what was verified and left as-is, what was
fixed because it had drifted, and the offers from step 8.
