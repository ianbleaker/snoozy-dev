# Snoozy Dev Playbook

Portable skills, hooks, and working conventions for Claude Code. This repo is
the source of truth for every machine and every project.

**Install the plugin (local machine):**

```bash
git clone https://github.com/ianbleaker/snoozy-dev ~/snoozy-dev
~/snoozy-dev/scripts/install-plugin.sh
```

Skills are namespaced (`/snoozy-dev:onboard`, …). While editing the skills
themselves, use `claude --plugin-dir ~/snoozy-dev/plugins/snoozy-dev` to load
your working tree live. Then apply Layer 1 below and run
`/snoozy-dev:onboard` in each project.

**Claude Code in the Cloud:** see the README section "Adding this to Claude
Code in the Cloud" (setup script once per environment + SessionStart hook per
repo, added by `/onboard`).

Plugins can't ship `global/CLAUDE.md` or the settings snippet — those remain
Layer 1 (local) only. In cloud repos, put anything from `global/CLAUDE.md` you
need into the repo's own CLAUDE.md.

---

## Token economics — why this is shaped the way it is

Every mechanism Claude Code offers has a different context cost. Put each thing
where it costs least:

| Mechanism | Cost | Use for |
| --- | --- | --- |
| CLAUDE.md (global + project) | **Eager** — loaded into every session; every word costs forever | Invariants and pointers only |
| Skills | **Lazy** — one description line in context until invoked | Repeated workflows, multi-step rituals |
| Hooks | **Free** — zero context until they fire | Mechanical rules, verification gates |
| Memory | **Selective** — recalled only when relevant | Pointers into repo docs, never copies |

Rules of thumb:

- If a rule is **mechanical** (a grep could check it), it's a **hook**, not CLAUDE.md prose. Prose costs tokens every session and still gets violated; hooks cost nothing and don't.
- If a **workflow repeats**, it's a **skill**, not a retyped prompt.
- If knowledge **lives in the repo**, memory and CLAUDE.md hold a **pointer** to it, not a copy of it.
- Interactive tool loops (one browser command per model turn) are the most expensive habit there is. Batch everything batchable.

---

## Layer 1 — Global (install once per machine)

Symlink CLAUDE.md so this repo stays the source of truth. (Skills and the agent
are installed by the plugin — symlinking them won't work, since they rely on
`${CLAUDE_PLUGIN_ROOT}`; the SessionStart hook or a re-run of `scripts/install-plugin.sh` picks up edits.)

```bash
ln -sf ~/snoozy-dev/global/CLAUDE.md ~/.claude/CLAUDE.md
```

`~/.claude/settings.json` holds machine-specific config (model, theme, etc.) so it
isn't symlinked wholesale — merge `global/settings.snippet.json` into it instead
(re-run after any snippet update):

```bash
jq -s '.[0] * .[1]' ~/.claude/settings.json ~/snoozy-dev/global/settings.snippet.json \
  > /tmp/settings.merged.json && mv /tmp/settings.merged.json ~/.claude/settings.json
```

What this installs:

| Piece | Purpose |
| --- | --- |
| `global/CLAUDE.md` | Cross-project preferences, kept under 20 lines |
| `global/settings.snippet.json` | Auto-mode classifier allow-rules (e.g. lets `/sweep-tasks` force-delete a stale local task branch without a confirm prompt) |
| `/write-plan` | Spar over findings one at a time, then write a checklist plan doc |
| `/implement-plan` | Implement a plan doc in order, in scope, checking items off |
| `/wrap-up` | End of session: reconcile memory, check doc sync, handoff note |
| `/audit-plan` | Planner-tier audit of an implementation diff against its plan doc |
| `/fix-bug` | Disciplined bug fix when the user has already confirmed the repro |
| `/onboard` | Instantiate Layer 2 in any project (hooks, permissions, gates, CLAUDE.md skeleton) |
| `/ui-consistency-pass` | Audit a named UI area against the project's visual-language doc, findings-first (violations vs rule gaps) |
| `/log-task` | Record a finding/idea as a GitHub issue, always landing on `status:draft` |
| `/next-task` | Pull the next `status:ready` item and route it to direct implementation, `/write-plan`, or `/implement-plan` |
| `/batch-tasks` | Implement up to N eligible `status:ready` items unattended (one `task-worker` + one PR each), then stage them on preview and sense-check it before one smoke test |
| `plugins/snoozy-dev/agents/task-worker.md` | Worker agent spawned by `/batch-tasks` to implement one ticket in its own worktree; not invoked directly |
| `/stage-preview` | Rebuild the disposable `preview` environment from a group of non-conflicting in-review task branches and deploy it, then sense-check it (reachable, no console errors, project `Preview check:` passes) before smoke testing |
| `/merge-preview` | After a passing smoke test, squash-merge every open PR whose exact head is on preview, in one confirmed pass |
| `/sweep-tasks` | Manual backup: sweep stale local `task/*` branches and reconcile any missed issue-close left behind by a merged PR |
| `/deploy` | SSH-deploy a named project to its production host via that project's `deploy/deploy.sh` |

