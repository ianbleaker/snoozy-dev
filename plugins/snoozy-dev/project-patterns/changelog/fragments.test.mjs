import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { BASIC, HERE, fragment, makeRepo } from './testutil.mjs'
import { loadConfig, validateConfig } from './config.mjs'
import { check, cut, insertSection, notes, parseFragment, readFragments, render, suggestAreas } from './fragments.mjs'

const CFG = validateConfig(BASIC, '/tmp')
const H = 'a'.repeat(40)
const cli = (dir, ...args) => spawnSync('node', [path.join(HERE, 'fragments.mjs'), '--repo', dir, ...args], { encoding: 'utf8' })
const missingSubjects = (cfg) => check(cfg).missing.map((u) => u.commits.map((c) => c.subject))

// ---------- parse ----------

test('parse: valid fragments', () => {
  assert.deepEqual(parseFragment(fragment({ category: 'mechanics', area: ['start', 'wolves'], commit: H }, 'Wolves deal 4\ndamage.'), 'f.md', CFG),
    { category: 'mechanics', areas: ['start', 'wolves'], commit: H, skip: false, summary: 'Wolves deal 4 damage.' })
  assert.deepEqual(parseFragment(fragment({ category: 'fixes', area: 'start' }), 'f.md', CFG).areas, ['start'])
  assert.equal(parseFragment(fragment({ skip: true }, 'Tooling only.'), 'f.md', CFG).skip, true)
})

test('parse: each error names the file and problem', () => {
  const cases = [
    ['---\ncolour: red\ncategory: fixes\n---\nX\n', /changes\/f\.md: unknown key `colour`/],
    [fragment({ category: 'nope' }), /unknown category "nope"/],
    [fragment({ category: 'fixes', area: ['start', 'moon'] }), /unknown area "moon"/],
    [fragment({ category: 'fixes', commit: 'abc1234' }), /`commit` must be a full 40-character hash/],
    [fragment({ category: 'fixes' }, ''), /empty body/],
    [fragment({ area: 'start' }), /`category` is required/],
    ['no frontmatter\n', /missing `---` frontmatter/],
  ]
  for (const [text, re] of cases) assert.throws(() => parseFragment(text, 'changes/f.md', CFG), (e) => /^changes\/f\.md: /.test(e.message) && re.test(e.message), text)
})

test('areas: config order, any matching file', () => {
  assert.deepEqual(suggestAreas(CFG, ['mobs/wolf-alpha.md', 'zones/start/a.md']), ['start', 'wolves'])
  assert.deepEqual(suggestAreas(CFG, ['zones/other/a.md']), [])
  const r = makeRepo({ config: BASIC })
  assert.equal(cli(r.dir, 'areas', 'mobs/wolf.md', 'x').stdout, 'wolves\n')
})

// ---------- check ----------

test('check: range from the config-adding commit; uncovered content commit named', () => {
  const r = makeRepo()
  r.commit('feat: before adoption', { 'zones/a.md': 'a' })
  r.commit('chore: adopt', { 'doc-changelog.json': JSON.stringify(BASIC) })
  r.commit('feat: wolves', { 'mobs/wolf.md': 'grr' })
  const cfg = loadConfig(r.dir)
  const res = check(cfg)
  assert.equal(res.from, r.git('log', '--format=%H', '-1', '--', 'doc-changelog.json'))
  assert.deepEqual(res.missing.map((u) => u.commits.map((c) => c.subject)), [['feat: wolves']])
  assert.deepEqual(res.missing[0].commits[0].files, ['mobs/wolf.md'])
  const out = cli(r.dir, 'check')
  assert.equal(out.status, 1)
  assert.match(out.stdout, /^ {2}[0-9a-f]{7} feat: wolves$/m)
})

test('check: range from the highest semver tag', () => {
  const r = makeRepo({ config: BASIC })
  r.commit('feat: a', { 'zones/a.md': 'a' })
  r.git('tag', 'v1.10.0')
  r.commit('feat: b', { 'zones/b.md': 'b' })
  r.git('tag', 'v1.9.0')
  r.git('tag', 'other-tag')
  r.commit('feat: c', { 'zones/c.md': 'c' })
  const cfg = loadConfig(r.dir)
  assert.equal(check(cfg).from, 'v1.10.0')
  assert.deepEqual(missingSubjects(cfg), [['feat: c'], ['feat: b']])
})

