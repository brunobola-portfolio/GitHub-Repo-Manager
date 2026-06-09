# Premium Dev Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `npm run dev:all` plumbing with a single Node orchestrator that renders a unified, premium dev terminal — clear port/URL separation, per-service line tagging, live backend health, and an optional `--inspect` debug mode.

**Architecture:** One supervising process (`scripts/dev.mjs`) spawns the Express backend as a child and boots Vite via its programmatic API with a `customLogger`. Pure, unit-tested formatting helpers (`scripts/dev/format.mjs`) own the banner and per-line tagging; the orchestrator wires them to real streams plus a `/api/health` poller.

**Tech Stack:** Node 20+ (built-in `child_process`, `readline`, global `fetch`), Vite 8 programmatic API, `dotenv` (already a dep), Vitest 4 (node environment).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `scripts/dev/format.mjs` | **New, pure.** ANSI color constants, `supportsColor`, `stripAnsi`, `tagLine`, `renderBanner`. No I/O, no side effects — safe to import in tests. |
| `scripts/__tests__/dev.test.js` | **New.** Unit tests for every export of `format.mjs`. Runs in the `node` env (per `vitest.config.js`). |
| `scripts/dev.mjs` | **New, side-effectful.** Orchestrator entry: spawn backend, boot Vite, print banner, poll health, handle lifecycle. Run via `node scripts/dev.mjs`. |
| `package.json` | **Modify.** Point `dev:all` at the orchestrator; add `dev:all:debug`. |

`scripts/dev/format.mjs` is split from `scripts/dev.mjs` precisely so the orchestrator's spawn/listen side effects never run when a test imports the pure helpers.

---

## Task 1: Pure helpers — `supportsColor` + `stripAnsi`

**Files:**
- Create: `scripts/dev/format.mjs`
- Test: `scripts/__tests__/dev.test.js`

- [ ] **Step 1: Write the failing test**

Create `scripts/__tests__/dev.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { supportsColor, stripAnsi } from '../dev/format.mjs'

describe('supportsColor', () => {
  it('is true for a TTY with no NO_COLOR', () => {
    expect(supportsColor({ isTTY: true, env: {} })).toBe(true)
  })
  it('is false when NO_COLOR is set, even on a TTY', () => {
    expect(supportsColor({ isTTY: true, env: { NO_COLOR: '1' } })).toBe(false)
  })
  it('is false when not a TTY', () => {
    expect(supportsColor({ isTTY: false, env: {} })).toBe(false)
  })
})

describe('stripAnsi', () => {
  it('removes SGR color codes', () => {
    expect(stripAnsi('\x1b[36mAPI\x1b[0m')).toBe('API')
  })
  it('removes cursor/clear sequences', () => {
    expect(stripAnsi('\x1b[2KLocal')).toBe('Local')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/dev.test.js`
Expected: FAIL — `Failed to resolve import "../dev/format.mjs"`.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/dev/format.mjs`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
// Pure formatting helpers for the dev orchestrator (scripts/dev.mjs).
// No I/O, no side effects — safe to import in unit tests.

export const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
}

// Matches SGR colors plus cursor/clear control sequences Vite emits.
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]/g

export function stripAnsi(s) {
  return String(s).replace(ANSI_RE, '')
}

export function supportsColor({ isTTY = false, env = {} } = {}) {
  if (env.NO_COLOR != null) return false
  return Boolean(isTTY)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/dev.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/dev/format.mjs scripts/__tests__/dev.test.js
git commit -m "feat(dev): add color/ansi helpers for dev orchestrator"
```

---

## Task 2: Pure helper — `tagLine`

**Files:**
- Modify: `scripts/dev/format.mjs`
- Test: `scripts/__tests__/dev.test.js`

- [ ] **Step 1: Write the failing test**

Append to `scripts/__tests__/dev.test.js`:

```js
import { tagLine } from '../dev/format.mjs'

describe('tagLine', () => {
  it('renders a fixed-width gutter with timestamp, no color', () => {
    expect(tagLine('API', 'GET /api/health 200 4ms', { time: '12:04:02' }))
      .toBe('12:04:02 API │ GET /api/health 200 4ms')
  })
  it('pads short labels so gutters align (WEB vs status dot)', () => {
    const api = tagLine('API', 'x', { time: '00:00:00' })
    const up = tagLine('up', 'x', { time: '00:00:00' })
    // " │ x" starts at the same column in both lines
    expect(api.indexOf('│')).toBe(up.indexOf('│'))
  })
  it('colorizes the gutter when color is enabled', () => {
    const out = tagLine('API', 'x', { color: true, time: '00:00:00' })
    expect(out).toContain('\x1b[36m') // cyan for API
  })
  it('omits the timestamp when none is given', () => {
    expect(tagLine('WEB', 'hmr update')).toBe('WEB │ hmr update')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/dev.test.js -t tagLine`
Expected: FAIL — `tagLine is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/dev/format.mjs`:

