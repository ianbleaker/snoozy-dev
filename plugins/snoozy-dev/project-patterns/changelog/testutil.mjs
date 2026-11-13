// doc-changelog test helpers, on top of the shared temp-repo helpers in
// ../testutil.mjs (which also scrub GIT_* and isolate git config).

import path from 'node:path'
import { makeRepo as makeGitRepo, tmpDir } from '../testutil.mjs'

export { tmpDir }
export const HERE = path.dirname(new URL(import.meta.url).pathname)

// A temp repo; `config`: also commit it as doc-changelog.json.
export function makeRepo({ origin = false, config } = {}) {
  const r = makeGitRepo({ origin })
  if (config) commit(r, config)
  return r
}
const commit = (r, config) => r.commit('chore: adopt doc-changelog', { 'doc-changelog.json': JSON.stringify(config, null, 2) })

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