test('check: covered by an added fragment, a modified fragment, a commit: field and a trailer', () => {
  const r = makeRepo({ config: BASIC })
  r.commit('feat: a', { 'zones/a.md': 'a', 'changes/a.md': fragment({ category: 'mechanics' }) })
  r.commit('feat: b', { 'zones/b.md': 'b', 'changes/a.md': fragment({ category: 'mechanics' }, 'Reworded.') })
  r.commit('chore: tidy\n\nChangelog: skip', { 'zones/c.md': 'c' })
  const old = r.commit('feat: d', { 'zones/d.md': 'd' })
  r.commit('docs: backfill', { 'changes/d.md': fragment({ category: 'fixes', commit: old }) })
  const late = r.commit('feat: e', { 'zones/e.md': 'e' })
  const cfg = loadConfig(r.dir)
  assert.deepEqual(missingSubjects(cfg), [['feat: e']])
  // an uncommitted fragment's commit: counts too
  r.write('changes/e.md', fragment({ category: 'fixes', commit: late }))
  assert.deepEqual(missingSubjects(cfg), [])
  assert.equal(cli(r.dir, 'check').status, 0)
})

test('check: deleting a fragment is not coverage', () => {
  const r = makeRepo({ config: BASIC })
  r.commit('feat: a', { 'zones/a.md': 'a', 'changes/a.md': fragment({ category: 'mechanics' }) })
  r.commit('feat: b', { 'zones/b.md': 'b', 'changes/a.md': null })
  assert.deepEqual(missingSubjects(loadConfig(r.dir)), [['feat: b']])
})

test('check: exclusions — release commits (with and without #N), non-content-only commits', () => {
  const r = makeRepo({ config: BASIC })
  r.commit('chore: release v1.0.0', { 'zones/a.md': 'a' })
  r.commit('chore: release v1.0.1 (#12)', { 'zones/b.md': 'b' })
  r.commit('chore: release v1.0.2 (draft)', { 'zones/c.md': 'c' })
  r.commit('chore: tooling', { 'tools/x.mjs': 'x', 'CHANGELOG.md': '# Changelog\n' })
  assert.deepEqual(missingSubjects(loadConfig(r.dir)), [['chore: release v1.0.2 (draft)']])
})

test('check: a merge commit joins its side commits in one unit', () => {
  const r = makeRepo({ config: BASIC })
  r.git('switch', '-q', '-c', 'feature')
  r.commit('feat: step 1', { 'zones/a.md': 'a' })
  r.commit('feat: step 2', { 'zones/b.md': 'b', 'changes/ab.md': fragment({ category: 'mechanics' }) })
  r.git('switch', '-q', 'main')
  r.git('switch', '-q', '-c', 'other')
  r.commit('feat: other 1', { 'zones/c.md': 'c' })
  r.git('switch', '-q', 'main')
  r.commit('feat: on main', { 'mobs/m.md': 'm', 'changes/m.md': fragment({ category: 'fixes' }) })
  r.git('merge', '-q', '--no-ff', 'feature', '-m', 'Merge feature')
  r.git('merge', '-q', '--no-ff', 'other', '-m', 'Merge other')
  // feature's unit is covered by its last commit; other's isn't; merges never stand alone
  assert.deepEqual(missingSubjects(loadConfig(r.dir)), [['Merge other', 'feat: other 1']])
})

test('check: on a task branch, origin/main..HEAD is one pending unit', () => {
  const r = makeRepo({ origin: true, config: BASIC })
  r.git('push', '-q', 'origin', 'main')
  r.git('switch', '-q', '-c', 'task/1-x')
  r.commit('feat: step 1', { 'zones/a.md': 'a' })
  r.commit('feat: step 2', { 'zones/b.md': 'b' })
  const cfg = loadConfig(r.dir)
  assert.deepEqual(missingSubjects(cfg), [['feat: step 2', 'feat: step 1']])
  r.commit('docs: add changelog fragment', { 'changes/1-x.md': fragment({ category: 'mechanics' }) })
  assert.deepEqual(missingSubjects(cfg), [])
})

