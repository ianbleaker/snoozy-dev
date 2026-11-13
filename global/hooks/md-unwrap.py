#!/usr/bin/env python3
# Shim: the hook moved into the plugin (plugins/snoozy-dev/hooks/md-unwrap.py). Kept so ~/.claude/settings.json entries that still point here keep working; remove once install-plugin.sh has cleaned up the old entries.
import os, runpy
runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "plugins", "snoozy-dev", "hooks", "md-unwrap.py"), run_name="__main__")
