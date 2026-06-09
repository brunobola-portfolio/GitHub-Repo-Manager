# Premium Dev Orchestrator — Design Spec

- **Date:** 2026-06-09
- **Status:** Approved (pending written-spec review)
- **Scope:** Developer experience / dev tooling only. No runtime app or production change.

## Problem

`npm run dev:all` runs `concurrently "npm run dev:server" "npm run dev"`, so the
Express backend (port **3001**) and the Vite dev server (port **5173**, with
5174–5180 fallbacks) share one terminal, distinguished only by `concurrently`'s
default `[0]`/`[1]` prefixes. Consequences:

- You can't tell at a glance which line came from the backend vs the frontend.
- There's no single, authoritative view of *which ports are live*, *whether the
  backend is actually up*, or *what the current log/debug state is*.
- The output reads as raw and noisy rather than premium/professional.

## Goal

Replace the `dev:all` plumbing with a single, coordinated dev orchestrator that
makes the running dev environment **instantly legible**: clear port/URL
separation, live backend observability, an obvious debug state, and per-line
visual separation of the two services — without adding runtime dependencies or
touching production behavior.

## Non-Goals (YAGNI)

- No in-browser dev badge/overlay (explicitly descoped — terminal only).
- No log-level *toggle UI* — the banner *displays* the level; changing it stays
  `LOG_LEVEL=...` as today.
- No new npm runtime dependencies. Implementation uses Node built-ins plus
  Vite's already-installed programmatic API. `dotenv` (already a dependency) is
  reused to load `.env`.
- No change to `dev` or `dev:server` (the raw single-service scripts stay).

## Approach

A dedicated Node orchestrator script — `scripts/dev.mjs` — becomes what
`npm run dev:all` runs. One supervising process owns both services so it can
render a unified, coordinated terminal UI. (`concurrently` is no longer used on
this path; it remains a devDependency but is unreferenced by `dev:all`.)

Rejected alternatives:

- **Heavily-configured `concurrently`** — gives colored prefixes but cannot
  inject live health-status lines or coordinate a single "both ready" banner;
  delivers separation but not observability.
- **Vite-plugin only** — smallest change, but leaves the two streams
  un-separated; solves half the problem.

## Architecture

```
scripts/dev.mjs  (supervisor, single process)
├── env            reads PORT, FRONTEND_URL, NODE_ENV, LOG_LEVEL, VITE_MOCK_MODE
│                  via dotenv (mirrors server/config.js defaults; does NOT import
│                  server/config.js, which has process.exit side-effects)
├── backend        child_process.spawn('node', [serverArgs])
│                  stdout/stderr → line-tagger → "API │" gutter (cyan)
│                  serverArgs = ['server/index.js'] | ['--inspect','server/index.js']
├── frontend       Vite programmatic API: createServer({ customLogger })
│                  customLogger routes Vite/HMR lines → "WEB │" gutter (magenta)
│                  resolved port read from server.resolvedUrls (true post-fallback port)
├── banner         rendered ONCE when (Vite listening) AND (first /api/health ok)
├── health-watcher polls GET /api/health on an interval; emits a status line
│                  ONLY on transition (up→down / down→up), accent green/red
└── lifecycle      SIGINT/SIGTERM → close Vite server + kill backend child → clean exit
```

### Module boundaries (testable units)

The script is split so the pure logic is unit-testable and the I/O glue stays thin:

- **`renderBanner(state) → string`** — pure. `state` = `{ version, web: {url, ready},
  api: {url, healthy, latencyMs}, proxy, nodeEnv, logLevel, mock, inspector }`.
  Returns the boxed banner string. No I/O.
- **`tagLine(stream, line, { color }) → string`** — pure. Given a stream label
  (`'WEB'|'API'|'●'`) and a raw line, returns the timestamped, gutter-prefixed,
  colored line. Color disabled when `!isTTY` or `NO_COLOR` set.
- **orchestration glue** — spawns the backend, boots Vite, wires the two pure
  functions to real streams, runs the health loop. Thin; exercised manually.

### Effective values the banner must report (correctness details)