test('check: invalid fragments fail the gate, tracked or not', () => {
  const r = makeRepo({ config: BASIC })
  r.write('changes/bad.md', fragment({ category: 'nope' }))
  const res = check(loadConfig(r.dir))
  assert.deepEqual(res.invalid, [{ file: 'changes/bad.md', error: 'unknown category "nope"' }])
  const json = JSON.parse(cli(r.dir, 'check', '--json').stdout)
  assert.deepEqual(Object.keys(json), ['from', 'missing', 'invalid'])
})

// ---------- render ----------

function renderRepo(groupBy) {
  const r = makeRepo({ config: { ...BASIC, groupBy } })
  r.commit('feat: 2', { 'changes/b.md': fragment({ category: 'mechanics', area: 'wolves' }, 'Wolves hit harder.') })
  r.commit('feat: 1', { 'changes/a.md': fragment({ category: 'mechanics', area: ['start', 'wolves'] }, 'Start has wolves.') })
  r.commit('feat: 3', { 'changes/c.md': fragment({ category: 'fixes' }, 'Typo fixed.') })
  r.commit('chore: 4', { 'changes/d.md': fragment({ category: 'tooling' }, 'New linter.') })
  r.commit('chore: 5', { 'changes/s.md': fragment({ skip: true }, 'Nothing.') })
  r.write('changes/0-new.md', fragment({ category: 'mechanics' }, 'Uncommitted.'))
  const hash = (f) => r.git('log', '--diff-filter=A', '--format=%H', '-1', '--', f)
  const link = (f) => { const h = hash(f); return ` [\`${h.slice(0, 7)}\`](https://x/commit/${h})` }
  const cfg = loadConfig(r.dir)
  return { r, cfg, out: render(cfg, readFragments(cfg).fragments), link }
}

test('render: groupBy category — area labels, commit order, uncommitted last, collapsed, skip ignored', () => {
  const { out, link } = renderRepo('category')
  assert.equal(out, [
    '### Mechanics',
    `- Wolves hit harder. (Wolves)${link('changes/b.md')}`,
    `- Start has wolves. (Starting zone, Wolves)${link('changes/a.md')}`,
    '- Uncommitted.',
    '### Bug fixes',
    `- Typo fixed.${link('changes/c.md')}`,
    '<details><summary>Tooling</summary>',
    '',
    `- New linter.${link('changes/d.md')}`,
    '',
    '</details>',
    '',
  ].join('\n'))
})

test('render: groupBy area — General last', () => {
  const { out, link } = renderRepo('area')
  assert.equal(out, [
    '### Starting zone',
    `- Start has wolves. *(Mechanics)*${link('changes/a.md')}`,
    '### Wolves',
    `- Wolves hit harder. *(Mechanics)*${link('changes/b.md')}`,
    `- Start has wolves. *(Mechanics)*${link('changes/a.md')}`,
    '### General',
    `- Typo fixed. *(Bug fixes)*${link('changes/c.md')}`,
    `- New linter. *(Tooling)*${link('changes/d.md')}`,
    '- Uncommitted. *(Mechanics)*',
    '',
  ].join('\n'))
})

test('render: groupBy area>category', () => {
  const { out, link } = renderRepo('area>category')
  assert.equal(out, [
    '### Starting zone',
    '#### Mechanics',
    `- Start has wolves.${link('changes/a.md')}`,
    '### Wolves',
    '#### Mechanics',
    `- Wolves hit harder.${link('changes/b.md')}`,
    `- Start has wolves.${link('changes/a.md')}`,
    '### General',
    '#### Mechanics',
    '- Uncommitted.',
    '#### Bug fixes',
    `- Typo fixed.${link('changes/c.md')}`,
    '#### Tooling',
    `- New linter.${link('changes/d.md')}`,
    '',
  ].join('\n'))
})

test('render: a backfilled fragment links and orders by its commit: (escalation)', () => {
  const r = makeRepo({ config: BASIC })
  const old = r.commit('feat: old', { 'zones/a.md': 'a' })
  r.commit('feat: new', { 'zones/b.md': 'b', 'changes/b.md': fragment({ category: 'fixes' }, 'New.') })
  r.write('changes/a.md', fragment({ category: 'fixes', commit: old }, 'Old.'))
  const cfg = loadConfig(r.dir)
  const out = render(cfg, readFragments(cfg).fragments)
  assert.match(out, new RegExp(`^### Bug fixes\\n- Old\\. \\[\`${old.slice(0, 7)}\`\\]\\(https://x/commit/${old}\\)\\n- New\\.`))
})