If a machine already has a `~/.claude/CLAUDE.md`, merge instead of overwriting.

---

## Layer 2 — Per project (run `/onboard` in the repo)

`/onboard` detects the stack and writes `.claude/settings.json` plus a project
CLAUDE.md skeleton. The hook snippets live inside the onboard skill
(`plugins/snoozy-dev/skills/onboard/SKILL.md`) — single source of truth. Summary:

1. **Verify hooks.** Per-edit incremental typecheck (immediate feedback, ~1–2 s)
   plus a Stop hook running typecheck and lint on changed files as the final
   gate. Catching a type error right after the edit that caused it is cheap;
   untangling five stacked edits at end of turn is not.
2. **Permissions baseline.** Read-only commands (`git status/log/diff`, `ls`,
   `grep`/`rg`, `find`, …) allowlisted so sessions don't stall on prompts.
   For an existing project with history, `/fewer-permission-prompts` can mine
   transcripts instead.
3. **Project CLAUDE.md skeleton.** Sections: one-line purpose, hard invariants,
   pointers to reference docs, doc-sync table (edited file → which living doc
   to update), verify commands, plan-doc location.
4. **Safety rules.** Permissions deny-list for secrets reads and force-pushes,
   ask-list for destructive commands. Weaker models make these mistakes more
   often; the rules cost zero tokens and apply identically to every model.
5. **Git pre-commit gate.** A real `.git/hooks/pre-commit` running the verify
   commands. The Stop hook is *feedback*; this is the *gate* — it protects the
   durable action regardless of which model, session, or human is committing.
6. **CI workflow.** If the repo has a GitHub remote: a minimal Actions workflow
   running the verify commands on push/PR. The strongest model-independent
   check of all — it catches whatever every hook, model, and human missed.
7. **Task tracking bootstrap.** Create the `type:*`/`priority:*`/`size:*`/`status:*`
   labels (`plugins/snoozy-dev/project-patterns/task-labels.md`) on the repo if
   missing — task *status* lives in the `status:*` labels. Retires the
   old per-project "open questions" doc — task capture now goes through
   `/log-task`/`/next-task` against GitHub Issues instead.

**Project CLAUDE.md diet:** invariants and pointers, never reference content.
A vocabulary table or data-model description belongs in `docs/` with a one-line
pointer from CLAUDE.md. Budget: ~60 lines.

### Pattern: invariant guard hooks

Any rule you catch yourself writing CLAUDE.md prose about — and Claude still
occasionally violating — should become a PostToolUse hook that greps the
written file and **feeds a warning back** (stderr + exit 2) so Claude fixes it
in-flow. Warn, don't hard-block: false positives stay cheap.

Example (a design-token invariant: no raw hex or font literals outside the
theme file):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "f=$(jq -r '.tool_input.file_path // \"\"'); case \"$f\" in *theme.css|*theme.ts|*.json) exit 0;; esac; echo \"$f\" | grep -qE '\\.(css|tsx)$' || exit 0; m=$(grep -nE '#[0-9a-fA-F]{3,8}\\b|font-family:' \"$f\" | head -5); [ -n \"$m\" ] && { echo \"Hard-coded style values (use var(--token) per styling invariants):\" >&2; echo \"$m\" >&2; exit 2; } || true",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

Adapt the file globs and the grep to whatever the project's mechanical
invariant is (import bans, naming rules, forbidden APIs, …).

### Pattern: review rubric

Cached judgment: `docs/review-rubric.md` lists *this codebase's* specific
failure modes ("touching events? verify the visibility filter"), written by a
planner-tier session after real bugs and reviews, consumed by `/audit-plan` and
code reviews at any tier. See
[`project-patterns/review-rubric.md`](plugins/snoozy-dev/project-patterns/review-rubric.md).

