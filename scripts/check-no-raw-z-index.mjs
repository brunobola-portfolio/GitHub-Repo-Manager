#!/usr/bin/env node
/**
 * Pre-commit guard: reject staged JS/JSX/CSS files that introduce raw
 * numeric Tailwind z-index classes (`z-30`, `z-[40]`, `z-[60]`, etc.).
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
 * Bypass in emergencies with `git commit --no-verify`.
 */

import { readFileSync } from 'node:fs'
import { relative, normalize } from 'node:path'

// Match `z-30`, `z-45`, `z-[60]`, `z-50`, `z-[100]`, etc. — any raw numeric
// value >= 30 (two-or-more digits) that should be using a token instead.
// (z-0, z-10, z-20 are fine for in-flow stacking.) Excludes Tailwind variant
// prefixes like `focus:`, `hover:`, `group-hover:`, `aria-*:`, `dark:`, etc.,
// where the z-N is conditional and usually serves an a11y skip-link or a
// transient hover lift — those don't participate in the global layer
// contract.
//
// Previously this enumerated only the exact contract values (30|40|50|60|
// 70|80|90), which let an off-contract value like `z-[45]` slip through
// untouched — the very "z-index spaghetti" this guard exists to catch.
// `[3-9]\d` covers every two-digit value 30-99; `\d{3,}` covers 100+.
const RAW_Z_RE = /(?<![:\w-])z-(?:\[?(?:[3-9]\d|\d{3,})\]?)\b/

const files = process.argv.slice(2)
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

    if (RAW_Z_RE.test(stripped)) {
      console.error(
        `  ${relative(cwd, file)}:${idx + 1}  raw z-index  ->  ${line.trim()}`
      )
      violations++
    }
  })
}

if (violations > 0) {
  console.error('')
  console.error(`Found ${violations} raw numeric z-index value(s).`)
  console.error('Use the design-system tokens to opt into the layering contract:')
  console.error('')
  console.error('  z-[var(--ds-z-floating)]   /* FABs that sit above content   */')
  console.error('  z-[var(--ds-z-composer)]   /* inline floating composers     */')
  console.error('  z-[var(--ds-z-overlay)]    /* toasts, tooltips, popovers    */')
  console.error('  z-[var(--ds-z-modal)]      /* modal backdrop + sheet        */')
  console.error('  z-[var(--ds-z-ceiling)]    /* hard-stop overlays            */')
  console.error('')
  console.error('Tokens live in src/design-system.css. z-0 / z-10 / z-20 are')
  console.error('still allowed for in-flow stacking inside a single component.')
  process.exit(1)
}
