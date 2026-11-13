---
name: onboard
description: Set up or upgrade a project for efficient Claude Code work - detect the stack, write .snoozy-dev.json (verify commands the plugin's hooks run, plus the onboard schema stamp), a read-only permissions baseline, the pre-commit gate and CI, and a minimal project CLAUDE.md. Reads the stamp first and, when it is behind the plugin, applies only the newer schema changes. Use when joining a new project, when the plugin's session-start check offers it, or when the user asks to onboard/set up Claude for a repo.
---

Instantiate the per-project layer of the snoozy-dev repo's `SETUP.md` (https://github.com/ianbleaker/snoozy-dev/blob/main/SETUP.md). Never overwrite existing config — merge, and ask before replacing anything the user wrote.

**Plugin-side vs per-repo.** The plugin's `hooks/hooks.json` ships everything generic: the edit/Stop verify runner (`hooks/verify-runner.mjs`, which feeds failures back to Claude), the session-start onboard check, and the global Claude-free and md-unwrap hooks. A repo keeps only data and what can't live in a plugin: a tracked root `.snoozy-dev.json` (verify commands + `onboardSchema` stamp), the permissions baseline and any repo-specific hooks in `.claude/settings.json`, the pre-commit gate and `ci.yml` (both run `verify.gate`), CLAUDE.md, plan dirs, and the one-time GitHub settings. At session start the plugin's `hooks/onboard-check.mjs` offers this skill when `.snoozy-dev.json` is missing, invalid or behind; running it by hand stays the fallback (e.g. a forced re-run).

**Maintainer rule:** when a step here changes what lands in a repo, bump `schema.json` next to this file and add its `changes` entry.

**Idempotent by design.** Re-running this on an already-onboarded project must not treat "something with the right name exists" as "done." For each of steps 2a–4, if the artifact already exists: verify it still does its job (prove it against a deliberate failure, or check its commands match the stack detected in step 1) before moving on. Fix drift found this way directly — that's different from *creating* something new, which still follows the merge/ask rules above.

## 0. Read the stamp

Read `.snoozy-dev.json` at the repo root and `${CLAUDE_PLUGIN_ROOT}/skills/onboard/schema.json`.
- **No file** → full onboard: every step below.
- **`onboardSchema` behind the manifest's `schema`** → upgrade mode: apply only the `changes` entries newer than the stamp (list them to the user first), plus the idempotent verify of everything else that the steps below already do.
- **Current** → verify-only re-run of every step.
- **Invalid JSON** → show the error, then treat it as no file, merging what's still readable.

## 1. Detect the stack

Check for `package.json` + `tsconfig.json` (TypeScript), `pyproject.toml`/`requirements.txt` (Python), `Cargo.toml` (Rust), `go.mod` (Go). Note the test runner and linter actually configured (don't assume).

## 2a. Write `.snoozy-dev.json`

Tracked, at the repo root (not under `.claude/`: in companion-backed repos `.claude` is a symlink into the private repo and excluded, so cloud clones would miss it). The plugin's verify runner reads it; every key except `onboardSchema` is optional:

```json
{
  "onboardSchema": 1,
  "verify": {
    "edit": [{ "pattern": "\\.(ts|tsx)$", "command": "npx tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/tsbuildinfo", "timeout": 30 }],
    "stop": { "command": "npx tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/tsbuildinfo && { git diff --name-only --diff-filter=d HEAD; git ls-files -o --exclude-standard; } | grep -E '\\.(ts|tsx)$' | xargs -r npx eslint", "timeout": 120 },
    "gate": "npx tsc --noEmit && npx eslint . --quiet && npm test --silent -- --run"
  }
}
```

- `edit`: entries whose `pattern` (JS regex) matches the edited path run after each Write/Edit; the path is in `$FILE` (never splice it into the command). Failures go to Claude as context and never block.
- `stop`: runs at Stop when the tree has uncommitted changes; a failure sends Claude back once.
- `gate`: the full check the pre-commit hook and CI run (step 3–4).
- `timeout` is in seconds (defaults: edit 30, stop 120). Write `onboardSchema` last (step 9).

TypeScript's incremental cache goes in `node_modules/.cache/` (already git-ignored), not under `.claude/`, which is a symlink into the companion repo in companion-backed projects. On migration, delete a stale `.claude/.tsbuildinfo` and its `.gitignore` line (ask first).

| Stack | `edit` (fast, changed file's language) | `stop` (final check) | `gate` |
| --- | --- | --- | --- |
| TypeScript | `\.(ts\|tsx)$` → `npx tsc --noEmit --incremental --tsBuildInfoFile node_modules/.cache/tsbuildinfo` | tsc + eslint on changed files (example above) | `npx tsc --noEmit && npx eslint . --quiet && npm test --silent -- --run` |
| Python | `\.py$` → `ruff check "$FILE"` | `ruff check . && pyright` | `ruff check . && pyright && pytest -q` |
| Rust | `\.rs$` → `cargo check --quiet` | `cargo check --quiet && cargo clippy --quiet -- -D warnings` | stop + `&& cargo test --quiet` |
| Go | `\.go$` → `go vet ./...` | `go vet ./... && go build ./...` | stop + `&& go test ./...` |

Principles: every command must **exit non-zero on failure** — no `| tail` (the runner keeps the last 20 lines) and no `|| true` (the runner never fails the session itself). `edit` commands must be fast (incremental, single-file where possible); `stop` is the thorough check; only cover languages the repo contains.

**Trap — verify the check actually checks.** If `tsconfig.json` is solution-style (`"files": []` + `references`, the Vite template default), plain `tsc --noEmit` compiles *nothing* and always passes — use `npx tsc -b` instead (build mode; composite projects are already incremental, no extra flags). Before writing any command, prove it fails: introduce a deliberate error, run the command (`FILE=<path> sh -c '<edit command>'`, `sh -c '<stop command>'`, `sh -c '<gate>'`), confirm a non-zero exit, then revert the error. **This applies just as much to commands already in `.snoozy-dev.json`** — run the same prove-it-fails check on them on every re-run and fix any no-op.

## 2b. Write `.claude/settings.json`

Merge into any existing file. It holds the permissions baseline only (plugins can't ship permissions, and the per-repo copy also works in cloud), plus any repo-specific hooks the user already has.

**Migration:** if it holds generic edit/Stop verify hooks — a PostToolUse `Edit|Write` or a Stop hook whose command type-checks, lints, syntax-checks or runs a verify script — the plugin now runs these from `.snoozy-dev.json`, and leaving them makes verify run twice. Show the user each one's translation into `verify.edit`/`verify.stop` (drop its `jq` file-matching into `pattern`, its `| tail` and `|| true`, use `$FILE`), prove the translation fails on a deliberate error, and ask before removing the old hook. Leave every other hook (e.g. a custom guard script) untouched. When `.claude` is a symlink into a companion repo, the change commits to the companion's `main` (step 9).

**Permissions baseline** (read-only allows; deny for secrets and history rewrites; ask for destructive commands):

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

Add the stack's read-only commands to `allow` (`npx tsc --noEmit*`, `npm test*`, `cargo check*`, …). Deny beats allow, so `.env.example` becomes unreadable too — acceptable; describe its contents in the project CLAUDE.md if Claude needs them.

## 3. Git pre-commit gate

Write `.git/hooks/pre-commit` running `verify.gate` (if husky or `core.hooksPath` is configured, extend that instead):

```sh
#!/bin/sh
set -e
cd "$(git rev-parse --show-toplevel)"
gate=$(jq -er '.verify.gate' .snoozy-dev.json) || { echo "no verify.gate in .snoozy-dev.json" >&2; exit 1; }
sh -c "$gate"
```

Use `jq -er`, not `jq -r … // empty`: a missing key, file or `jq` would otherwise become `sh -c ""` and silently pass — a no-op gate. `chmod +x .git/hooks/pre-commit`. If the test suite is slow (>~60 s), leave tests out of `gate` and add a separate CI step for them. `.git/hooks` isn't versioned — fine for solo work; use husky when collaborators need the gate too.

If a pre-commit hook already exists, don't assume it still works: read it. One that runs its own copy of the verify commands is migrated to the form above (show the diff; the commands move into `verify.gate`). Prove it blocks a deliberate error before trusting it. Only ask before replacing a hook that does something unrelated to verification.

## 4. CI workflow (if the repo has a GitHub remote)

The strongest model-independent check: catches whatever every hook, model, and human missed. Create `.github/workflows/ci.yml` running `verify.gate`, after the stack's setup and install steps (TypeScript example — adapt per stack):

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
      - run: gate=$(jq -er .verify.gate .snoozy-dev.json) && sh -c "$gate"
```

A failed command substitution doesn't fail `sh -c`, so the step assigns `gate` first and chains with `&&` (`jq` is preinstalled on GitHub's Ubuntu runners). Skip silently if there's no GitHub remote. If CI already exists, don't just ask and stop — check whether it runs `verify.gate` (or, before migration, whether its own steps cover the stack's current typecheck/lint/test). Report what's missing or stale, then ask before editing — the check-and-report is not optional, only the edit is.

**Cloud:** if `${CLAUDE_PLUGIN_ROOT}/project-patterns/cloud-check.sh` exits 1, don't run the branch-protection command below or section 5's label-creation and repo-settings commands (`gh label create`, `gh repo edit`, `gh api -X PATCH repos/…`): print them with `<owner>/<repo>` filled in and tell the user to run them from a CLI session.

Once `ci.yml` exists and has run at least once on the repo (so its check name is known — **do not guess the check name**; fetch it via `gh api repos/<owner>/<repo>/commits/<sha>/check-runs --jq '.check_runs[].name'` against the most recent commit that ran CI), set branch protection on `main` so a red run actually blocks merge (`ci.yml` alone doesn't — it just runs):
```bash
echo '{"required_status_checks":{"strict":false,"contexts":["<exact check name from above>"]},"enforce_admins":true,"required_pull_request_reviews":null,"restrictions":null,"allow_force_pushes":false,"allow_deletions":false}' \
  | gh api --method PUT repos/<owner>/<repo>/branches/main/protection --input -
```
JSON via `--input` because `gh api -f` neither nests dotted keys nor sends a real `null`. `strict` stays `false`: "up to date before merging" blocks every staged PR after the first one `/merge-preview` merges, and it never updates a branch to get past that. Plans don't block it: in-project plans reach `main` only through their task's PR, and a companion repo is a separate repo. Private repos on the free plan can't use protection at all.

Same "confirm with the user before mutating a live repo" guard as the other repo-mutation commands in this section. If `ci.yml` was just created in this same onboard run (no commit has triggered it yet), note that this step must wait for the first PR/push to run CI once, and either come back to it or ask the user to re-run this step after that happens — don't block the rest of onboarding on it.

## 5. Bootstrap task tracking

Create the labels defined in `${CLAUDE_PLUGIN_ROOT}/project-patterns/task-labels.md` (`type:*`, `priority:*`, `size:*`, `status:*`) on the repo if missing (`gh label create` — skip any that already exist). Also restrict the repo's merge method to squash-only and enable auto-delete of the head branch on merge — this is what makes merging a PR on GitHub equivalent to `gh pr merge --squash --delete-branch`:
```bash
gh repo edit <owner>/<repo> --enable-squash-merge --enable-merge-commit=false \
  --enable-rebase-merge=false --delete-branch-on-merge
```
Also set the squash-commit message to the PR title/description rather than GitHub's default of concatenating every commit's full message. The default (`COMMIT_MESSAGES`) repeats a `Co-Authored-By` trailer once per commit on any multi-commit branch (routine here, since pre-existing fixes and verify-pass commits are kept separate per CLAUDE.md) — `PR_BODY` uses the PR description once instead:
```bash
gh api -X PATCH repos/<owner>/<repo> \
  -f squash_merge_commit_title=PR_TITLE -f squash_merge_commit_message=PR_BODY
```
(`squash_merge_commit_title=PR_TITLE` is required — GitHub only allows `PR_BODY` paired with `PR_TITLE`, not `COMMIT_OR_PR_TITLE`.) **Before running any of these commands against any real repo, confirm with the user** — they mutate a live GitHub repo, not local files.

Going forward, don't scaffold a per-project "open questions" doc — task capture goes through `/log-task`/`/next-task` against GitHub Issues instead.

**Re-running on an already-onboarded project:** ask the user whether an "open questions"-style doc exists in this repo (name varies by project, not standardized). If yes, offer to migrate each entry to a `/log-task` issue (lands on `Draft` automatically), then delete the doc and its doc-sync-table line.

## 6. Create the plan-doc directories

**Private companion repo:** if `CLAUDE.md` has a `Private repo: ../<repo>-private` line (set by `/go-public`), skip the `mkdir` below — plans live in the companion. Instead check, and report anything missing (don't create a companion; that's `/go-public`'s job):
- `<companion>/plans/completed/` exists;
- `<companion>/.claude-free-exempt` exists;
- `CLAUDE.md` and `.claude` in the project are symlinks into the companion;
- `.git/info/exclude` lists both `CLAUDE.md` and `.claude`.

Otherwise: `mkdir -p docs/plans/completed`. If `docs/plans/` doesn't exist yet, this is what makes `write-plan`/`implement-plan`/`audit-plan` usable in this project — without it those skills have nowhere defined to put or find plan docs. Add a `.gitkeep` to `docs/plans/completed/` if it would otherwise be empty and thus unstaged by git. Naturally idempotent — if both directories already exist, this step is a no-op; just confirm and move on.

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
<- Mockup kit: <path>  (optional, see mockup-kit.md)>

## Doc-sync table
| Edited area | Update this doc |
| --- | --- |

## Plans
Plan docs live in `docs/plans/` on their `task/<NN>-<slug>` branch — written
via /write-plan, executed via /implement-plan, and reach `main` through the
task's PR. Completed plans move to `docs/plans/completed/` in that PR.
<Optional: `Private repo: ../<repo>-private` keeps plans in a private companion
repo's `plans/` instead (set up by /go-public).>
```

If CLAUDE.md already exists, don't recreate it — but check its Plans and Doc-sync sections (if present) for drift against the current convention (`docs/plans/`, `docs/plans/completed/`) and flag anything stale for the user rather than silently leaving it.

## 7b. Record the deploy convention

Read the current record with `eval "$("${CLAUDE_PLUGIN_ROOT}/project-patterns/deploy-config.sh" .)"` (the only `## Deploy` parser). If `DEPLOY_CONVENTION` is set, skip this step silently. Otherwise run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/project-patterns/deploy-convention.mjs" detect .
```

- **It prints `<name>@<N>`:** show it and ask the user to confirm; they may correct the version. Then merge `- Convention: <confirmed>` into CLAUDE.md's `## Deploy`, creating the section with just that line if it's absent. If a malformed `Convention:` line is already there (`deploy-config.sh` warned about it), replace it only after asking. Never overwrite any other `## Deploy` line.
- **It prints nothing, but the root has `Dockerfile`, `fly.toml`, `docker-compose.yml` or `compose.yaml`:** ask whether to record `- Convention: none` (the repo deploys some other way), merged the same way.
- **Otherwise:** do nothing.

The line uses the `- Key: value` list form, like every `## Deploy` line (see `deploy-scripts.md`).

## 8. Offer (don't auto-create)

- Invariant guard hooks for any mechanical rules found in an existing CLAUDE.md.
- A smoke-test scenario driver if it's a UI app (`${CLAUDE_PLUGIN_ROOT}/project-patterns/smoke-driver.md`).
- A mockup kit if it's a UI app (`${CLAUDE_PLUGIN_ROOT}/project-patterns/mockup-kit.md`), so brainstorm mockups use the app's own tokens and stylesheets. On acceptance:
  1. Ask the location: companion `.claude/skills/mockup-kit/` (the default when `CLAUDE.md` has a `Private repo:` line) or a tracked project `mockup-kit/` folder.
  2. Copy `${CLAUDE_PLUGIN_ROOT}/project-patterns/mockup-kit.mjs` to `<kit>/render.mjs`.
  3. Detect the token/stylesheet paths (compiled output for Tailwind/Sass/CSS modules), confirm them with the user, then write `<kit>/kit.json`.
  4. Write `<kit>/SKILL.md` from the doc's template, seeding the snippet catalog from the app's components directory if one exists.
  5. Ask first, then merge `- Mockup kit: <path>` into the existing `## Pointers` section of `CLAUDE.md`, never replacing existing lines.

  If any `<kit>/` file already exists, leave it untouched and say so.
- A document changelog if the project ships user-facing releases (rules, game content, docs) and has no `doc-changelog.json` (`${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog/changelog.md`). On acceptance, copy the closest `${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog/examples/*.json` to the content repo root (the repo holding `CHANGELOG.md`) as `doc-changelog.json`, then tailor `categories`, `areas` and `content` with the user, checking each change with `node "${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog/fragments.mjs" render`. On re-runs, if the file already exists, validate it with `node "${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog/config.mjs" show --repo <dir>` and report any errors. Never rewrite it.
- The architecture-docs + component-reuse convention if it's a UI project with a components directory (`${CLAUDE_PLUGIN_ROOT}/project-patterns/architecture-docs.md`).
- The deploy-scripts convention (`${CLAUDE_PLUGIN_ROOT}/project-patterns/deploy-scripts.md`): if the repo has no `deploy/` folder yet, offer the full four-script scaffold (`setup.sh`, `deploy.sh`, `preview-setup.sh`, `preview-deploy.sh`, a `.service` unit template), following the deployer privilege model: a deployer-owned checkout, a sudoers drop-in installed by `setup.sh`/`preview-setup.sh`, and a `deploy.sh` that never needs root beyond the one `systemctl restart`. A freshly scaffolded `deploy/` gets `- Convention: vps-systemd@<version>` in `## Deploy`, with the version from `${CLAUDE_PLUGIN_ROOT}/project-patterns/deploy-conventions.json`. Remind the user to add the `- Preview URL: http://{host}:<port>` line to `## Deploy` once `preview-setup.sh` has run and printed its port, plus an optional `- Preview check:` smoke command (see deploy-scripts.md). If `deploy/setup.sh`/`deploy.sh` already exist, leave them untouched — offer only the two preview scripts (`preview-setup.sh`, `preview-deploy.sh`) alongside — and if `setup.sh` predates the privilege split (no sudoers drop-in, or a `chown -R` to the service user), say so in one line, pointing at deploy-scripts.md, without editing it.
- When `deploy/preview-setup.sh` and `deploy/preview-deploy.sh` already exist (or are being scaffolded in the same step), also offer the Tier 1 preview- automation workflow described in `${CLAUDE_PLUGIN_ROOT}/project-patterns/preview-workflow.md` (`.github/workflows/preview.yml`) — don't auto-create, same offer-don't- create posture as the rest of this step.

## 9. Stamp and commit

Write or update `onboardSchema` in `.snoozy-dev.json` to the manifest's `schema`, merging into the existing file. Then commit per `${CLAUDE_PLUGIN_ROOT}/project-patterns/branch-workflow.md` on `chore/onboard-schema-<N>` (one commit per step that changed tracked files) and open its PR. Changes behind a companion `.claude` symlink (e.g. removing migrated hooks from `.claude/settings.json`) commit straight to the companion's `main` instead, never into the project's branch. `.git/hooks/pre-commit` is untracked, and GitHub settings aren't files: nothing to commit for them.

## 10. Report

List what was created/merged, what was verified and left as-is, what was fixed because it had drifted, the schema changes applied (from the manifest's `changes`, in upgrade mode), and the offers from step 8.
