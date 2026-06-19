import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { lockfilesDrifted, parseInstallSummary, ensureDepsFresh } from '../dev/ensure-deps.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

describe('lockfilesDrifted', () => {
  it('is drifted when the installed snapshot is missing', () => {
    expect(lockfilesDrifted(1000, null)).toBe(true)
  })
  it('is drifted when the lockfile is newer than the snapshot', () => {
    expect(lockfilesDrifted(2000, 1000)).toBe(true)
  })
  it('is NOT drifted when the snapshot is newer (just installed)', () => {
    expect(lockfilesDrifted(1000, 2000)).toBe(false)
  })
  it('is NOT drifted when the timestamps are equal', () => {
    expect(lockfilesDrifted(1000, 1000)).toBe(false)
  })
})

describe('parseInstallSummary', () => {
  it('distils npm’s footer into added/removed/changed counts', () => {
    const footer = 'added 9 packages, removed 48 packages, changed 54 packages, and audited 964 packages in 4s'
    expect(parseInstallSummary(footer)).toBe('added 9, removed 48, changed 54')
  })
  it('reports only the verbs that appear', () => {
    expect(parseInstallSummary('added 3 packages in 1s')).toBe('added 3')
  })
  it('returns null when nothing changed', () => {
    expect(parseInstallSummary('up to date, audited 900 packages in 600ms')).toBeNull()
    expect(parseInstallSummary('')).toBeNull()
  })
})

describe('ensureDepsFresh', () => {
  it('no-ops (never spawns) when there is no package-lock.json to compare', () => {
    let started = false
    const root = path.join(__dirname, '__no_such_project__')
    const res = ensureDepsFresh(root, { onStart: () => { started = true } })
    expect(res).toEqual({ drifted: false, installed: false, code: 0, elapsedMs: 0, summary: null, output: '' })
    expect(started).toBe(false)
  })
})