### Pattern: smoke-test scenario library (UI apps)

See [`plugins/snoozy-dev/project-patterns/smoke-driver.md`](plugins/snoozy-dev/project-patterns/smoke-driver.md).
The rule that matters: **never drive a browser one command per model turn.**
Write or extend a named scenario script, run it once, read the result. A smoke
test should be 1–2 Bash calls, not 40 round-trips.

### Pattern: deploy scripts (offered, not auto-scaffolded)

See [`plugins/snoozy-dev/project-patterns/deploy-scripts.md`](plugins/snoozy-dev/project-patterns/deploy-scripts.md).
Stack-agnostic shape for a project's `deploy/` folder: one systemd service,
one git checkout, idempotent `setup.sh` + repeatable `deploy.sh`
(pull → install deps → restart → verify, no silent rollback), plus a
`preview-setup.sh`/`preview-deploy.sh` pair tracking a disposable `preview`
branch on a second instance. `/onboard` offers the full four-script scaffold
if no `deploy/` folder exists yet, or just the preview pair alongside an
existing hand-rolled `deploy/setup.sh`/`deploy.sh` — never rewrites one.

---

## Layer 3 — Habits (the human side)

These can't be installed; they're how you use the tool.

- **One task per session; `/clear` between tasks.** Context you don't carry is the cheapest context.
- **Plan-doc sandwich:** `/write-plan` (planner tier) → review the doc yourself → `/implement-plan <path>` (executor tier, fresh session) → `/audit-plan <path>` (planner tier, fresh session). The docs are the context handoff *and* the tier bridge; nothing else needs to survive the `/clear`.
- **Broad scans** ("find every place that does X") → ask for the **Explore subagent** so file dumps stay out of the main context and you pay only for conclusions.
- **End significant sessions with `/wrap-up`** so memory stays a lean index instead of an append-only log.
- **Task capture and pull.** Capture ad hoc via GitHub's mobile app/web or `/log-task`. Triage `type:*`/`priority:*`/`size:*` and `status:*` labels (see [`plugins/snoozy-dev/project-patterns/task-labels.md`](plugins/snoozy-dev/project-patterns/task-labels.md)) when at a desktop. When an issue is labeled `status:planned` (meaning `/write-plan` finished a doc for it), review the plan doc and add `status:ready` to approve (keeping `status:planned` alongside it is normal — it marks the plan as reviewed at a glance). Pull work in via `/next-task` at the start of a session. `/batch-tasks` pulls several eligible ready items at once, then stages them for one smoke test.
- **Don't paste large logs or files into chat** — save to a file and give Claude the path; it will read the parts it needs.
- **Escalation rule:** the second time you correct Claude about the same thing, stop and encode it — hook if mechanical, skill if workflow, CLAUDE.md line if preference — and commit it to this repo.

### Model tiering

Match the model to the session type, not to the project. Think in **tiers, not
model names** — when access changes (e.g. Fable moving to usage credits), every
role falls back one slot and nothing here needs rewriting:

| Tier | Currently | Fallback | Use for |
| --- | --- | --- | --- |
| **Planner/Auditor** | Fable | Opus | `/write-plan` sparring, `/audit-plan`, security & architecture review, writing rubrics/hooks/skills |
| **Executor** | Sonnet | — | `/implement-plan`, `/fix-bug`, `task-worker` (via `/batch-tasks`), mechanical refactors |
| **Chore** | Haiku | — | scenario runs, doc formatting, scripted batch edits |

The artifacts are the bridge between tiers: the planner writes docs assuming a
literal-minded executor; the executor escalates instead of improvising; the
auditor checks conformance and resolves escalations. Quality survives the tier
gap because it is cached in the artifacts, not carried by the model.

---

## Maintenance

- This repo is versioned; commit every change. CLAUDE.md edits propagate via the symlink; skill edits reach sessions via the SessionStart hook (or a re-run of `scripts/install-plugin.sh`).
- Review `global/CLAUDE.md` occasionally: anything that has grown past a line or two should move into a skill or a hook.
- When a project invents a pattern worth reusing (a good hook, a driver, a workflow), generalize it into `plugins/snoozy-dev/project-patterns/` or a global skill here.
