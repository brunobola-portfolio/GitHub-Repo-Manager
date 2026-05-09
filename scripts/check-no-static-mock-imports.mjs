#!/usr/bin/env node
/**
 * Pre-commit guard: reject staged JS/JSX files that contain a top-level
 * `import ... from '.../__mocks__/...'` statement.
 *
 * Why this matters: Vite's tree-shaker can drop unused exports of an
 * imported module, but it CANNOT drop a still-imported module from the
 * dependency graph. A static `import { mockX } from '../__mocks__/foo'`
 * pins the entire mock module in the production bundle even when every
 * reference to `mockX` is inside an `import.meta.env.DEV && ...` branch
 * that gets dead-code-eliminated. Result: fixture data ships in prod
 * bundles as static JS bytes (bundle bloat + minor info-disclosure).
 *
 * Safe pattern (enforced everywhere by convention):
 *
 *     if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {
 *         const { mockX } = await import('../__mocks__/foo.js')
 *         ...
 *     }
 *
 * Violations are easy to introduce under code-review pressure (the file
 * works in dev, tests pass, prod build succeeds — only the bundle
 * silently grows). This guard makes them impossible to commit.
 *
 * Bypass in emergencies with `git commit --no-verify`.
 *
 * See: feedback_vite_inline_dce_guards in project memory,
 *      docs/reports/2026-05-09-huge-diff-rendering-validation.md
 *      (no — that's a different report; the relevant report is the
 *      mock-hygiene specialist review summarised in commit ab1f1fd).
 */

import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

// Match `import ... from '...__mocks__...'` and `import '...__mocks__...'`
// at the start of a non-comment line. Requoted to handle both single + double.
const STATIC_MOCK_IMPORT_RE = /^\s*import\b[^;]*['"][^'"]*__mocks__[^'"]*['"]/

const files = process.argv.slice(2)
if (files.length === 0) {
  process.exit(0)
}

let violations = 0
const cwd = process.cwd()

for (const file of files) {
  // Whitelist: the mock files themselves can re-export from each other.
  // Test files in tests/ can also stub mock modules legitimately.
  if (file.includes('/__mocks__/') || file.includes('\\__mocks__\\')) continue
  if (file.startsWith('tests/') || file.startsWith('tests\\') || file.includes('/tests/') || file.includes('\\tests\\')) continue

  let contents
  try {
    contents = readFileSync(file, 'utf8')
  } catch {
    // File may have been unstaged/deleted; skip.
    continue
  }

  const lines = contents.split(/\r?\n/)
  lines.forEach((line, idx) => {
    // Skip lines that are themselves comments.
    const trimmed = line.trimStart()
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) return

    if (STATIC_MOCK_IMPORT_RE.test(line)) {
      console.error(
        `  ${relative(cwd, file)}:${idx + 1}  static __mocks__ import  ->  ${line.trim()}`
      )
      violations++
    }
  })
}

if (violations > 0) {
  console.error('')
  console.error(`Found ${violations} static __mocks__ import(s).`)
  console.error('Convert to a dynamic await import() inside an inlined env-checked branch:')
  console.error('')
  console.error("  if (import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true') {")
  console.error("      const { mockX } = await import('../__mocks__/foo.js')")
  console.error('      ...')
  console.error('  }')
  console.error('')
  console.error('Why: a static import pins the mock module in the production bundle even')
  console.error('     when the runtime branch is dead-code-eliminated.')
  process.exit(1)
}
