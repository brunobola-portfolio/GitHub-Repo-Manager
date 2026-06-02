import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const __dirname = import.meta.dirname

const css = readFileSync(resolve(__dirname, '../../src/design-system.css'), 'utf8')

const EXPECTED_TOKENS = {
  // Neutral palette is slate-aligned (matches the dominant in-app Tailwind
  // slate callsites). Accent/status/radius below are unchanged.
  '--ds-surface': '#ffffff',
  '--ds-surface-subtle': '#f8fafc',
  '--ds-surface-muted': '#f1f5f9',
  '--ds-border': '#e2e8f0',
  '--ds-fg': '#0f172a',
  '--ds-fg-muted': '#64748b',
  '--ds-surface-dark': '#0f172a',
  '--ds-fg-dark': '#f1f5f9',
  '--ds-accent-link': '#0969da',
  '--ds-accent-link-dark': '#4493f8',
  '--ds-accent-brand': '#4f46e5',
  '--ds-accent-brand-dark': '#818cf8',
  '--ds-success': '#1a7f37',
  '--ds-danger': '#cf222e',
  '--ds-cta': '#1f883d',
  '--ds-radius-sm': '4px',
  '--ds-radius': '6px',
  '--ds-radius-lg': '16px',
  '--ds-radius-xl': '24px',
}

describe('design-system.css — new tokens resolve to expected values', () => {
  Object.entries(EXPECTED_TOKENS).forEach(([token, value]) => {
    it(`${token} = ${value}`, () => {
      const re = new RegExp(`${token}(?![-\\w])\\s*:\\s*${value.replace(/[#()]/g, '\\$&')}`)
      expect(css).toMatch(re)
    })
  })
})
