#!/usr/bin/env node
// Post-deploy sense check for the preview environment: is it reachable, does
// it load without console/page errors, and does the project's own preview
// check (if declared) pass. Run from the project root, after
// rebuild-and-deploy.sh. No project-specific content — see
// plugins/snoozy-dev/skills/stage-preview/SKILL.md for the skill that drives this.
//
// Usage:
//   sense-check.mjs <preview-url>
//
// Layers, each printed as one `<LAYER>: <result>` line:
//   REACH    poll the URL for up to 60s until a 2xx/3xx with a non-empty body
//   BROWSER  headless load via the project's own Playwright: console errors,
//            uncaught page errors, failed/4xx/5xx same-origin requests, blank
//            page; screenshot saved to the path on the SCREENSHOT line.
//            `unavailable` when Playwright doesn't resolve from the project —
//            the caller falls back to one batched Chrome call.
//   PROJECT  the `Preview check:` command from CLAUDE.md's ## Deploy section,
//            with `{url}` replaced by the preview URL; `none` if not declared.
//
// Final line: `SENSE CHECK: PASS | FAIL | PARTIAL` (PARTIAL = nothing failed
// but BROWSER was unavailable). Exit 0 on PASS/PARTIAL, 1 on FAIL.

import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const url = process.argv[2];
if (!url) {
  console.error('Usage: sense-check.mjs <preview-url>');
  process.exit(1);
}

const REACH_TIMEOUT_MS = 60_000;
const SCREENSHOT = path.join(os.tmpdir(), 'preview-sense-check.png');
let failed = false;
let partial = false;

// --- REACH ---------------------------------------------------------------
async function reach() {
  const deadline = Date.now() + REACH_TIMEOUT_MS;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(10_000) });
      const body = await res.text();
      if (res.status < 400 && body.trim().length > 0) return `ok (${res.status})`;
      last = `HTTP ${res.status}${body.trim() ? '' : ', empty body'}`;
    } catch (err) {
      last = err.cause?.code || err.name || String(err);
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }
  failed = true;
  return `FAIL — ${last} after ${REACH_TIMEOUT_MS / 1000}s`;
}

// --- BROWSER -------------------------------------------------------------
async function browser() {
  let chromium;
  try {
    chromium = createRequire(path.join(process.cwd(), 'package.json'))('playwright').chromium;
  } catch {
    partial = true;
    return { line: 'unavailable (playwright not resolvable from project)', errors: [] };
  }

  fs.rmSync(SCREENSHOT, { force: true });
  const errors = [];
  const origin = new URL(url).origin;
  // Preview is plain http on an IP — not a secure context without this flag,
  // which breaks apps that need crypto.subtle / randomUUID.
  const b = await chromium.launch({ args: [`--unsafely-treat-insecure-origin-as-secure=${origin}`] });
  try {
    const page = await b.newPage();
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
    page.on('requestfailed', (r) => {
      if (r.url().startsWith(origin)) errors.push(`requestfailed: ${r.url()} (${r.failure()?.errorText})`);
    });
    page.on('response', (r) => {
      if (r.url().startsWith(origin) && r.status() >= 400) errors.push(`HTTP ${r.status()}: ${r.url()}`);
    });

    await page.goto(url, { waitUntil: 'load', timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
    const text = (await page.evaluate(() => document.body?.innerText ?? '')).trim();
    if (!text) errors.push('blank page: body has no visible text after load');
    await page.screenshot({ path: SCREENSHOT, fullPage: true });
  } catch (err) {
    errors.push(`load: ${err.message.split('\n')[0]}`);
  } finally {
    await b.close();
  }

  if (errors.length) failed = true;
  return { line: errors.length ? `FAIL — ${errors.length} error(s)` : 'ok', errors };
}

// --- PROJECT -------------------------------------------------------------
function projectCheck() {
  let md = '';
  try { md = fs.readFileSync('CLAUDE.md', 'utf8'); } catch {}
  const section = md.split(/^## Deploy\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const cmd = section.match(/^Preview check:\s*(.+)$/m)?.[1]?.trim();
  if (!cmd) return { line: 'none (no `Preview check:` line in CLAUDE.md ## Deploy)', tail: '' };

  const run = spawnSync(cmd.replaceAll('{url}', url), { shell: true, encoding: 'utf8', timeout: 300_000 });
  const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-20).join('\n');
  if (run.status === 0) return { line: 'ok', tail };
  failed = true;
  return { line: `FAIL — exit ${run.status ?? run.signal}`, tail };
}

const reachLine = await reach();
console.log(`REACH: ${reachLine}`);

if (reachLine.startsWith('ok')) {
  const br = await browser();
  console.log(`BROWSER: ${br.line}`);
  for (const e of br.errors) console.log(`  ${e}`);
  if (fs.existsSync(SCREENSHOT) && !br.line.startsWith('unavailable')) console.log(`SCREENSHOT: ${SCREENSHOT}`);

  const pc = projectCheck();
  console.log(`PROJECT: ${pc.line}`);
  if (pc.tail) console.log(pc.tail.replace(/^/gm, '  '));
} else {
  console.log('BROWSER: skipped (unreachable)');
  console.log('PROJECT: skipped (unreachable)');
}

console.log(`SENSE CHECK: ${failed ? 'FAIL' : partial ? 'PARTIAL' : 'PASS'}`);
process.exit(failed ? 1 : 0);
