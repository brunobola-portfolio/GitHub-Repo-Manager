// SPDX-License-Identifier: AGPL-3.0-only
// Pure formatting helpers for the dev orchestrator (scripts/dev.mjs).
// No I/O, no side effects — safe to import in unit tests.

export const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
}

// Matches SGR colors plus cursor/clear control sequences Vite emits.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g

export function stripAnsi(s) {
  return String(s).replace(ANSI_RE, '')
}

export function supportsColor({ isTTY = false, env = {} } = {}) {
  if (env.NO_COLOR != null) return false
  return Boolean(isTTY)
}

// kind → gutter label + color. 'up'/'down' are health transitions (dot glyph).
const LABEL_META = {
  WEB: { text: 'WEB', color: 'magenta' },
  API: { text: 'API', color: 'cyan' },
  up: { text: '●', color: 'green' },
  down: { text: '●', color: 'red' },
}
const GUTTER_WIDTH = 3 // 'WEB'/'API' are 3 cols; the dot pads to match.

export function tagLine(kind, line, { color = false, time = '' } = {}) {
  const meta = LABEL_META[kind] ?? { text: String(kind), color: 'reset' }
  const label = meta.text.padEnd(GUTTER_WIDTH, ' ')
  const gutter = color ? `${ANSI[meta.color]}${label} │${ANSI.reset}` : `${label} │`
  const ts = time ? (color ? `${ANSI.dim}${time}${ANSI.reset} ` : `${time} `) : ''
  return `${ts}${gutter} ${line}`
}
