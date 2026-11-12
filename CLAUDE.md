# snoozy-dev

Portable Claude Code configuration: the `snoozy-dev` plugin (skills, agents, project patterns), global settings, and the SETUP.md playbook. Mostly markdown plus shell/Node helper scripts; no app build.

## Verify
`scripts/verify.sh` — `bash -n` on every tracked `.sh`, `node --check` on every `.mjs`, an `ast.parse` syntax check on every `.py`, then `node --test` on the tracked `*.test.mjs` files (only the ones passed, when given file args). Wired through `.snoozy-dev.json`: the plugin's edit/Stop verify hooks run its `verify.edit`/`verify.stop` commands, and `.git/hooks/pre-commit` and CI run `verify.gate`. `VERIFY_FAST=1` skips the `node --test` step; only the Stop command sets it. No linter is configured.

## Invariants
- Skills live in `plugins/snoozy-dev/skills/<name>/SKILL.md`; helper scripts sit next to the skill that uses them, and helpers shared by several skills live in `plugins/snoozy-dev/project-patterns/` (e.g. `find-plan.sh`, `changelog/`).
- Never overwrite a user's existing project config from a skill — merge, and ask first.
- `.claude-free-exempt` at the root marks this repo exempt from the Claude-free rule and its hook: its skills have to name Claude.

## Pointers
- Playbook: SETUP.md; install/cloud notes: README.md
- Conventions: `plugins/snoozy-dev/project-patterns/`
- Changelog: `doc-changelog.json` (fragment flow, `project-patterns/changelog/changelog.md`). Every PR adds a fragment in `changes/` (branch-workflow PR step); releases go through `/doc-release` and bump `plugin.json`'s version.

## Doc-sync table
| Edited area | Update this doc |
| --- | --- |
| Skill added/renamed/removed | SETUP.md skills table |
| `scripts/install-plugin.sh` behavior | README.md install steps |
| Onboard step changes what lands in a repo | bump `plugins/snoozy-dev/skills/onboard/schema.json` + its `changes` entry |

## Plans
Private repo: ../snoozy-dev-private

Plan docs live in the companion repo's `plans/` (resolved by `plugins/snoozy-dev/project-patterns/plans-dir.sh`, found by `find-plan.sh <NN>`); completed ones move to `plans/completed/`. Plan commits go straight to the companion's `main`, never into this repo.
