import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { tmpDir } from './testutil.mjs'
import { detect, driftSignals, loadRegistry, otherPlatformFiles } from './deploy-convention.mjs'

const HERE = path.dirname(new URL(import.meta.url).pathname)
const CLI = path.join(HERE, 'deploy-convention.mjs')
const REGISTRY = { 'vps-systemd': { version: 2, migrations: { 1: ['a'], 2: ['b'] } } }

const V1_SETUP = '#!/bin/bash\nuseradd --system app\nsystemctl enable app\n'
const V2_SETUP = '#!/bin/bash\nuseradd --system app-deployer\ninstall -m 0440 "$tmp" /etc/sudoers.d/app-deploy\n'

// A project dir holding `files` (relative path → text).
function proj(files = {}) {
  const dir = tmpDir('deploy-convention-')
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true })
    fs.writeFileSync(path.join(dir, rel), text)
  }
  return dir
}
const v1 = (extra = {}) => proj({ 'deploy/setup.sh': V1_SETUP, 'deploy/app.service': '[Unit]\n', ...extra })
const v2 = (extra = {}) => proj({ 'deploy/setup.sh': V2_SETUP, 'deploy/app.service': '[Unit]\n', ...extra })
const VPS1 = { name: 'vps-systemd', version: 1 }
const VPS2 = { name: 'vps-systemd', version: 2 }

test('detect: no deploy/', () => {
  assert.equal(detect(proj({ 'README.md': 'x' })), null)
})

test('detect: setup.sh without a .service', () => {
  assert.equal(detect(proj({ 'deploy/setup.sh': V2_SETUP, 'deploy/deploy.sh': 'x' })), null)
})

test('detect: v1 (no sudoers drop-in)', () => {
  assert.deepEqual(detect(v1()), VPS1)
})

test('detect: v2 (sudoers drop-in)', () => {
  assert.deepEqual(detect(v2()), VPS2)
})

test('otherPlatformFiles: only the ones present at the root', () => {
  assert.deepEqual(otherPlatformFiles(proj({ 'fly.toml': '', 'compose.yaml': '', 'sub/Dockerfile': '' })), ['fly.toml', 'compose.yaml'])
  assert.deepEqual(otherPlatformFiles(proj()), [])
})

test('loadRegistry: the shipped registry, a missing file, invalid JSON', () => {
  const shipped = loadRegistry(path.join(HERE, '..'))
  assert.equal(shipped['vps-systemd'].version, 2)
  assert.ok(Array.isArray(shipped['vps-systemd'].migrations['2']))
  assert.equal(loadRegistry(tmpDir('deploy-convention-root-')), null)
  const bad = tmpDir('deploy-convention-root-')
  fs.mkdirSync(path.join(bad, 'project-patterns'))
  fs.writeFileSync(path.join(bad, 'project-patterns', 'deploy-conventions.json'), '{ nope')
  assert.equal(loadRegistry(bad), null)
})

test('drift: deploy-missing', () => {
  assert.deepEqual(driftSignals(proj(), VPS2, REGISTRY), ['deploy-missing'])
})

test('drift: other-platform, one per file', () => {
  assert.deepEqual(driftSignals(v2({ Dockerfile: '', 'fly.toml': '' }), VPS2, REGISTRY), ['other-platform:Dockerfile', 'other-platform:fly.toml'])
})

test('drift: files-newer', () => {
  assert.deepEqual(driftSignals(v2(), VPS1, REGISTRY), ['files-newer'])
})

test('drift: now-vps', () => {
  assert.deepEqual(driftSignals(v1(), 'none', REGISTRY), ['now-vps'])
})

test('drift: unrecorded', () => {
  assert.deepEqual(driftSignals(v2(), null, REGISTRY), ['unrecorded'])
})

test('drift: unknown-convention', () => {
  assert.deepEqual(driftSignals(proj(), { name: 'k8s', version: 1 }, REGISTRY), ['unknown-convention:k8s'])
})

test('no signal: vps-systemd record matching its files', () => {
  assert.deepEqual(driftSignals(v2(), VPS2, REGISTRY), [])
  assert.deepEqual(driftSignals(v1(), VPS1, REGISTRY), [])
})

test('no signal: none record without vps files', () => {
  assert.deepEqual(driftSignals(proj({ Dockerfile: '' }), 'none', REGISTRY), [])
})

test('no signal: no record and nothing detected', () => {
  assert.deepEqual(driftSignals(proj({ Dockerfile: '' }), null, REGISTRY), [])
})

test('CLI: detect prints name@version or nothing, exit 0', () => {
  let r = spawnSync('node', [CLI, 'detect', v1()], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.stdout, 'vps-systemd@1\n')
  r = spawnSync('node', [CLI, 'detect', v2()], { encoding: 'utf8' })
  assert.equal(r.stdout, 'vps-systemd@2\n')
  r = spawnSync('node', [CLI, 'detect', proj()], { encoding: 'utf8' })
  assert.equal(r.status, 0)
  assert.equal(r.stdout, '')
})
