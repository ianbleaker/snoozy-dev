---
name: doc-commit
description: Commit uncommitted content edits in a doc-changelog repo (one with doc-changelog.json) as one commit per concern, each carrying its changelog fragment, after one confirmation; pushes only when the config says so. Use for "commit my changes" / "commit the rules" in a repo that uses the document-changelog flow. Arguments - [--repo <dir>].
---

Turns the working tree into focused commits, one per concern, each with the changelog fragment that describes it. Convention and fragment format: `${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog/changelog.md`. **Invoking this skill means the user is comfortable with the changes as they stand.** The one confirmation in step 5 approves the commits, and the push too when `commit.push` is on. Don't ask again.

`CL` is `${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog`. `REPO` is `--repo <dir>` if given, else `node CL/config.mjs locate`. If locate fails, relay its error and stop. Run git as `git -C REPO …`. Load the config once with `node CL/config.mjs show --repo REPO`, which gives `categories` (with `description`s), `areas`, `fragmentsDir` and `commit`.

## Steps

1. **Preflight.**
   - `git fetch origin`. If the current branch has an upstream and is behind it, `git pull --ff-only`. Uncommitted edits stay in place. If it has diverged, stop and report.
   - If `git status --porcelain` is empty, say there's nothing to commit and stop.

2. **Verify.** If `commit.verify` is set, run it from REPO. On failure, stop and show the output. Never commit content that fails it.

3. **Read the changes and sort them into concerns.** Use `git diff` plus the contents of untracked files (`git status --porcelain -uall`).
   - Pick each hunk's category by matching it against the categories' `description`s.
   - **One concern per commit**, even when that splits a file. Hunks of the same concern across files share a commit. A move between files is always one commit: the removal and the addition land together. Don't over-split: five small fixes of one kind on one page are one commit.
   - **Non-content changes** form their own commits, with no fragment and a `Changelog: skip` trailer. Non-content means files outside `content`, in `ignore`, or the config itself.
   - Fragments the user already wrote under `fragmentsDir` go with the concern they describe. Never rewrite them.
   - Areas: run `node CL/fragments.mjs --repo REPO areas <files of the concern>` for suggestions. Keep only those the concern really touches.

4. **Draft each commit.**
   - **Subject:** a conventional commit, using the repo's own style (`git log --format=%s -20`).
   - **Body:** optional, one or two sentences on *why* for larger changes. If the why isn't evident from the diff or the conversation, ask, batched into step 5. Never invent a reason.
   - **Fragment** (content commits): `<fragmentsDir>/<slug>.md`. The slug is the summary in kebab-case, at most 6 words. If the file exists, add `-2`, `-3` and so on. Use the format from `changelog.md`: `category`, `area` (omit when none), then the summary as the body. Write the summary for readers: present tense, ≤ 20 words, about what changed for them, not in the repo.

5. **Confirm once.** Print the plan in chat first, because previews don't render on mobile. For each commit, show its files (and hunks, when a file is split), subject, body, fragment filename, category, areas and summary. Then ask one `AskUserQuestion` with the options **Commit** (or **Commit & push** when `commit.push` is true) and **Adjust**. Put the plan in the preview too. Fold any open questions (an unclear category, a missing why) into the same call. On **Adjust**, apply the changes and confirm again.

6. **Commit**, in plan order:
   - Write the commit's fragment file.
   - Whole files: `git add -- <files>`, or `git add -A -- <paths>` for new or deleted files.
   - Some of a file's hunks: write those hunks to a patch in the scratchpad and run `git apply --cached --recount <patch>`. `git add -p` is interactive and not available. When concerns interleave inside hunks (editor reflows), build this commit's version of the file in the scratchpad instead and stage it with `git update-index --cacheinfo 100644,$(git hash-object -w <snapshot>),<path>`. The last commit that touches the file takes the working-tree file itself.
   - Before each `git commit`, check `git diff --cached --stat` against the plan. If it doesn't match, `git reset -q` and redo the staging. Never commit a mismatched index.
   - Pass the subject, body and trailers as separate `-m` arguments.

   Afterwards, `git status --porcelain` must be empty, or show only what the plan deliberately left out.

7. **Gate.** `node CL/fragments.mjs --repo REPO check` must pass. If it fails, show the output. A gap that predates this run is for `/doc-changelog`, so say so; a gap from this run means a commit missed its fragment, so fix it with a follow-up commit.

8. **Push**, only if `commit.push` is true. `git push` (with `-u origin <branch>` the first time). On rejection because the remote moved, `git pull --rebase`, rerun step 2's verify, then push again. If the rebase conflicts, `git rebase --abort`, stop and report. Never force-push.

9. **Report.** List the commits (hash, subject, fragment), say whether they were pushed, and show the unreleased preview: `node CL/fragments.mjs --repo REPO render`.

## Rules

- Never touch `CHANGELOG.md`, the `versionFile`, or tags. Releases are `/doc-release`'s job.
- Never stash, discard or reset the user's changes. If something is unclear, ask in step 5.
- Never force-push. Push only when `commit.push` is true, and only the current branch.
