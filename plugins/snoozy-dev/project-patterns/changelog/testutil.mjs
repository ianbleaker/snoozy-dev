// Test helpers: isolated temp git repos. Importing this scrubs GIT_* from the
// environment (a pre-commit hook runs the tests with GIT_INDEX_FILE set) and
// points git at a throwaway global config, so neither leaks into temp repos.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k]
// Every temp dir this process creates is removed when it exits.
const created = []
process.on('exit', () => { for (const d of created) fs.rmSync(d, { recursive: true, force: true }) })
const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-changelog-gitcfg-'))
created.push(cfgDir)
const cfgFile = path.join(cfgDir, 'gitconfig')
fs.writeFileSync(cfgFile, '[user]\n\tname = t\n\temail = t@t\n[commit]\n\tgpgsign = false\n[tag]\n\tgpgsign = false\n[init]\n\tdefaultBranch = main\n')
process.env.GIT_CONFIG_GLOBAL = cfgFile
process.env.GIT_CONFIG_NOSYSTEM = '1'

export const HERE = path.dirname(new URL(import.meta.url).pathname)

export const tmpDir = (prefix = 'doc-changelog-') => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  created.push(d)
  return d
}

let clock = Date.UTC(2026, 0, 1) / 1000

// A git repo at `dir` (created if needed) with helpers. `origin`: also create
// a bare origin and clone from it.
export function makeRepo({ origin = false, config } = {}) {
  const base = tmpDir()
  const dir = path.join(base, 'work')
  let originDir = null
  if (origin) {
    originDir = path.join(base, 'origin.git')
    execFileSync('git', ['init', '-q', '--bare', '-b', 'main', originDir])
    execFileSync('git', ['clone', '-q', originDir, dir], { stdio: 'ignore' })
  } else {
    fs.mkdirSync(dir)
    execFileSync('git', ['init', '-q', '-b', 'main', dir])
  }
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  // Commit everything staged by `files` (path → text; null deletes) with a
  // distinct timestamp; returns the full hash.
  const commit = (message, files = {}) => {
    for (const [rel, text] of Object.entries(files)) {
      if (text === null) git('rm', '-q', rel)
      else { write(rel, text); git('add', rel) }
    }
    clock += 60
    const date = `${clock} +0000`
    execFileSync('git', ['commit', '-q', '--allow-empty', ...message.split('\n\n').flatMap((p) => ['-m', p])], {
      cwd: dir, env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
    })
    return git('rev-parse', 'HEAD')
  }
  if (config) {
    write('doc-changelog.json', JSON.stringify(config, null, 2))
    commit('chore: adopt doc-changelog', { 'doc-changelog.json': JSON.stringify(config, null, 2) })
  }
  return { base, dir, origin: originDir, git, write, commit }
}

export const fragment = ({ category, area, commit, skip } = {}, body = 'A change.') => {
  const lines = ['---']
  if (category) lines.push(`category: ${category}`)
  if (area) lines.push(`area: ${Array.isArray(area) ? `[${area.join(', ')}]` : area}`)
  if (commit) lines.push(`commit: ${commit}`)
  if (skip) lines.push('skip: true')
  lines.push('---', body, '')
  return lines.join('\n')
}

export const BASIC = {
  categories: [
    { id: 'mechanics', heading: 'Mechanics', description: 'rules changed' },
    { id: 'fixes', heading: 'Bug fixes' },
    { id: 'tooling', heading: 'Tooling', collapsed: true },
  ],
  areas: [
    { id: 'start', label: 'Starting zone', paths: ['zones/start/**'] },
    { id: 'wolves', label: 'Wolves', paths: ['mobs/wolf*.md'] },
  ],
  content: ['zones/**', 'mobs/**'],
  commitUrl: 'https://x/commit/{hash}',
}
