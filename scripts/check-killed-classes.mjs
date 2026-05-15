#!/usr/bin/env node
import { execSync } from 'node:child_process'
import process from 'node:process'

// Patterns that are safe as-is in POSIX ERE (no lookaheads).
const SIMPLE_PATTERNS = [
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
  '--ds-gradient-(primary|secondary|accent|success|premium)',
  '--ds-shadow-glow',
]

// ds-glass is killed, but ds-glassed (a real Tailwind utility) is allowed.
// git grep ERE doesn't support negative lookahead, so we grep then filter
// in Node.
const GLASS_PATTERN = 'ds-glass'
const GLASS_ALLOWED = /ds-glassed/

const EXCLUDE_FILE = ':(exclude)src/design-system.css'

/**
 * Run git grep and return stdout, or '' when there are no matches (exit 1).
 * Throws on any other non-zero exit.
 */
function gitGrep(pattern) {
  try {
    return execSync(
      `git grep -InE "${pattern}" -- "src/" "${EXCLUDE_FILE}"`,
      { encoding: 'utf8' }
    )
  } catch (err) {
    // git grep exits 1 when there are no matches — that's the success case.
    if (err.status === 1) return ''
    throw err
  }
}

// --- Run checks ---

const simpleOutput = gitGrep(SIMPLE_PATTERNS.join('|'))

const glassRaw = gitGrep(GLASS_PATTERN)
// Filter out lines that only contain the allowed ds-glassed token.
const glassOutput = glassRaw
  .split('\n')
  .filter(line => line.trim() && !GLASS_ALLOWED.test(line))
  .join('\n')

const combined = [simpleOutput, glassOutput].filter(s => s.trim()).join('\n')

if (combined.trim()) {
  console.error('❌ Found references to killed theme classes/tokens:\n')
  console.error(combined)
  console.error(
    '\nSee docs/specs/2026-05-14-premium-non-llm-theme-design.md for the kill list.'
  )
  process.exit(1)
}
