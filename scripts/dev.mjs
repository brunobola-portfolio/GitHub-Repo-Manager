#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
// Premium dev orchestrator for `npm run dev:all`.
//
// Supervises the Express backend + Vite dev server in ONE process so it can
// render a unified terminal: a startup banner, per-service line tagging
// (WEB/API), live backend health, and an optional --inspect debug mode.
// Cross-platform (Windows-first). No runtime dependencies beyond Vite + dotenv.

import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import dotenv from 'dotenv'
import { createServer } from 'vite'
import { tagLine, renderBanner, supportsColor, stripAnsi } from './dev/format.mjs'

dotenv.config({ quiet: true })

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const pkg = require('../package.json')

const DEBUG = process.argv.includes('--debug')
const COLOR = supportsColor({ isTTY: process.stdout.isTTY, env: process.env })

// Read the few env vars the banner needs directly (mirrors server/config.js
// defaults). We deliberately do NOT import server/config.js — it validates and
// can process.exit on missing secrets, which must not abort the dev launcher.
const PORT = Number(process.env.PORT) || 3001
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'
const NODE_ENV = process.env.NODE_ENV || 'development'
// Mirror server/lib/logger.js: dev effective level is LOG_LEVEL || 'debug'.
const LOG_LEVEL = process.env.LOG_LEVEL || 'debug'
const MOCK = process.env.VITE_MOCK_MODE === 'true'
const HEALTH_URL = `http://localhost:${PORT}/api/health`
const INSPECTOR_URL = DEBUG ? 'ws://127.0.0.1:9229' : null

const delay = (ms) => new Promise((r) => setTimeout(r, ms))
const clock = () => new Date().toTimeString().slice(0, 8) // HH:MM:SS local

function emit(kind, line) {
  process.stdout.write(tagLine(kind, line, { color: COLOR, time: clock() }) + '\n')
}

// ---- backend child process ------------------------------------------------
const serverArgs = DEBUG ? ['--inspect', 'server/index.js'] : ['server/index.js']
const backend = spawn(process.execPath, serverArgs, {
  cwd: ROOT,
  env: process.env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
for (const stream of [backend.stdout, backend.stderr]) {
  createInterface({ input: stream }).on('line', (line) => {
    if (line.trim()) emit('API', stripAnsi(line).trimEnd())
  })
}
backend.on('exit', (code) => {
  if (code && code !== 0) {
    emit('down', `backend exited (code ${code}) — if a port is stuck, run: npm run dev:kill`)
  }
})

// ---- vite dev server (programmatic) ---------------------------------------
// customLogger routes Vite/HMR output through our WEB gutter; we suppress
// Vite's own startup URL block since the banner below already shows it.
const SKIP_VITE = /(VITE v|ready in|Local:|Network:|press h \+ enter|use --host)/i
function viteLogger() {
  const toWeb = (msg) => {
    for (const raw of String(msg).split('\n')) {
      const l = stripAnsi(raw).trimEnd()
      if (l && !SKIP_VITE.test(l)) emit('WEB', l)
    }
  }
  return {
    info: toWeb,
    warn: toWeb,
    warnOnce: toWeb,
    error: toWeb,
    clearScreen() {},
    hasErrorLogged() { return false },
    hasWarned: false,
  }
}

const vite = await createServer({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.js'),
  customLogger: viteLogger(),
})
await vite.listen()
const webUrl = vite.resolvedUrls?.local?.[0]?.replace(/\/$/, '') || FRONTEND_URL

// ---- health probing -------------------------------------------------------
async function probe() {
  const started = Date.now()
  try {
    const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(2000) })
    return { ok: res.ok, latency: Date.now() - started }
  } catch {
    return { ok: false, latency: Date.now() - started }
  }
}

// Give the backend up to ~10s to come up so the first banner usually shows healthy.
let first = await probe()
const deadline = Date.now() + 10000
while (!first.ok && Date.now() < deadline) {
  await delay(250)
  first = await probe()
}
let healthy = first.ok

process.stdout.write('\n' + renderBanner({
  version: pkg.version,
  web: { url: webUrl, ready: true },
  api: { url: `http://localhost:${PORT}`, healthy: first.ok, latencyMs: first.latency },
  proxyPort: PORT,
  nodeEnv: NODE_ENV,
  logLevel: LOG_LEVEL,
  mock: MOCK,
  inspector: INSPECTOR_URL,
}, { color: COLOR }) + '\n\n')

// Report only health transitions so steady state stays quiet.
const watcher = setInterval(async () => {
  const { ok, latency } = await probe()
  if (ok === healthy) return
  healthy = ok
  if (ok) emit('up', `API back — healthy ${latency}ms`)
  else emit('down', `API down — retrying ${HEALTH_URL}`)
}, 4000)

// ---- lifecycle ------------------------------------------------------------
let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  clearInterval(watcher)
  process.stdout.write('\n')
  emit('down', 'shutting down dev environment…')
  try { await vite.close() } catch { /* already closed */ }
  try { backend.kill() } catch { /* already gone */ }
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
