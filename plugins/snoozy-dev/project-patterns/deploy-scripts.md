# Deploy scripts convention

Generalized from a working production setup (`deploy/setup.sh`,
`deploy/deploy.sh`, `deploy/<repo>.service`). If a project you own already
follows it, read those scripts before adapting the convention to a new
project; they're the source of truth for the *shape*, not something to
paraphrase from memory.

**This describes stack-agnostic shape, not verbatim commands.** The
properties below — idempotent re-run, port-conflict retry, ownership setup,
restart-then-verify, loud failure — are what every project's `deploy/`
folder must have. The actual dependency-install and service-start commands
(e.g. `npm ci --omit=dev` + `node server.js` for Node) are filled in per
project to match its own stack (e.g. `pip install -r requirements.txt` +
`gunicorn ...` for Python, `cargo build --release` + the built binary for
Rust) — never copy-pasted from one stack's commands into
another.

## Remote-execution convention

These scripts run *on the host*, not against it — there's no remote-exec
wrapper baked in. The convention any skill invoking them should follow is a
plain SSH command naming the checkout path directly, e.g.:

```bash
ssh <deploy-host> "cd /opt/<repo> && sudo ./deploy/deploy.sh"
ssh <deploy-host> "cd /opt/<repo>-preview && sudo ./deploy/preview-deploy.sh"
```

The host alias and checkout path are per-project details recorded in a
`## Deploy` section in that project's own CLAUDE.md, in this exact format:

```markdown
## Deploy
Host: my-deploy-host
Remote path: /opt/my-app
Preview URL: http://<host-ip>:<preview-port>
Preview check: node .claude/skills/smoke-test/preview-sense.mjs {url}
```

`Preview URL:` is added once `preview-setup.sh` has run and printed the port
it chose; `/stage-preview` and `/batch-tasks` print it in their reports (a
missing line is a warning, not a failure). `Preview check:` is optional. It
is a command that exercises the app's basic functionality against preview,
and `{url}` is replaced with the preview URL. Exit 0 means pass. Usually it's
one of the project's smoke-test scenarios (see `smoke-driver.md`).
`/stage-preview` runs it as the last layer of its post-deploy sense check,
after reachability and a headless load/console check. Without it, basic
functionality goes unchecked and the sense check says so.

All lines are parsed with a plain `grep`/`awk` for the `Host:`, `Remote
path:`, `Preview URL:` and `Preview check:` lines following the `## Deploy`
heading — this doc only fixes the *shape* of the
invocation (SSH in, `cd` to the known checkout, run the known script name),
not a specific host. If `preview-setup.sh` hasn't been run yet on that host
(no checkout at `/opt/<repo>-preview`, no service installed), a caller
should say so and stop rather than attempting first-time setup inline.

## Folder layout

```
deploy/
  setup.sh              # one-time bootstrap, primary instance
  deploy.sh              # repeatable, primary instance
  preview-setup.sh       # one-time bootstrap, preview instance
  preview-deploy.sh      # repeatable, preview instance
  <service>.service      # systemd unit template, primary
  <service>-preview.service   # systemd unit template, preview
```

## `setup.sh` — one-time bootstrap

Run once per host, as root, from the repo checkout. Safe to re-run.

1. Create a dedicated system service user if it doesn't already exist
   (`useradd --system --home <checkout> --shell /usr/sbin/nologin <service-user>`).
2. `chown -R` the checkout to that user.
3. Pick a port: read the default from the `.service` template, and if it's
   already in use on the host, retry the next port up (interactively prompt
   if there's a TTY, otherwise silently increment) until a free one is found.
4. Install dependencies as the service user, stack-appropriate
   (`npm ci --omit=dev` for Node; substitute per stack).
5. Install the systemd unit (substituting the chosen port into the template),
   `daemon-reload`, `enable`, `restart`.
6. Verify: check `systemctl is-active`. On success, print the port and a
   smoke-check command (e.g. `curl localhost:<port>/...`). On failure, print
   the `journalctl -u <service> -n 50 --no-pager` pointer and exit non-zero —
   no silent fallback.
7. Reverse proxy/TLS is explicitly out of scope — the service is reachable by
   IP:port only. Print a reminder rather than attempting to configure one.

## `deploy.sh` — repeatable redeploy

Run from the repo checkout on the host, as many times as needed.

1. `git pull --ff-only` — never a merge or rebase; if this fails (diverged
   history), that's a real problem to surface, not paper over.
2. Reinstall dependencies (same stack-appropriate command as `setup.sh` step 4).
3. `systemctl restart <service>`.
4. Brief sleep, then verify `systemctl is-active`. On success, print the port
   the service is listening on. On failure, print the `journalctl` pointer
   and exit non-zero.
5. **No silent auto-rollback.** If the restart doesn't come back up cleanly,
   say so loudly and stop — the previous working tree state is still on disk
   for manual inspection, but nothing here reverts it automatically.

## systemd unit template (`<service>.service`)

Standard shape: `Type=simple`, `User=<service-user>`,
`WorkingDirectory=<checkout>`, an `Environment=PORT=<port>` line (rewritten by
`setup.sh` at install time), the stack's start command as `ExecStart`,
`Restart=on-failure` with a short `RestartSec`, journal-based logging, and the
usual systemd sandboxing (`NoNewPrivileges=true`, `ProtectSystem=strict`,
`ProtectHome=true`, `PrivateTmp=true`, with `ReadWritePaths` scoped to
whatever directory the app writes to at runtime, if any).

## Preview pair: `preview-setup.sh` / `preview-deploy.sh`

Same shape as the primary pair, run alongside it — not replacing it. A second
systemd service (e.g. `<service>-preview`), a second port (same conflict-retry
logic in `setup.sh` step 3, but started from a different default port so it
doesn't collide with the primary's), and a second checkout path (e.g.
`/opt/<repo>-preview`) tracking the `preview` branch instead of `main`.

Production must stay live and undisturbed while `preview` is being
smoke-tested — the preview instance is entirely separate infrastructure, not
a mode switch on the primary one. Like the primary, no reverse proxy/TLS: the
preview instance is reachable by IP:port only, deliberately unadvertised.

`preview-deploy.sh` differs from `deploy.sh` only in which checkout/service
it targets and that it pulls the `preview` branch rather than `main` — same
pull → install → restart → verify shape, same no-silent-rollback rule.
