# Deploy scripts convention

Generalized from a working production setup (`deploy/setup.sh`, `deploy/deploy.sh`, `deploy/<repo>.service`). If a project you own already follows it, read those scripts before adapting the convention to a new project; they're the source of truth for the *shape*, not something to paraphrase from memory.

**This describes stack-agnostic shape, not verbatim commands.** The properties below — idempotent re-run, port-conflict retry, ownership setup, restart-then-verify, loud failure — are what every project's `deploy/` folder must have. The actual dependency-install and service-start commands (e.g. `npm ci --omit=dev` + `node server.js` for Node) are filled in per project to match its own stack (e.g. `pip install -r requirements.txt` + `gunicorn ...` for Python, `cargo build --release` + the built binary for Rust) — never copy-pasted from one stack's commands into another.

## Remote-execution convention

These scripts run *on the host*, not against it — there's no remote-exec wrapper baked in. The convention any skill invoking them should follow is a plain SSH command naming the checkout path directly, e.g.:

```bash
ssh <deploy-host> "cd /opt/<repo> && sudo -n -u <repo>-deployer ./deploy/deploy.sh"
ssh <deploy-host> "cd /opt/<repo>-preview && sudo -n -u <repo>-preview-deployer ./deploy/preview-deploy.sh"
```

The SSH alias logs in as the developer's **own non-root account** (see "Host access" below), never root. `sudo -n -u <deployer>` runs the script as the instance's deployer (see "Privilege model"); `-n` makes a missing sudoers rule fail at once instead of hanging on a password prompt over non-interactive SSH. The deployer name is always derived from the checkout path: `<basename of checkout>-deployer`, so `/opt/<repo>` gives `<repo>-deployer` and `/opt/<repo>-preview` gives `<repo>-preview-deployer`. There is no setting to override it.

The host alias and checkout path are per-project details recorded in a `## Deploy` section in that project's own CLAUDE.md, in this exact format:

```markdown
## Deploy
- Host: my-deploy-host
- Remote path: /opt/my-app
- Preview URL: http://{host}:<preview-port>
- Preview check: node .claude/skills/smoke-test/preview-sense.mjs {url}
```

Each line is a `- Key: value` list item because the markdown unwrap hook joins consecutive plain lines into one paragraph, and list items stay separate. The bare `Key: value` form is still accepted as legacy, but lines that have been joined onto one line fail loudly rather than deploy to a garbage host.

- `Host:` is an alias from each developer's own `~/.ssh/config`, which holds the real `HostName`, `User` and `IdentityFile`. No IP, hostname, username or key ever goes in CLAUDE.md.
- `Remote path:` is the production checkout on the host.
- `Preview path:` is optional and defaults to the `Remote path:` value plus `-preview` (e.g. `/opt/my-app-preview`).
- `Preview URL:` is added once `preview-setup.sh` has run and printed the port it chose. `{host}` is resolved per user to the `HostName` that `ssh -G <Host alias>` reports (the alias itself if none is set), so the tracked file never holds the server's address. A URL without `{host}` is used as is. `/stage-preview` and `/batch-tasks` print it in their reports (a missing line is a warning, not a failure).
- `Preview check:` is optional. It is a command that exercises the app's basic functionality against preview, and `{url}` is replaced with the preview URL. Exit 0 means pass. Usually it's one of the project's smoke-test scenarios (see `smoke-driver.md`). `/stage-preview` runs it as the last layer of its post-deploy sense check, after reachability and a headless load/console check. Without it, basic functionality goes unchecked and the sense check says so.

All parsing lives in one helper, `project-patterns/deploy-config.sh` (`eval "$(deploy-config.sh [project-dir])"`), which prints `DEPLOY_HOST`, `REMOTE_PATH`, `PREVIEW_PATH`, `DEPLOY_USER`, `PREVIEW_DEPLOY_USER`, `PREVIEW_URL` (with `{host}` resolved) and `PREVIEW_CHECK`. Callers never parse `## Deploy` themselves. This doc only fixes the *shape* of the invocation (SSH in, `cd` to the known checkout, run the known script name as its deployer), not a specific host. If `preview-setup.sh` hasn't been run yet on that host (no checkout at the preview path, no service installed), a caller should say so and stop rather than attempting first-time setup inline.

