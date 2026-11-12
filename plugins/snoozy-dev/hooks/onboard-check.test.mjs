import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
// Scrubs GIT_* and isolates git config (tests may run under pre-commit).
import { makeRepo, tmpDir } from '../project-patterns/testutil.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const CHECK = path.join(HERE, 'onboard-check.mjs')
const ORIGIN = 'git@github.com:someone/proj.git'

function pluginRoot(manifest) {
  const root = tmpDir('onboard-root-')
  fs.mkdirSync(path.join(root, 'skills', 'onboard'), { recursive: true })
  fs.writeFileSync(path.join(root, 'skills', 'onboard', 'schema.json'), JSON.stringify(manifest))
  return root
}
const V1 = { schema: 1, changes: { 1: ['first'] } }
const V3 = { schema: 3, changes: { 1: ['one'], 2: ['two a', 'two b'], 3: ['three'] } }

function check(dir, { source = 'startup', root = pluginRoot(V1), data = tmpDir('onboard-data-') } = {}) {
  const env = { ...process.env, CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: root }
  if (data === null) delete env.CLAUDE_PLUGIN_DATA
  else env.CLAUDE_PLUGIN_DATA = data
  const r = spawnSync('node', [CHECK], { input: JSON.stringify({ source, cwd: dir }), env, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout
}
const declineCli = (origin, data) => spawnSync('node', [CHECK, '--decline', origin, '--data-dir', data], { encoding: 'utf8' })

function repo({ origin = ORIGIN, config } = {}) {
  const r = makeRepo()
  if (origin) r.git('remote', 'add', 'origin', origin)
  if (config !== undefined) fs.writeFileSync(path.join(r.dir, '.snoozy-dev.json'), typeof config === 'string' ? config : JSON.stringify(config))
  return r
}

test('silent: source is not startup', () => {
  for (const source of ['resume', 'clear', 'compact', 'fork']) assert.equal(check(repo().dir, { source }), '')
})

test('silent: not a git repo', () => {
  assert.equal(check(tmpDir('onboard-nogit-')), '')
})

test('silent: no origin, or origin not on github.com', () => {
  assert.equal(check(repo({ origin: null }).dir), '')
  assert.equal(check(repo({ origin: 'https://gitlab.com/a/b.git' }).dir), '')
})

test('silent: stamp current or ahead', () => {
  assert.equal(check(repo({ config: { onboardSchema: 1 } }).dir), '')
  assert.equal(check(repo({ config: { onboardSchema: 2 } }).dir), '')
})

test('no config: offers onboard, with the decline command', () => {
  const root = pluginRoot(V1)
  const data = tmpDir('onboard-data-')
  const out = check(repo().dir, { root, data })
  assert.match(out, /isn't set up for snoozy-dev \(no \.snoozy-dev\.json\)/)
  assert.match(out, /run \/snoozy-dev:onboard; it verifies any existing setup rather than redoing it/)
  assert.ok(out.includes(`node "${path.join(root, 'hooks', 'onboard-check.mjs')}" --decline "${ORIGIN}" --data-dir "${data}"`), out)
})

test('behind: lists every change from stamp+1 to the plugin schema', () => {
  const out = check(repo({ config: { onboardSchema: 1 } }).dir, { root: pluginRoot(V3) })
  assert.match(out, /on onboard schema 1 and the plugin is on 3\. What changed:\n- two a\n- two b\n- three\nOffer the user, once this session, to run \/snoozy-dev:onboard to upgrade\./)
  assert.doesNotMatch(out, /- one/)
})

test('invalid: bad JSON or no integer stamp', () => {
  assert.match(check(repo({ config: '{ nope' }).dir), /\.snoozy-dev\.json is invalid \(.+\)\. Offer the user, once this session, to run \/snoozy-dev:onboard/)
  assert.match(check(repo({ config: { verify: {} } }).dir), /is invalid \(no integer `onboardSchema`\)/)
})

test('no CLAUDE_PLUGIN_DATA: offer without the decline sentence', () => {
  const out = check(repo().dir, { data: null })
  assert.match(out, /snoozy-dev:onboard/)
  assert.doesNotMatch(out, /--decline/)
})

test('--decline creates the file, stays idempotent, and silences that origin', () => {
  const data = path.join(tmpDir('onboard-data-'), 'nested')
  let r = declineCli(ORIGIN, data)
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, `Declined onboarding for ${ORIGIN}.\n`)
  r = declineCli(ORIGIN, data)
  assert.equal(r.status, 0)
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(data, 'onboard-declined.json'), 'utf8')), [ORIGIN])
  assert.equal(check(repo().dir, { data }), '')
  assert.match(check(repo({ origin: 'https://github.com/other/repo.git' }).dir, { data }), /snoozy-dev:onboard/)
})
