#!/usr/bin/env bash
# Release a doc-changelog repo through a PR. See changelog.md in this folder.
#
#   release.sh [--repo <dir>] cut patch|minor|major|X.Y.Z
#       on main == origin/main with the gate passing: switch to
#       release/<tagPrefix>X.Y.Z, run release.beforeCommit, bump versionFile,
#       write the CHANGELOG section from the fragments and delete them, commit
#       "chore: release <tagPrefix>X.Y.Z". Pushes nothing.
#   release.sh [--repo <dir>] --undo
#       drop an unpushed cut: back to main, delete the release branch, restore
#       the backfilled (untracked) fragments the cut consumed, uncommitted.
#   release.sh [--repo <dir>] --open
#       push the release branch and open its PR with the release notes.
#   release.sh [--repo <dir>] --publish
#       after the PR merged: tag the newest untagged release commit on
#       origin/main, push the tag, create the GitHub Release.
#
# --repo defaults to `config.mjs locate` from the current directory.
# DRY_RUN=1 prints each step and changes nothing; for cut, failed
# preconditions become warnings; for --publish, it exits 0 when there is a
# release to publish and 1 when there isn't.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DRY="${DRY_RUN:-}"

REPO=""
ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    *) ARGS+=("$1"); shift ;;
  esac
done
set -- "${ARGS[@]+"${ARGS[@]}"}"
MODE="${1:-}"
usage() { echo "Usage: release.sh [--repo <dir>] cut patch|minor|major|X.Y.Z | --undo | --open | --publish" >&2; exit 2; }
[ -n "$MODE" ] || usage

[ -n "$REPO" ] || REPO="$(node "$HERE/config.mjs" locate)"
cd "$REPO"
REPO="$(pwd)"
CFG="$(node "$HERE/config.mjs" show --repo "$REPO")"
get() { node -e 'const v = process.argv[2].split(".").reduce((o, k) => o?.[k], JSON.parse(process.argv[1])); process.stdout.write(v == null ? "" : String(v))' "$CFG" "$1"; }
PREFIX="$(get release.tagPrefix)"
VERSION_FILE="$(get release.versionFile)"
BEFORE="$(get release.beforeCommit)"
FRAG_DIR="$(get fragmentsDir)"
CHANGELOG="$(get changelog)"
UNDO="$(git rev-parse --absolute-git-dir)/doc-changelog-undo"
frag() { node "$HERE/fragments.mjs" --repo "$REPO" "$@"; }

die() { echo "Error: $1" >&2; exit 1; }
fail() { if [ -n "$DRY" ]; then echo "  WARNING (would abort): $1"; else die "$1"; fi; }
run() { if [ -n "$DRY" ]; then echo "  would run: $*"; else "$@"; fi; }

# X.Y.Z from release/<prefix>X.Y.Z, or nothing.
branch_version() {
  local b="$1"
  case "$b" in "release/$PREFIX"*) ;; *) return 0 ;; esac
  local v="${b#release/"$PREFIX"}"
  [[ "$v" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] && echo "$v"
  return 0
}

semver_cmp() { # prints <0, 0 or >0 for $1 vs $2
  node -e 'const [a, b] = process.argv.slice(1).map((v) => v.split(".").map(Number)); console.log(a[0] - b[0] || a[1] - b[1] || a[2] - b[2])' "$1" "$2"
}

current_version() {
  if [ -n "$VERSION_FILE" ] && [ -f "$VERSION_FILE" ]; then
    node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).version ?? ""))' "$VERSION_FILE"
    return
  fi
  local tag
  tag="$(node -e '
    import(process.argv[1]).then(async ({ loadConfig }) => {
      const { latestTag } = await import(process.argv[2])
      process.stdout.write(latestTag(loadConfig(process.argv[3])) ?? "")
    })' "$HERE/config.mjs" "$HERE/fragments.mjs" "$REPO")"
  if [ -n "$tag" ]; then echo "${tag#"$PREFIX"}"; else echo "0.0.0"; fi
}

