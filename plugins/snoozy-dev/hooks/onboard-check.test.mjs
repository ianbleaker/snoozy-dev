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

const PATTERNS = path.join(HERE, '..', 'project-patterns')
const DEPLOY_FILES = ['deploy-conventions.json', 'deploy-convention.mjs', 'deploy-config.sh']

// A temp plugin root with `manifest` as the onboard schema. `deploy`: also
// copy the deploy-convention files into <root>/project-patterns/, with
// `registry` (when given) replacing the shipped deploy-conventions.json.
function pluginRoot(manifest, { deploy = false, registry } = {}) {
  const root = tmpDir('onboard-root-')
  fs.mkdirSync(path.join(root, 'skills', 'onboard'), { recursive: true })
  fs.writeFileSync(path.join(root, 'skills', 'onboard', 'schema.json'), JSON.stringify(manifest))
  if (deploy) {
    fs.mkdirSync(path.join(root, 'project-patterns'))
    for (const f of DEPLOY_FILES) fs.copyFileSync(path.join(PATTERNS, f), path.join(root, 'project-patterns', f))
    if (registry) fs.writeFileSync(path.join(root, 'project-patterns', 'deploy-conventions.json'), JSON.stringify(registry))
  }
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

function repo({ origin = ORIGIN, config, files = {} } = {}) {
  const r = makeRepo()
  if (origin) r.git('remote', 'add', 'origin', origin)
  if (config !== undefined) fs.writeFileSync(path.join(r.dir, '.snoozy-dev.json'), typeof config === 'string' ? config : JSON.stringify(config))
  for (const [rel, text] of Object.entries(files)) r.write(rel, text)
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

// --- deploy convention check ---

const REG = {
  'vps-systemd': { version: 3, migrations: { 1: ['initial'], 2: ['note two a', 'note two b'], 3: ['note three'] } },
}
const deployRoot = (registry = REG) => pluginRoot(V1, { deploy: true, registry })
const deployMd = (line) => `# Proj\n\n## Deploy\n- Host: h\n- Remote path: /opt/proj\n${line ? `${line}\n` : ''}`
const V1_FILES = { 'deploy/setup.sh': 'useradd app\n', 'deploy/app.service': '[Unit]\n' }
const V2_FILES = { 'deploy/setup.sh': 'install -m 0440 "$t" /etc/sudoers.d/app\n', 'deploy/app.service': '[Unit]\n' }
// A repo with onboarding silent (stamp current), `## Deploy` holding `line`.
const deployRepo = (line, files = V2_FILES, stamp = 2) =>
  repo({ config: { onboardSchema: stamp }, files: { 'CLAUDE.md': deployMd(line), ...files } })

test('deploy: behind lists the notes from version+1, with the decline command', () => {
  const root = deployRoot()
  const data = tmpDir('onboard-data-')
  const out = check(deployRepo('- Convention: vps-systemd@1', V1_FILES).dir, { root, data })
  assert.match(out, /records deploy convention vps-systemd@1, and the current version is 3\. Migration notes:\n- note two a\n- note two b\n- note three\nOffer the user, once this session, to file a draft migration issue in this repo with \/snoozy-dev:log-task/)
  assert.doesNotMatch(out, /- initial/)
  assert.ok(out.includes(`--decline "${ORIGIN}#deploy-migrate:vps-systemd@3" --data-dir "${data}"`), out)
  assert.doesNotMatch(out, /drifted/)
})

test('deploy: current version is silent', () => {
  assert.equal(check(deployRepo('- Convention: vps-systemd@2').dir, { root: deployRoot({ 'vps-systemd': { version: 2, migrations: {} } }) }), '')
})

test('deploy: a recorded version ahead of the registry is silent', () => {
  assert.equal(check(deployRepo('- Convention: vps-systemd@9').dir, { root: deployRoot() }), '')
})

test('deploy: none without vps files is silent', () => {
  assert.equal(check(deployRepo('- Convention: none', { Dockerfile: 'FROM x\n' }).dir, { root: deployRoot() }), '')
})

test('deploy: none with vps files flags now-vps', () => {
  const data = tmpDir('onboard-data-')
  const out = check(deployRepo('- Convention: none').dir, { root: deployRoot(), data })
  assert.match(out, /drifted from the `- Convention:` line in its `## Deploy` section:\n- The `## Deploy` section records `none`, but `deploy\/` now follows vps-systemd\. Detected from the files: vps-systemd@2\./)
  assert.ok(out.includes(`--decline "${ORIGIN}#deploy-drift:now-vps"`), out)
})

test('deploy: a vps record with a Dockerfile flags other-platform', () => {
  const root = deployRoot({ 'vps-systemd': { version: 2, migrations: {} } })
  const out = check(deployRepo('- Convention: vps-systemd@2', { ...V2_FILES, Dockerfile: '' }).dir, { root })
  assert.match(out, /records vps-systemd, but `Dockerfile` exists at the repo root\./)
  assert.ok(out.includes('#deploy-drift:other-platform:Dockerfile"'), out)
})

test('deploy: unrecorded is flagged at onboard stamp 2, silent at stamp 1', () => {
  const root = deployRoot()
  assert.match(check(deployRepo('', V2_FILES, 2).dir, { root }), /has no `- Convention:` line, but `deploy\/` follows vps-systemd\. Detected from the files: vps-systemd@2\./)
  assert.equal(check(deployRepo('', V2_FILES, 1).dir, { root }), '')
})

test('deploy: a migration decline silences only that paragraph', () => {
  const root = deployRoot()
  const data = tmpDir('onboard-data-')
  const r = deployRepo('- Convention: vps-systemd@1', { ...V1_FILES, 'fly.toml': '' })
  const before = check(r.dir, { root, data })
  assert.match(before, /Migration notes/)
  assert.match(before, /`fly\.toml` exists/)
  assert.equal(declineCli(`${ORIGIN}#deploy-migrate:vps-systemd@3`, data).status, 0)
  const after = check(r.dir, { root, data })
  assert.doesNotMatch(after, /Migration notes/)
  assert.match(after, /`fly\.toml` exists/)
})

test('deploy: joined lines silence the deploy check, onboarding still prints', () => {
  const r = repo({ files: { 'CLAUDE.md': '## Deploy\n- Host: h Convention: vps-systemd@1\n', ...V1_FILES } })
  const out = check(r.dir, { root: deployRoot() })
  assert.match(out, /isn't set up for snoozy-dev/)
  assert.doesNotMatch(out, /deploy convention|drifted/)
})

test('deploy: onboarding and deploy paragraphs together', () => {
  const r = repo({ config: { onboardSchema: 0 }, files: { 'CLAUDE.md': deployMd('- Convention: vps-systemd@1'), ...V1_FILES } })
  const out = check(r.dir, { root: deployRoot() })
  assert.match(out, /on onboard schema 0 and the plugin is on 1\.[\s\S]*\n\nsnoozy-dev: this repo's `## Deploy` section records deploy convention vps-systemd@1/)
})

test('deploy: the shipped registry and messages stay Claude-free', () => {
  const out = check(deployRepo('- Convention: vps-systemd@1', { ...V1_FILES, Dockerfile: '' }).dir, { root: pluginRoot(V1, { deploy: true }) })
  assert.match(out, /Migration notes/)
  const text = out.split('\n').filter((l) => !l.startsWith('If the user declines')).join('\n')
  assert.doesNotMatch(text, /claude|anthropic/i)
})
