#!/usr/bin/env node
// Plugin verify hook: runs the repo's verify commands from .snoozy-dev.json and
// reports failures back to Claude.
//
//   node verify-runner.mjs edit   PostToolUse (Write|Edit|MultiEdit): runs every
//                                 verify.edit entry whose `pattern` matches the
//                                 edited path, with the path in $FILE; failures
//                                 go to Claude as additionalContext (never blocks).
//   node verify-runner.mjs stop   Stop: runs verify.stop when the tree has
//                                 uncommitted changes; a failure blocks once,
//                                 and only warns while stop_hook_active.
//
// Hook JSON arrives on stdin. Commands run with `sh -c` in the project dir and
// must exit non-zero on failure; this runner trims the output (last 20 lines)
// and always exits 0, so it never breaks the session itself.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CONFIG = '.snoozy-dev.json'
const TAIL = 20
const DEFAULT_TIMEOUT = { edit: 30, stop: 120 }

const emit = (obj) => process.stdout.write(JSON.stringify(obj) + '\n')

function readInput() {
  try { return JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch { return {} }
}

// null when there is no config; { error } when it can't be used.
function loadConfig(dir) {
  const file = path.join(dir, CONFIG)
  if (!fs.existsSync(file)) return null
  let cfg
  try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { return { error: e.message } }
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) return { error: 'top level must be an object' }
  const v = cfg.verify ?? {}
  if (typeof v !== 'object' || Array.isArray(v)) return { error: '`verify` must be an object' }
  if (v.edit !== undefined) {
    if (!Array.isArray(v.edit)) return { error: '`verify.edit` must be an array' }
    for (const [i, e] of v.edit.entries()) {
      if (!e || typeof e.pattern !== 'string' || typeof e.command !== 'string') return { error: `verify.edit[${i}] needs string \`pattern\` and \`command\`` }
      try { new RegExp(e.pattern) } catch (err) { return { error: `verify.edit[${i}].pattern: ${err.message}` } }
    }
  }
  if (v.stop !== undefined && (!v.stop || typeof v.stop.command !== 'string')) return { error: '`verify.stop` needs a string `command`' }
  return { verify: v }
}

// Runs `command` with sh -c; returns null on success, else the trimmed output.
function run(command, dir, timeoutSec, env = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snoozy-verify-'))
  const out = path.join(tmp, 'out')
  const fd = fs.openSync(out, 'w')
  let r
  try {
    r = spawnSync('sh', ['-c', command], { cwd: dir, env: { ...process.env, ...env }, stdio: ['ignore', fd, fd], timeout: timeoutSec * 1000, killSignal: 'SIGKILL' })
  } finally { fs.closeSync(fd) }
  const text = fs.readFileSync(out, 'utf8')
  fs.rmSync(tmp, { recursive: true, force: true })
  const timedOut = r.error?.code === 'ETIMEDOUT'
  if (!timedOut && !r.error && r.status === 0) return null
  const lines = text.replace(/\n+$/, '').split('\n').slice(-TAIL)
  if (timedOut) lines.push(`(timed out after ${timeoutSec}s)`)
  else if (r.error) lines.push(`(could not run: ${r.error.message})`)
  return lines.join('\n').replace(/^\n+/, '')
}

function edit(input, dir, cfg) {
  if (cfg.error) return emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `${CONFIG} is invalid: ${cfg.error}` } })
  const file = input.tool_input?.file_path
  if (!file) return
  const fails = []
  for (const e of cfg.verify.edit ?? []) {
    if (!new RegExp(e.pattern).test(file)) continue
    const tail = run(e.command, dir, e.timeout ?? DEFAULT_TIMEOUT.edit, { FILE: file })
    if (tail !== null) fails.push(`Verify failed after editing ${file} (${e.command}):\n${tail}`)
  }
  if (fails.length) emit({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: fails.join('\n\n') } })
}

function stop(input, dir, cfg) {
  if (cfg.error) return emit({ systemMessage: `${CONFIG} is invalid: ${cfg.error}` })
  const s = cfg.verify.stop
  if (!s) return
  const st = spawnSync('git', ['status', '--porcelain'], { cwd: dir, encoding: 'utf8' })
  if (st.status !== 0 || st.stdout.trim() === '') return
  const tail = run(s.command, dir, s.timeout ?? DEFAULT_TIMEOUT.stop)
  if (tail === null) return
  if (input.stop_hook_active) emit({ systemMessage: `Verify still failing (${s.command}); stopping anyway.` })
  else emit({ decision: 'block', reason: `Verify failed (${s.command}):\n${tail}\nFix this before finishing.` })
}

function main() {
  const mode = process.argv[2]
  if (mode !== 'edit' && mode !== 'stop') return
  const input = readInput()
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  const cfg = loadConfig(dir)
  if (!cfg) return
  ;(mode === 'edit' ? edit : stop)(input, dir, cfg)
}

try { main() } catch (e) { process.stderr.write(`verify-runner: ${e.message}\n`) }
process.exitCode = 0
