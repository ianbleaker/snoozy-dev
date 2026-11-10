# snoozy-dev

Portable Claude Code configuration: the `snoozy-dev` plugin (skills, agents, project patterns), global settings, and the SETUP.md playbook. Mostly markdown plus shell/Node helper scripts; no app build.

## Verify
`scripts/verify.sh` — `bash -n` on every tracked `.sh`, `node --check` on every `.mjs`, then `node --test` on the tracked `*.test.mjs` files (only the ones passed, when given file args). Run by the Edit/Stop hooks in `.claude/settings.json`, `.git/hooks/pre-commit`, and CI. No linter is configured.

## Invariants
- Skills live in `plugins/snoozy-dev/skills/<name>/SKILL.md`; helper scripts sit next to the skill that uses them, and helpers shared by several skills live in `plugins/snoozy-dev/project-patterns/` (e.g. `find-plan.sh`, `changelog/`).
- Never overwrite a user's existing project config from a skill — merge, and ask first.
- `.claude-free-exempt` at the root marks this repo exempt from the Claude-free rule and its hook: its skills have to name Claude.

## Pointers
- Playbook: SETUP.md; install/cloud notes: README.md
- Conventions: `plugins/snoozy-dev/project-patterns/`

## Doc-sync table
| Edited area | Update this doc |
| --- | --- |
| Skill added/renamed/removed | SETUP.md skills table |
| `scripts/install-plugin.sh` behavior | README.md install steps |

## Plans
Private repo: ../snoozy-dev-private

Plan docs live in the companion repo's `plans/` (resolved by `plugins/snoozy-dev/project-patterns/plans-dir.sh`, found by `find-plan.sh <NN>`); completed ones move to `plans/completed/`. Plan commits go straight to the companion's `main`, never into this repo.