test('render: no fragments, version heading, no commitUrl', () => {
  const r = makeRepo({ config: { ...BASIC, commitUrl: null } })
  const cfg = loadConfig(r.dir)
  assert.equal(render(cfg, []), 'No changes.\n')
  assert.equal(render(cfg, [], { version: '1.2.0', date: '2026-11-10' }), '## v1.2.0 — 2026-11-10\nNo changes.\n')
  r.commit('x', { 'changes/a.md': fragment({ category: 'fixes' }, 'Linkless.') })
  assert.equal(cli(r.dir, 'render').stdout, '### Bug fixes\n- Linkless.\n')
})

// ---------- cut / notes ----------

test('insertSection: below the first # heading, above earlier releases', () => {
  assert.equal(insertSection(null, '## v1 — d\nX\n'), '# Changelog\n\n## v1 — d\nX\n')
  assert.equal(insertSection('# Changelog\n\nIntro.\n\n## v0 — d\nOld\n', '## v1 — d\nX\n'), '# Changelog\n\n## v1 — d\nX\n\nIntro.\n\n## v0 — d\nOld\n')
  assert.equal(insertSection('# Changelog', '## v1 — d\nX\n'), '# Changelog\n\n## v1 — d\nX\n')
})

test('cut: writes the section, consumes tracked, untracked and skip fragments, refuses a repeat', () => {
  const r = makeRepo({ config: BASIC })
  r.commit('chore: changelog', { 'CHANGELOG.md': '# Changelog\n\n## v0.1.0 — 2026-01-01\n- Old.\n' })
  r.commit('feat: a', { 'changes/a.md': fragment({ category: 'fixes' }, 'Fixed A.'), 'changes/s.md': fragment({ skip: true }, 'n/a') })
  r.write('changes/b.md', fragment({ category: 'fixes' }, 'Fixed B.'))
  const cfg = loadConfig(r.dir)
  assert.equal(cut(cfg, '0.2.0', '2026-11-10'), 3)
  const text = fs.readFileSync(path.join(r.dir, 'CHANGELOG.md'), 'utf8')
  assert.match(text, /^# Changelog\n\n## v0\.2\.0 — 2026-11-10\n### Bug fixes\n- Fixed A\. \[`[0-9a-f]{7}`\]\([^)]+\)\n- Fixed B\.\n\n## v0\.1\.0/)
  const left = path.join(r.dir, 'changes')
  assert.deepEqual(fs.existsSync(left) ? fs.readdirSync(left) : [], [])
  assert.equal(r.git('status', '--porcelain', '--', 'changes'), 'D  changes/a.md\nD  changes/s.md')
  const undo = path.join(r.dir, '.git/doc-changelog-undo')
  assert.deepEqual(fs.readdirSync(undo).sort(), ['a.md', 'b.md', 's.md'])
  assert.throws(() => cut(cfg, '0.2.0', '2026-11-10'), /already has a v0\.2\.0 section/)
})

test('notes: body of a cut section, from a given file', () => {
  const r = makeRepo({ config: { ...BASIC, release: { tagPrefix: 'rules-v' } } })
  const cfg = loadConfig(r.dir)
  const text = '# Changelog\n\n## rules-v1.1.0 — 2026-02-01\n### Bug fixes\n- B.\n\n## rules-v1.0.0 — 2026-01-01\n- A.\n'
  assert.equal(notes(cfg, '1.1.0', text), '### Bug fixes\n- B.\n')
  assert.equal(notes(cfg, '1.0.0', text), '- A.\n')
  assert.throws(() => notes(cfg, '1.2.0', text), /no rules-v1\.2\.0 section/)
  fs.writeFileSync(path.join(r.base, 'cl.md'), text)
  assert.equal(cli(r.dir, 'notes', '1.0.0', '--file', path.join(r.base, 'cl.md')).stdout, '- A.\n')
})
