#!/usr/bin/env node
// Changelog fragments: parse, gate, render, cut. Deterministic: summaries and
// categories are written by the /doc-* skills, never here. See changelog.md.
//
//   node fragments.mjs areas <file>...                       area ids matching the files
//   node fragments.mjs check [--json]                        the coverage gate (exit 1 on gaps)
//   node fragments.mjs render [--version X.Y.Z --date D]     unreleased notes from fragments
//   node fragments.mjs cut <version> <date>                  write the section, consume fragments
//   node fragments.mjs notes <version> [--file <changelog>]  body of a cut section
//
// Every subcommand takes --repo <dir> (default: config.mjs locate from cwd).

import fs from 'node:fs'
import path from 'node:path'
import { CONFIG_FILE, git, isContent, loadConfig, repoArg, runCli } from './config.mjs'

class FragmentError extends Error {}
FragmentError.prototype.userFacing = true
const KEYS = ['category', 'area', 'commit', 'skip']
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------- parse ----------

// { category, areas, commit, skip, summary } from a fragment's text; throws
// naming `file` and the problem.
export function parseFragment(text, file, cfg) {
  const bad = (msg) => { throw new FragmentError(`${file}: ${msg}`) }
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text)
  if (!m) bad('missing `---` frontmatter')
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim()) continue
    const kv = /^([A-Za-z]+):\s*(.*?)\s*$/.exec(line)
    if (!kv) bad(`unreadable frontmatter line "${line}"`)
    if (!KEYS.includes(kv[1])) bad(`unknown key \`${kv[1]}\``)
    meta[kv[1]] = kv[2]
  }
  let skip = false
  if (meta.skip !== undefined) {
    if (meta.skip !== 'true' && meta.skip !== 'false') bad('`skip` must be true or false')
    skip = meta.skip === 'true'
  }
  let areas = []
  if (meta.area !== undefined && meta.area !== '') {
    const list = /^\[(.*)\]$/.exec(meta.area)
    areas = (list ? list[1].split(',') : [meta.area]).map((s) => s.trim()).filter(Boolean)
    for (const a of areas) if (!cfg.areas.some((x) => x.id === a)) bad(`unknown area "${a}"`)
  }
  const category = meta.category || null
  if (category && !cfg.categories.some((c) => c.id === category)) bad(`unknown category "${category}"`)
  if (!category && !skip) bad('`category` is required (or `skip: true`)')
  const commit = meta.commit || null
  if (commit && !/^[0-9a-f]{40}$/.test(commit)) bad('`commit` must be a full 40-character hash')
  const summary = m[2].trim().replace(/\s*\n\s*/g, ' ')
  if (!summary) bad('empty body: write the one-line summary below the frontmatter')
  return { category, areas, commit, skip, summary }
}

// Every `*.md` fragment in the working tree (tracked or not), parsed, with
// the commit that added it. Invalid ones land in `invalid`.
export function readFragments(cfg) {
  const dir = path.join(cfg.repo, cfg.fragmentsDir)
  const fragments = []
  const invalid = []
  if (!fs.existsSync(dir)) return { fragments, invalid }
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
    const file = `${cfg.fragmentsDir}/${name}`
    try {
      const f = parseFragment(fs.readFileSync(path.join(cfg.repo, file), 'utf8'), file, cfg)
      if (f.commit) {
        try { git(cfg.repo, ['cat-file', '-e', `${f.commit}^{commit}`]) } catch { throw new FragmentError(`${file}: \`commit\` ${f.commit.slice(0, 7)} is not a commit in this repo`) }
      }
      const added = git(cfg.repo, ['log', '--diff-filter=A', '--format=%H', '-1', '--', file]) || null
      const link = f.commit ?? added
      const time = link ? Number(git(cfg.repo, ['log', '-1', '--format=%ct', link])) : null
      fragments.push({ ...f, file, added, link, time })
    } catch (e) {
      if (!(e instanceof FragmentError)) throw e
      invalid.push({ file, error: e.message.slice(file.length + 2) })
    }
  }
  return { fragments, invalid }
}