```js
// kind → gutter label + color. 'up'/'down' are health transitions (dot glyph).
const LABEL_META = {
  WEB: { text: 'WEB', color: 'magenta' },
  API: { text: 'API', color: 'cyan' },
  up: { text: '●', color: 'green' },
  down: { text: '●', color: 'red' },
}
const GUTTER_WIDTH = 3 // 'WEB'/'API' are 3 cols; the dot pads to match.

export function tagLine(kind, line, { color = false, time = '' } = {}) {
  const meta = LABEL_META[kind] ?? { text: String(kind), color: 'reset' }
  const label = meta.text.padEnd(GUTTER_WIDTH, ' ')
  const gutter = color ? `${ANSI[meta.color]}${label} │${ANSI.reset}` : `${label} │`
  const ts = time ? (color ? `${ANSI.dim}${time}${ANSI.reset} ` : `${time} `) : ''
  return `${ts}${gutter} ${line}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/dev.test.js -t tagLine`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/dev/format.mjs scripts/__tests__/dev.test.js
git commit -m "feat(dev): add per-service line tagger"
```

---

## Task 3: Pure helper — `renderBanner`

**Files:**
- Modify: `scripts/dev/format.mjs`
- Test: `scripts/__tests__/dev.test.js`

- [ ] **Step 1: Write the failing test**

Append to `scripts/__tests__/dev.test.js`:

```js
import { renderBanner } from '../dev/format.mjs'

const baseState = {
  version: '4.3.0',
  web: { url: 'http://localhost:5173', ready: true },
  api: { url: 'http://localhost:3001', healthy: true, latencyMs: 4 },
  proxyPort: 3001,
  nodeEnv: 'development',
  logLevel: 'debug',
  mock: false,
  inspector: null,
}

describe('renderBanner', () => {
  it('shows both URLs, env, log level, and off states', () => {
    const out = renderBanner(baseState)
    expect(out).toContain('http://localhost:5173')
    expect(out).toContain('http://localhost:3001')
    expect(out).toContain('healthy 4ms')
    expect(out).toContain('/api → :3001')
    expect(out).toContain('NODE_ENV development')
    expect(out).toContain('log debug')
    expect(out).toContain('mock off')
    expect(out).toContain('inspector off')
    expect(out).toContain('v4.3.0')
  })
  it('surfaces the inspector endpoint in debug mode', () => {
    const out = renderBanner({ ...baseState, inspector: 'ws://127.0.0.1:9229' })
    expect(out).toContain('ws://127.0.0.1:9229')
    expect(out).not.toContain('inspector off')
  })
  it('shows DOWN when the backend is unhealthy', () => {
    const out = renderBanner({ ...baseState, api: { ...baseState.api, healthy: false } })
    expect(out).toContain('DOWN')
  })
  it('renders a closed box (top and bottom borders)', () => {
    const out = renderBanner(baseState)
    expect(out.startsWith('┌')).toBe(true)
    expect(out.trimEnd().endsWith('┘')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/dev.test.js -t renderBanner`
Expected: FAIL — `renderBanner is not a function` / import error.

- [ ] **Step 3: Write minimal implementation**

Append to `scripts/dev/format.mjs`:

```js
const visibleLen = (s) => stripAnsi(s).length

function boxify(lines, { color = false } = {}) {
  const width = Math.max(...lines.map(visibleLen))
  const d = (s) => (color ? `${ANSI.dim}${s}${ANSI.reset}` : s)
  const bar = '─'.repeat(width + 2)
  const side = d('│')
  const body = lines
    .map((l) => `${side} ${l}${' '.repeat(width - visibleLen(l))} ${side}`)
    .join('\n')
  return [d(`┌${bar}┐`), body, d(`└${bar}┘`)].join('\n')
}

export function renderBanner(state, { color = false } = {}) {
  const paint = (name, s) => (color ? `${ANSI[name]}${s}${ANSI.reset}` : s)
  const dot = paint('green', '●')
  const webStatus = state.web.ready ? 'Vite ready' : 'starting…'
  const apiStatus = state.api.healthy ? `healthy ${state.api.latencyMs}ms` : paint('red', 'DOWN')
  const inspector = state.inspector
    ? `inspector ${paint('green', '◉')} ${state.inspector}`
    : 'inspector off'

  const lines = [
    `${paint('bold', 'GitHub Repo Manager · dev')}   v${state.version}`,
    '',
    `${dot} WEB   ${state.web.url}   ${webStatus}`,
    `${dot} API   ${state.api.url}   ${apiStatus}`,
    `↳ proxy  /api → :${state.proxyPort}`,
    '',
    `NODE_ENV ${state.nodeEnv}   log ${state.logLevel}   mock ${state.mock ? 'on' : 'off'}`,
    `${inspector}   ·  ctrl-c to stop`,
  ]
  return boxify(lines, { color })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/__tests__/dev.test.js`
Expected: PASS (all tests across Tasks 1–3).

- [ ] **Step 5: Commit**

```bash
git add scripts/dev/format.mjs scripts/__tests__/dev.test.js
git commit -m "feat(dev): add premium startup banner renderer"
```

---

## Task 4: Orchestrator — `scripts/dev.mjs`