## Privilege model

Three identities per instance, and repo code never runs as root during a deploy:

- **A person in the `deploy` group** may run only that instance's `deploy.sh` (or `preview-deploy.sh`), only as its deployer, with no arguments. Each person has their own account, so auth.log and the sudo log record who deployed.
- **The deployer** (`<repo>-deployer`, `<repo>-preview-deployer`) owns the checkout and runs pull, dependency install and build. Its one root privilege is `systemctl restart <service>`. Its home is `/var/lib/<deployer>`, never the checkout: it holds `~/.ssh` (the git deploy key) and the npm/pip cache.
- **The service user** runs the app and owns only the runtime-writable directories (the unit's `ReadWritePaths`). It can't write `deploy.sh` or the code it runs.

Residual risk, accepted: push access to `main` means code running as `<repo>-deployer` and the service user, which is full control of that app and its data, but not of the host. Push access to any PR branch means the same, only for the preview instance. `setup.sh` itself runs as root and comes from git, so before re-running it a human reviews `git diff <last-setup-commit>..HEAD -- deploy/`. Signed-commit verification was considered and rejected: `/merge-preview` squash-merges through GitHub, so merge commits carry GitHub's own signature, and trusting that key brings the hole back.

## Host access (manual, once per host)

Accounts and keys are personal, so they never come from a repo and `setup.sh` never creates them.

- For each person: `useradd -m -s /bin/bash -G deploy <name>`, then their public key in `~<name>/.ssh/authorized_keys` (mode 600, owned by them).
- Each developer's own `~/.ssh/config`:
  ```
  Host <alias>
    HostName <host-ip>
    User <name>
    IdentityFile ~/.ssh/<key-file>
  ```
- Offboarding: `userdel -r <name>`. No shared `authorized_keys` to edit, no repo change.
- Move the git deploy key from root's `~/.ssh` to `/var/lib/<repo>-deployer/.ssh/` (owned by the deployer, mode 600), so `git pull` works as the deployer.
- Once a non-root deploy has been verified end to end, set `PermitRootLogin no` in `sshd_config` and reload sshd. **Never do this before verifying**: if the non-root path doesn't work yet, it locks you out of the host.

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

Run once per host, as root, from the repo checkout. Safe to re-run. Re-running it on an existing host is also the migration path to the privilege model: it hands a root- or service-owned checkout to the deployer and installs the sudoers drop-in.

1. Create a dedicated system service user if it doesn't already exist (`useradd --system --home <checkout> --shell /usr/sbin/nologin <service-user>`).
2. `groupadd -f deploy`, then create the deployer if it doesn't exist: `useradd --system --create-home --home-dir /var/lib/<deployer> --shell /usr/sbin/nologin <deployer>`, where `<deployer>` is `<basename of checkout>-deployer`. If that name is longer than 32 characters (the Linux username limit), fail with a clear message.
3. Ownership: the whole checkout belongs to the deployer (recursively, `<deployer>:<deployer>`, readable by everyone with the default umask). Only the runtime-writable directories, the ones in the unit's `ReadWritePaths`, are then chowned to the service user. **Never `chown -R` the checkout to the service user**: the app could then rewrite `deploy.sh` and the code it runs.
4. Pick a port: read the default from the `.service` template, and if it's already in use on the host, retry the next port up (interactively prompt if there's a TTY, otherwise silently increment) until a free one is found.
5. Install dependencies **as the deployer** (`sudo -u <deployer>`), stack-appropriate (`npm ci --omit=dev` for Node; substitute per stack).
6. Install the systemd unit (substituting the chosen port into the template), `daemon-reload`, `enable`, `restart`. Write the template's `sha256sum` to `/var/lib/<deployer>/unit.sha256` (owned by the deployer) so `deploy.sh` can spot an unapplied template change.
7. Install the sudoers drop-in, `/etc/sudoers.d/<repo>-deploy`, with exactly these two lines:
   ```
   %deploy ALL=(<repo>-deployer) NOPASSWD: /opt/<repo>/deploy/deploy.sh ""
   <repo>-deployer ALL=(root) NOPASSWD: <systemctl path> restart <service>
   ```
   - `""` forbids arguments, and the `systemctl` rule lists its exact arguments, so nothing else matches.
   - `<systemctl path>` comes from `command -v systemctl`, never a hardcoded `/usr/bin`.
   - Write a temp file, validate it with `visudo -cf <tmp>`, then `install -m 0440 -o root -g root <tmp> /etc/sudoers.d/<name>`. A broken sudoers file breaks sudo for every user on the host, so it is never moved into place unvalidated.
   - Any `.` in the filename becomes `_`: sudo skips drop-in files whose names contain `.`.