// ---------- areas ----------

export function suggestAreas(cfg, files) {
  const rel = files.map((f) => (path.isAbsolute(f) ? path.relative(cfg.repo, f) : f))
  return cfg.areas.filter((a) => a.paths.some((g) => rel.some((f) => path.matchesGlob(f, g)))).map((a) => a.id)
}

// ---------- check ----------

const semver = (s) => s.split('.').map(Number)
const cmpVer = (a, b) => { const [x, y] = [semver(a), semver(b)]; return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] }

// Highest `<tagPrefix>X.Y.Z` tag, or null.
export function latestTag(cfg) {
  const re = new RegExp(`^${escapeRe(cfg.release.tagPrefix)}(\\d+\\.\\d+\\.\\d+)$`)
  const tags = git(cfg.repo, ['tag', '--list']).split('\n').map((t) => [t, re.exec(t)?.[1]]).filter(([, v]) => v)
  tags.sort((a, b) => cmpVer(b[1], a[1]))
  return tags[0]?.[0] ?? null
}

export const releaseSubjectRe = (cfg) => new RegExp(`^chore: release ${escapeRe(cfg.release.tagPrefix)}(\\d+\\.\\d+\\.\\d+)( \\(#\\d+\\))?$`)

const lines = (s) => s.split('\n').filter(Boolean)

function commitInfo(cfg, hash) {
  const [subject, ...body] = git(cfg.repo, ['log', '-1', '--format=%s%n%b', hash]).split('\n')
  const changes = lines(git(cfg.repo, ['diff-tree', '--root', '--relative', '--no-commit-id', '-r', '--name-status', hash]))
    .map((l) => { const [status, ...paths] = l.split('\t'); return { status: status[0], file: paths.at(-1) } })
  return { hash, subject, message: body.join('\n'), changes, files: changes.map((c) => c.file) }
}

// The range start: the highest release tag, else the commit that added the
// config (null when it isn't committed yet: nothing to check).
export function rangeStart(cfg) {
  const tag = latestTag(cfg)
  if (tag) return tag
  return lines(git(cfg.repo, ['log', '--diff-filter=A', '--format=%H', '--', CONFIG_FILE])).at(-1) ?? null
}

// Units of commits since the range start, newest first (see changelog.md → Gate).
export function units(cfg, start) {
  const ref = (r) => { try { return git(cfg.repo, ['rev-parse', '-q', '--verify', `${r}^{commit}`]) } catch { return null } }
  const head = ref('HEAD')
  if (!start || !head) return []
  const branch = git(cfg.repo, ['branch', '--show-current'])
  const originMain = ref('origin/main')
  let base = head
  let pending = []
  if (branch !== 'main' && originMain) {
    base = git(cfg.repo, ['merge-base', 'HEAD', 'origin/main'])
    pending = lines(git(cfg.repo, ['rev-list', 'HEAD', `^${base}`, `^${start}`]))
  }
  const out = []
  for (const hash of lines(git(cfg.repo, ['rev-list', '--first-parent', base, `^${start}`]))) {
    const parents = git(cfg.repo, ['log', '-1', '--format=%P', hash]).split(' ')
    const side = parents.length > 1 ? lines(git(cfg.repo, ['rev-list', `${parents[0]}..${parents[1]}`, `^${start}`])) : []
    out.push([hash, ...side])
  }
  if (pending.length) out.unshift(pending)
  return out.map((u) => u.map((h) => commitInfo(cfg, h)))
}

export function check(cfg) {
  const from = rangeStart(cfg)
  const { fragments, invalid } = readFragments(cfg)
  const named = new Set(fragments.map((f) => f.commit).filter(Boolean))
  const release = releaseSubjectRe(cfg)
  const dir = `${cfg.fragmentsDir}/`
  const covered = (c) => named.has(c.hash)
    || /^Changelog:\s*skip\s*$/im.test(c.message)
    || c.changes.some((x) => (x.status === 'A' || x.status === 'M') && x.file.startsWith(dir))
  const excluded = (c) => release.test(c.subject) || !c.files.some((f) => isContent(cfg, f))
  const missing = units(cfg, from)
    .filter((u) => !u.every(excluded) && !u.some(covered))
    .map((u) => ({ commits: u.map(({ hash, subject, files }) => ({ hash, subject, files })) }))
  return { from, missing, invalid }
}