# ---------- --undo ----------
if [ "$MODE" = "--undo" ]; then
  BRANCH="$(git branch --show-current)"
  VERSION="$(branch_version "$BRANCH")"
  [ -n "$VERSION" ] || die "not on a release/$PREFIX<version> branch (on ${BRANCH:-a detached HEAD})"
  git fetch --quiet origin
  [ "$(git rev-list --count origin/main..HEAD)" = "1" ] && [ "$(git rev-parse HEAD~1)" = "$(git rev-parse origin/main)" ] \
    || die "$BRANCH is not exactly one commit ahead of origin/main — not an unpushed cut"
  [ -z "$(git ls-remote --heads origin "refs/heads/$BRANCH")" ] \
    || die "$BRANCH is already pushed — close its PR and delete the remote branch to abandon it, or fix it with follow-up commits"
  echo "=== Undoing the unpushed cut of $PREFIX$VERSION"
  run git switch --quiet main
  run git branch -D --quiet "$BRANCH"
  if [ -d "$UNDO" ]; then
    for f in "$UNDO"/*.md; do
      [ -e "$f" ] || continue
      rel="$FRAG_DIR/$(basename "$f")"
      if ! git ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
        run mkdir -p "$FRAG_DIR"
        run cp "$f" "$rel"
        echo "  restored $rel (uncommitted)"
      fi
    done
    run rm -rf "$UNDO"
  fi
  echo "Done: back on main; the release branch is deleted."
  exit 0
fi

# ---------- --open ----------
if [ "$MODE" = "--open" ]; then
  BRANCH="$(git branch --show-current)"
  VERSION="$(branch_version "$BRANCH")"
  [ -n "$VERSION" ] || die "not on a release/$PREFIX<version> branch (on ${BRANCH:-a detached HEAD})"
  NOTES="$(mktemp)"
  trap 'rm -f "$NOTES"' EXIT
  frag notes "$VERSION" > "$NOTES"
  run git push --quiet -u origin "$BRANCH"
  run gh pr create --base main --head "$BRANCH" --title "chore: release $PREFIX$VERSION" --body-file "$NOTES"
  exit 0
fi

# ---------- --publish ----------
if [ "$MODE" = "--publish" ]; then
  git fetch --quiet --tags origin main
  # The newest release commit; if its tag is already on origin, there's nothing to publish.
  PREFIX_RE="$(node -e 'process.stdout.write(process.argv[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))' "$PREFIX")"
  RE="^chore: release ${PREFIX_RE}([0-9]+\.[0-9]+\.[0-9]+)( \(#[0-9]+\))?\$"
  SHA=""; VERSION=""
  while IFS=$'\t' read -r hash subject; do
    [[ "$subject" =~ $RE ]] || continue
    v="${BASH_REMATCH[1]}"
    if [ -z "$(git ls-remote --tags origin "refs/tags/$PREFIX$v")" ]; then SHA="$hash"; VERSION="$v"; fi
    break
  done < <(git log --first-parent --format=$'%H\t%s' origin/main)
  if [ -z "$SHA" ]; then
    echo "Nothing to publish: no untagged 'chore: release $PREFIX<version>' commit on origin/main newer than the last published release." >&2
    exit 1
  fi
  TAG="$PREFIX$VERSION"
  echo "=== Publishing $TAG at ${SHA:0:7}"
  if [ -n "$DRY" ]; then echo "  would tag ${SHA:0:7} as $TAG, push it and create the GitHub Release"; exit 0; fi
  if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
    [ "$(git rev-parse "$TAG^{commit}")" = "$SHA" ] || die "local tag $TAG points elsewhere"
  else
    git tag "$TAG" "$SHA"
  fi
  CL="$(mktemp)"; NOTES="$(mktemp)"
  trap 'rm -f "$CL" "$NOTES"' EXIT
  git show "$SHA:./$CHANGELOG" > "$CL"
  frag notes "$VERSION" --file "$CL" > "$NOTES"
  git push --quiet origin "refs/tags/$TAG"
  gh release create "$TAG" --title "$TAG" --notes-file "$NOTES"
  echo "Done: $TAG published."
  exit 0
fi

# ---------- cut ----------
[ "$MODE" = "cut" ] || usage
BUMP="${2:-}"
case "$BUMP" in
  patch|minor|major) ;;
  *) [[ "$BUMP" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || usage ;;
esac

echo "=== Release cut ($BUMP)${DRY:+ — DRY RUN}"
echo "[1/4] Checking preconditions..."
[ "$(git branch --show-current)" = "main" ] || fail "not on main (on $(git branch --show-current))"
DIRTY="$(git status --porcelain --untracked-files=all -- . ":(exclude)$FRAG_DIR")"
[ -z "$DIRTY" ] || fail "working tree is not clean (only $FRAG_DIR/ may have uncommitted changes):
$DIRTY"
git fetch --quiet origin
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main 2>/dev/null || true)" ] || fail "local main differs from origin/main"
frag check || fail "the changelog gate failed — run /doc-changelog to backfill fragments"

CURRENT="$(current_version)"
case "$BUMP" in
  patch|minor|major)
    NEXT="$(node -e '
      const [maj, min, pat] = process.argv[1].split(".").map(Number)
      const b = process.argv[2]
      console.log(b === "major" ? `${maj + 1}.0.0` : b === "minor" ? `${maj}.${min + 1}.0` : `${maj}.${min}.${pat + 1}`)' "$CURRENT" "$BUMP")" ;;
  *) NEXT="$BUMP"
     [ "$(semver_cmp "$NEXT" "$CURRENT")" -gt 0 ] || fail "$NEXT is not greater than the current version $CURRENT" ;;
esac
TAG="$PREFIX$NEXT"
BRANCH="release/$TAG"
TODAY="$(date +%F)"
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then fail "tag $TAG already exists"; fi
if git rev-parse -q --verify "refs/heads/$BRANCH" >/dev/null; then fail "branch $BRANCH already exists"; fi

echo "[2/4] $CURRENT -> $NEXT ($TODAY) on $BRANCH..."
run git switch --quiet -c "$BRANCH"
if [ -n "$BEFORE" ]; then
  if [ -n "$DRY" ]; then echo "  would run (beforeCommit): $BEFORE"; else bash -c "$BEFORE"; fi
fi
if [ -n "$VERSION_FILE" ]; then
  if [ -n "$DRY" ]; then echo "  would set $VERSION_FILE version to $NEXT"; else
    node -e '
      const fs = require("fs"); const [file, version, today] = process.argv.slice(1)
      const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {}
      data.version = version
      if ("releasedAt" in data) data.releasedAt = today
      fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n")' "$VERSION_FILE" "$NEXT" "$TODAY"
  fi
fi

echo "[3/4] Writing $CHANGELOG..."
if [ -n "$DRY" ]; then
  echo "  would write this section and delete the fragments:"
  frag render --version "$NEXT" --date "$TODAY" | sed 's/^/    /'
else
  frag cut "$NEXT" "$TODAY"
fi

echo "[4/4] Committing (local only)..."
run git add -A -- .
run git commit --quiet -m "chore: release $TAG"

if [ -n "$DRY" ]; then echo "Dry run: nothing changed."; exit 0; fi
echo "Cut: $TAG is committed on $BRANCH; nothing is pushed. Review it (git show --stat HEAD), then:"
echo "  release.sh --open   # push the branch and open the release PR"
echo "  release.sh --undo   # drop the cut"
