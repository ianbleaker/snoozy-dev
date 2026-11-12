import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { BASIC, HERE, fragment, makeRepo } from './testutil.mjs'

const CONFIG = { ...BASIC, release: { versionFile: 'version.json', beforeCommit: 'echo built > build.txt' } }

// A clone of a bare origin: config + version.json tagged v1.0.0, then one
// content commit with its fragment, all pushed. `gh` is a stub that logs.
function setup(config = CONFIG) {
  const r = makeRepo({ origin: true })
  r.commit('chore: init', { 'doc-changelog.json': JSON.stringify(config), 'version.json': '{ "version": "1.0.0", "releasedAt": "2026-01-01" }\n' })
  r.git('tag', 'v1.0.0')
  r.commit('feat: wolves', { 'mobs/wolf.md': 'grr', 'changes/wolves.md': fragment({ category: 'mechanics', area: 'wolves' }, 'Wolves arrive.') })
  r.git('push', '-q', 'origin', 'main', 'v1.0.0')
  const bin = path.join(r.base, 'bin')
  fs.mkdirSync(bin)
  fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh
echo "$@" >> "${r.base}/gh.log"
for a in "$@"; do case "$prev" in --notes-file|--body-file) cp "$a" "${r.base}/notes.md";; esac; prev="$a"; done
[ "$1 $2" = "pr create" ] && echo "https://github.com/o/r/pull/7"
exit 0
`, { mode: 0o755 })
  const release = (args, env = {}) => spawnSync('bash', [path.join(HERE, 'release.sh'), '--repo', r.dir, ...args], {
    cwd: r.base, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...env },
  })
  const originGit = (...args) => execFileSync('git', ['--git-dir', r.origin, ...args], { encoding: 'utf8' }).trim()
  const read = (rel) => fs.readFileSync(path.join(r.dir, rel), 'utf8')
  const ghLog = () => (fs.existsSync(path.join(r.base, 'gh.log')) ? fs.readFileSync(path.join(r.base, 'gh.log'), 'utf8') : '')
  return { ...r, release, originGit, read, ghLog }
}
const ok = (res) => assert.equal(res.status, 0, res.stdout + res.stderr)
const refuses = (res, re) => { assert.notEqual(res.status, 0, res.stdout); assert.match(res.stdout + res.stderr, re) }

test('cut: release branch, version bump, section written, fragments gone, beforeCommit output included, nothing pushed', () => {
  const s = setup()
  ok(s.release(['cut', 'minor']))
  assert.equal(s.git('branch', '--show-current'), 'release/v1.1.0')
  assert.equal(s.git('log', '-1', '--format=%s'), 'chore: release v1.1.0')
  assert.equal(s.git('status', '--porcelain'), '')
  const v = JSON.parse(s.read('version.json'))
  assert.equal(v.version, '1.1.0')
  assert.match(v.releasedAt, /^\d{4}-\d\d-\d\d$/)
  assert.notEqual(v.releasedAt, '2026-01-01')
  assert.match(s.read('CHANGELOG.md'), /^# Changelog\n\n## v1\.1\.0 — \d{4}-\d\d-\d\d\n### Mechanics\n- Wolves arrive\. \(Wolves\)/)
  assert.equal(fs.existsSync(path.join(s.dir, 'changes/wolves.md')), false)
  assert.match(s.git('show', '--stat', '--format=', 'HEAD'), /build\.txt/)
  assert.equal(s.originGit('branch', '--list', 'release/*'), '')
  assert.deepEqual(s.originGit('tag').split('\n'), ['v1.0.0'])
})

test('cut: each precondition failure', () => {
  let s = setup()
  s.git('switch', '-q', '-c', 'other')
  refuses(s.release(['cut', 'patch']), /not on main/)

  s = setup()
  s.write('mobs/wolf.md', 'edited')
  refuses(s.release(['cut', 'patch']), /working tree is not clean/)

  s = setup()
  s.write('changes/extra.md', fragment({ category: 'fixes' }, 'Uncommitted fragments are fine.'))
  ok(s.release(['cut', 'patch']))

  s = setup()
  s.commit('feat: local only', { 'zones/a.md': 'a', 'changes/a.md': fragment({ category: 'fixes' }) })
  refuses(s.release(['cut', 'patch']), /local main differs from origin\/main/)

  s = setup()
  s.commit('feat: no fragment', { 'zones/a.md': 'a' })
  s.git('push', '-q', 'origin', 'main')
  refuses(s.release(['cut', 'patch']), /gate failed/)

  s = setup()
  refuses(s.release(['cut', '1.0.0']), /not greater than the current version 1\.0\.0/)
})

test('DRY_RUN changes nothing and turns failures into warnings', () => {
  const s = setup()
  s.write('mobs/wolf.md', 'edited')
  const head = s.git('rev-parse', 'HEAD')
  const res = s.release(['cut', 'patch'], { DRY_RUN: '1' })
  ok(res)
  assert.match(res.stdout, /WARNING \(would abort\): working tree is not clean/)
  assert.match(res.stdout, /would run: git switch --quiet -c release\/v1\.0\.1/)
  assert.match(res.stdout, /## v1\.0\.1 — /)
  assert.equal(s.git('rev-parse', 'HEAD'), head)
  assert.equal(s.git('branch', '--show-current'), 'main')
  assert.equal(s.git('status', '--porcelain'), 'M mobs/wolf.md')
  assert.equal(JSON.parse(s.read('version.json')).version, '1.0.0')
  assert.equal(fs.existsSync(path.join(s.dir, 'changes/wolves.md')), true)
})

test('cut consumes an untracked backfilled fragment; undo restores main and that fragment, uncommitted', () => {
  const s = setup()
  const late = s.commit('feat: no fragment', { 'zones/a.md': 'a' })
  s.git('push', '-q', 'origin', 'main')
  const main = s.git('rev-parse', 'HEAD')
  s.write('changes/backfill.md', fragment({ category: 'fixes', commit: late }, 'Backfilled.'))
  ok(s.release(['cut', 'patch']))
  assert.equal(fs.existsSync(path.join(s.dir, 'changes/backfill.md')), false)
  assert.match(s.read('CHANGELOG.md'), new RegExp(`- Backfilled\\. \\[\`${late.slice(0, 7)}\`\\]`))

  ok(s.release(['--undo']))
  assert.equal(s.git('branch', '--show-current'), 'main')
  assert.equal(s.git('rev-parse', 'HEAD'), main)
  assert.equal(s.git('branch', '--list', 'release/*'), '')
  assert.equal(s.git('status', '--porcelain'), '?? changes/backfill.md')
  assert.equal(fs.existsSync(path.join(s.dir, 'changes/wolves.md')), true)
  assert.equal(fs.existsSync(path.join(s.dir, '.git/doc-changelog-undo')), false)
  ok(s.release(['cut', 'patch'])) // and it can be cut again
})

