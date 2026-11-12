# Environments: CLI and Claude Code cloud

The skills are written for a local CLI session (`gh`, `ssh`, sibling checkouts). In a Claude Code cloud session `gh` is preinstalled and authenticated through a proxy that rejects its GraphQL-backed subcommands (`gh issue …`, `gh pr …` return 403), while REST calls through `gh api` go through. This doc is the one place that maps each GitHub step a skill takes to a form that works in cloud. Skills keep their CLI commands as written and point here with a one-line **Cloud:** or **CLI-only:** note.

## 1. Detect

Run `${CLAUDE_PLUGIN_ROOT}/project-patterns/cloud-check.sh` once per skill run, from the project root.

- Exit 0, no output: CLI mode. Use every command exactly as the skill writes it.
- Exit 1, one `CLOUD:` line: cloud mode. Do each GitHub step with its cloud form from section 2, with the same intent and in the same order. An unauthenticated or offline CLI also lands here; the line says so.

The cloud forms below follow the cloud-environments docs and the REST API. **None has been run inside a real cloud session yet**: treat each as "try this", and if one fails, report the exact error rather than improvising a different mechanism.

## 2. Intent → form

`{owner}/{repo}` is expanded by `gh api` from the current checkout's remote. If expansion fails, set `GH_REPO=<owner>/<repo>` for the call. Bodies go through a file: `-F body=@<file>`. Quote each endpoint so the shell leaves `?`, `&` and `{}` alone. In the table, `\|` stands for a plain `|` (Markdown table escaping).

Or use the session's built-in GitHub tools, if present, for the same intent.

| Intent | CLI (as written in skills) | Cloud (gh api REST) |
| --- | --- | --- |
| List open issues by label | `gh issue list --repo <owner>/<repo> --label <label> --state open --json number,title,labels` | `gh api 'repos/{owner}/{repo}/issues?state=open&labels=<label>&per_page=100' --jq '.[] \| select(.pull_request\|not) \| {number, title, labels: [.labels[].name]}'` |
| Search issues across an owner by label | `gh search issues --owner <owner> --label <label> --state open` | `gh api -X GET search/issues -f q='user:<owner> is:issue is:open label:<label>' --jq '.items[] \| {number, title, repo: .repository_url, labels: [.labels[].name]}'` (use `org:<owner>` for an organization) |
| Read issue body | `gh issue view <N> --repo <repo> --json body --jq .body > <tmp>` | `gh api 'repos/{owner}/{repo}/issues/<N>' --jq .body > <tmp>` |
| Read issue state | `gh issue view <N> --json state` | `gh api 'repos/{owner}/{repo}/issues/<N>' --jq .state` (lowercase `open`/`closed`) |
| Read blocked-by | `gh api repos/<owner>/<repo>/issues/<N>/dependencies/blocked_by` | `gh api 'repos/{owner}/{repo}/issues/<N>/dependencies/blocked_by' --jq '.[] \| {number, state}'`. If the endpoint fails: the body's `Blocked by:` line is the source of truth, plus a read-issue-state call per blocker |
| Create issue with labels | `gh issue create --repo <repo> --title … --body-file <file> --label …` | `gh api 'repos/{owner}/{repo}/issues' -f title='<title>' -F body=@<file> -f 'labels[]=<label1>' -f 'labels[]=<label2>'` |
| Edit issue body from a file | `gh issue edit <N> --repo <repo> --body-file <file>` | `gh api -X PATCH 'repos/{owner}/{repo}/issues/<N>' -F body=@<file>` |
| Add a label | `gh issue edit <N> --add-label <label>` | `gh api 'repos/{owner}/{repo}/issues/<N>/labels' -f 'labels[]=<label>'` |
| Remove a label | `gh issue edit <N> --remove-label <label>` | `gh api -X DELETE 'repos/{owner}/{repo}/issues/<N>/labels/<label>'` |
| Comment on an issue | `gh issue comment <N> --repo <repo> --body …` | `gh api 'repos/{owner}/{repo}/issues/<N>/comments' -F body=@<file>` |
| Close an issue | `gh issue close <N>` | `gh api -X PATCH 'repos/{owner}/{repo}/issues/<N>' -f state=closed` |
| List open PRs (number, title, head branch) | `gh pr list --state open --json number,title,headRefName` | `gh api 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] \| {number, title, head: .head.ref}'` |
| List PRs by head branch | `gh pr list --head <branch>` | `gh api 'repos/{owner}/{repo}/pulls?state=all&head={owner}:<branch>' --jq '.[] \| {number, state, head: .head.ref}'` (`state=open` to match `gh pr list`'s default) |
| Read a PR | `gh pr view <N> --json number,title,state,headRefName,body` | `gh api 'repos/{owner}/{repo}/pulls/<N>' --jq '{number, title, state, head: .head.ref, body}'` |
| Create a PR from a body file | `gh pr create --base main --head <branch> --title "…" --body-file <file>` | `gh api 'repos/{owner}/{repo}/pulls' -f base=main -f head=<branch> -f title='<title>' -F body=@<file>` |

## 3. Cloud rules

- **Lean list calls.** Request only number, title and labels (an unfiltered issue list once returned ~98k characters). Read bodies only for the finalists.
- **Dependencies.** Run `npm ci` when `node_modules` is missing.
- **Regressions.** Before treating a test failure as a regression, confirm it also fails on the base branch: some failures only happen in the sandbox.
- **Task branches.** `/next-task` and `/batch-tasks` task work uses `task/<N>-<slug>`, not the session-assigned `claude/...` branch: preview grouping, `/merge-preview`, `/sweep-tasks` and the In Review derivation all key on `task/<N>-*`. Ad hoc work stays on the session branch.
- **Companion repos.** A project whose `CLAUDE.md` has a `Private repo:` line keeps its plans in a sibling checkout that a cloud container doesn't have, so `plans-dir.sh` stops with its "companion repo … not found" error. That's expected: plan work for such a project needs a local session. Projects without the line keep plans in `docs/plans/` and are unaffected.

## 4. CLI-only

These stop in cloud mode with the `cloud-check.sh` line and a one-line reason:

- `/deploy`: SSH to the deploy host.
- `/stage-preview` (including its sense check): SSH deploy to the preview host and multi-branch merging.
- `/merge-preview`: merges multiple PRs with `gh pr`.
- `/sweep-tasks`: reconciles branches and issues with `gh pr`/`gh issue`.
- `/go-public`: creates, transfers and archives repos.
- `/doc-release`, open and publish steps: `release.sh` opens the release PR and creates the tag/GitHub Release with `gh pr create`/`gh release create`. The cut (local git work) still runs.
- `/onboard`, label creation, branch protection and repo settings: they change repo settings through `gh`. In cloud the skill prints the commands with `<owner>/<repo>` filled in for the user to run from a CLI.
