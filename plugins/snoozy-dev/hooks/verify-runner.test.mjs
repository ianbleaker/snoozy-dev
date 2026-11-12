import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
// Scrubs GIT_* and isolates git config (tests may run under pre-commit).
import { makeRepo } from '../project-patterns/changelog/testutil.mjs'

const RUNNER = path.join(path.dirname(new URL(import.meta.url).pathname), 'verify-runner.mjs')

function env() {
  const e = { ...process.env }
  for (const k of ['CLAUDE_PROJECT_DIR', 'CLAUDE_PLUGIN_ROOT', 'CLAUDE_PLUGIN_DATA']) delete e[k]
  return e
}

// Runs the runner; returns parsed stdout JSON, or null when silent.
function runner(mode, dir, input = {}) {
  const r = spawnSync('node', [RUNNER, mode], { input: JSON.stringify({ cwd: dir, ...input }), env: { ...env(), CLAUDE_PROJECT_DIR: dir }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return r.stdout.trim() === '' ? null : JSON.parse(r.stdout)
}

const repo = (verify) => {
  const r = makeRepo()
  if (verify !== undefined) r.commit('chore: config', { '.snoozy-dev.json': JSON.stringify({ onboardSchema: 1, verify }) })
  return r
}
const edited = (file) => ({ tool_name: 'Edit', tool_input: { file_path: file } })

test('no config: silent in both modes', () => {
  const r = repo()
  fs.writeFileSync(path.join(r.dir, 'x'), 'dirty')
  assert.equal(runner('edit', r.dir, edited('a.sh')), null)
  assert.equal(runner('stop', r.dir), null)
})

test('edit: matching entry that passes is silent', () => {
  const r = repo({ edit: [{ pattern: '\\.sh$', command: 'true' }] })
  assert.equal(runner('edit', r.dir, edited('a.sh')), null)
})

test('edit: matching entry that fails reports the last 20 lines as additionalContext', () => {
  const r = repo({ edit: [{ pattern: '\\.sh$', command: 'for i in $(seq 1 30); do echo line$i; done; echo err >&2; exit 3' }] })
  const out = runner('edit', r.dir, edited('a.sh'))
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse')
  const ctx = out.hookSpecificOutput.additionalContext
  assert.match(ctx, /^Verify failed after editing a\.sh \(for i in/)
  assert.match(ctx, /line30\nerr$/)
  assert.doesNotMatch(ctx, /line11\n/)
  assert.match(ctx, /line12\n/)
})

test('edit: non-matching path is silent', () => {
  const r = repo({ edit: [{ pattern: '\\.sh$', command: 'exit 1' }] })
  assert.equal(runner('edit', r.dir, edited('a.md')), null)
})

test('edit: $FILE with a space and ; arrives intact and is not executed', () => {
  const r = repo({ edit: [{ pattern: '\\.sh$', command: 'printf %s "$FILE" > got; exit 1' }] })
  const name = 'a b;touch PWNED;.sh'
  const out = runner('edit', r.dir, edited(name))
  assert.ok(out.hookSpecificOutput.additionalContext.startsWith(`Verify failed after editing ${name} `))
  assert.equal(fs.readFileSync(path.join(r.dir, 'got'), 'utf8'), name)
  assert.equal(fs.existsSync(path.join(r.dir, 'PWNED')), false)
})

test('edit: a timeout is reported naming the timeout', () => {
  const r = repo({ edit: [{ pattern: '.', command: 'echo started; sleep 5', timeout: 1 }] })
  const ctx = runner('edit', r.dir, edited('a')).hookSpecificOutput.additionalContext
  assert.match(ctx, /started\n\(timed out after 1s\)$/)
})

test('stop: clean tree is silent even when the command would fail', () => {
  const r = repo({ stop: { command: 'exit 1' } })
  assert.equal(runner('stop', r.dir), null)
})

test('stop: failing on a dirty tree blocks with the tail', () => {
  const r = repo({ stop: { command: 'echo broken; exit 1' } })
  fs.writeFileSync(path.join(r.dir, 'x'), 'dirty')
  assert.deepEqual(runner('stop', r.dir, { stop_hook_active: false }), { decision: 'block', reason: 'Verify failed (echo broken; exit 1):\nbroken\nFix this before finishing.' })
})

test('stop: failing with stop_hook_active only warns', () => {
  const r = repo({ stop: { command: 'exit 1' } })
  fs.writeFileSync(path.join(r.dir, 'x'), 'dirty')
  assert.deepEqual(runner('stop', r.dir, { stop_hook_active: true }), { systemMessage: 'Verify still failing (exit 1); stopping anyway.' })
})

test('stop: passing on a dirty tree is silent; no verify.stop is silent', () => {
  const r = repo({ stop: { command: 'true' } })
  fs.writeFileSync(path.join(r.dir, 'x'), 'dirty')
  assert.equal(runner('stop', r.dir), null)
  const r2 = repo({ edit: [] })
  fs.writeFileSync(path.join(r2.dir, 'x'), 'dirty')
  assert.equal(runner('stop', r2.dir), null)
})

test('invalid config: edit gets additionalContext, stop gets systemMessage', () => {
  const r = makeRepo()
  fs.writeFileSync(path.join(r.dir, '.snoozy-dev.json'), '{ nope')
  assert.match(runner('edit', r.dir, edited('a.sh')).hookSpecificOutput.additionalContext, /^\.snoozy-dev\.json is invalid: /)
  assert.match(runner('stop', r.dir).systemMessage, /^\.snoozy-dev\.json is invalid: /)
  fs.writeFileSync(path.join(r.dir, '.snoozy-dev.json'), JSON.stringify({ verify: { edit: [{ pattern: '(', command: 'x' }] } }))
  assert.match(runner('edit', r.dir, edited('a.sh')).hookSpecificOutput.additionalContext, /^\.snoozy-dev\.json is invalid: verify\.edit\[0\]\.pattern: /)
})

test('project dir falls back to stdin cwd when CLAUDE_PROJECT_DIR is unset', () => {
  const r = repo({ edit: [{ pattern: '.', command: 'exit 1' }] })
  const res = spawnSync('node', [RUNNER, 'edit'], { input: JSON.stringify({ cwd: r.dir, ...edited('a') }), env: env(), encoding: 'utf8' })
  assert.match(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, /^Verify failed after editing a /)
})
