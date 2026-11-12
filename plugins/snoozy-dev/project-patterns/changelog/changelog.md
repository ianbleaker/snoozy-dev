# Document changelog (fragments)

A changelog for a repo whose readers care about *what changed in the content*: rules, game data, docs, a book. Each change records its own changelog entry, a **fragment**, when it is committed. A release concatenates the fragments into `CHANGELOG.md` and deletes them. Nothing classifies diffs after the fact: the session making a change knows its intent, so it writes the line.

- **Fragments, not trailers.** A fragment is a small markdown file in `changes/`, added in the same commit or PR as the change. Commit trailers are immutable once pushed, and squash merges pile them up. Appending to an `## Unreleased` section makes every parallel branch conflict. Fragments have neither problem and work the same in PR repos and direct-to-main repos.
- **`main` only holds unreleased fragments.** There is no `## Unreleased` section. Run `fragments.mjs render` to preview the unreleased notes.
- **Deterministic scripts.** Summaries and categories are written by the skills and the committing session, never by the scripts.

## Pieces

| Piece | What it does |
| --- | --- |
| `doc-changelog.json` | Per-repo config at the content repo root (the repo that holds `CHANGELOG.md`). |
| `config.mjs` | Loads and validates the config. `locate [dir]` finds the content repo; `show --repo <dir>` prints the resolved config. |
| `fragments.mjs` | `areas <file>...`, `check [--json]`, `render [--version X.Y.Z --date YYYY-MM-DD]`, `cut <version> <date>`, `notes <version> [--file <path>]`. |
| `release.sh` | `cut patch\|minor\|major\|X.Y.Z`, `--undo`, `--open`, `--publish`. |
| `examples/*.json` | Starting configs to copy. |

The scripts live in the plugin and aren't copied into projects. Skills call them as `node "${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog/<x>.mjs" --repo <dir>` and `bash "${CLAUDE_PLUGIN_ROOT}/project-patterns/changelog/release.sh" --repo <dir> …`. Without `--repo`, they run `config.mjs locate` from the current directory: the git toplevel if it holds `doc-changelog.json`, else the single directory up to three levels below it that does (`node_modules` and `.git` are skipped). Several matches is an error; pass `--repo`. Node ≥ 22.5, no dependencies.

## Fragment format

`changes/<slug>.md` (task branches: `changes/<issue>-<slug>.md`):

```markdown
---
category: balance
area: [starting-zone, wolves]
---
Wolves deal 4 damage instead of 6.
```

| Key | Required | Meaning |
| --- | --- | --- |
| `category` | yes, unless `skip: true` | A category `id` from the config. |
| `area` | no | One area `id`, or a list `[a, b]`. |
| `commit` | no | Full 40-character hash. Only for backfilled fragments: the commit this entry describes. |
| `skip` | no | `true` marks a change with nothing user-facing. The body is a one-line reason. Render ignores it; cut deletes it. |

The body is one paragraph, the summary readers see: present tense, about what changed for them, not in the repo. Line breaks in it are joined. The frontmatter is parsed by hand: `key: value` lines only, with no comments and no other YAML. Unknown keys, unknown ids, a malformed `commit`, an empty body, or a missing `category` without `skip` make the fragment invalid. The gate reports invalid fragments, and `cut` refuses them.

**The commit link** comes from `commit:` if present. Otherwise it comes from the commit that added the file (`git log --diff-filter=A -1 -- <file>`), which after a squash merge is the squash commit. A fragment with neither, meaning uncommitted with no `commit:`, renders last in its group with no link.

## Config reference (`doc-changelog.json`)

| Key | Default | Meaning |
| --- | --- | --- |
| `content` | `["**"]` | Globs (`path.matchesGlob`) of files whose changes need a fragment. |
| `ignore` | `[]` | Globs subtracted from `content`. `fragmentsDir`, `changelog`, `doc-changelog.json` and `release.versionFile` never count as content. |
| `fragmentsDir` | `"changes"` | Folder holding the fragments. |
| `changelog` | `"CHANGELOG.md"` | The changelog file. |
| `categories` | **required**, non-empty | Kinds of change, in render order. Each is `{ "id", "heading", "description"?, "collapsed"? }`. `id` matches `^[a-z0-9-]+$`. `description` tells the committer when to pick it. `collapsed: true` renders the group in a `<details>` block (`groupBy: category` only). |
| `areas` | `[]` | Where a change landed, in render order. Each is `{ "id", "label", "paths"? }`. `paths` globs let `fragments.mjs areas` suggest areas from changed files. The committer confirms them. |
| `groupBy` | `"category"` | `category`: `### <heading>`, with areas in parentheses after each line. `area`: `### <label>`, with the category in italics after each line, and fragments with no area under `### General`, last. `area>category`: `### <label>` then `#### <heading>`. |
| `commitUrl` | derived | Link template containing `{hash}`. Derived from a GitHub `origin` (ssh or https) as `https://github.com/<owner>/<repo>/commit/{hash}`. Otherwise `null`, meaning no links. Set `null` to turn links off. |
| `release.tagPrefix` | `"v"` | Tags and headings are `<tagPrefix>X.Y.Z`. |
| `release.versionFile` | `null` | JSON file with a `version` key, bumped at cut. A `releasedAt` key, if present, is set to the release date. Other keys are kept. `null` takes the version from the highest tag. |
| `release.beforeCommit` | `null` | Shell command run from the repo root during cut. Whatever it changes joins the release commit. |
| `release.stableBranch` | `null` | Branch fast-forwarded to each published release commit. `null` = off. Never `main`. |
| `commit.push` | `false` | `/doc-commit` pushes the current branch after its one confirmation. |
| `commit.verify` | `null` | Shell command that must pass before `/doc-commit` commits. |

