#!/usr/bin/env node
// Plugin SessionStart hook: when the repo has no .snoozy-dev.json, an invalid
// one, or an onboard schema stamp behind the plugin's
// skills/onboard/schema.json, prints one paragraph asking Claude to offer
// /snoozy-dev:onboard once. Plain stdout from SessionStart lands in Claude's
// context. Only reads the repo: declines are kept per origin URL in
// ${CLAUDE_PLUGIN_DATA}/onboard-declined.json.
//
//   node onboard-check.mjs                                   (hook JSON on stdin)
//   node onboard-check.mjs --decline <origin> --data-dir <dir>

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const CONFIG = '.snoozy-dev.json'
const DECLINED = 'onboard-declined.json'
const HERE = path.dirname(new URL(import.meta.url).pathname)

function readDeclined(dataDir) {
  if (!dataDir) return []
  try {
    const list = JSON.parse(fs.readFileSync(path.join(dataDir, DECLINED), 'utf8'))
    return Array.isArray(list) ? list : []
  } catch { return [] }
}

function decline(origin, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true })
  const list = readDeclined(dataDir)
  if (!list.includes(origin)) list.push(origin)
  fs.writeFileSync(path.join(dataDir, DECLINED), JSON.stringify(list, null, 2) + '\n')
  process.stdout.write(`Declined onboarding for ${origin}.\n`)
}

const git = (dir, ...args) => {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8' })
  return r.status === 0 ? r.stdout.trim() : null
}

// Returns the paragraph to print, or null for silence.
function check(input) {
  if (input.source !== 'startup') return null
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  const top = git(dir, 'rev-parse', '--show-toplevel')
  if (!top) return null
  const origin = git(top, 'remote', 'get-url', 'origin')
  if (!origin || !/github\.com[:/]/.test(origin)) return null
  const dataDir = process.env.CLAUDE_PLUGIN_DATA ? path.resolve(process.env.CLAUDE_PLUGIN_DATA) : ''
  if (readDeclined(dataDir).includes(origin)) return null
  const root = path.resolve(process.env.CLAUDE_PLUGIN_ROOT || path.join(HERE, '..'))
  let manifest
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'skills', 'onboard', 'schema.json'), 'utf8')) } catch { return null }
  const latest = manifest.schema

  let msg
  const file = path.join(top, CONFIG)
  if (!fs.existsSync(file)) {
    msg = `snoozy-dev: this repo isn't set up for snoozy-dev (no ${CONFIG}). Offer the user, once this session, to run /snoozy-dev:onboard; it verifies any existing setup rather than redoing it.`
  } else {
    let stamp, error
    try {
      stamp = JSON.parse(fs.readFileSync(file, 'utf8')).onboardSchema
      if (!Number.isInteger(stamp)) error = 'no integer `onboardSchema`'
    } catch (e) { error = e.message }
    if (error) {
      msg = `snoozy-dev: this repo's ${CONFIG} is invalid (${error}). Offer the user, once this session, to run /snoozy-dev:onboard to repair it.`
    } else if (stamp >= latest) {
      return null
    } else {
      const changes = []
      for (let n = stamp + 1; n <= latest; n++) for (const c of manifest.changes?.[n] ?? []) changes.push(`- ${c}`)
      msg = `snoozy-dev: this repo is on onboard schema ${stamp} and the plugin is on ${latest}. What changed:\n${changes.join('\n')}\nOffer the user, once this session, to run /snoozy-dev:onboard to upgrade.`
    }
  }
  if (dataDir) msg += `\nIf the user declines, run \`node "${path.join(root, 'hooks', 'onboard-check.mjs')}" --decline "${origin}" --data-dir "${dataDir}"\`, and don't raise it again.`
  return msg
}

function main(argv) {
  const i = argv.indexOf('--decline')
  if (i !== -1) {
    const origin = argv[i + 1]
    const d = argv.indexOf('--data-dir')
    const dataDir = d !== -1 ? argv[d + 1] : ''
    if (!origin || !dataDir) {
      process.stderr.write('usage: onboard-check.mjs --decline <origin> --data-dir <dir>\n')
      process.exitCode = 2
      return
    }
    return decline(origin, dataDir)
  }
  let input = {}
  try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}') } catch {}
  const msg = check(input)
  if (msg) process.stdout.write(msg + '\n')
}

try { main(process.argv.slice(2)) } catch (e) { process.stderr.write(`onboard-check: ${e.message}\n`) }
