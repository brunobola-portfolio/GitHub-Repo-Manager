import { describe, it, expect } from 'vitest'
import { supportsColor, stripAnsi } from '../dev/format.mjs'

describe('supportsColor', () => {
  it('is true for a TTY with no NO_COLOR', () => {
    expect(supportsColor({ isTTY: true, env: {} })).toBe(true)
  })
  it('is false when NO_COLOR is set, even on a TTY', () => {
    expect(supportsColor({ isTTY: true, env: { NO_COLOR: '1' } })).toBe(false)
  })
  it('is false when not a TTY', () => {
    expect(supportsColor({ isTTY: false, env: {} })).toBe(false)
  })
})

describe('stripAnsi', () => {
  it('removes SGR color codes', () => {
    expect(stripAnsi('\x1b[36mAPI\x1b[0m')).toBe('API')
  })
  it('removes cursor/clear sequences', () => {
    expect(stripAnsi('\x1b[2KLocal')).toBe('Local')
  })
})
