#!/usr/bin/env node
// Select a /batch-tasks batch: eligibility, ordering, predicted footprints
// and the pairwise overlap drops (steps 2-4 of
// plugins/snoozy-dev/skills/batch-tasks/SKILL.md). No project-specific content. Run from
// the repo root.
//
// Usage:
//   select-batch.mjs [N] [--skip 12,34] [--bodies-dir <dir>]
//
//   N             batch cap (default 5)
//   --skip        treat these issues as dropped (e.g. a hotspot overlap the
//                 model spotted), then refill
//   --bodies-dir  write each batch member's issue body to <dir>/body-<N>.md
//
// Output: compact sections BATCH, DROPPED, WAITING, INELIGIBLE, SHARED DOCS.

import { execFileSync, execFile } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';

const execFileP = promisify(execFile);
const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20 });

let cap = 5;
let skip = new Set();
let bodiesDir = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--skip') skip = new Set(argv[++i].split(',').map((s) => Number(s.replace('#', ''))));
  else if (argv[i] === '--bodies-dir') bodiesDir = argv[++i];
  else if (/^\d+$/.test(argv[i])) cap = Number(argv[i]);
  else throw new Error(`unknown argument: ${argv[i]}`);
}

const repo = sh('git', ['remote', 'get-url', 'origin']).trim().replace(/.*[:/]([^/]+\/[^/.]+)(\.git)?$/, '$1');
sh('git', ['fetch', 'origin', 'main', '--quiet']);
const mainFiles = sh('git', ['ls-tree', '-r', '--name-only', 'origin/main']).split('\n').filter(Boolean);
const fileSet = new Set(mainFiles);
const byBase = new Map();
for (const f of mainFiles) {
  const b = f.split('/').pop();
  byBase.set(b, byBase.has(b) ? null : f); // null = ambiguous basename
}

const ready = JSON.parse(sh('gh', ['issue', 'list', '--repo', repo, '--label', 'status:ready', '--state', 'open',
  '--limit', '200', '--json', 'number,title,labels,body']));
const openIssues = new Set(JSON.parse(sh('gh', ['issue', 'list', '--repo', repo, '--state', 'open',
  '--limit', '1000', '--json', 'number'])).map((i) => i.number));
const inReview = new Set(JSON.parse(sh('gh', ['pr', 'list', '--repo', repo, '--state', 'open',
  '--limit', '200', '--json', 'headRefName']))
  .map((p) => p.headRefName.match(/^task\/(\d+)-/)?.[1]).filter(Boolean).map(Number));