test('open pushes the branch and opens the PR with the notes; undo then refuses', () => {
  const s = setup()
  ok(s.release(['cut', 'patch']))
  const res = s.release(['--open'])
  ok(res)
  assert.match(res.stdout, /https:\/\/github\.com\/o\/r\/pull\/7/)
  assert.equal(s.originGit('rev-parse', 'release/v1.0.1'), s.git('rev-parse', 'HEAD'))
  assert.match(s.ghLog(), /^pr create --base main --head release\/v1\.0\.1 --title chore: release v1\.0\.1 --body-file /)
  assert.match(fs.readFileSync(path.join(s.base, 'notes.md'), 'utf8'), /^### Mechanics\n- Wolves arrive\./)
  refuses(s.release(['--undo']), /already pushed/)
})

test('undo refuses off a release branch', () => {
  refuses(setup().release(['--undo']), /not on a release\/v<version> branch/)
})

for (const suffix of ['', ' (#7)']) {
  test(`publish tags the merged release commit${suffix ? ' (squash subject)' : ''} and creates the GitHub Release; refuses when already tagged`, () => {
    const s = setup()
    ok(s.release(['cut', 'patch']))
    // simulate the PR merge on origin
    s.git('commit', '-q', '--amend', '-m', `chore: release v1.0.1${suffix}`)
    const merged = s.git('rev-parse', 'HEAD')
    s.git('push', '-q', 'origin', 'HEAD:main')
    s.git('switch', '-q', 'main')
    ok(s.release(['--publish'], { DRY_RUN: '1' }))
    ok(s.release(['--publish']))
    assert.equal(s.originGit('rev-parse', 'v1.0.1^{commit}'), merged)
    assert.match(s.ghLog(), /^release create v1\.0\.1 --title v1\.0\.1 --notes-file /m)
    assert.match(fs.readFileSync(path.join(s.base, 'notes.md'), 'utf8'), /^### Mechanics\n- Wolves arrive\./)
    refuses(s.release(['--publish']), /Nothing to publish/)
    refuses(s.release(['--publish'], { DRY_RUN: '1' }), /Nothing to publish/)
  })
}

test('publish with release.stableBranch creates the branch at the release commit, then fast-forwards it', () => {
  const s = setup({ ...CONFIG, release: { ...CONFIG.release, stableBranch: 'stable' } })
  const merge = () => {
    ok(s.release(['cut', 'patch']))
    s.git('push', '-q', 'origin', 'HEAD:main')
    const sha = s.git('rev-parse', 'HEAD')
    s.git('switch', '-q', 'main')
    s.git('merge', '-q', '--ff-only', 'origin/main')
    return sha
  }
  const first = merge()
  const dry = s.release(['--publish'], { DRY_RUN: '1' })
  ok(dry)
  assert.match(dry.stdout, /and fast-forward stable/)
  assert.equal(s.originGit('branch', '--list', 'stable'), '')
  ok(s.release(['--publish']))
  assert.equal(s.originGit('rev-parse', 'stable'), first)

  s.commit('feat: bears', { 'mobs/bear.md': 'roar', 'changes/bears.md': fragment({ category: 'mechanics', area: 'wolves' }, 'Bears arrive.') })
  s.git('push', '-q', 'origin', 'main')
  const second = merge()
  ok(s.release(['--publish']))
  assert.equal(s.originGit('rev-parse', 'v1.0.2^{commit}'), second)
  assert.equal(s.originGit('rev-parse', 'stable'), second)
})
