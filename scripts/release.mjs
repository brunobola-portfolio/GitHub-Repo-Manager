#!/usr/bin/env node
/*
 * Cut a release from main in one command, so none of the runbook steps
 * (docs/operations.md, "Release flow") can be skipped or half-done:
 *
 *   node scripts/release.mjs minor                 # 4.23.2 -> 4.24.0
 *   node scripts/release.mjs patch --push          # commit, tag, push
 *   node scripts/release.mjs 5.0.0 --title "..."   # explicit version
 *   node scripts/release.mjs minor --dry-run       # print, write nothing
 *
 * What it does, in order: refuses a dirty tree or a branch other than main;
 * promotes CHANGELOG.md [Unreleased] to a dated section and fixes the compare
 * links; bumps package.json and package-lock.json (version fields only, the
 * lockfile is never regenerated here); refreshes the README "What's new"
 * link; commits `chore(release): X.Y.Z`; creates the annotated tag vX.Y.Z.
 * With --push it pushes main and the tag, which is what triggers the Release,
 * Docker and Windows-package workflows (and the production deploy when the
 * AUTO_DEPLOY repository variable is set).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
    bumpVersion,
    promoteUnreleased,
    setPackageVersion,
    updateWhatsNew,
} from './lib/release-lib.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const REPO_URL = 'https://github.com/brunobola-portfolio/GitHub-Repo-Manager'

const args = process.argv.slice(2)
const flags = new Set(args.filter((a) => a.startsWith('--')))
const positional = args.filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--title')
const titleIdx = args.indexOf('--title')
const title = titleIdx === -1 ? '' : String(args[titleIdx + 1] || '').trim()
const kind = positional[0]
const dryRun = flags.has('--dry-run')
const push = flags.has('--push')

if (!kind) {
    console.error('Usage: node scripts/release.mjs <major|minor|patch|X.Y.Z> [--title "..."] [--push] [--dry-run]')
    process.exit(2)
}

function git(...a) {
    return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim()
}

const branch = git('rev-parse', '--abbrev-ref', 'HEAD')
if (branch !== 'main') fail(`Releases are cut from main; you are on "${branch}"`)
const dirty = git('status', '--porcelain')
if (dirty) fail(`The working tree is not clean:\n${dirty}`)

const pkgPath = join(ROOT, 'package.json')
const lockPath = join(ROOT, 'package-lock.json')
const changelogPath = join(ROOT, 'CHANGELOG.md')
const readmePath = join(ROOT, 'README.md')

const pkgText = readFileSync(pkgPath, 'utf8')
const previous = JSON.parse(pkgText).version
const version = bumpVersion(previous, kind)
const date = new Date().toISOString().slice(0, 10)

if (git('tag', '--list', `v${version}`)) fail(`Tag v${version} already exists`)

const changelog = promoteUnreleased(readFileSync(changelogPath, 'utf8'), { version, previous, date, repoUrl: REPO_URL })
const pkg = setPackageVersion(pkgText, version)
const lock = setPackageVersion(readFileSync(lockPath, 'utf8'), version, { lockfile: true })
const readme = updateWhatsNew(readFileSync(readmePath, 'utf8'), { version, date, title })

console.log(`${previous} -> ${version} (${date})${dryRun ? '  [dry run]' : ''}`)
if (dryRun) {
    console.log('Would write CHANGELOG.md, package.json, package-lock.json, README.md; commit; tag v' + version + (push ? '; push' : ''))
    process.exit(0)
}

writeFileSync(changelogPath, changelog)
writeFileSync(pkgPath, pkg)
writeFileSync(lockPath, lock)
writeFileSync(readmePath, readme)

git('add', 'CHANGELOG.md', 'package.json', 'package-lock.json', 'README.md')
git('commit', '-m', `chore(release): ${version}`)
git('tag', '-a', `v${version}`, '-m', `v${version}`)
console.log(`Committed and tagged v${version}`)

if (push) {
    git('push', 'origin', 'main', `v${version}`)
    console.log('Pushed main and the tag — the Release workflow takes it from here')
} else {
    console.log(`Next: git push origin main v${version}`)
}

function fail(msg) {
    console.error(msg)
    process.exit(1)
}
