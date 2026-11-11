---
name: doc-release
description: Release a doc-changelog repo (one with doc-changelog.json) through a PR. Picks the version, backfills missing changelog fragments, cuts the release locally, has the user review it, and opens the release PR; after the PR merges, a re-run tags it and creates the GitHub Release. Use for "cut a release", "release the docs/rules", "publish the release". Arguments - [patch|minor|major|X.Y.Z] [--repo <dir>].
---

Convention and release flow: `${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog/changelog.md`.

`CL` is `${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog`. `REPO` is `--repo <dir>` if given, else `node CL/config.mjs locate`. If locate fails, relay its error and stop. `RELEASE` means `bash CL/release.sh --repo REPO`.

The release isn't public until the user merges its PR and this skill publishes it. Everything before **Open PR** is local and can be undone.

## Steps

1. **Publish a merged release first.** Run `DRY_RUN=1 RELEASE --publish`.
   - Exit 0: a release PR has merged but isn't tagged yet. Show its line (`Publishing <tag> at <hash>`), then ask one `AskUserQuestion`: **Publish** / **Not now**. On **Publish**, run `RELEASE --publish` and report the release URL (`gh release view <tag> --json url --jq .url`). Stop either way.
   - Exit 1: nothing to publish. Go on.

2. **Preflight.** REPO must be on `main`, matching `origin/main` after `git fetch`. If it's behind, `git pull --ff-only`. If it has diverged, stop. Only files under `fragmentsDir` may be uncommitted; uncommitted content means stop and suggest `/doc-commit` first. If a `release/*` branch exists locally from an interrupted run, switch to it and skip to step 5 for its version.

3. **Version.** If an argument was given, use it. Otherwise compute the current version (the `versionFile`'s `version`, else the highest `<tagPrefix>X.Y.Z` tag, else `0.0.0`) and ask one `AskUserQuestion` (header `Version`): patch `X.Y.Z+1` (Recommended), minor and major, each showing the computed number. The user can give an explicit version through Other.

4. **Backfill, then cut.**
   - Follow `/doc-changelog` steps 1–5 (`${CLAUDE_PLUGIN_ROOT}/skills/doc-changelog/SKILL.md`), leaving the fragments uncommitted (its step 6, `/doc-release` case). If every change already has a fragment, say so and go on.
   - If there are no fragments at all (`render` prints `No changes.`) and nothing was backfilled, stop: there's nothing to release.
   - `RELEASE cut <version>`. On failure, show the output and stop; whatever it created can be dropped with `RELEASE --undo`.

5. **Review.** Show the user:
   - `git -C REPO show --stat HEAD`: the files in the release commit;
   - the release notes exactly as they'll be published: `node CL/fragments.mjs --repo REPO notes <version>`, printed in full.

   Then ask one `AskUserQuestion`: **Open PR** / **Revise** / **Abandon**.
   - **Revise:** `RELEASE --undo`. This returns to `main` and restores backfilled fragments, uncommitted. Apply the user's changes. Edit uncommitted fragments in place. A committed fragment changes through a follow-up: an edit to it, committed with `/doc-commit` or a branch and PR, never by rewriting history. Then go back to `RELEASE cut` with the same version.
   - **Abandon:** `RELEASE --undo` and stop. Say that any backfilled fragments are left uncommitted for the next run.
   - **Open PR:** `RELEASE --open`. Report the PR URL. Say that once it merges, re-running `/doc-release` publishes it (step 1).

## Rules

- Never `--publish` a release the user hasn't merged, and never without a **Publish** answer in this run.
- Never edit published sections of `CHANGELOG.md`. A fix ships in the next release.
- Never force-push, push `main`, or delete remote tags. `release.sh` only pushes the release branch (`--open`) and the new tag (`--publish`).
