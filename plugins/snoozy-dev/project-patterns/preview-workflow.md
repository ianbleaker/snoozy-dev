# Preview automation convention (Tier 1)

Generalized GitHub Actions workflow that automates what `/stage-preview`
already does by hand: merge every open `task/*` branch onto the shared
`preview` branch and deploy it via the project's existing
`deploy/preview-deploy.sh` (see `deploy-scripts.md`). **This describes
stack-agnostic shape, not verbatim commands** — same posture as
`deploy-scripts.md`; adapt the deploy step per project the same way `ci.yml`
is adapted per stack.

## Trigger

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]
    branches: [main]
```

## Unattended grouping policy

No human in the loop to pick between candidate groups the way
`/stage-preview` does interactively, so the policy is simpler and stricter:
- Merge **every** open `task/*` branch onto `preview` in one shot.
- On any merge conflict, **stop the job immediately**, print exactly which
  branches conflicted, and do not push — the previous `preview` deploy (and
  its running service) stays untouched.
- No auto-exclusion of a conflicting branch. A branch quietly missing from
  preview is a worse failure mode than a loud, immediate stop.

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
            --json headRefName --jq '.[].headRefName' | grep -E '^task/' || true)
          git checkout -B preview origin/main
          for b in $branches; do
            if ! git merge --no-edit "origin/$b"; then
              echo "::error::Conflict merging $b into preview — stopping, not pushing."
              exit 1
            fi
          done
          git push origin preview --force-with-lease
      - name: Deploy preview
        run: |
          # Host/remote path parsed from this project's CLAUDE.md
          # `## Deploy` section, same convention as deploy-scripts.md.
          ssh "$DEPLOY_HOST" "cd $PREVIEW_REMOTE_PATH && sudo ./deploy/preview-deploy.sh"
        env:
          SSH_AUTH_SOCK: ${{ /* configured via a prior ssh-agent step using
            the PREVIEW_DEPLOY_SSH_KEY secret */ '' }}
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

The SSH-agent setup step and `$PREVIEW_URL` value are per-project detail,
same as `deploy-scripts.md`'s existing host/path parameterization — not
fully spelled out here, adapted at onboard-offer time.

Reporting status via the GitHub Deployments API (rather than a plain issue
comment) is the point of Tier 1 over the manual skill: it shows up natively
on the PR (checkmark + environment link) instead of being invisible to
GitHub.

## Secret convention

`PREVIEW_DEPLOY_SSH_KEY` — a **repo secret**, not org-level (smallest blast
radius per repo), holding the private key for the preview host's deploy
user. This is a one-time manual setup step per project — `/onboard`'s offer
should note it needs to be set before the workflow can succeed, and can't
verify it was set (secrets aren't readable via API).

## Relationship to `/stage-preview`

Explicitly **additive, not a replacement**. `/stage-preview` stays useful for
deliberate single-issue staging (its `[issue-number]` fast path) or as a
fallback if CI is down.
