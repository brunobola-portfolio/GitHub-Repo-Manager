#!/usr/bin/env node
/**
 * Guard: reject JS/JSX files that contain `console.log(` or `debugger;?`
 * statements. Invoked by lint-staged with one or more file paths as CLI args,
 * and by `npm run guards` (CI) with `--all`.
 *
 * Why a Node script (instead of inline shell/grep in lint-staged config):
 * - Portable across Windows, macOS, Linux without requiring git-bash on PATH.
 * - Clearer matching: skips matches inside single-line `//` comments.
 * - Zero dependencies beyond Node stdlib.
 *
 * Bypass a single commit in emergencies with `git commit --no-verify` — but
 * the `--all` sweep in CI still catches it, which is the point.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

const CONSOLE_LOG_RE = /\bconsole\s*\.\s*log\s*\(/
const DEBUGGER_RE = /\bdebugger\s*;?/

// Mirrors the lint-staged globs for this guard (src + server JS/JSX). Kept in
// sync deliberately: widening it to scripts/ would fail instantly, because CLI
// tooling there prints to stdout by design.
const ALL_ROOTS = ['src', 'server']
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
  let contents
  try {
    contents = readFileSync(file, 'utf8')
  } catch (err) {
    // File may have been unstaged/deleted; skip.
    continue
  }

  const lines = contents.split(/\r?\n/)
  lines.forEach((line, idx) => {
    // Strip trailing `//` line comments so commented-out examples don't trip.
    const commentIdx = line.indexOf('//')
    const code = commentIdx >= 0 ? line.slice(0, commentIdx) : line

    if (CONSOLE_LOG_RE.test(code)) {
      console.error(
        `  ${relative(cwd, file)}:${idx + 1}  console.log()  ->  ${line.trim()}`
      )
      violations++
    }
    if (DEBUGGER_RE.test(code)) {
      console.error(
        `  ${relative(cwd, file)}:${idx + 1}  debugger        ->  ${line.trim()}`
      )
      violations++
    }
  })
}

if (violations > 0) {
  console.error(
    `\nDebug-statement check failed: ${violations} console.log/debugger ` +
      `statement(s) across ${files.length} checked file(s). Remove them, or ` +
      `route the output through the project logger.`
  )
  process.exit(1)
}

// Print the file count on the repo-wide sweep. A guard that finds nothing to
// check exits 0 and looks green — that silent-no-op failure mode is exactly
// how the old check-bundle-size.mjs decayed into a permanent warn-skip. The
// count makes an empty sweep visible in the CI log and assertable in tests.
if (argv.includes('--all')) {
  console.log(`check-debug-statements: ${files.length} tracked file(s) checked, 0 violations`)
}

process.exit(0)
