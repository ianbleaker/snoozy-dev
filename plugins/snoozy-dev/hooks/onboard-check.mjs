#!/usr/bin/env node
// Plugin SessionStart hook. Prints up to two kinds of paragraph, each asking
// Claude to offer something once:
// - onboarding: the repo has no .snoozy-dev.json, an invalid one, or an
//   onboard schema stamp behind the plugin's skills/onboard/schema.json
//   → offer /snoozy-dev:onboard.
// - deploy: the `- Convention:` line in the repo's `## Deploy` section
//   (read through project-patterns/deploy-config.sh) is behind the registry
//   in project-patterns/deploy-conventions.json → offer a draft migration
//   issue; or the deploy files have drifted from it → offer to fix the line.
// Plain stdout from SessionStart lands in Claude's context. Only reads the
// repo: declines are kept as opaque keys in
// ${CLAUDE_PLUGIN_DATA}/onboard-declined.json — `<origin>` for onboarding,
// `<origin>#deploy-migrate:<name>@<version>` and
// `<origin>#deploy-drift:<signal>` for the deploy check.
//
//   node onboard-check.mjs                                   (hook JSON on stdin)
//   node onboard-check.mjs --decline <key> --data-dir <dir>

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { detect, driftSignals, loadRegistry } from '../project-patterns/deploy-convention.mjs'

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

const declineCmd = (root, key, dataDir) =>
  `\`node "${path.join(root, 'hooks', 'onboard-check.mjs')}" --decline "${key}" --data-dir "${dataDir}"\``

// The onboard stamp from .snoozy-dev.json, or null when missing or invalid.
function readStamp(top) {
  try {
    const stamp = JSON.parse(fs.readFileSync(path.join(top, CONFIG), 'utf8')).onboardSchema
    return Number.isInteger(stamp) ? stamp : null
  } catch { return null }
}

// The paragraph to print, or null for silence.
function check(input) {
  if (input.source !== 'startup') return null
  const dir = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd()
  const top = git(dir, 'rev-parse', '--show-toplevel')
  if (!top) return null
  const origin = git(top, 'remote', 'get-url', 'origin')
  if (!origin || !/github\.com[:/]/.test(origin)) return null
  const dataDir = process.env.CLAUDE_PLUGIN_DATA ? path.resolve(process.env.CLAUDE_PLUGIN_DATA) : ''
  const root = path.resolve(process.env.CLAUDE_PLUGIN_ROOT || path.join(HERE, '..'))
  const paragraphs = []
  const onboard = onboardCheck(top, origin, root, dataDir)
  if (onboard) paragraphs.push(onboard)
  try { paragraphs.push(...deployCheck(top, origin, root, dataDir)) } catch {}
  return paragraphs.length ? paragraphs.join('\n\n') : null
}

// The onboarding paragraph, or null.
function onboardCheck(top, origin, root, dataDir) {
  if (readDeclined(dataDir).includes(origin)) return null
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
  if (dataDir) msg += `\nIf the user declines, run ${declineCmd(root, origin, dataDir)}, and don't raise it again.`
  return msg
}

// Reads the recorded convention through deploy-config.sh (the only `## Deploy`
// parser): { name, version }, 'none', null (no usable line), or undefined
// when the script fails (e.g. joined lines), which silences the deploy check.
function readRecord(top, root) {
  const script = 'out=$(bash "$1" "$2") || exit 1; eval "$out"; printf \'%s\\n%s\\n\' "$DEPLOY_CONVENTION" "$DEPLOY_CONVENTION_VERSION"'
  const r = spawnSync('bash', ['-c', script, 'bash', path.join(root, 'project-patterns', 'deploy-config.sh'), top], { cwd: top, encoding: 'utf8' })
  if (r.status !== 0) return undefined
  const [name, version] = r.stdout.split('\n')
  if (name === 'none') return 'none'
  if (!name || !/^[0-9]+$/.test(version)) return null
  return { name, version: Number(version) }
}

const DRIFT_TEXT = {
  'deploy-missing': () => 'records vps-systemd, but there is no `deploy/setup.sh` with a `deploy/*.service` any more.',
  'files-newer': () => 'records vps-systemd@1, but `deploy/setup.sh` already installs the sudoers drop-in of v2.',
  'now-vps': () => 'records `none`, but `deploy/` now follows vps-systemd.',
  unrecorded: () => 'has no `- Convention:` line, but `deploy/` follows vps-systemd.',
  'other-platform': (file) => `records vps-systemd, but \`${file}\` exists at the repo root.`,
  'unknown-convention': (name) => `records \`${name}\`, which isn't a convention this plugin knows.`,
}

// The deploy-convention paragraphs (migration, then drift); [] for silence.
function deployCheck(top, origin, root, dataDir) {
  const registry = loadRegistry(root)
  if (!registry) return []
  const record = readRecord(top, root)
  if (record === undefined) return []
  const latest = record && typeof record === 'object' ? registry[record.name]?.version : undefined
  if (Number.isInteger(latest) && record.version > latest) return []
  const declined = readDeclined(dataDir)
  const out = []

  if (Number.isInteger(latest) && record.version < latest) {
    const key = `${origin}#deploy-migrate:${record.name}@${latest}`
    if (!declined.includes(key)) {
      const notes = []
      for (let n = record.version + 1; n <= latest; n++) for (const note of registry[record.name].migrations?.[n] ?? []) notes.push(`- ${note}`)
      let msg = `snoozy-dev: this repo's \`## Deploy\` section records deploy convention ${record.name}@${record.version}, and the current version is ${latest}. Migration notes:\n${notes.join('\n')}\nOffer the user, once this session, to file a draft migration issue in this repo with /snoozy-dev:log-task, using these notes as the body. Once the migration is done, the \`- Convention:\` line becomes \`- Convention: ${record.name}@${latest}\`.`
      if (dataDir) msg += `\nIf the user declines, run ${declineCmd(root, key, dataDir)}, and don't raise it again.`
      out.push(msg)
    }
  }

  const stamp = readStamp(top)
  const signals = driftSignals(top, record, registry)
    .filter((s) => s !== 'unrecorded' || (stamp !== null && stamp >= 2))
    .filter((s) => !declined.includes(`${origin}#deploy-drift:${s}`))
  if (signals.length) {
    const found = detect(top)
    const detected = found ? ` Detected from the files: ${found.name}@${found.version}.` : ''
    const lines = signals.map((s) => {
      const [kind, arg] = s.split(/:(.*)/s)
      return `- The \`## Deploy\` section ${DRIFT_TEXT[kind](arg)}${detected}`
    })
    let msg = `snoozy-dev: this repo's deploy setup has drifted from the \`- Convention:\` line in its \`## Deploy\` section:\n${lines.join('\n')}\nOffer the user, once this session, to update the \`- Convention:\` line, or to log a task for it with /snoozy-dev:log-task.`
    if (dataDir) {
      const cmds = signals.map((s) => declineCmd(root, `${origin}#deploy-drift:${s}`, dataDir))
      msg += `\nIf the user declines, run ${cmds.join(' and ')}, and don't raise it again.`
    }
    out.push(msg)
  }
  return out
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
