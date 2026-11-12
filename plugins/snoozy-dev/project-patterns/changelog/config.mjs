#!/usr/bin/env node
// doc-changelog.json: load, validate, apply defaults, and locate the content
// repo that holds it. Shared by fragments.mjs, release.sh and the /doc-* skills.
// Reference: changelog.md in this folder.
//
//   node config.mjs locate [dir]        print the content repo dir (exit 1 if none or several)
//   node config.mjs show [--repo <dir>] print the resolved config as JSON (exit 1 if invalid)

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONFIG_FILE = 'doc-changelog.json'
const ID_RE = /^[a-z0-9-]+$/
const GROUP_BY = ['category', 'area', 'area>category']
const TOP_KEYS = ['content', 'ignore', 'fragmentsDir', 'changelog', 'categories', 'areas', 'groupBy', 'commitUrl', 'release', 'commit']
const RELEASE_DEFAULTS = { tagPrefix: 'v', versionFile: null, beforeCommit: null, stableBranch: null }
const COMMIT_DEFAULTS = { push: false, verify: null }

export class ConfigError extends Error {}

export function git(dir, args, opts = {}) {
  return execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).replace(/\n$/, '')
}

// `https://github.com/<owner>/<repo>/commit/{hash}` from a GitHub origin
// (ssh or https), else null.
export function githubCommitUrl(remoteUrl) {
  const m = /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/(?:[^@/]+@)?github\.com\/)([^/]+)\/(.+?)(?:\.git)?\/?$/.exec(remoteUrl ?? '')
  return m ? `https://github.com/${m[1]}/${m[2]}/commit/{hash}` : null
}

function originUrl(repoDir) {
  try { return git(repoDir, ['remote', 'get-url', 'origin']) } catch { return null }
}

const fail = (msg) => { throw new ConfigError(`${CONFIG_FILE}: ${msg}`) }
const isStr = (v) => typeof v === 'string' && v.length > 0
const strList = (v, key) => {
  if (!Array.isArray(v) || !v.every(isStr)) fail(`\`${key}\` must be a list of strings`)
  return v
}

function checkIds(list, key, labelKey) {
  const seen = new Set()
  list.forEach((item, i) => {
    if (!item || typeof item !== 'object') fail(`\`${key}[${i}]\` must be an object`)
    if (!isStr(item.id) || !ID_RE.test(item.id)) fail(`\`${key}[${i}].id\` must match ${ID_RE} (got ${JSON.stringify(item.id)})`)
    if (seen.has(item.id)) fail(`duplicate \`${key}\` id "${item.id}"`)
    seen.add(item.id)
    if (!isStr(item[labelKey])) fail(`\`${key}[${i}].${labelKey}\` is required`)
  })
}

// Validated config with every default filled in; `repo` is the absolute dir.
export function validateConfig(raw, repoDir) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('must be a JSON object')
  for (const k of Object.keys(raw)) if (!TOP_KEYS.includes(k)) fail(`unknown key \`${k}\``)
  if (!Array.isArray(raw.categories) || raw.categories.length === 0) fail('`categories` is required and must be a non-empty list')
  checkIds(raw.categories, 'categories', 'heading')
  const areas = raw.areas ?? []
  if (!Array.isArray(areas)) fail('`areas` must be a list')
  checkIds(areas, 'areas', 'label')
  areas.forEach((a, i) => { if (a.paths !== undefined) strList(a.paths, `areas[${i}].paths`) })
  const groupBy = raw.groupBy ?? 'category'
  if (!GROUP_BY.includes(groupBy)) fail(`unknown \`groupBy\` "${groupBy}" (use ${GROUP_BY.join(', ')})`)
  for (const k of ['fragmentsDir', 'changelog']) if (raw[k] !== undefined && !isStr(raw[k])) fail(`\`${k}\` must be a non-empty string`)
  if (raw.commitUrl !== undefined && raw.commitUrl !== null && !(isStr(raw.commitUrl) && raw.commitUrl.includes('{hash}'))) fail('`commitUrl` must be a string containing {hash}, or null')
  const sub = (key, defaults) => {
    const v = raw[key] ?? {}
    if (typeof v !== 'object' || Array.isArray(v)) fail(`\`${key}\` must be an object`)
    for (const k of Object.keys(v)) if (!(k in defaults)) fail(`unknown key \`${key}.${k}\``)
    return { ...defaults, ...v }
  }
  const release = sub('release', RELEASE_DEFAULTS)
  if (typeof release.tagPrefix !== 'string') fail('`release.tagPrefix` must be a string')
  if (release.stableBranch !== null && !(isStr(release.stableBranch) && release.stableBranch !== 'main')) fail('`release.stableBranch` must be null or a branch name other than `main`')
  const commit = sub('commit', COMMIT_DEFAULTS)
  if (typeof commit.push !== 'boolean') fail('`commit.push` must be true or false')
  return {
    repo: path.resolve(repoDir),
    content: raw.content === undefined ? ['**'] : strList(raw.content, 'content'),
    ignore: raw.ignore === undefined ? [] : strList(raw.ignore, 'ignore'),
    fragmentsDir: (raw.fragmentsDir ?? 'changes').replace(/\/+$/, ''),
    changelog: raw.changelog ?? 'CHANGELOG.md',
    categories: raw.categories.map((c) => ({ description: null, collapsed: false, ...c })),
    areas: areas.map((a) => ({ paths: [], ...a })),
    groupBy,
    commitUrl: raw.commitUrl === undefined ? githubCommitUrl(originUrl(repoDir)) : raw.commitUrl,
    release,
    commit,
  }
}

