#!/usr/bin/env node
// Deploy-convention detection: the one rule for which convention (and
// version) a repo's files follow, and how that compares with the
// `- Convention:` line recorded in its `## Deploy` section. The registry of
// current versions and migration notes is deploy-conventions.json next to
// this file. Imported by hooks/onboard-check.mjs; the onboard skill calls
// the CLI.
//
//   node deploy-convention.mjs detect <dir>   prints vps-systemd@N or nothing, exits 0

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const OTHER_PLATFORM_FILES = ['Dockerfile', 'fly.toml', 'docker-compose.yml', 'compose.yaml']

// The parsed registry under <pluginRoot>/project-patterns/, or null when the
// file is missing or invalid.
export function loadRegistry(pluginRoot) {
  try {
    const reg = JSON.parse(fs.readFileSync(path.join(pluginRoot, 'project-patterns', 'deploy-conventions.json'), 'utf8'))
    return reg && typeof reg === 'object' && !Array.isArray(reg) ? reg : null
  } catch { return null }
}

// vps-systemd when deploy/setup.sh and at least one deploy/*.service exist;
// version 2 when setup.sh installs a sudoers drop-in, else 1. Otherwise null.
export function detect(dir) {
  const deployDir = path.join(dir, 'deploy')
  let setup
  try { setup = fs.readFileSync(path.join(deployDir, 'setup.sh'), 'utf8') } catch { return null }
  let entries
  try { entries = fs.readdirSync(deployDir) } catch { return null }
  if (!entries.some((f) => f.endsWith('.service'))) return null
  return { name: 'vps-systemd', version: setup.includes('sudoers.d') ? 2 : 1 }
}

// The other-platform files present at the repo root.
export function otherPlatformFiles(dir) {
  return OTHER_PLATFORM_FILES.filter((f) => fs.existsSync(path.join(dir, f)))
}

// Signals that the recorded convention no longer matches the files.
// `record` is { name, version }, 'none' or null.
export function driftSignals(dir, record, registry) {
  const found = detect(dir)
  const signals = []
  if (record === null) {
    if (found) signals.push('unrecorded')
  } else if (record === 'none') {
    if (found) signals.push('now-vps')
  } else {
    if (registry && !Object.hasOwn(registry, record.name)) signals.push(`unknown-convention:${record.name}`)
    if (record.name === 'vps-systemd') {
      if (!found) signals.push('deploy-missing')
      for (const f of otherPlatformFiles(dir)) signals.push(`other-platform:${f}`)
      if (record.version === 1 && found?.version === 2) signals.push('files-newer')
    }
  }
  return signals
}

function main(argv) {
  if (argv[0] !== 'detect' || !argv[1]) {
    process.stderr.write('usage: deploy-convention.mjs detect <dir>\n')
    process.exitCode = 2
    return
  }
  const found = detect(argv[1])
  if (found) process.stdout.write(`${found.name}@${found.version}\n`)
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2))
}
