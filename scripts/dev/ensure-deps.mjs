// SPDX-License-Identifier: Apache-2.0
// Fast dependency-drift guard for the dev orchestrator (scripts/dev.mjs).
//
// npm writes a snapshot of the resolved tree to node_modules/.package-lock.json
// on every install. When the root package-lock.json is newer than that snapshot
// (or the snapshot is missing) node_modules is out of sync with the lockfile —
// the classic "pulled / switched branch and forgot to reinstall" drift that
// makes Vite fail to resolve a freshly-added dependency mid-session. We detect
// that in microseconds (two stat() calls) and run `npm install` before booting.

import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import path from 'node:path'

// Pure: true when the installed snapshot is missing or older than the lockfile.
// mtimes are ms epoch; `installedMtimeMs` is null when the snapshot is absent.
export function lockfilesDrifted(rootMtimeMs, installedMtimeMs) {
  if (installedMtimeMs == null) return true
  return rootMtimeMs > installedMtimeMs
}

// Pure: distil npm's noisy install footer into one premium line, e.g.
// "added 9, removed 48, changed 54". Returns null when nothing changed
// (npm printed "up to date" or only an audit line).
export function parseInstallSummary(output) {
  const parts = []
  for (const verb of ['added', 'removed', 'changed']) {
    const m = String(output).match(new RegExp(`${verb} (\\d+) package`))
    if (m) parts.push(`${verb} ${m[1]}`)
  }
  return parts.length ? parts.join(', ') : null
}

function safeMtimeMs(file) {
  try {
    return statSync(file).mtimeMs
  } catch {
    return null
  }
}

// Reconcile node_modules with the lockfile when they've drifted. Returns
// { drifted, installed, code, elapsedMs, summary, output }. Runs `npm install`
// synchronously (output captured, not inherited) so the caller can render a
// clean summary instead of npm's raw spam. Never throws — on install failure it
// returns a non-zero `code` and the captured output for the caller to surface.
export function ensureDepsFresh(root, { onStart, now = Date.now } = {}) {
  const idle = { drifted: false, installed: false, code: 0, elapsedMs: 0, summary: null, output: '' }

  const rootMtime = safeMtimeMs(path.join(root, 'package-lock.json'))
  // No lockfile at all (e.g. a detached/partial checkout) — nothing to compare.
  if (rootMtime == null) return idle

  const installedMtime = safeMtimeMs(path.join(root, 'node_modules', '.package-lock.json'))
  if (!lockfilesDrifted(rootMtime, installedMtime)) return idle

  onStart?.()
  const started = now()
  // --no-audit/--no-fund/--no-progress keep the captured output terse. shell:true
  // lets Windows resolve `npm` → npm.cmd via PATHEXT; args are static (no
  // interpolation) so there's no shell-injection surface here.
  const res = spawnSync('npm', ['install', '--no-audit', '--no-fund', '--no-progress'], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
  })
  const output = `${res.stdout || ''}${res.stderr || ''}`
  return {
    drifted: true,
    installed: true,
    code: res.status ?? 1,
    elapsedMs: now() - started,
    summary: parseInstallSummary(output),
    output,
  }
}