Validation errors name the key: missing or empty `categories`, a bad id, duplicate ids, an unknown `groupBy`, an unknown key. Example:

```json
{
  "content": ["topics/**", "settings/**"],
  "categories": [
    { "id": "rule", "heading": "Rule changes", "description": "The mechanics changed." },
    { "id": "wording", "heading": "Wording", "description": "The prose changed, the meaning didn't." },
    { "id": "tooling", "heading": "Tooling", "collapsed": true }
  ],
  "areas": [{ "id": "combat", "label": "Combat", "paths": ["topics/combat*.md"] }],
  "release": { "versionFile": "version.json" },
  "commit": { "verify": "npm test" }
}
```

## The gate (`fragments.mjs check`)

The gate checks **units**, not single commits, because a task's step commits carry no fragment and only its last commit does.

- **Range**: `<start>..HEAD`. `start` is the highest semver tag `<tagPrefix>X.Y.Z`, or, with no such tag, the commit that added `doc-changelog.json`. Adopting the flow never demands backfilling all of history, and the adopting commit itself isn't checked.
- **Units**, walking `--first-parent` from HEAD:
  - A squash or direct commit on the first-parent line is a unit of one.
  - A merge commit `M` forms one unit with its side commits `M^1..M^2`. A merge never stands alone.
  - On a branch other than `main`, all of `origin/main..HEAD` is one pending unit: a task branch before its PR.
- **Covered**: any commit in the unit adds or modifies a file in `fragmentsDir` (deleting one doesn't count), or any fragment's `commit:` names one of its commits (uncommitted fragments count too), or one of its commits has a `Changelog: skip` trailer line.
- **Excluded**: every commit in the unit is a release commit (`chore: release <tagPrefix>X.Y.Z`, optionally followed by ` (#N)`) or touches no content file.

It also validates every fragment in the working tree, tracked or not. Exit 1 lists each uncovered unit as `<short hash> <subject>` lines, plus each invalid fragment. `--json` prints `{ from, missing: [{ commits: [{ hash, subject, files }] }], invalid: [{ file, error }] }`.

**Skip markers.** In PR flows, a task with nothing user-facing adds a `skip: true` fragment, because GitHub squash merges don't reliably carry trailers into the squash message. `Changelog: skip` trailers are for direct commits (`/doc-commit`'s non-content commits).

## Skills

| Skill | Use it when |
| --- | --- |
| `/doc-commit` | You have uncommitted content edits. It splits them into one commit per concern, each with its fragment, after one confirmation. |
| `/doc-changelog` | The gate flags commits made without the flow, or you want the unreleased preview (`--preview`). It drafts backfill fragments with `commit:` and asks only where the category is unclear. |
| `/doc-release` | Cutting a release, or publishing one whose PR has merged. |

snoozy's task flow writes fragments too. In a repo with `doc-changelog.json`, `branch-workflow.md`'s PR step adds the task's fragment (or a skip fragment) before opening the PR.

## Release flow (always via a PR)

1. `release.sh cut <bump>`, on `main` == `origin/main` with the gate passing (only `fragmentsDir` may be dirty: backfilled fragments ride along). It creates `release/<tagPrefix>X.Y.Z`, runs `beforeCommit`, bumps `versionFile`, runs `fragments.mjs cut`, and commits `chore: release <tagPrefix>X.Y.Z`. `fragments.mjs cut` inserts the rendered section below the first `# ` heading, copies every fragment it consumes to `<git dir>/doc-changelog-undo/`, and deletes them. Nothing is pushed. `DRY_RUN=1` prints each step and turns failed preconditions into warnings.
2. Review: `git show --stat HEAD` and `fragments.mjs notes X.Y.Z`. To revise, `release.sh --undo` (allowed while the branch is unpushed) returns to `main`, deletes the branch, and restores the backfilled fragments `main` doesn't track, uncommitted. Edit, then cut again.
3. `release.sh --open` pushes the branch and opens the PR `chore: release <tagPrefix>X.Y.Z`, with the notes as its body.
4. The user merges the PR. Fragments merged while it was open roll into the next release.
5. `release.sh --publish` finds the newest release commit on `origin/main` (subject optionally followed by ` (#N)`). If its tag isn't on origin, it tags it, pushes the tag, and creates the GitHub Release from that commit's changelog section. With `DRY_RUN=1` it only reports what it would publish: exit 0 if there is something to publish, 1 if not.

## Tuning loop

Categories and areas are yours to shape. Edit `doc-changelog.json`, run `node fragments.mjs render` (and `config.mjs show` to catch mistakes), and repeat until the preview reads right. `render` works on whatever fragments are in the tree, so draft a few throwaway ones while tuning. Renaming an id invalidates fragments that use it; the gate will list them.

## Adopting

1. Copy the closest `examples/*.json` to the content repo root as `doc-changelog.json`. `game.json` uses area-first notes for a game; `journals-rpg.json` uses category-first notes for a rules document. `/onboard` offers this.
2. Tailor `content`, `categories` and `areas`, using the tuning loop.
3. Commit it. The gate starts from this commit, or from the latest release tag if there is one.
4. From then on, commit content with `/doc-commit` (or let the task flow write fragments), and release with `/doc-release`.