export function loadConfig(repoDir) {
  const file = path.join(repoDir, CONFIG_FILE)
  if (!fs.existsSync(file)) throw new ConfigError(`no ${CONFIG_FILE} in ${repoDir}`)
  let raw
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { fail(`invalid JSON (${e.message})`) }
  return validateConfig(raw, repoDir)
}

// Paths that never count as content: the fragments folder, the changelog,
// the config and the version file, plus `ignore`.
export function isContent(cfg, file) {
  const fixed = [cfg.changelog, CONFIG_FILE, cfg.release.versionFile].filter(Boolean)
  if (fixed.includes(file) || file.startsWith(`${cfg.fragmentsDir}/`)) return false
  if (cfg.ignore.some((g) => path.matchesGlob(file, g))) return false
  return cfg.content.some((g) => path.matchesGlob(file, g))
}

// The content repo: the git toplevel of `startDir` if it holds the config,
// else the one dir up to three levels below it that does.
export function locateConfig(startDir = process.cwd()) {
  let top
  try { top = git(startDir, ['rev-parse', '--show-toplevel']) } catch { top = path.resolve(startDir) }
  if (fs.existsSync(path.join(top, CONFIG_FILE))) return top
  const found = []
  const walk = (dir, depth) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name === CONFIG_FILE) found.push(dir)
      else if (e.isDirectory() && depth < 3 && e.name !== 'node_modules' && e.name !== '.git') walk(path.join(dir, e.name), depth + 1)
    }
  }
  walk(top, 1)
  if (found.length === 1) return found[0]
  if (found.length > 1) throw new ConfigError(`several ${CONFIG_FILE} files under ${top}; pass --repo <dir>:\n${found.map((d) => `  ${d}`).join('\n')}`)
  throw new ConfigError(`no ${CONFIG_FILE} in ${top} or up to 3 levels below it. To adopt the flow, see project-patterns/changelog/changelog.md`)
}

// `--repo <dir>` from argv (removed from it), else locateConfig(cwd).
export function repoArg(argv) {
  const i = argv.indexOf('--repo')
  if (i === -1) return locateConfig()
  const dir = argv[i + 1]
  argv.splice(i, 2)
  return path.resolve(dir)
}

function main(argv) {
  const [cmd, ...rest] = argv
  if (cmd === 'locate' && rest.length <= 1) {
    console.log(locateConfig(rest[0] ?? process.cwd()))
    return 0
  }
  if (cmd === 'show') {
    console.log(JSON.stringify(loadConfig(repoArg(rest)), null, 2))
    return 0
  }
  console.error('Usage: config.mjs locate [dir] | show [--repo <dir>]')
  return 2
}

export function runCli(metaUrl, fn) {
  if (!process.argv[1] || fs.realpathSync(process.argv[1]) !== fileURLToPath(metaUrl)) return
  try {
    process.exitCode = fn(process.argv.slice(2))
  } catch (e) {
    if (!(e instanceof ConfigError) && !e.userFacing) throw e
    console.error(`Error: ${e.message}`)
    process.exitCode = 1
  }
}

runCli(import.meta.url, main)