// ---------- render ----------

function linkText(cfg, f) {
  if (!f.link || !cfg.commitUrl) return ''
  return ` [\`${f.link.slice(0, 7)}\`](${cfg.commitUrl.replaceAll('{hash}', f.link)})`
}

export function render(cfg, fragments, { version, date } = {}) {
  const live = fragments.filter((f) => !f.skip)
    .sort((a, b) => (a.time ?? Infinity) - (b.time ?? Infinity) || a.file.localeCompare(b.file))
  const areaLabel = (id) => cfg.areas.find((a) => a.id === id).label
  const out = []
  const items = (list, fmt) => list.map((f) => `- ${f.summary}${fmt(f)}${linkText(cfg, f)}`)
  const byArea = (list) => [
    ...cfg.areas.map((a) => [a.label, list.filter((f) => f.areas.includes(a.id))]),
    ['General', list.filter((f) => f.areas.length === 0)],
  ].filter(([, l]) => l.length)

  if (cfg.groupBy === 'category') {
    for (const c of cfg.categories) {
      const list = items(live.filter((f) => f.category === c.id), (f) => (f.areas.length ? ` (${f.areas.map(areaLabel).join(', ')})` : ''))
      if (!list.length) continue
      if (c.collapsed) out.push(`<details><summary>${c.heading}</summary>`, '', ...list, '', '</details>')
      else out.push(`### ${c.heading}`, ...list)
    }
  } else if (cfg.groupBy === 'area') {
    const heading = (id) => cfg.categories.find((c) => c.id === id).heading
    for (const [label, list] of byArea(live)) out.push(`### ${label}`, ...items(list, (f) => ` *(${heading(f.category)})*`))
  } else {
    for (const [label, list] of byArea(live)) {
      out.push(`### ${label}`)
      for (const c of cfg.categories) {
        const sub = list.filter((f) => f.category === c.id)
        if (sub.length) out.push(`#### ${c.heading}`, ...items(sub, () => ''))
      }
    }
  }
  const body = out.length ? out.join('\n') : 'No changes.'
  return version ? `## ${cfg.release.tagPrefix}${version} — ${date}\n${body}\n` : `${body}\n`
}

// ---------- cut / notes ----------

// The `## ` heading matching `re` and its body up to the next `## `.
export function findSection(text, re) {
  const m = re.exec(text ?? '')
  if (!m) return null
  const rest = text.slice(m.index + m[0].length)
  const next = /^## /m.exec(rest)
  return { start: m.index, rest, body: (next ? rest.slice(0, next.index) : rest).trim() }
}
export const releaseHeading = (cfg, version) => new RegExp(`^## ${escapeRe(cfg.release.tagPrefix + version)} — [^\\n]*\\n`, 'm')

// `section` inserted below the first `# ` heading, above earlier releases.
export function insertSection(text, section) {
  if (text === null) return `# Changelog\n\n${section}`
  const m = /^# [^\n]*(\n|$)/m.exec(text)
  if (!m) return `${section}\n${text.replace(/^\n+/, '')}`
  const end = m.index + m[0].length
  const rest = text.slice(end).replace(/^\n+/, '')
  return `${text.slice(0, end)}${m[1] ? '' : '\n'}\n${section}${rest ? `\n${rest}` : ''}`
}

