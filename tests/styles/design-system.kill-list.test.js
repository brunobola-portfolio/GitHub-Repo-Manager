import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const __dirname = import.meta.dirname

const css = readFileSync(resolve(__dirname, '../../src/design-system.css'), 'utf8')

const KILL_LIST = [
  'ds-gradient-text-premium',
  'ds-gradient-text',
  'ds-shadow-glow',
  'ds-card-shimmer',
  'ds-btn-shimmer',
  'ds-border-glow',
  'ds-hover-glow',
  'ds-animate-float',
  'ds-pulse-glow',
  'ds-glass-strong',
  'ds-glass',
  '--ds-gradient-primary',
  '--ds-gradient-secondary',
  '--ds-gradient-accent',
  '--ds-gradient-success',
  '--ds-gradient-premium',
]

describe('design-system.css — killed tokens/classes are gone', () => {
  KILL_LIST.forEach((name) => {
    it(`does not contain "${name}"`, () => {
      expect(css).not.toContain(name)
    })
  })
})
