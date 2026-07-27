#!/usr/bin/env node
/**
 * Guard: reject JS/JSX/CSS files that introduce raw numeric Tailwind
 * z-index classes (`z-30`, `z-[40]`, `z-[60]`, etc.). Invoked by lint-staged
 * with explicit paths, and by `npm run guards` (CI) with `--all`.
 *
 * The PR-review surface stacks several fixed-position layers (sticky
 * status bar, FAB, floating composer, modal backdrop, ...). Drift in
 * those numbers is the canonical "z-index spaghetti" bug — one
 * carelessly-bumped value silently puts a sheet behind a backdrop.
 *
 * The contract lives at the top of src/design-system.css as CSS
 * custom properties (--ds-z-surface, --ds-z-floating, --ds-z-composer,
 * --ds-z-overlay, --ds-z-modal, --ds-z-ceiling). Consumers must use
 * `z-[var(--ds-z-NAME)]` (NAME = floating | composer | popover | modal | toast | ceiling) to opt into the contract.
 *
 * Allowed exceptions:
 *   - `z-0`, `z-10`, `z-20` — in-flow stacking inside a single component;
 *     no cross-surface coordination needed.
 *   - `z-[var(--ds-z-NAME)]` (NAME = floating | composer | popover | modal | toast | ceiling) — the canonical opt-in.
 *   - `src/design-system.css` itself — the contract owner.
 *
 * Bypass a single commit in emergencies with `git commit --no-verify` — but
 * the `--all` sweep in CI still catches it, which is the point.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative, normalize } from 'node:path'

// Match every `z-N` / `z-[N]` occurrence; the numeric floor is applied at the
// callsite via MIN_CONTRACT_Z rather than encoded in the character classes, so
// the threshold is one readable constant instead of a digit-range puzzle.
// Excludes Tailwind variant
// prefixes like `focus:`, `hover:`, `group-hover:`, `aria-*:`, `dark:`, etc.,
// where the z-N is conditional and usually serves an a11y skip-link or a
// transient hover lift — those don't participate in the global layer
// contract.
//
// Previously this enumerated only the exact contract values (30|40|50|60|
// 70|80|90), which let an off-contract value like `z-[45]` slip through
// untouched — the very "z-index spaghetti" this guard exists to catch.
// The two alternatives are kept separate (rather than a shared `\[?...\]?`)
// so match[0] reports the COMPLETE token: with an optional trailing `\]?`
// the `\b` anchors right after the last digit and `z-[45]` prints as `z-[45`.
const RAW_Z_RE = /(?<![:\w-])z-(?:\[(\d+)\]|(\d+)\b)/g

// Values below this are benign in-flow stacking inside a single component and
// are in active use (`z-0`, `z-10`, `z-20`, `z-[1]`); they don't participate
// in the cross-surface layer contract, so they stay allowed.
const MIN_CONTRACT_Z = 30

// The layer contract from src/design-system.css, ascending. A raw value is
// reported against the lowest token that still sits at or above it, so the
// message names the one token the author should have used instead of making
// them guess from a list (the old output printed the whole table every time).
const Z_TOKENS = [
  { value: 30, token: '--ds-z-floating', use: 'FABs / sticky affordances above content' },
  { value: 40, token: '--ds-z-composer', use: 'inline floating composers' },
  { value: 50, token: '--ds-z-overlay', use: 'toasts, tooltips, popovers' },
  { value: 60, token: '--ds-z-modal', use: 'modal backdrop + sheet' },
  { value: 70, token: '--ds-z-toast', use: 'toasts that must clear a modal' },
  { value: 80, token: '--ds-z-ceiling', use: 'hard-stop overlays (context menus)' },
]

function suggestToken(n) {
  const hit = Z_TOKENS.find((t) => n <= t.value) ?? Z_TOKENS[Z_TOKENS.length - 1]
  // Anything above the ceiling is by definition off-contract: there is no
  // layer above it, so the fix is to lower the *other* layer, not to invent one.
  const note = n > 80 ? ` (nothing may sit above the ceiling — lower the competing layer instead)` : ''
  return `z-[var(${hit.token})]  /* ${hit.use} */${note}`
}

const ALL_ROOTS = ['src']
const ALL_EXT_RE = /\.(?:js|jsx|css)$/

// A pre-commit hook only sees staged files and is trivially bypassed
// (`--no-verify`, a clone where husky never ran, an edit made in the GitHub
// web UI). `--all` re-checks every tracked file so CI enforces the same rule
// on code that never passed through a local hook.
function trackedFiles() {
  return execFileSync('git', ['ls-files', '-z', '--', ...ALL_ROOTS], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter((f) => f && ALL_EXT_RE.test(f))
}

const argv = process.argv.slice(2)
const files = argv.includes('--all') ? trackedFiles() : argv
if (files.length === 0) {
  process.exit(0)
}

let violations = 0
const cwd = process.cwd()

for (const file of files) {
  const norm = normalize(file).replace(/\\/g, '/')
  // The contract owner can use any z value.
  if (norm.endsWith('src/design-system.css')) continue

  let contents
  try {
    contents = readFileSync(file, 'utf8')
  } catch {
    continue
  }

  const lines = contents.split(/\r?\n/)
  // Tracks whether we're inside a /* ... */ (or JSX {/* ... */}) block
  // comment that opened on an earlier line and hasn't closed yet — needed
  // because widening RAW_Z_RE to catch two-digit values now also matches
  // prose like "the previous z-[99] was removed" inside a multi-line
  // rationale comment, which isn't a real class and must not fail the guard.
  let inBlockComment = false
  lines.forEach((line, idx) => {
    let codeLine = line

    if (inBlockComment) {
      const closeIdx = codeLine.indexOf('*/')
      if (closeIdx === -1) return // still inside the block comment
      codeLine = codeLine.slice(closeIdx + 2)
      inBlockComment = false
    }

    const trimmed = codeLine.trimStart()
    if (trimmed.startsWith('//')) return

    const openIdx = codeLine.indexOf('/*')
    if (openIdx !== -1) {
      const closeIdx = codeLine.indexOf('*/', openIdx)
      if (closeIdx === -1) {
        codeLine = codeLine.slice(0, openIdx)
        inBlockComment = true
      } else {
        codeLine = codeLine.slice(0, openIdx) + codeLine.slice(closeIdx + 2)
      }
    }

    // Skip if the line uses a token (the regex below would still match
    // a bare `z-30` even when the same line includes a tokenised one).
    const stripped = codeLine.replace(/z-\[var\(--ds-z-[^)]+\)\]/g, '')

    // Global regex: reset lastIndex per line, and report EVERY raw value on
    // the line rather than just the first, so a single pass fixes them all.
    RAW_Z_RE.lastIndex = 0
    let match
    while ((match = RAW_Z_RE.exec(stripped)) !== null) {
      const raw = Number(match[1] ?? match[2])
      if (raw < MIN_CONTRACT_Z) continue
      console.error(
        `  ${relative(cwd, file)}:${idx + 1}  raw \`${match[0]}\` -> use ${suggestToken(raw)}`
      )
      console.error(`      ${line.trim()}`)
      violations++
    }
  })
}

if (violations > 0) {
  console.error('')
  console.error(`Found ${violations} raw numeric z-index value(s) in ${files.length} checked file(s).`)
  console.error('Each line above names the token to use instead. The full contract lives')
  console.error('at the top of src/design-system.css; z-0 / z-10 / z-20 remain allowed for')
  console.error('in-flow stacking inside a single component.')
  process.exit(1)
}

// See check-debug-statements.mjs: the count makes an empty sweep (a guard that
// silently checked nothing) visible instead of passing as green.
if (argv.includes('--all')) {
  console.log(`check-no-raw-z-index: ${files.length} tracked file(s) checked, 0 violations`)
}
