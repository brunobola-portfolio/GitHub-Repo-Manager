// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { withReplaceOnConflict } from '../lib/migration-task-config.js'

describe('withReplaceOnConflict', () => {
  it('adds onConflict=replace to a JSON config string, preserving fields', () => {
    const out = withReplaceOnConflict('{"makePrivate":true,"description":"x"}')
    expect(JSON.parse(out)).toMatchObject({ makePrivate: true, description: 'x', onConflict: 'replace' })
  })

  it('handles an object config', () => {
    expect(JSON.parse(withReplaceOnConflict({ a: 1 }))).toMatchObject({ a: 1, onConflict: 'replace' })
  })

  it('tolerates null and malformed input', () => {
    expect(JSON.parse(withReplaceOnConflict(null))).toEqual({ onConflict: 'replace' })
    expect(JSON.parse(withReplaceOnConflict('not json'))).toEqual({ onConflict: 'replace' })
    expect(JSON.parse(withReplaceOnConflict(undefined))).toEqual({ onConflict: 'replace' })
  })

  it('overrides an existing onConflict value', () => {
    expect(JSON.parse(withReplaceOnConflict('{"onConflict":"fail"}'))).toEqual({ onConflict: 'replace' })
  })
})
