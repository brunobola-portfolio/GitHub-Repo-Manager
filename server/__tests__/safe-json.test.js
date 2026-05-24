import { describe, it, expect } from 'vitest'
import { safeJson } from '../lib/safe-json.js'

describe('safeJson', () => {
  it('parses valid JSON strings', () => {
    expect(safeJson('{"a":1}')).toEqual({ a: 1 })
    expect(safeJson('[1,2,3]')).toEqual([1, 2, 3])
    expect(safeJson('"x"')).toBe('x')
  })

  it('returns fallback on null / undefined input', () => {
    expect(safeJson(null)).toBe(null)
    expect(safeJson(undefined)).toBe(null)
    expect(safeJson(null, [])).toEqual([])
  })

  it('returns fallback on malformed JSON', () => {
    expect(safeJson('{ not json')).toBe(null)
    expect(safeJson('not json', { default: true })).toEqual({ default: true })
  })

  it('returns input unchanged when already an object', () => {
    const obj = { a: 1 }
    expect(safeJson(obj)).toBe(obj)
    const arr = [1, 2]
    expect(safeJson(arr)).toBe(arr)
  })
})
