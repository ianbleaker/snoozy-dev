# Preview automation convention (Tier 1)

Generalized GitHub Actions workflow that automates what `/stage-preview` already does by hand: merge every open-PR `task/*` and ad hoc branch onto the shared `preview` branch and deploy it via the project's existing `deploy/preview-deploy.sh` (see `deploy-scripts.md`). **This describes stack-agnostic shape, not verbatim commands** — same posture as `deploy-scripts.md`; adapt the deploy step per project the same way `ci.yml` is adapted per stack.

## Trigger

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches: [main]
```

## Unattended grouping policy

No human in the loop to pick between candidate groups the way `/stage-preview` does interactively, so the policy is simpler and stricter:
- Merge **every** open-PR `task/*` or ad hoc `<type>/*` branch (`branch-workflow.md`) onto `preview` in one shot.
- On any merge conflict, **stop the job immediately**, print exactly which branches conflicted, and do not push — the previous `preview` deploy (and its running service) stays untouched.
- No auto-exclusion of a conflicting branch. A branch quietly missing from preview is a worse failure mode than a loud, immediate stop.

## Example workflow

```yaml
name: preview
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches: [main]
permissions:
  contents: write
  deployments: write
jobs:
  deploy-preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Configure git identity
        run: |
          git config user.email "actions@github.com"
          git config user.name "github-actions[bot]"
      - name: Merge all open task branches onto preview
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          branches=$(gh pr list --repo "${{ github.repository }}" --state open \
            --json headRefName --jq '.[].headRefName' | grep -E '^(task|feat|fix|refactor|docs|chore|security)/' || true)
          git checkout -B preview origin/main
          for b in $branches; do
            if ! git merge --no-edit "origin/$b"; then
              echo "::error::Conflict merging $b into preview — stopping, not pushing."
              exit 1
            fi
          done
          git push origin preview --force-with-lease
      - name: Load the deploy key and pin the host key
        env:
          SSH_KEY: ${{ secrets.PREVIEW_DEPLOY_SSH_KEY }}
          KNOWN_HOSTS: ${{ secrets.PREVIEW_DEPLOY_KNOWN_HOSTS }}
        run: |
          mkdir -p ~/.ssh && chmod 700 ~/.ssh
          # Pinned host key (`ssh-keyscan <host>` output, checked once by
          # hand), so the job never trusts whatever answers on first use.
          printf '%s\n' "$KNOWN_HOSTS" > ~/.ssh/known_hosts
          eval "$(ssh-agent -s)"
          ssh-add - <<<"$SSH_KEY"
          echo "SSH_AUTH_SOCK=$SSH_AUTH_SOCK" >> "$GITHUB_ENV"
      - name: Deploy preview
        env:
          DEPLOY_HOST: ${{ secrets.PREVIEW_DEPLOY_HOST }}
        run: |
          # Preview checkout: the `Preview path:` rule from deploy-scripts.md
          # (default <Remote path>-preview). The ci-preview account's forced
          # command runs exactly this anyway, whatever is sent here.
          ssh -o StrictHostKeyChecking=yes "ci-preview@$DEPLOY_HOST" \
            "cd /opt/<repo>-preview && sudo -n -u <repo>-preview-deployer ./deploy/preview-deploy.sh"
          echo "PREVIEW_URL=http://$DEPLOY_HOST:<preview-port>" >> "$GITHUB_ENV"
      - name: Report deployment status
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          dep_id=$(gh api repos/${{ github.repository }}/deployments \
            -f ref="${{ github.event.pull_request.head.sha }}" \
            -f environment="preview" -F auto_merge=false \
            -f 'required_contexts[]' --jq '.id')
          gh api repos/${{ github.repository }}/deployments/$dep_id/statuses \
            -f state="success" -f environment_url="$PREVIEW_URL"
```

The host never appears in the workflow file: it comes from the `PREVIEW_DEPLOY_HOST` repo secret, which also fills the `{host}` part of `$PREVIEW_URL` (the CI runner has no `~/.ssh/config` alias to resolve it from). The checkout path, deployer name and port are per-project detail, same as `deploy-scripts.md`'s parameterization, adapted at onboard-offer time.

Reporting status via the GitHub Deployments API (rather than a plain issue comment) is the point of Tier 1 over the manual skill: it shows up natively on the PR (checkmark + environment link) instead of being invisible to GitHub.

## Secret convention

Three **repo secrets**, not org-level (smallest blast radius per repo):

- `PREVIEW_DEPLOY_SSH_KEY`: the private key for a dedicated `ci-preview` account on the host, never a person's account.
- `PREVIEW_DEPLOY_HOST`: the host's address.
- `PREVIEW_DEPLOY_KNOWN_HOSTS`: the host's pinned `known_hosts` line(s).

The `ci-preview` account is created once by hand, like a person's account (`deploy-scripts.md` "Host access"): `useradd -m -s /bin/sh -G deploy ci-preview`. Its login shell must be a real shell, because a forced command runs through it. Its `~ci-preview/.ssh/authorized_keys` holds exactly one line:

```
restrict,command="cd /opt/<repo>-preview && sudo -n -u <repo>-preview-deployer ./deploy/preview-deploy.sh" <public key>
```

Why: `restrict` takes away the shell, port/agent/X11 forwarding and a pty, and the forced command ignores whatever command the client sends. A leaked CI key can only redeploy preview. It can't reach prod either, even though the `deploy` group's sudoers rule would allow that, because it can never run any other command.

Setting the secrets and the account is a one-time manual step per project — `/onboard`'s offer should note it needs to be done before the workflow can succeed, and can't verify it was (secrets aren't readable via API).

## Relationship to `/stage-preview`

Explicitly **additive, not a replacement**. `/stage-preview` stays useful for deliberate single-issue staging (its `[issue-number]` fast path) or as a fallback if CI is down.
