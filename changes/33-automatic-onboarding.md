---
category: feature
area: [setup]
---
The plugin now offers `/snoozy-dev:onboard` at session start when a repo isn't set up or its setup is behind the plugin, and remembers a decline per repo. Each repo keeps its verify commands and an onboard schema stamp in a tracked `.snoozy-dev.json`; the plugin runs the edit and Stop verify hooks from it and feeds failures back to Claude, which the old per-repo hooks never did, and the pre-commit gate and CI run its `verify.gate`. The Claude-free and md-unwrap hooks also ship in the plugin now, so they run in cloud too: re-run `scripts/install-plugin.sh` after updating to remove their old `~/.claude/settings.json` entries.
