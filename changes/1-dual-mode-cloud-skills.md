---
category: feature
area: [cloud, task-flow]
---
The GitHub-workflow skills (`/next-task`, `/log-task`, `/write-plan`, `/implement-plan`, `/batch-tasks`) work in Claude Code cloud sessions through `gh api` REST calls. Skills that need a local machine (`/deploy`, `/stage-preview`, `/merge-preview`, `/sweep-tasks`, `/go-public`) stop with a clear message, `/doc-release` stops after the cut, and `/onboard` prints its repo-settings commands instead of running them.
