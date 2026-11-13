---
category: feature
area: [preview-deploy, setup]
---
Projects record which version of the deploy convention they follow as a `- Convention: vps-systemd@2` line (or `none`) in CLAUDE.md's `## Deploy` section. `/onboard` detects it and fills it in after you confirm. The session-start check then offers a draft migration issue, with the migration notes, when a project is behind the plugin's convention, and flags drift such as a removed `deploy/` folder or a new `Dockerfile`.
