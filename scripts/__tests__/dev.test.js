import { describe, it, expect } from 'vitest'
import { supportsColor, stripAnsi, tagLine, renderBanner } from '../dev/format.mjs'

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

describe('tagLine', () => {
  it('renders a fixed-width gutter with timestamp, no color', () => {
    expect(tagLine('API', 'GET /api/health 200 4ms', { time: '12:04:02' }))
      .toBe('12:04:02 API │ GET /api/health 200 4ms')
  })
  it('pads short labels so gutters align (WEB vs status dot)', () => {
    const api = tagLine('API', 'x', { time: '00:00:00' })
    const up = tagLine('up', 'x', { time: '00:00:00' })
    // The "│" gutter starts at the same column in both lines.
    expect(api.indexOf('│')).toBe(up.indexOf('│'))
  })
  it('colorizes the gutter when color is enabled', () => {
    const out = tagLine('API', 'x', { color: true, time: '00:00:00' })
    expect(out).toContain('\x1b[36m') // cyan for API
  })
  it('omits the timestamp when none is given', () => {
    expect(tagLine('WEB', 'hmr update')).toBe('WEB │ hmr update')
  })
})

const baseState = {
  version: '4.3.0',
  web: { url: 'http://localhost:5173', ready: true },
  api: { url: 'http://localhost:3001', healthy: true, latencyMs: 4 },
  proxyPort: 3001,
  nodeEnv: 'development',
  logLevel: 'debug',
  mock: false,
  inspector: null,
}

describe('renderBanner', () => {
  it('shows both URLs, env, log level, and off states', () => {
    const out = renderBanner(baseState)
    expect(out).toContain('http://localhost:5173')
    expect(out).toContain('http://localhost:3001')
    expect(out).toContain('healthy 4ms')
    expect(out).toContain('/api → :3001')
    expect(out).toContain('NODE_ENV development')
    expect(out).toContain('log debug')
    expect(out).toContain('mock off')
    expect(out).toContain('inspector off')
    expect(out).toContain('v4.3.0')
  })
  it('surfaces the inspector endpoint in debug mode', () => {
    const out = renderBanner({ ...baseState, inspector: 'ws://127.0.0.1:9229' })
    expect(out).toContain('ws://127.0.0.1:9229')
    expect(out).not.toContain('inspector off')
  })
  it('shows DOWN when the backend is unhealthy', () => {
    const out = renderBanner({ ...baseState, api: { ...baseState.api, healthy: false } })
    expect(out).toContain('DOWN')
  })
  it('renders a closed box (top and bottom borders)', () => {
    const out = renderBanner(baseState)
    expect(out.startsWith('┌')).toBe(true)
    expect(out.trimEnd().endsWith('┘')).toBe(true)
  })
})