No unit test (process/spawn glue). It composes the Task 1–3 helpers; correctness is verified manually in Task 5.

**Files:**
- Create: `scripts/dev.mjs`

- [ ] **Step 1: Write the orchestrator**

Create `scripts/dev.mjs`:

```js
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
```

- [ ] **Step 2: Lint the new files**

Run: `npx eslint scripts/dev.mjs scripts/dev/format.mjs --max-warnings 0`
Expected: no errors. (Fix any unused-var / import lint issues before continuing.)

- [ ] **Step 3: Wire the npm scripts**

In `package.json`, replace the `dev:all` line and add `dev:all:debug` (the
`dev` and `dev:server` lines stay unchanged):

```json
    "dev:all": "node scripts/dev.mjs",
    "dev:all:debug": "node scripts/dev.mjs --debug",
```

The block should read:

```json
    "dev": "vite",
    "dev:server": "node server/index.js",
    "dev:all": "node scripts/dev.mjs",
    "dev:all:debug": "node scripts/dev.mjs --debug",
    "dev:kill": "node scripts/kill-dev-ports.js",
```

- [ ] **Step 4: Run the unit suite once more (no regressions)**

Run: `npx vitest run scripts/__tests__/dev.test.js`
Expected: PASS (all format tests still green).

- [ ] **Step 5: Commit**

```bash
git add scripts/dev.mjs package.json
git commit -m "feat(dev): orchestrate dev:all with unified premium terminal"
```

---

## Task 5: Manual smoke verification

No code — confirm the real behavior. Per superpowers:verification-before-completion, record actual output, don't assert from memory.

- [ ] **Step 1: Default mode**

Run: `npm run dev:all`
Expected:
- A boxed banner appears once, showing the WEB URL (e.g. `http://localhost:5173`), `API http://localhost:3001 healthy <n>ms`, `/api → :3001`, `NODE_ENV development`, `log debug`, `mock off`, `inspector off`.
- Subsequent lines are gutter-tagged `WEB │ …` (magenta) and `API │ …` (cyan).
- Open `http://localhost:5173` in a browser; a request shows an `API │ … /api/… 200` line. HMR edit to a `src/*.jsx` file shows a `WEB │ hmr update …` line.

- [ ] **Step 2: Backend-down detection**

While `dev:all` runs, kill just the backend node child (e.g. `taskkill /PID <pid>`
for the `server/index.js` process, or `npm run dev:kill` which also stops Vite).
Expected: a red `● │ backend exited (…) — … npm run dev:kill` line appears
immediately. (Auto-restart is out of scope; this verifies the crash is reported.)

- [ ] **Step 3: Debug mode**

Stop, then run: `npm run dev:all:debug`
Expected: banner's last line reads `inspector ◉ ws://127.0.0.1:9229`, and Node prints a debugger-listening line (tagged `API │`). Confirm VS Code/Chrome can attach to `127.0.0.1:9229`.

- [ ] **Step 4: Clean shutdown**

Press Ctrl-C.
Expected: `● │ shutting down dev environment…`, process exits, and `netstat`/`npm run dev:kill` shows ports 3001 + 5173 freed (no orphans).

- [ ] **Step 5: Final commit (if any tweaks were needed)**

```bash
git add -A
git commit -m "chore(dev): polish dev orchestrator after smoke test"
```

(Skip if Steps 1–4 passed with no changes.)

---

## Self-Review Notes

- **Spec coverage:** banner (Task 3), per-line WEB/API separation (Task 2), backend health + transitions (Task 4), log-level mirrors logger default (Task 4 `LOG_LEVEL || 'debug'`), inspector/`--debug` (Tasks 3+4), npm scripts incl. unchanged `dev`/`dev:server` (Task 4), Windows-first line reading (Task 4), tests in `scripts/__tests__/` node env (Tasks 1–3). All spec sections map to a task.
- **No new runtime deps:** only `vite` (devDep) + `dotenv` (dep) + Node built-ins.
- **Name consistency:** `tagLine(kind, line, {color,time})`, `renderBanner(state,{color})`, `state` shape `{version, web:{url,ready}, api:{url,healthy,latencyMs}, proxyPort, nodeEnv, logLevel, mock, inspector}` — identical across format.mjs, its tests, and dev.mjs.
- **Implementation check (per spec Risks):** Task 5 Step 1 is where Vite 8's `createServer({customLogger})` + `resolvedUrls` and the preserved `/api` proxy are confirmed against the installed version.
- **As-built refinement (post-smoke):** the Task 4 code above shows an interval `setInterval` health poll. The smoke test (Task 5 Step 1) revealed it made the backend log a `/api/health` block every 4s, drowning the terminal. The shipped `scripts/dev.mjs` therefore drops the interval poll: it keeps the **one-shot startup probe** (for the banner's latency/health) and reports "down" via the child `exit` handler instead. The `setInterval`/`watcher`/`healthy` lines and the `'up'` transition are not in the final file. `tagLine`'s `'up'`/`'down'` kinds remain (used by tests + the exit handler).
