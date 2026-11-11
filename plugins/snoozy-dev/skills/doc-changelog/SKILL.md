---
name: doc-changelog
description: In a doc-changelog repo (one with doc-changelog.json), backfill changelog fragments for commits the gate flags (made without /doc-commit or the task flow), asking only where the category is unclear, or print the unreleased notes preview. Use for "changelog", "backfill the changelog", "what's unreleased". /doc-release runs these steps itself. Arguments - [--repo <dir>] [--preview].
---

Fills gaps in a fragment-based changelog. Convention: `${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog/changelog.md`.

`CL` is `${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog`. `REPO` is `--repo <dir>` if given, else `node CL/config.mjs locate`. If locate fails, relay its error and stop. Load the config with `node CL/config.mjs show --repo REPO`.

## Arguments

- `--repo <dir>`: the content repo.
- `--preview`: only print `node CL/fragments.mjs --repo REPO render` and stop.

## Steps

1. **Gate.** `node CL/fragments.mjs --repo REPO check --json`.
   - `invalid` is non-empty: report each `file: error` and stop. Fixing them is a judgment call for the user, not a backfill.
   - `missing` is empty: say every change has a fragment, print `render` as the unreleased preview, and stop.

2. **Draft fragments for each missing unit.** Read each commit's message and diff (`git -C REPO show <hash>`). A unit's commits are one change (a task branch, a merged PR), so draft for the unit as a whole.
   - One fragment per user-facing change in the unit. One unit can need several, e.g. a balance change and a fix. A unit with nothing user-facing gets a single `skip: true` fragment with a one-line reason.
   - `commit:` is the full hash of the unit's newest content commit, so the fragment links it and the gate counts the unit as covered.
   - `category`: match the diff against the categories' `description`s. Note whether the match is clear or unclear.
   - `area`: `node CL/fragments.mjs --repo REPO areas <the unit's files>` suggests areas; keep only those the change really touches.
   - Summary: for readers, present tense, ≤ 20 words, about what changed for them, not in the repo.
   - Filename: `<fragmentsDir>/<slug>.md`, the summary in kebab-case (at most 6 words), with `-2`, `-3` and so on on collision.

3. **Ask only where the category is unclear.** Use `AskUserQuestion`, up to 4 questions per call and as many calls as needed. Never ask one per turn when questions could be batched.
   - Header: the short hash (≤ 12 chars).
   - Question: the subject, and why the category is unclear.
   - Options: the best-guess category first, labelled `(Recommended)`, then the other likely categories. Each option's `preview` shows a diff excerpt (a few `-`/`+` lines) and the fragment as it would be written with that category.
   - The user can rewrite the summary or areas through notes or Other. Use their text verbatim.
   - When the user corrects an area, offer, in the next batch rather than in a new turn, to add a `paths` glob to that area in `doc-changelog.json` so future suggestions get it right. Edit the config only on a yes.

4. **Confirm.** Show every drafted fragment (filename, frontmatter, summary) in chat, then ask one `AskUserQuestion`: **Write** / **Edit first**. On edit, apply the changes and confirm again.

5. **Write** the fragment files, then rerun `check`. It must pass. If it doesn't, show the output and fix the drafts.

6. **Commit.**
   - **Called from `/doc-release`:** leave the fragments uncommitted. `release.sh cut` allows uncommitted fragments and folds them into the release commit.
   - **`commit.push` is true and REPO is on `main`** (a direct-to-main repo): `git add` the fragment files, commit `docs: add changelog fragments`, and push. On rejection, `git pull --rebase`, then push. Never force-push.
   - **Otherwise:** follow `${CLAUDE_PLUGIN_ROOT}/project-patterns/branch-workflow.md` on the branch `docs/changelog-backfill`: Start, commit `docs: add changelog fragments`, push, and open the PR. The fragments are the change, so the PR step needs no extra fragment of its own.

7. **Report.** List the fragments written and where they went (uncommitted, pushed, or the PR URL). Print `render` as the unreleased preview.

## Rules

- Never edit `CHANGELOG.md`. Only `fragments.mjs cut` writes it, during `/doc-release`.
- Never rewrite or delete an existing fragment. Fragments in `invalid` are reported for the user to fix.
- Scripts stay deterministic. Categories and summaries come only from this skill's drafts and the user's answers.
