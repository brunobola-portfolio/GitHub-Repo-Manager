#!/usr/bin/env node
/*
 * Extract a single version's section from CHANGELOG.md so the Release workflow
 * can publish curated notes instead of GitHub's auto-generated commit list.
 *
 * Usage: node scripts/extract-changelog.mjs 4.6.0   (accepts "4.6.0" or "v4.6.0")
 * Prints the body between "## [<version>]" and the next "## [" heading to
 * stdout. Exits 0 with empty output if the version isn't found (the workflow
 * falls back to --generate-notes), never failing the release on a formatting
 * mismatch.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const raw = String(process.argv[2] || '').trim().replace(/^v/, '')
if (!raw) process.exit(0)

const changelogPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md')

let text
try {
    text = readFileSync(changelogPath, 'utf8')
} catch {
    process.exit(0)
}

const lines = text.split(/\r?\n/)
// Match "## [4.6.0]" with an optional " - date" suffix; escape the dots.
const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const startRe = new RegExp(`^##\\s*\\[${escaped}\\]`)
const anyHeadingRe = /^##\s*\[/

let start = -1
for (let i = 0; i < lines.length; i++) {
    if (startRe.test(lines[i])) { start = i; break }
}
if (start === -1) process.exit(0)

let end = lines.length
for (let i = start + 1; i < lines.length; i++) {
    if (anyHeadingRe.test(lines[i])) { end = i; break }
}

const body = lines.slice(start + 1, end).join('\n').trim()
process.stdout.write(body + '\n')
