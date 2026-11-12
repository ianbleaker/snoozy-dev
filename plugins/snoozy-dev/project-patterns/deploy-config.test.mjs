import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'deploy-config.sh')
const VARS = ['DEPLOY_HOST', 'REMOTE_PATH', 'PREVIEW_PATH', 'DEPLOY_USER', 'PREVIEW_DEPLOY_USER', 'PREVIEW_URL', 'PREVIEW_CHECK']

// A fake `ssh` on PATH: `-G` prints a documentation-range hostname, or
// fails when sshExit is nonzero.
function fakeSshDir(sshExit = 0) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-config-bin-'))
  const body = sshExit
    ? `#!/bin/sh\nexit ${sshExit}\n`
    : '#!/bin/sh\n[ "$1" = "-G" ] && { echo "user someone"; echo "hostname 203.0.113.5"; exit 0; }\nexit 2\n'
  fs.writeFileSync(path.join(dir, 'ssh'), body, { mode: 0o755 })
  return dir
}

// Runs deploy-config.sh on a project dir holding `claudeMd` (none when
// null), then evals its output in bash and reads each var back, so values
// are checked after the real `eval` round trip.
function run(claudeMd, { sshExit = 0 } = {}) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-config-proj-'))
  if (claudeMd !== null) fs.writeFileSync(path.join(proj, 'CLAUDE.md'), claudeMd)
  const env = { ...process.env, PATH: `${fakeSshDir(sshExit)}:${process.env.PATH}` }
  const script = `set -e; out="$("$1" "$2")"; eval "$out"; ${VARS.map((v) => `printf '%s\\0' "$${v}"`).join('; ')}`
  const res = spawnSync('bash', ['-c', script, 'bash', SCRIPT, proj], { encoding: 'utf8', env })
  const values = res.stdout.split('\0').slice(0, VARS.length)
  const vars = Object.fromEntries(VARS.map((v, i) => [v, values[i] ?? '']))
  return { status: res.status, stderr: res.stderr, vars }
}

const LIST_FORM = `# Proj

## Deploy
- Host: my-deploy-host
- Remote path: /opt/app
- Preview URL: http://{host}:8081
- Preview check: node .claude/skills/smoke-test/preview-sense.mjs {url}

## Next
`

test('all lines in the - Key: list form', () => {
  const { status, vars } = run(LIST_FORM)
  assert.equal(status, 0)
  assert.deepEqual(vars, {
    DEPLOY_HOST: 'my-deploy-host',
    REMOTE_PATH: '/opt/app',
    PREVIEW_PATH: '/opt/app-preview',
    DEPLOY_USER: 'app-deployer',
    PREVIEW_DEPLOY_USER: 'app-preview-deployer',
    PREVIEW_URL: 'http://203.0.113.5:8081',
    PREVIEW_CHECK: 'node .claude/skills/smoke-test/preview-sense.mjs {url}',
  })
})

test('the same lines in the legacy bare Key: form', () => {
  const { status, vars } = run(LIST_FORM.replace(/^- /gm, ''))
  assert.equal(status, 0)
  assert.equal(vars.DEPLOY_HOST, 'my-deploy-host')
  assert.equal(vars.REMOTE_PATH, '/opt/app')
  assert.equal(vars.PREVIEW_URL, 'http://203.0.113.5:8081')
  assert.equal(vars.PREVIEW_CHECK, 'node .claude/skills/smoke-test/preview-sense.mjs {url}')
})

test('joined lines exit 1 with the joined-lines message', () => {
  const { status, stderr } = run('## Deploy\nHost: h Remote path: /opt/x\n')
  assert.equal(status, 1)
  assert.match(stderr, /were joined onto one line; rewrite them as '- Key: value' list items/)
})

test('no Preview path: derives it from Remote path:', () => {
  const { vars } = run('## Deploy\n- Host: h\n- Remote path: /srv/thing\n')
  assert.equal(vars.PREVIEW_PATH, '/srv/thing-preview')
  assert.equal(vars.PREVIEW_DEPLOY_USER, 'thing-preview-deployer')
})

test('a Preview path: override', () => {
  const { vars } = run('## Deploy\n- Host: h\n- Remote path: /opt/app\n- Preview path: /opt/staging-app\n')
  assert.equal(vars.PREVIEW_PATH, '/opt/staging-app')
  assert.equal(vars.PREVIEW_DEPLOY_USER, 'staging-app-deployer')
  assert.equal(vars.DEPLOY_USER, 'app-deployer')
})

test('deployer names for /opt/app, with and without a trailing /', () => {
  for (const p of ['/opt/app', '/opt/app/']) {
    const { vars } = run(`## Deploy\n- Host: h\n- Remote path: ${p}\n`)
    assert.equal(vars.DEPLOY_USER, 'app-deployer', p)
    assert.equal(vars.PREVIEW_DEPLOY_USER, 'app-preview-deployer', p)
  }
})

test('{host} resolves from ssh -G', () => {
  const { vars } = run('## Deploy\n- Host: h\n- Preview URL: http://{host}:9000/{host}\n')
  assert.equal(vars.PREVIEW_URL, 'http://203.0.113.5:9000/203.0.113.5')
})

test('a literal URL without {host} passes through unchanged', () => {
  const { vars, stderr } = run('## Deploy\n- Host: h\n- Preview URL: http://203.0.113.9:8081\n')
  assert.equal(vars.PREVIEW_URL, 'http://203.0.113.9:8081')
  assert.equal(stderr, '')
})

test('{host} with ssh -G failing: PREVIEW_URL empty, warning on stderr', () => {
  const { status, vars, stderr } = run('## Deploy\n- Host: h\n- Preview URL: http://{host}:8081\n', { sshExit: 1 })
  assert.equal(status, 0)
  assert.equal(vars.PREVIEW_URL, '')
  assert.match(stderr, /can't resolve \{host\}/)
})

test('no CLAUDE.md: every var empty, exit 0', () => {
  const { status, vars } = run(null)
  assert.equal(status, 0)
  for (const v of VARS) assert.equal(vars[v], '', v)
})

test('a Host: line under a later heading is ignored', () => {
  const { vars } = run('## Deploy\n- Remote path: /opt/app\n\n## Other\nHost: not-this-one\n')
  assert.equal(vars.DEPLOY_HOST, '')
  assert.equal(vars.REMOTE_PATH, '/opt/app')
})

test('a Preview check: value with spaces and quotes survives eval', () => {
  const check = `node "a b.mjs" --flag 'x y' {url}`
  const { vars } = run(`## Deploy\n- Host: h\n- Preview check: ${check}\n`)
  assert.equal(vars.PREVIEW_CHECK, check)
})
