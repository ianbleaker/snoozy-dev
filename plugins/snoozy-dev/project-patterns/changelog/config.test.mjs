import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { HERE, makeRepo, tmpDir } from './testutil.mjs'
import { ConfigError, githubCommitUrl, isContent, loadConfig, locateConfig, validateConfig } from './config.mjs'

const CATS = [{ id: 'fixes', heading: 'Fixes' }]
const v = (raw) => validateConfig(raw, tmpDir())

test('defaults', () => {
  const cfg = v({ categories: CATS })
  assert.deepEqual(cfg.content, ['**'])
  assert.deepEqual(cfg.ignore, [])
  assert.equal(cfg.fragmentsDir, 'changes')
  assert.equal(cfg.changelog, 'CHANGELOG.md')
  assert.deepEqual(cfg.categories, [{ id: 'fixes', heading: 'Fixes', description: null, collapsed: false }])
  assert.deepEqual(cfg.areas, [])
  assert.equal(cfg.groupBy, 'category')
  assert.equal(cfg.commitUrl, null)
  assert.deepEqual(cfg.release, { tagPrefix: 'v', versionFile: null, beforeCommit: null })
  assert.deepEqual(cfg.commit, { push: false, verify: null })
})

test('validation errors name the key', () => {
  const cases = [
    [{}, /`categories` is required/],
    [{ categories: [] }, /`categories` is required/],
    [{ categories: [{ id: 'Bad Id', heading: 'X' }] }, /`categories\[0\]\.id` must match/],
    [{ categories: [{ id: 'a', heading: 'A' }, { id: 'a', heading: 'B' }] }, /duplicate `categories` id "a"/],
    [{ categories: CATS, areas: [{ id: 'x', label: 'X' }, { id: 'x', label: 'Y' }] }, /duplicate `areas` id "x"/],
    [{ categories: CATS, areas: [{ id: 'x_y', label: 'X' }] }, /`areas\[0\]\.id` must match/],
    [{ categories: CATS, groupBy: 'page' }, /unknown `groupBy` "page"/],
    [{ categories: CATS, colour: 'red' }, /unknown key `colour`/],
    [{ categories: CATS, release: { prefix: 'v' } }, /unknown key `release\.prefix`/],
    [{ categories: [{ id: 'a' }] }, /`categories\[0\]\.heading` is required/],
  ]
  for (const [raw, re] of cases) assert.throws(() => v(raw), (e) => e instanceof ConfigError && re.test(e.message), JSON.stringify(raw))
})

test('CLI exits 1 naming the key on an invalid config', () => {
  const { dir } = makeRepo()
  fs.writeFileSync(path.join(dir, 'doc-changelog.json'), JSON.stringify({ categories: CATS, groupBy: 'x' }))
  const res = spawnSync('node', [path.join(HERE, 'config.mjs'), 'show', '--repo', dir], { encoding: 'utf8' })
  assert.equal(res.status, 1)
  assert.match(res.stderr, /`groupBy`/)
})

test('GitHub commit URL from ssh and https origins', () => {
  const want = 'https://github.com/o/r/commit/{hash}'
  assert.equal(githubCommitUrl('git@github.com:o/r.git'), want)
  assert.equal(githubCommitUrl('ssh://git@github.com/o/r.git'), want)
  assert.equal(githubCommitUrl('https://github.com/o/r.git'), want)
  assert.equal(githubCommitUrl('https://github.com/o/r'), want)
  assert.equal(githubCommitUrl('https://gitlab.com/o/r.git'), null)
  const { dir, git } = makeRepo()
  git('remote', 'add', 'origin', 'git@github.com:o/r.git')
  fs.writeFileSync(path.join(dir, 'doc-changelog.json'), JSON.stringify({ categories: CATS }))
  assert.equal(loadConfig(dir).commitUrl, want)
})

test('isContent excludes the fixed non-content files and ignore globs', () => {
  const cfg = v({ categories: CATS, content: ['topics/**', 'README.md'], ignore: ['topics/drafts/**'], release: { versionFile: 'version.json' } })
  assert.equal(isContent(cfg, 'topics/a.md'), true)
  assert.equal(isContent(cfg, 'README.md'), true)
  assert.equal(isContent(cfg, 'tools/x.mjs'), false)
  assert.equal(isContent(cfg, 'topics/drafts/x.md'), false)
  const all = v({ categories: CATS, release: { versionFile: 'version.json' } })
  for (const f of ['changes/a.md', 'CHANGELOG.md', 'doc-changelog.json', 'version.json']) assert.equal(isContent(all, f), false, f)
  assert.equal(isContent(all, 'deep/nested/file.md'), true)
})

test('locate: toplevel, one nested match, several, none', () => {
  const { dir } = makeRepo()
  assert.throws(() => locateConfig(dir), /no doc-changelog\.json .*changelog\.md/)
  fs.mkdirSync(path.join(dir, 'a/rules'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'a/rules/doc-changelog.json'), '{}')
  assert.equal(fs.realpathSync(locateConfig(dir)), fs.realpathSync(path.join(dir, 'a/rules')))
  fs.mkdirSync(path.join(dir, 'b'))
  fs.writeFileSync(path.join(dir, 'b/doc-changelog.json'), '{}')
  assert.throws(() => locateConfig(dir), /several doc-changelog\.json/)
  fs.mkdirSync(path.join(dir, 'node_modules/x'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'doc-changelog.json'), '{}')
  assert.equal(fs.realpathSync(locateConfig(path.join(dir, 'b'))), fs.realpathSync(dir))
})

test('locate ignores node_modules and anything deeper than 3 levels', () => {
  const { dir } = makeRepo()
  fs.mkdirSync(path.join(dir, 'node_modules/p'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'node_modules/p/doc-changelog.json'), '{}')
  fs.mkdirSync(path.join(dir, 'a/b/c'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'a/b/c/doc-changelog.json'), '{}')
  assert.throws(() => locateConfig(dir), /no doc-changelog\.json/)
})