const label = (issue, prefix) => issue.labels.map((l) => l.name).find((n) => n.startsWith(prefix))?.slice(prefix.length);
const nums = (s) => (s && !/^none\b/i.test(s) ? [...s.matchAll(/#(\d+)/g)].map((m) => Number(m[1])) : []);
const section = (body, name) => body.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'))?.[1];

function deps(body) {
  const block = section(body, 'Dependencies');
  if (!block) return null;
  const line = (k) => block.match(new RegExp(`^${k}:\\s*(.*)$`, 'm'))?.[1]?.trim();
  return { blockedBy: nums(line('Blocked by')), blocks: nums(line('Blocks')),
    conflicts: nums(line('Conflicts with')), decision: line('Decision needed') ?? 'none' };
}

// Paths named in text: backticked or bare tokens with a file extension.
// Paths with a slash count if they exist on main (or `keepNew`, for plans
// and ## Touches, which may name files still to be created); bare basenames
// count when they resolve to exactly one file on main.
function pathsIn(text, keepNew) {
  const out = new Set();
  for (const [, tok] of text.matchAll(/`?([\w@.\/-]+\.[a-z]{1,5})(?::[\d,-]+)?`?/gi)) {
    const t = tok.replace(/^\.\//, '');
    if (t.includes('/')) {
      if (fileSet.has(t) || (keepNew && !t.startsWith('http') && !t.includes('//'))) out.add(t);
    } else if (byBase.get(t)) out.add(byBase.get(t));
  }
  return out;
}

const PRIO = { high: 0, medium: 1, low: 2 };
const SIZE = { small: 0, medium: 1, large: 2 };
const eligible = [];
const ineligible = [];

const checks = ready.map(async (issue) => {
  const n = issue.number;
  const d = deps(issue.body);
  const size = label(issue, 'size:');
  const why = (r) => ineligible.push({ n, r });
  if (!d) return why('no ## Dependencies block');
  if (!/^none\b/i.test(d.decision)) return why(`decision needed: ${d.decision}`);
  let plan = 'none';
  if (size !== 'small') {
    plan = mainFiles.find((f) => f.startsWith(`docs/plans/${n}-`) && f.endsWith('.md'));
    if (!plan) return why(`size:${size ?? '?'} without docs/plans/${n}-*.md`);
  }
  const conflictsInReview = d.conflicts.filter((c) => inReview.has(c));
  if (conflictsInReview.length) return why(`conflicts with in-review ${conflictsInReview.map((c) => '#' + c).join(', ')}`);
  let native = [];
  try {
    const { stdout } = await execFileP('gh', ['api', `repos/${repo}/issues/${n}/dependencies/blocked_by`,
      '--jq', '[.[] | select(.state == "open") | .number]']);
    native = JSON.parse(stdout || '[]');
  } catch { /* no native links */ }
  const blockers = [...new Set([...native, ...d.blockedBy.filter((b) => openIssues.has(b))])];
  if (blockers.length) return why(`blocked by ${blockers.map((b) => '#' + b).join(', ')}`);

  const touches = section(issue.body, 'Touches');
  const fp = new Set();
  const src = [];
  if (plan !== 'none') {
    pathsIn(sh('git', ['show', `origin/main:${plan}`]), true).forEach((p) => fp.add(p));
    src.push('plan');
  }
  if (touches) { pathsIn(touches, true).forEach((p) => fp.add(p)); src.push('touches'); }
  const before = fp.size;
  pathsIn(issue.body.replace(touches ?? '', ''), false).forEach((p) => fp.add(p));
  if (fp.size > before) src.push('body');
  eligible.push({ n, issue, d, plan, size, prio: label(issue, 'priority:'), fp, src });
});
await Promise.all(checks);

eligible.sort((a, b) => (PRIO[a.prio] ?? 3) - (PRIO[b.prio] ?? 3) || (SIZE[a.size] ?? 3) - (SIZE[b.size] ?? 3)
  || b.d.blocks.length - a.d.blocks.length || a.n - b.n);

// Greedy fill in drop-rule order: a later candidate is dropped when it
// clashes with an already-kept one. Shared living docs (*.md) are kept.
const isDoc = (p) => p.endsWith('.md');
const batch = [];
const dropped = [];
const waiting = [];
const sharedDocs = [];
for (const c of eligible) {
  if (skip.has(c.n)) { dropped.push(`#${c.n} dropped — skipped by caller`); continue; }
  if (batch.length >= cap) { waiting.push(c.n); continue; }
  let clash = null;
  for (const k of batch) {
    if (c.d.conflicts.includes(k.n) || k.d.conflicts.includes(c.n)) { clash = `Conflicts with #${k.n}`; break; }
    const shared = [...c.fp].filter((p) => k.fp.has(p) && !isDoc(p));
    if (shared.length) { clash = `shares ${shared.join(', ')} with #${k.n}`; break; }
  }
  if (clash) { dropped.push(`#${c.n} dropped — ${clash}`); continue; }
  for (const k of batch) {
    const docs = [...c.fp].filter((p) => k.fp.has(p) && isDoc(p));
    if (docs.length) sharedDocs.push(`#${k.n} + #${c.n}: ${docs.join(', ')}`);
  }
  batch.push(c);
}

if (bodiesDir) {
  mkdirSync(bodiesDir, { recursive: true });
  for (const c of batch) writeFileSync(`${bodiesDir}/body-${c.n}.md`, c.issue.body);
}

const fpLine = (c) => (c.fp.size ? `[${c.src.join('+')}${c.src.join() === 'body' ? ', estimate' : ''}] ${[...c.fp].sort().join(', ')}`
  : '[none — estimate by grep]');
console.log(`REPO ${repo}`);
console.log(`BATCH (${batch.length}/${cap})`);
for (const c of batch) {
  console.log(`#${c.n} ${c.prio}/${c.size} plan=${c.plan} blocks=${c.d.blocks.length} — ${c.issue.title}`);
  console.log(`   footprint ${fpLine(c)}`);
}
console.log('DROPPED'); dropped.forEach((l) => console.log(l));
console.log(`WAITING (eligible, over cap) ${waiting.map((n) => '#' + n).join(' ') || 'none'}`);
console.log('INELIGIBLE');
ineligible.sort((a, b) => a.n - b.n).forEach(({ n, r }) => console.log(`#${n} ${r}`));
console.log('SHARED DOCS (kept)'); sharedDocs.forEach((l) => console.log(l));
if (bodiesDir) console.log(`BODIES ${bodiesDir}/body-<N>.md`);
