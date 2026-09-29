# snoozy-dev

Portable Claude Code configuration: the `snoozy-dev` plugin (skills, agents, project patterns), global settings, and the SETUP.md playbook. Mostly markdown plus shell/Node helper scripts; no app build.

## Verify
`scripts/verify.sh` — `bash -n` on every tracked `.sh`, `node --check` on every `.mjs`. Run by the Edit/Stop hooks in `.claude/settings.json`, `.git/hooks/pre-commit`, and CI. No test suite or linter is configured.

## Invariants
- Skills live in `plugins/snoozy-dev/skills/<name>/SKILL.md`; helper scripts sit next to the skill that uses them.
- Never overwrite a user's existing project config from a skill — merge, and ask first.

## Pointers
- Playbook: SETUP.md; install/cloud notes: README.md
- Conventions: `plugins/snoozy-dev/project-patterns/`

## Doc-sync table
| Edited area | Update this doc |
| --- | --- |
| Skill added/renamed/removed | SETUP.md skills table |
| `scripts/install-plugin.sh` behavior | README.md install steps |

## Plans
Plan docs live in `docs/plans/` — written via /write-plan, executed via /implement-plan. Completed plans move to `docs/plans/completed/`.
