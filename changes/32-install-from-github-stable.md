---
category: change
area: [setup]
---
`scripts/install-plugin.sh` installs snoozy-dev from the GitHub marketplace's `stable` branch (the latest release) instead of a local checkout, and turns on marketplace auto-update, so every machine picks up each new release at startup. Re-running it migrates an existing local-directory install. Cloud environments use a one-line `curl … | bash` setup script. To try unreleased skills, use `claude --plugin-dir ~/development/snoozy-dev/plugins/snoozy-dev`.