- **Log level:** mirror the logger's resolution, not `config.logLevel`.
  Logger uses `process.env.LOG_LEVEL || 'debug'` in dev (see
  `server/lib/logger.js`). Banner computes the same: `LOG_LEVEL || 'debug'`.
- **Ports/URLs:** API URL from `http://localhost:${PORT||3001}`; WEB URL from
  Vite's `resolvedUrls.local[0]` (handles the 5173→5174… fallback hop).
- **Proxy:** static `/api → :${PORT||3001}` (from `vite.config.js`).
- **Mock:** on when `VITE_MOCK_MODE === 'true'`, else off.
- **Inspector:** off by default; in `--debug` shows the inspector ws endpoint.

## Terminal UI

### Startup banner (printed once, both services ready)

```
┌─ GitHub Repo Manager · dev ─────────────────── v4.3.0 ─┐
│                                                        │
│  ● WEB    http://localhost:5173        Vite ready      │
│  ● API    http://localhost:3001        healthy 4ms     │
│  ↳ proxy  /api  →  :3001                                │
│                                                        │
│  NODE_ENV development   log debug   mock off           │
│  inspector off        ·  ctrl-c to stop                │
└────────────────────────────────────────────────────────┘
```

In `--debug` mode the last line reads: `inspector ◉ ws://127.0.0.1:9229`.

### Per-line stream separation (steady state)

```
12:04:01  WEB │ hmr update /src/App.jsx
12:04:02  API │ GET /api/health 200 4ms
12:04:05  ●   │ API down — retrying (ECONNREFUSED)
12:04:08  ●   │ API back — healthy 3ms
```

- `WEB` = magenta, `API` = cyan, status transition = green (up) / red (down).
- Fixed-width gutter so columns align regardless of label.
- Colors auto-off when stdout is not a TTY or `NO_COLOR` is set.

## npm scripts

| Script | Before | After |
|---|---|---|
| `dev:all` | `concurrently "npm run dev:server" "npm run dev"` | `node scripts/dev.mjs` |
| `dev:all:debug` | *(new)* | `node scripts/dev.mjs --debug` |
| `dev` | `vite` | unchanged |
| `dev:server` | `node server/index.js` | unchanged |
| `dev:kill` | `node scripts/kill-dev-ports.js` | unchanged |

## Error handling & lifecycle

- **Ctrl-C / SIGINT / SIGTERM** → forward shutdown to the backend child, call
  `viteServer.close()`, exit 0. No orphaned ports.
- **Backend child exits unexpectedly** → red status line with the exit code;
  keep Vite alive so HMR/state survives. Banner not re-rendered.
- **Port already in use** (Vite `listen` or backend EADDRINUSE) → friendly line
  pointing at `npm run dev:kill`.
- **Health probe failure** → counts as `down`; transition line emitted; watcher
  keeps polling so recovery is reported.
- **Windows-first:** read child stdout line-by-line (no shell-string spawn,
  avoiding quoting pitfalls); ANSI verified in Windows Terminal / VS Code.

## Testing

Unit tests for the pure units (per project convention, mirror under `tests/`):

- `tests/scripts/dev.test.js`
  - `tagLine`: WEB/API/status labels produce expected gutter + timestamp; color
    present with TTY, absent with `NO_COLOR`.
  - `renderBanner`: given a state object → expected banner string (ports, env,
    log level, inspector on/off, mock on/off).

Orchestration/spawn glue is verified manually (`npm run dev:all` and
`npm run dev:all:debug`) — no integration test for child-process lifecycle.

## Risks / open checks for implementation

- Confirm Vite 8's programmatic `createServer({ customLogger })` + `resolvedUrls`
  against the installed version during TDD (API stable since Vite 3, but verify).
- Ensure `customLogger` still surfaces Vite errors/warnings (don't swallow them
  while reformatting).

## Files

- **New:** `scripts/dev.mjs` (orchestrator), `tests/scripts/dev.test.js`.
- **Edit:** `package.json` (`dev:all`, add `dev:all:debug`).
- **Unchanged:** `vite.config.js`, `server/*`, `scripts/kill-dev-ports.js`.
