# snoozy-dev

Portable Claude Code configuration: global skills, hook recipes, and working
conventions, plus the playbook that explains when to apply what.

**Start here → [SETUP.md](SETUP.md)**

On a clean machine, clone this repo and install the plugin:

```bash
git clone https://github.com/ianbleaker/snoozy-dev.git ~/snoozy-dev
~/snoozy-dev/scripts/install-plugin.sh
```

Then tell Claude:

> Read ~/snoozy-dev/SETUP.md and apply Layer 1.

In each project, run `/snoozy-dev:onboard`.

## Adding this to a cloud session

This repo is a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`)
containing the `snoozy-dev` plugin (`plugins/snoozy-dev/`).

**Gotcha (per the [cloud environments docs](https://code.claude.com/docs/en/cloud-environments)):**
cloud sessions do *not* install plugins listed in a repo's `.claude/settings.json`
(`enabledPlugins` / `extraKnownMarketplaces`), and nothing from your local
`~/.claude` carries over. Only a repo's own committed `.claude/skills|agents|commands`
and claude.ai-enabled skills load. So the plugin has to be installed by the
environment itself:

1. At claude.ai/code → environment settings, make sure the environment can
   reach `github.com` (the Trusted network level does).
2. Set the environment's **setup script** to:

   ```bash
   git clone -q --depth 1 https://github.com/ianbleaker/snoozy-dev.git ~/snoozy-dev \
     && ~/snoozy-dev/scripts/install-plugin.sh
   ```

3. Start a session; skills are available as `/snoozy-dev:<name>`, e.g.
   `/snoozy-dev:onboard`. Use one environment for all repos you want this in.

Steps 1–3 are configured in the claude.ai UI, not in this repo. Status: the plugin
install and `${CLAUDE_PLUGIN_ROOT}` substitution are verified locally; the
setup-script path in a real cloud environment is **not yet verified** — if it
fails, check that the setup script runs as the same user/home the session uses
and that the plugin still shows in `/help` after environment caching.

For a local machine, run `scripts/install-plugin.sh` and see [SETUP.md](SETUP.md).
