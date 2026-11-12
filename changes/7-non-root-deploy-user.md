---
category: change
area: [preview-deploy, setup]
---
`/deploy` and `/stage-preview` now SSH in as your own non-root account and run `deploy.sh` as a per-instance `<repo>-deployer` user (`sudo -n -u`), so repo code never runs as root. Projects need `deploy/setup.sh` re-run on the host first (see `deploy-scripts.md`, "Privilege model" and "Host access"). `## Deploy` lines are now `- Key: value` list items (the bare form still works), `Preview URL:` takes a `{host}` placeholder resolved from your own `~/.ssh/config`, `Preview path:` is optional, and the projects root comes from `SNOOZY_PROJECTS_DIR` (default `~/development`). Parsing lives in the new `deploy-config.sh` helper.