export function cut(cfg, version, date) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new FragmentError(`version must be X.Y.Z (got ${version})`)
  if (!/^\d{4}-\d\d-\d\d$/.test(date)) throw new FragmentError(`date must be YYYY-MM-DD (got ${date})`)
  const file = path.join(cfg.repo, cfg.changelog)
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null
  if (findSection(before, releaseHeading(cfg, version))) throw new FragmentError(`${cfg.changelog} already has a ${cfg.release.tagPrefix}${version} section`)
  const { fragments, invalid } = readFragments(cfg)
  if (invalid.length) throw new FragmentError(`invalid fragments:\n${invalid.map((i) => `  ${i.file}: ${i.error}`).join('\n')}`)
  fs.writeFileSync(file, insertSection(before, render(cfg, fragments, { version, date })))
  const undo = path.join(git(cfg.repo, ['rev-parse', '--absolute-git-dir']), 'doc-changelog-undo')
  fs.rmSync(undo, { recursive: true, force: true })
  fs.mkdirSync(undo, { recursive: true })
  for (const f of fragments) {
    fs.copyFileSync(path.join(cfg.repo, f.file), path.join(undo, path.basename(f.file)))
    const tracked = git(cfg.repo, ['ls-files', '--', f.file]) !== ''
    if (tracked) git(cfg.repo, ['rm', '-qf', '--', f.file])
    else fs.rmSync(path.join(cfg.repo, f.file))
  }
  return fragments.length
}

export function notes(cfg, version, text) {
  const s = findSection(text, releaseHeading(cfg, version))
  if (!s) throw new FragmentError(`no ${cfg.release.tagPrefix}${version} section in ${cfg.changelog}`)
  return `${s.body}\n`
}

// ---------- CLI ----------

function main(argv) {
  const args = [...argv]
  const repo = repoArg(args)
  const flag = (name) => { const i = args.indexOf(name); if (i === -1) return undefined; const v = args[i + 1]; args.splice(i, 2); return v }
  const bool = (name) => { const i = args.indexOf(name); if (i === -1) return false; args.splice(i, 1); return true }
  const cfg = loadConfig(repo)
  const [cmd, ...rest] = args

  if (cmd === 'areas') {
    for (const id of suggestAreas(cfg, rest)) console.log(id)
    return 0
  }
  if (cmd === 'check') {
    const json = bool('--json')
    const r = check(cfg)
    if (json) {
      console.log(JSON.stringify(r, null, 2))
    } else {
      if (!r.from) console.log(`check: ${CONFIG_FILE} isn't committed yet; nothing to check`)
      for (const u of r.missing) {
        console.log('no changelog fragment for:')
        for (const c of u.commits) console.log(`  ${c.hash.slice(0, 7)} ${c.subject}`)
      }
      for (const i of r.invalid) console.log(`invalid fragment ${i.file}: ${i.error}`)
      if (r.from && !r.missing.length && !r.invalid.length) console.log(`check: every change since ${r.from.length === 40 ? r.from.slice(0, 7) : r.from} has a fragment`)
    }
    return r.missing.length || r.invalid.length ? 1 : 0
  }
  if (cmd === 'render') {
    const version = flag('--version')
    const date = flag('--date') ?? new Date().toISOString().slice(0, 10)
    const { fragments, invalid } = readFragments(cfg)
    for (const i of invalid) console.error(`invalid fragment ${i.file}: ${i.error}`)
    process.stdout.write(render(cfg, fragments, version ? { version, date } : {}))
    return invalid.length ? 1 : 0
  }
  if (cmd === 'cut' && rest.length === 2) {
    const n = cut(cfg, rest[0], rest[1])
    console.log(`cut: ${cfg.release.tagPrefix}${rest[0]} written to ${cfg.changelog}; ${n} fragment(s) consumed`)
    return 0
  }
  if (cmd === 'notes' && rest.length >= 1) {
    const file = flag('--file')
    const src = file ?? path.join(cfg.repo, cfg.changelog)
    process.stdout.write(notes(cfg, rest[0], fs.existsSync(src) ? fs.readFileSync(src, 'utf8') : null))
    return 0
  }
  console.error('Usage: fragments.mjs [--repo <dir>] areas <file>... | check [--json] | render [--version X.Y.Z --date YYYY-MM-DD] | cut <version> <date> | notes <version> [--file <path>]')
  return 2
}

runCli(import.meta.url, main)