8. Verify: check `systemctl is-active`. On success, print the port and a smoke-check command (e.g. `curl localhost:<port>/...`). On failure, print the `journalctl -u <service> -n 50 --no-pager` pointer and exit non-zero — no silent fallback.
9. Reverse proxy/TLS is explicitly out of scope — the service is reachable by IP:port only. Print a reminder rather than attempting to configure one.

## `deploy.sh` — repeatable redeploy

Run from the repo checkout on the host, **as the deployer, not root** (`sudo -n -u <repo>-deployer ./deploy/deploy.sh`), as many times as needed.

1. `git pull --ff-only` — never a merge or rebase; if this fails (diverged history), that's a real problem to surface, not paper over.
2. Reinstall dependencies (same stack-appropriate command as `setup.sh` step 5).
3. Compare the unit template's `sha256sum` with `/var/lib/<deployer>/unit.sha256`. On a mismatch, print `Unit template changed: run 'sudo ./deploy/setup.sh' to apply it.` and carry on: a warning, not a failure.
4. `sudo -n systemctl restart <service>`, the deployer's one root privilege.
5. Brief sleep, then verify `systemctl is-active` (and `systemctl show` for the port), both without sudo since they work unprivileged. On success, print the port the service is listening on. On failure, print the `journalctl` pointer and exit non-zero.
6. **No silent auto-rollback.** If the restart doesn't come back up cleanly, say so loudly and stop — the previous working tree state is still on disk for manual inspection, but nothing here reverts it automatically.

`deploy.sh` must never need root for anything except that one restart: no unit-file copy, no package install, no `/etc` writes. Those belong in `setup.sh`, which a human runs deliberately.

## systemd unit template (`<service>.service`)

Standard shape: `Type=simple`, `User=<service-user>`, `WorkingDirectory=<checkout>`, an `Environment=PORT=<port>` line (rewritten by `setup.sh` at install time), the stack's start command as `ExecStart`, `Restart=on-failure` with a short `RestartSec`, journal-based logging, and the usual systemd sandboxing (`NoNewPrivileges=true`, `ProtectSystem=strict`, `ProtectHome=true`, `PrivateTmp=true`, with `ReadWritePaths` scoped to whatever directory the app writes to at runtime, if any).

## Preview pair: `preview-setup.sh` / `preview-deploy.sh`

Same shape as the primary pair, run alongside it — not replacing it. A second systemd service (e.g. `<service>-preview`), a second port (same conflict-retry logic in `setup.sh` step 3, but started from a different default port so it doesn't collide with the primary's), and a second checkout path (the `Preview path:`, by default `/opt/<repo>-preview`) tracking the `preview` branch instead of `main`.

Production must stay live and undisturbed while `preview` is being smoke-tested — the preview instance is entirely separate infrastructure, not a mode switch on the primary one. Like the primary, no reverse proxy/TLS: the preview instance is reachable by IP:port only, deliberately unadvertised.

`preview-setup.sh` does everything `setup.sh` does for the preview instance's own deployer, `<repo>-preview-deployer`, and its own sudoers drop-in, `/etc/sudoers.d/<repo>-preview-deploy` (granting `%deploy` `/opt/<repo>-preview/deploy/preview-deploy.sh ""` as that deployer, and that deployer `systemctl restart <service>-preview`). The preview checkout follows the `Preview path:` rule above.

`preview-deploy.sh` differs from `deploy.sh` only in which checkout/service it targets and that it pulls the `preview` branch rather than `main` — same pull → install → restart → verify shape, same no-silent-rollback rule.
