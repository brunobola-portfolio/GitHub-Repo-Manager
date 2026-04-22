#!/usr/bin/env node
/**
 * Pre-commit guard: reject staged JS/JSX files that contain `console.log(` or
 * `debugger;?` statements. Invoked by lint-staged with one or more file paths
 * as CLI args.
 *
 * Why a Node script (instead of inline shell/grep in lint-staged config):
 * - Portable across Windows, macOS, Linux without requiring git-bash on PATH.
 * - Clearer matching: skips matches inside single-line `//` comments.
 * - Zero dependencies beyond Node stdlib.
 *
 * Bypass in emergencies with `git commit --no-verify`.
 */

import { readFileSync } from 'node:fs'
import { relative } from 'node:path'

const CONSOLE_LOG_RE = /\bconsole\s*\.\s*log\s*\(/
const DEBUGGER_RE = /\bdebugger\s*;?/

const files = process.argv.slice(2)
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
    `\nPre-commit check failed: ${violations} console.log/debugger ` +
      `statement(s) in staged files. Remove them, or bypass with ` +
      `\`git commit --no-verify\` for a hotfix.`
  )
  process.exit(1)
}

process.exit(0)
