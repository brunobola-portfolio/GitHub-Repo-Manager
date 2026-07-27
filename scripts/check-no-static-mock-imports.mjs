#!/usr/bin/env node
/**
 * Guard: reject JS/JSX files that contain a top-level
 * `import ... from '.../__mocks__/...'` statement. Invoked by lint-staged with
 * explicit paths, and by `npm run guards` (CI) with `--all`.
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
 * Bypass a single commit in emergencies with `git commit --no-verify` — but
 * the `--all` sweep in CI still catches it, which is the point.
 *
 * See: feedback_vite_inline_dce_guards in project memory,
 *      docs/reports/2026-05-09-huge-diff-rendering-validation.md
 *      (no — that's a different report; the relevant report is the
 *      mock-hygiene specialist review summarised in commit ab1f1fd).
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

// Match `import ... from '...__mocks__...'` and `import '...__mocks__...'`
// at the start of a non-comment line. Requoted to handle both single + double.
const STATIC_MOCK_IMPORT_RE = /^\s*import\b[^;]*['"][^'"]*__mocks__[^'"]*['"]/

// Only src/ ships to users; the whole point of this guard is the production
// bundle, so tests/ and server/ are out of scope (and tests/ is whitelisted
// below anyway).
const ALL_ROOTS = ['src']
const ALL_EXT_RE = /\.(?:js|jsx)$/

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

// See check-debug-statements.mjs: the count makes an empty sweep (a guard that
// silently checked nothing) visible instead of passing as green.
if (argv.includes('--all')) {
  console.log(`check-no-static-mock-imports: ${files.length} tracked file(s) checked, 0 violations`)
}
