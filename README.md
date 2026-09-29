# snoozy-dev

Portable Claude Code configuration: workflow skills, a worker agent, hook recipes,
and working conventions, plus the playbook that explains when to apply what.
Packaged as a Claude Code plugin marketplace (`.claude-plugin/marketplace.json`)
containing the `snoozy-dev` plugin (`plugins/snoozy-dev/`).

**Start here → [SETUP.md](SETUP.md)**

## Adding this to Claude Code in the Cloud

Cloud sessions don't read `~/.claude`, and they ignore plugins declared in a
repo's `.claude/settings.json` ([docs](https://code.claude.com/docs/en/cloud-environments)).
So two small pieces install the plugin and keep it fresh. This repo must be
**public** so neither piece needs a token.

**1. Once per cloud environment: the setup script** (claude.ai/code → environment
settings → Setup script). It pre-installs the plugin into the environment's
cached snapshot so the very first session already has it:

```bash
git clone -q --depth 1 https://github.com/ianbleaker/snoozy-dev.git ~/snoozy-dev
~/snoozy-dev/scripts/install-plugin.sh
exit 0
```

**2. Once per repo: a SessionStart hook** in that repo's committed
`.claude/settings.json` (`/snoozy-dev:onboard` adds it for you). It pulls the
latest commit of this repo and refreshes the plugin at the start of every
session, so pushes here reach new sessions with no further steps:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "d=$HOME/snoozy-dev; [ -d $d/.git ] || git clone -q --depth 1 https://github.com/ianbleaker/snoozy-dev.git $d; $d/scripts/install-plugin.sh || true",
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

Then in a session: skills are `/snoozy-dev:<name>` (e.g. `/snoozy-dev:onboard`).
Check with `claude plugin list`.

**Updating skills:** edit and push to `main` here. That's it. The plugin has no
fixed version, so every commit is a new version; the hook picks it up next session.

**Caveats (verified locally, not yet in a real cloud session):**
- A plugin's *first* install by the hook only takes effect the *next* session;
  updates apply in the same session. That's why the setup script pre-installs.
- SessionStart hooks in a repo's settings don't run in cloud sessions that
  attach several repos; those still work via the setup-script install but only
  refresh when the environment cache rebuilds (~7 days, or edit the script).

Local machine: see [SETUP.md](SETUP.md).
