import { describe, it, expect } from 'vitest'
import {
  supportsColor,
  stripAnsi,
  tagLine,
  renderBanner,
  isProxyDownError,
  BACKEND_DOWN_HINT,
  makeThrottle,
} from '../dev/format.mjs'

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

describe('isProxyDownError', () => {
  it('matches Vite proxy ECONNREFUSED messages (with stack)', () => {
    const msg = 'http proxy error: /api/auth/session-info\nAggregateError [ECONNREFUSED]: \n    at internalConnectMultiple'
    expect(isProxyDownError(msg)).toBe(true)
  })
  it('matches even when the message is ANSI-colored', () => {
    expect(isProxyDownError('\x1b[31mhttp proxy error: /api/v1/usage\x1b[0m')).toBe(true)
  })
  it('does not match ordinary HMR / build logs', () => {
    expect(isProxyDownError('hmr update /src/App.jsx')).toBe(false)
    expect(isProxyDownError('[optimizer] bundling dependencies...')).toBe(false)
  })
})

describe('BACKEND_DOWN_HINT', () => {
  it('points at the commands that start the backend', () => {
    expect(BACKEND_DOWN_HINT).toContain('npm run dev:all')
    expect(BACKEND_DOWN_HINT).toContain('npm run dev:server')
  })
})

describe('makeThrottle', () => {
  it('passes once, then suppresses until the window elapses', () => {
    const allow = makeThrottle(1000)
    expect(allow(0)).toBe(true)
    expect(allow(500)).toBe(false)
    expect(allow(999)).toBe(false)
    expect(allow(1000)).toBe(true)
    expect(allow(1200)).toBe(false)
    expect(allow(2000)).toBe(true)
  })
})
