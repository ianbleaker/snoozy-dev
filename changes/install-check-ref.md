---
category: fix
area: [setup]
---
`scripts/install-plugin.sh` checks that the branch it installs from exists on GitHub before changing anything. Before, migrating to `stable` before the first release removed the old marketplace, which uninstalled the plugin, and only then failed to add the new one.
