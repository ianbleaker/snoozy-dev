# snoozy-dev

Portable Claude Code configuration: global skills, hook recipes, and working conventions, plus the playbook that explains when to apply what.

**Start here → [SETUP.md](SETUP.md)**

On a clean machine, clone this repo and install the plugin:

```bash
git clone https://github.com/ianbleaker/snoozy-dev.git ~/development/snoozy-dev
~/development/snoozy-dev/scripts/install-plugin.sh
```

The plugin installs from this repo's `stable` branch (the latest release) and auto-updates to each new release at startup. The clone is for SETUP Layer 1 and for developing snoozy-dev itself. The script needs `jq`.

Then tell Claude:

> Read ~/development/snoozy-dev/SETUP.md and apply Layer 1.

In each project, run `/snoozy-dev:onboard`.

## Adding this to a cloud session

This repo is a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`) containing the `snoozy-dev` plugin (`plugins/snoozy-dev/`).

**Gotcha (per the [cloud environments docs](https://code.claude.com/docs/en/cloud-environments)):** cloud sessions do *not* install plugins listed in a repo's `.claude/settings.json` (`enabledPlugins` / `extraKnownMarketplaces`), and nothing from your local `~/.claude` carries over. Only a repo's own committed `.claude/skills|agents|commands` and claude.ai-enabled skills load. So the plugin has to be installed by the environment itself:

1. At claude.ai/code → environment settings, make sure the environment can reach `github.com` (the Trusted network level does).
2. Set the environment's **setup script** to:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/ianbleaker/snoozy-dev/main/scripts/install-plugin.sh | bash
   ```

3. Start a session; skills are available as `/snoozy-dev:<name>`, e.g. `/snoozy-dev:onboard`. Use one environment for all repos you want this in.

Steps 1–3 are configured in the claude.ai UI, not in this repo. Status: the GitHub install, migration from a directory install, and auto-update to a new version are verified locally; the curl setup-script path in a real cloud environment is **not yet verified** — if it fails, check that the setup script runs as the same user/home the session uses and that the plugin still shows in `/help` after environment caching.

### What works in cloud

In cloud, `gh` is authenticated through a proxy that rejects `gh issue`/`gh pr`, while `gh api` REST calls get through. Skills detect this with `project-patterns/cloud-check.sh` and switch to the REST forms in [`project-patterns/environments.md`](plugins/snoozy-dev/project-patterns/environments.md).

- **Cloud-capable (GitHub workflows):** `/next-task`, `/log-task`, `/write-plan`, `/implement-plan`, `/batch-tasks` (and its `task-worker` agent), plus the branch workflow and task labels they use.
- **CLI-only, stop with a message:** `/deploy`, `/stage-preview`, `/merge-preview`, `/sweep-tasks`, `/go-public`. `/doc-release` cuts the release, then stops before opening the PR and publishing. `/onboard` prints its label, branch-protection and repo-settings commands for you to run from a CLI.
- **Companion repos:** a project with a `Private repo:` line keeps plans in a sibling checkout that isn't in the cloud container, so plan work there needs a local session. Projects using `docs/plans/` are unaffected.
- **Status:** the cloud forms follow the cloud-environments docs and are **not yet verified** in a real cloud session.

For a local machine, run `scripts/install-plugin.sh` and see [SETUP.md](SETUP.md).
