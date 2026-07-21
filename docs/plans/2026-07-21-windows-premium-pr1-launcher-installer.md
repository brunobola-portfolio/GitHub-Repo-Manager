# Windows Premium PR 1 — Native Launcher, Graceful Stop, Logs, Installer Maintenance

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the console-window launcher with a flashless `GitHub Repo Manager.exe` stub, add a graceful-shutdown endpoint + file logging, and give the installer Repair/Uninstall maintenance, close-running-app, autostart, and a keep-your-data uninstall prompt.

**Architecture:** A ~70-line C# WinExe stub (compiled at package time with the in-box .NET Framework 4.8 `csc.exe`) launches the existing `start.ps1`/`stop.ps1` hidden. The server gains a loopback-only token-guarded `POST /api/system/shutdown` wired to the existing `gracefulShutdown`. `start.ps1` spawns node through a hidden `cmd /c ... >> log 2>&1` wrapper so ALL output (including pre-boot crashes) lands in a rotated log file. The Inno installer gains a maintenance form, graceful close-app via in-box `curl.exe`, and uninstall data choices.

**Tech Stack:** Node 22/Express 5 (server), PowerShell 5.1 (launch scripts), C# 5 compiled by legacy `csc.exe` (stub — no repo toolchain added), Inno Setup 6 (installer), Vitest (tests).

**Spec:** `docs/specs/2026-07-21-windows-premium-install-experience.md`

## Global Constraints

- `.jsx`/`.js` only in app code — NO TypeScript. The C# stub is packaging tooling, lives under `packaging/windows/launcher/`, and must compile with legacy csc (C# 5: no `$"..."` interpolation, no expression-bodied members).
- Comments explain WHY, never WHAT. No emojis in code.
- Unit tests live in `server/__tests__/` and `scripts/__tests__/` — NEVER next to source.
- Lint zero warnings: `npm run lint`. Conventional Commits, subject < 72 chars, NO AI attribution lines.
- Never weaken existing tests; `useGitHub`/frontend untouched in this PR.
- Every kill path verifies PID → process name `node` → this package's `runtime\node.exe` (existing safety pattern — keep it everywhere).
- Branch: `feat/windows-premium-setup` (already exists, contains the spec).

---

### Task 1: `server/lib/loopback.js` — shared loopback check

**Files:**
- Create: `server/lib/loopback.js`
- Modify: `server/routes/auth-setup.js` (import + re-export; delete local copy)
- Test: `server/__tests__/loopback.test.js`

**Interfaces:**
- Produces: `isLoopbackRequest(req) -> boolean` from `server/lib/loopback.js`. `auth-setup.js` keeps `export { isLoopbackRequest }` so existing importers/tests don't break.

- [ ] **Step 1: Write the failing test**

`server/__tests__/loopback.test.js`:

```js
// server/__tests__/loopback.test.js
//
// isLoopbackRequest moved to server/lib/loopback.js so system routes can
// share it; auth-setup.js must keep re-exporting it for old importers.
import { describe, it, expect } from 'vitest';
import { isLoopbackRequest } from '../lib/loopback.js';

function fakeReq({ addr = '127.0.0.1', host = '127.0.0.1:3001', forwarded } = {}) {
    const headers = { host };
    if (forwarded) headers['x-forwarded-for'] = forwarded;
    return { headers, socket: { remoteAddress: addr } };
}

describe('isLoopbackRequest (lib)', () => {
    it('accepts a direct loopback request', () => {
        expect(isLoopbackRequest(fakeReq())).toBe(true);
        expect(isLoopbackRequest(fakeReq({ addr: '::1', host: 'localhost:3001' }))).toBe(true);
        expect(isLoopbackRequest(fakeReq({ addr: '::ffff:127.0.0.1' }))).toBe(true);
    });
    it('rejects proxied, non-loopback, and rebound-host requests', () => {
        expect(isLoopbackRequest(fakeReq({ forwarded: '1.2.3.4' }))).toBe(false);
        expect(isLoopbackRequest(fakeReq({ addr: '192.168.1.10' }))).toBe(false);
        expect(isLoopbackRequest(fakeReq({ host: 'evil.example.com' }))).toBe(false);
    });
    it('is still re-exported from auth-setup.js', async () => {
        const mod = await import('../routes/auth-setup.js');
        expect(mod.isLoopbackRequest).toBe(isLoopbackRequest);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/loopback.test.js`
Expected: FAIL — `Cannot find module '../lib/loopback.js'`

- [ ] **Step 3: Create the lib and rewire auth-setup**

`server/lib/loopback.js`: move the ENTIRE `isLoopbackRequest` function from `server/routes/auth-setup.js:59-81` verbatim, including its full DNS-rebinding doc comment. In `auth-setup.js`, delete the local function and add at the imports:

```js
import { isLoopbackRequest } from '../lib/loopback.js';
```

and keep the public surface identical with:

```js
// Re-export: pre-existing importers (tests, other routes) resolve it from
// this module; the implementation moved to lib so system routes can share it.
export { isLoopbackRequest };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/loopback.test.js server/__tests__/auth-setup*.test.js`
Expected: ALL PASS (auth-setup's existing suite proves the move broke nothing)

- [ ] **Step 5: Commit**

```bash
git add server/lib/loopback.js server/routes/auth-setup.js server/__tests__/loopback.test.js
git commit -m "refactor(server): move isLoopbackRequest into shared lib"
```

---

### Task 2: `server/lib/shutdown.js` — shutdown registry

**Files:**
- Create: `server/lib/shutdown.js`
- Test: `server/__tests__/shutdown-registry.test.js`

**Interfaces:**
- Produces: `registerShutdown(fn)`, `requestShutdown(reason) -> boolean` (false when no handler or already requested — idempotent), `resetShutdownForTests()`.
- Consumed later by: `server/index.js` (Task 5) and the shutdown route (Task 4).

- [ ] **Step 1: Write the failing test**

`server/__tests__/shutdown-registry.test.js`:

```js
// server/__tests__/shutdown-registry.test.js
//
// The registry decouples "something asked us to shut down" (signal handler,
// /api/system/shutdown route) from index.js's gracefulShutdown closure, and
// guarantees the handler can only ever fire once.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { registerShutdown, requestShutdown, resetShutdownForTests } from '../lib/shutdown.js';

describe('shutdown registry', () => {
    beforeEach(() => resetShutdownForTests());

    it('invokes the registered handler with the reason', () => {
        const fn = vi.fn();
        registerShutdown(fn);
        expect(requestShutdown('SIGTERM')).toBe(true);
        expect(fn).toHaveBeenCalledWith('SIGTERM');
    });
    it('is a no-op without a handler', () => {
        expect(requestShutdown('api')).toBe(false);
    });
    it('only ever fires once', () => {
        const fn = vi.fn();
        registerShutdown(fn);
        expect(requestShutdown('api')).toBe(true);
        expect(requestShutdown('SIGINT')).toBe(false);
        expect(fn).toHaveBeenCalledTimes(1);
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/shutdown-registry.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`server/lib/shutdown.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
//
// Single-fire shutdown registry. index.js registers its gracefulShutdown
// closure here; both OS signal handlers and the managed-mode
// POST /api/system/shutdown route request shutdown through it, so a signal
// racing an API call can never run the teardown twice.
let handler = null;
let requested = false;

export function registerShutdown(fn) {
    handler = fn;
}

export function requestShutdown(reason) {
    if (requested || typeof handler !== 'function') return false;
    requested = true;
    handler(reason);
    return true;
}

export function resetShutdownForTests() {
    handler = null;
    requested = false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/shutdown-registry.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/shutdown.js server/__tests__/shutdown-registry.test.js
git commit -m "feat(server): single-fire shutdown registry"
```

---

### Task 3: `server/lib/managed-runtime.js` — token file lifecycle

**Files:**
- Create: `server/lib/managed-runtime.js`
- Test: `server/__tests__/managed-runtime.test.js`

**Interfaces:**
- Produces: `isManaged() -> boolean` (env `GRM_MANAGED === '1'`), `shutdownTokenPath(dataDir) -> string` (`<dataDir>/.grm.shutdown-token`), `initManagedRuntime(dataDir) -> string` (writes fresh 32-byte base64url token, returns it), `verifyShutdownToken(dataDir, candidate) -> boolean` (constant-time), `clearManagedRuntime(dataDir)` (best-effort delete, never throws).
- Consumed by: route (Task 4), index.js (Task 5). File is read by `stop.ps1` (Task 8) and the installer's curl (Task 9) — the path and single-line-token format are a cross-language contract; do not change them.

- [ ] **Step 1: Write the failing test**

`server/__tests__/managed-runtime.test.js`:

```js
// server/__tests__/managed-runtime.test.js
//
// The shutdown token is the auth for POST /api/system/shutdown: written per
// boot, single line, verified constant-time. stop.ps1 and installer.iss read
// the same file, so path and format are a contract.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
    isManaged, shutdownTokenPath, initManagedRuntime,
    verifyShutdownToken, clearManagedRuntime,
} from '../lib/managed-runtime.js';

let dir;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'grm-managed-')); });
afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.GRM_MANAGED;
});

describe('managed-runtime', () => {
    it('isManaged only when GRM_MANAGED=1', () => {
        expect(isManaged()).toBe(false);
        process.env.GRM_MANAGED = '1';
        expect(isManaged()).toBe(true);
    });
    it('writes a single-line base64url token and verifies it', () => {
        const token = initManagedRuntime(dir);
        expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(readFileSync(shutdownTokenPath(dir), 'utf8').trim()).toBe(token);
        expect(verifyShutdownToken(dir, token)).toBe(true);
    });
    it('rejects wrong, empty, and missing tokens without throwing', () => {
        initManagedRuntime(dir);
        expect(verifyShutdownToken(dir, 'x'.repeat(43))).toBe(false);
        expect(verifyShutdownToken(dir, '')).toBe(false);
        expect(verifyShutdownToken(dir, undefined)).toBe(false);
        clearManagedRuntime(dir);
        expect(existsSync(shutdownTokenPath(dir))).toBe(false);
        expect(verifyShutdownToken(dir, 'anything-at-all-of-any-length-1234567890123')).toBe(false);
    });
    it('clearManagedRuntime never throws when file is absent', () => {
        expect(() => clearManagedRuntime(dir)).not.toThrow();
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/managed-runtime.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`server/lib/managed-runtime.js`:

```js
// SPDX-License-Identifier: AGPL-3.0-only
//
// Managed-mode (packaged Windows) runtime state. start.ps1 sets GRM_MANAGED=1;
// the server then writes a per-boot shutdown token whose value authorizes
// POST /api/system/shutdown. The token lives in the data dir (same trust
// domain as .env beside it): local console readers are already root-equivalent
// for this app, while browser JS can never read files — which is exactly the
// property that lets the route bypass session CSRF.
import { randomBytes, timingSafeEqual } from 'crypto';
import { readFileSync, writeFileSync, rmSync } from 'fs';
import path from 'path';

export function isManaged() {
    return process.env.GRM_MANAGED === '1';
}

export function shutdownTokenPath(dataDir) {
    return path.join(dataDir, '.grm.shutdown-token');
}

export function initManagedRuntime(dataDir) {
    const token = randomBytes(32).toString('base64url');
    writeFileSync(shutdownTokenPath(dataDir), token + '\n', 'utf8');
    return token;
}

export function verifyShutdownToken(dataDir, candidate) {
    if (typeof candidate !== 'string' || candidate.length === 0) return false;
    let stored;
    try {
        stored = readFileSync(shutdownTokenPath(dataDir), 'utf8').trim();
    } catch {
        return false;
    }
    if (!stored) return false;
    const a = Buffer.from(stored);
    const b = Buffer.from(candidate);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
}

export function clearManagedRuntime(dataDir) {
    try {
        rmSync(shutdownTokenPath(dataDir), { force: true });
    } catch {
        // Best-effort: a locked/preremoved file must never break shutdown.
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run server/__tests__/managed-runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add server/lib/managed-runtime.js server/__tests__/managed-runtime.test.js
git commit -m "feat(server): managed-mode shutdown token lifecycle"
```

---

### Task 4: `POST /api/system/shutdown` route + CSRF bypass

**Files:**
- Modify: `server/routes/system.js` (add route + limiter)
- Modify: `server/middleware/csrf.js:37-42` (bypass entries)
- Test: `server/__tests__/system-shutdown-route.test.js`, extend `server/__tests__/` CSRF tests if a bypass test file exists (search `isCsrfBypassed` in `server/__tests__/` and add the two new paths to its cases)

**Interfaces:**
- Consumes: Task 1 `isLoopbackRequest`, Task 2 `requestShutdown`, Task 3 `isManaged`/`verifyShutdownToken`, existing `getDataDir()` from `server/lib/data-dir.js`.
- Produces: `POST /api/system/shutdown` → `404` unmanaged, `403` non-loopback or bad token, `202 {"shuttingDown":true}` then `setImmediate(requestShutdown)`. Header contract: `X-GRM-Shutdown-Token`.

- [ ] **Step 1: Write the failing test**

`server/__tests__/system-shutdown-route.test.js` (mirrors the mocking style of `server/__tests__/system-update-check-route.test.js`):

```js
// server/__tests__/system-shutdown-route.test.js
//
// POST /api/system/shutdown: 404 unless GRM_MANAGED, 403 unless loopback AND
// token match, 202 + single requestShutdown on success. Session/CSRF play no
// part — the callers (stop.ps1, installer curl) have neither.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../middleware/auth.js', () => ({
    requireAuth: (req, res, next) => next(),
    safeError: (e, fallback) => fallback,
}));
vi.mock('../db.js', () => ({
    default: { prepare: vi.fn(() => ({ get: vi.fn(), run: vi.fn() })) },
    initDB: vi.fn(),
}));
vi.mock('../lib/logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('../config.js', () => ({ config: { updateCheckEnabled: true } }));
vi.mock('../lib/update-check.js', () => ({ checkForUpdate: vi.fn() }));
vi.mock('../lib/data-dir.js', () => ({ getDataDir: () => 'C:/fake-data' }));

const isManagedMock = vi.fn();
const verifyTokenMock = vi.fn();
vi.mock('../lib/managed-runtime.js', () => ({
    isManaged: (...a) => isManagedMock(...a),
    verifyShutdownToken: (...a) => verifyTokenMock(...a),
}));
const requestShutdownMock = vi.fn(() => true);
vi.mock('../lib/shutdown.js', () => ({ requestShutdown: (...a) => requestShutdownMock(...a) }));

let router;
beforeEach(async () => {
    vi.clearAllMocks();
    isManagedMock.mockReturnValue(true);
    verifyTokenMock.mockReturnValue(true);
    router = (await import('../routes/system.js')).default;
});

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/system', router);
    return a;
}

// supertest connects over a real loopback socket with a loopback Host header,
// so isLoopbackRequest passes naturally; forcing a proxy header flips it.
describe('POST /api/system/shutdown', () => {
    it('404s when not managed (endpoint invisible in dev/Docker)', async () => {
        isManagedMock.mockReturnValue(false);
        const res = await request(app()).post('/api/system/shutdown');
        expect(res.status).toBe(404);
        expect(requestShutdownMock).not.toHaveBeenCalled();
    });
    it('403s a proxied request even with a valid token', async () => {
        const res = await request(app()).post('/api/system/shutdown')
            .set('X-Forwarded-For', '1.2.3.4')
            .set('X-GRM-Shutdown-Token', 'tok');
        expect(res.status).toBe(403);
        expect(requestShutdownMock).not.toHaveBeenCalled();
    });
    it('403s on a bad token', async () => {
        verifyTokenMock.mockReturnValue(false);
        const res = await request(app()).post('/api/system/shutdown')
            .set('X-GRM-Shutdown-Token', 'wrong');
        expect(res.status).toBe(403);
        expect(verifyTokenMock).toHaveBeenCalledWith('C:/fake-data', 'wrong');
        expect(requestShutdownMock).not.toHaveBeenCalled();
    });
    it('202s and requests shutdown exactly once on a valid call', async () => {
        const res = await request(app()).post('/api/system/shutdown')
            .set('X-GRM-Shutdown-Token', 'tok');
        expect(res.status).toBe(202);
        expect(res.body).toEqual({ shuttingDown: true });
        await new Promise((r) => setImmediate(r));
        expect(requestShutdownMock).toHaveBeenCalledTimes(1);
        expect(requestShutdownMock).toHaveBeenCalledWith('api');
    });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run server/__tests__/system-shutdown-route.test.js`
Expected: FAIL — 404 (route missing) on every case

- [ ] **Step 3: Implement route + bypass**

In `server/routes/system.js` add imports:

```js
import { isLoopbackRequest } from '../lib/loopback.js';
import { isManaged, verifyShutdownToken } from '../lib/managed-runtime.js';
import { requestShutdown } from '../lib/shutdown.js';
import { getDataDir } from '../lib/data-dir.js';
```

limiter next to the existing ones:

```js
const shutdownLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many shutdown attempts, please try again in a minute' }
});
```

route (before `export default router;`):

```js
// Managed-mode (packaged Windows) graceful stop. Auth is loopback + a
// per-boot secret file token (managed-runtime.js) instead of session/CSRF:
// the legitimate callers — stop.ps1 and the installer's curl — have no
// browser session, while a browser page can never read the token file. The
// path is CSRF-bypassed for exactly that reason (middleware/csrf.js).
router.post('/shutdown', shutdownLimiter, (req, res) => {
    if (!isManaged()) {
        return res.status(404).json({ error: 'Not found' });
    }
    if (!isLoopbackRequest(req)) {
        return res.status(403).json({ error: 'Shutdown is only accepted from this machine' });
    }
    if (!verifyShutdownToken(getDataDir(), req.get('X-GRM-Shutdown-Token'))) {
        return res.status(403).json({ error: 'Invalid shutdown token' });
    }
    res.status(202).json({ shuttingDown: true });
    // Respond first, then tear down — the caller polls process exit, not the body.
    setImmediate(() => requestShutdown('api'));
});
```

In `server/middleware/csrf.js` extend `BYPASS_PREFIXES` (exact paths work as prefixes):

```js
const BYPASS_PREFIXES = [
    '/api/auth/',
    '/api/v1/auth/',
    '/api/webhooks/',
    '/api/v1/webhooks/',
    // Managed-mode graceful stop: authenticated by loopback + secret token
    // file (see routes/system.js) — its callers have no session to CSRF.
    '/api/system/shutdown',
    '/api/v1/system/shutdown',
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run server/__tests__/system-shutdown-route.test.js server/__tests__/system-update-check-route.test.js`
Then: `npx vitest run server/__tests__ --silent` (any csrf bypass test that enumerates the list must be updated WITH this change, not weakened)
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add server/routes/system.js server/middleware/csrf.js server/__tests__/system-shutdown-route.test.js
git commit -m "feat(server): loopback token-guarded graceful shutdown endpoint"
```

---

### Task 5: Wire registry + token into `server/index.js`

**Files:**
- Modify: `server/index.js` (~L510 `gracefulShutdown`, ~L626 signal handlers, and the post-listen boot block)

**Interfaces:**
- Consumes: Tasks 2/3. No new exports — verified by CI smoke (Task 11) and the route test's mocks.

- [ ] **Step 1: Register the shutdown handler and token**

In `server/index.js` add imports:

```js
import { registerShutdown, requestShutdown } from './lib/shutdown.js';
import { isManaged, initManagedRuntime, clearManagedRuntime } from './lib/managed-runtime.js';
import { getDataDir } from './lib/data-dir.js';
```

Immediately AFTER the `function gracefulShutdown(signal) { ... }` definition (after current line 624), replace the two `process.on` lines:

```js
registerShutdown(gracefulShutdown);
process.on('SIGTERM', () => requestShutdown('SIGTERM'));
process.on('SIGINT', () => requestShutdown('SIGINT'));
```

Inside `gracefulShutdown`, in the `server.close(async () => { ... })` callback, right before `logger.info('Server shut down complete');` add:

```js
if (isManaged()) {
    clearManagedRuntime(getDataDir());
}
```

In the boot path, inside the existing `server.listen(...)` callback (where the "API is live" log line is emitted), add:

```js
if (isManaged()) {
    initManagedRuntime(getDataDir());
    logger.info('[managed] shutdown token ready');
}
```

- [ ] **Step 2: Boot the server to verify both modes**

Run (from repo root, Git Bash): `NODE_ENV=test VITE_MOCK_MODE=true node server/index.js &` then after boot `curl -s -X POST http://127.0.0.1:3001/api/system/shutdown -o /dev/null -w '%{http_code}'` and kill the background server.
Expected: `404` (unmanaged mode hides the endpoint). Then re-run with `GRM_MANAGED=1 DATA_DIR=$(mktemp -d) ...`, confirm the data dir contains `.grm.shutdown-token`, and `curl -s -X POST -H "X-GRM-Shutdown-Token: $(cat $DATA_DIR/.grm.shutdown-token)" http://127.0.0.1:3001/api/system/shutdown` returns `{"shuttingDown":true}` and the process exits within ~5 s with exit code 0 and no token file left.

- [ ] **Step 3: Run the touched server suites**

Run: `npx vitest run server/__tests__/system-shutdown-route.test.js server/__tests__/shutdown-registry.test.js server/__tests__/managed-runtime.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add server/index.js
git commit -m "feat(server): wire shutdown registry and managed token into boot"
```

---

### Task 6: Launcher stub + packaging compile step

**Files:**
- Create: `packaging/windows/launcher/Launcher.cs`
- Modify: `scripts/package-windows.mjs` (new exports + compile during staging; add exe to the ZIP staging root)
- Test: `scripts/__tests__/package-windows.test.js` (extend)

**Interfaces:**
- Produces: staged `GitHub Repo Manager.exe` at package root. CLI contract (used by installer Task 9 and smoke Task 11): no args or `start` → run `start.ps1`; `stop` → run `stop.ps1`; `--no-browser` → `-NoBrowser`; `--data-dir <p>` → `-DataDir "<p>"`. Exit code mirrors the script's.
- New exports from `package-windows.mjs`: `frameworkCscPath() -> string`, `launcherCscArgs({ source, out, icon }) -> string[]`, `LAUNCHER_EXE_NAME = 'GitHub Repo Manager.exe'`.

- [ ] **Step 1: Write the failing tests**

Append to `scripts/__tests__/package-windows.test.js`:

```js
describe('launcher stub compilation', () => {
    it('uses the in-box .NET Framework 4.8 csc (guaranteed on Windows + CI)', () => {
        const csc = frameworkCscPath();
        expect(csc.toLowerCase()).toContain('framework64');
        expect(csc.toLowerCase()).toContain('v4.0.30319');
        expect(csc.toLowerCase().endsWith('csc.exe')).toBe(true);
    });
    it('compiles a flashless GUI-subsystem exe with the brand icon', () => {
        const args = launcherCscArgs({ source: 'L.cs', out: 'G.exe', icon: 'b.ico' });
        expect(args).toContain('/target:winexe');
        expect(args).toContain('/platform:anycpu');
        expect(args).toContain('/optimize+');
        expect(args).toContain('/r:System.Windows.Forms.dll');
        expect(args).toContain('/win32icon:b.ico');
        expect(args).toContain('/out:G.exe');
        expect(args[args.length - 1]).toBe('L.cs');
    });
    it('names the exe like the product', () => {
        expect(LAUNCHER_EXE_NAME).toBe('GitHub Repo Manager.exe');
    });
});
```

Add `frameworkCscPath, launcherCscArgs, LAUNCHER_EXE_NAME` to the test file's existing import list from `../package-windows.mjs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/__tests__/package-windows.test.js`
Expected: FAIL — missing exports

- [ ] **Step 3: Write `Launcher.cs`**

`packaging/windows/launcher/Launcher.cs` (C# 5 — legacy csc has no interpolation):

```cs
// SPDX-License-Identifier: AGPL-3.0-only
//
// Flashless launcher for GitHub Repo Manager. PowerShell is a console-
// subsystem app, so ANY direct shortcut to it flashes a console window
// (upstream wontfix); a GUI-subsystem parent that spawns it with
// CreateNoWindow is the only clean fix. All real logic stays in
// start.ps1/stop.ps1 — this stub only launches them invisibly and mirrors
// their exit code. Compiled at package time by the in-box .NET Framework 4.8
// csc.exe (scripts/package-windows.mjs), so the repo carries no toolchain
// and stock Windows 10/11 carries no new runtime dependency.
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

static class Program
{
    [DllImport("shell32.dll", SetLastError = true)]
    static extern int SetCurrentProcessExplicitAppUserModelID(
        [MarshalAs(UnmanagedType.LPWStr)] string appId);

    [STAThread]
    static int Main(string[] args)
    {
        // Own taskbar identity: without this, pinned shortcuts group under
        // a generic host identity instead of the product.
        SetCurrentProcessExplicitAppUserModelID("BolaLabs.GitHubRepoManager");

        string root = AppDomain.CurrentDomain.BaseDirectory;
        int argStart = 0;
        bool stop = false;
        if (args.Length > 0 && args[0].Equals("stop", StringComparison.OrdinalIgnoreCase))
        {
            stop = true;
            argStart = 1;
        }
        else if (args.Length > 0 && args[0].Equals("start", StringComparison.OrdinalIgnoreCase))
        {
            argStart = 1;
        }

        string script = Path.Combine(root, stop ? "stop.ps1" : "start.ps1");
        string psArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + script + "\"";
        for (int i = argStart; i < args.Length; i++)
        {
            if (args[i] == "--no-browser")
            {
                psArgs += " -NoBrowser";
            }
            else if (args[i] == "--data-dir" && i + 1 < args.Length)
            {
                i++;
                psArgs += " -DataDir \"" + args[i] + "\"";
            }
        }

        try
        {
            ProcessStartInfo psi = new ProcessStartInfo();
            psi.FileName = "powershell.exe";
            psi.Arguments = psArgs;
            psi.WorkingDirectory = root;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            using (Process p = Process.Start(psi))
            {
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(
                "GitHub Repo Manager could not start Windows PowerShell, which it needs to run.\r\n\r\n"
                + ex.Message + "\r\n\r\n"
                + "If PowerShell is restricted on this machine, see the Troubleshooting section of docs/windows.md in the project repository.",
                "GitHub Repo Manager",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            return 1;
        }
    }
}
```

- [ ] **Step 4: Add the compile step to `scripts/package-windows.mjs`**

New exports near `getPublisher` (module scope):

```js
export const LAUNCHER_EXE_NAME = 'GitHub Repo Manager.exe';

/**
 * The legacy Framework 4.8 compiler ships inside Windows itself (and on
 * every GitHub windows-latest runner) — zero toolchain to install, and the
 * produced exe needs only the Framework 4.8 runtime preinstalled on all
 * supported Windows 10/11. Do not "upgrade" this to dotnet publish: that
 * either adds a runtime dependency or a 100x bigger AOT binary.
 */
export function frameworkCscPath() {
    const winDir = process.env.WINDIR || 'C:\\Windows';
    return path.join(winDir, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
}

export function launcherCscArgs({ source, out, icon }) {
    return [
        '/nologo',
        '/target:winexe',
        '/platform:anycpu',
        '/optimize+',
        '/r:System.Windows.Forms.dll',
        `/win32icon:${icon}`,
        `/out:${out}`,
        source,
    ];
}
```

private helper next to `copyLaunchers`:

```js
function compileLauncher(stagingDir) {
    const csc = frameworkCscPath();
    if (!existsSync(csc)) {
        throw new Error(
            `csc.exe not found at ${csc} — the launcher stub needs the in-box .NET Framework 4.8 compiler (present on all stock Windows 10/11 and CI runners).`,
        );
    }
    execFileSync(csc, launcherCscArgs({
        source: path.join(PACKAGING_WINDOWS_DIR, 'launcher', 'Launcher.cs'),
        out: path.join(stagingDir, LAUNCHER_EXE_NAME),
        icon: path.join(PACKAGING_WINDOWS_DIR, 'assets', 'bolalabs.ico'),
    }), { stdio: 'inherit' });
}
```

(`PACKAGING_WINDOWS_DIR` — reuse the existing constant/path the script already uses in `copyLaunchers` for `packaging/windows`; match its actual name when editing.) Call `compileLauncher(stagingDir)` right after `copyLaunchers(...)` in the packaging flow so the exe lands in the staged root and therefore in the ZIP.

- [ ] **Step 5: Run tests + a real compile**

Run: `npx vitest run scripts/__tests__/package-windows.test.js`
Expected: PASS
Then compile for real (PowerShell): `& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:winexe /platform:anycpu /optimize+ /r:System.Windows.Forms.dll "/win32icon:packaging\windows\assets\bolalabs.ico" "/out:$env:TEMP\grm-launcher-test.exe" packaging\windows\launcher\Launcher.cs`
Expected: exit 0, exe exists, `(Get-Item "$env:TEMP\grm-launcher-test.exe").Length` < 100KB

- [ ] **Step 6: Commit**

```bash
git add packaging/windows/launcher/Launcher.cs scripts/package-windows.mjs scripts/__tests__/package-windows.test.js
git commit -m "feat(windows): flashless launcher stub compiled at package time"
```

---

### Task 7: `start.ps1` — hidden spawn, file logs, port marker, failure dialog

**Files:**
- Modify: `packaging/windows/start.ps1`

**Interfaces:**
- Produces (contracts for Tasks 8/9/11): `<data>\logs\server-YYYY-MM-DD.log` (all node stdout/stderr, 7-day retention), `<data>\.grm.port` (single line, the ACTUAL port), `GRM_MANAGED=1` in the server env, pidfile still holds the **node.exe** PID.

- [ ] **Step 1: Replace the spawn/title section**

In `start.ps1`:

(a) After the `New-Item ... $DataDir` block (current line 97), add log setup:

```powershell
# All server output (including pre-boot crashes that never reach pino) goes
# to a dated log file: with the launcher running everything hidden there is
# no console buffer anymore, and "closing the window" no longer exists as a
# way to lose diagnostics. 7-day retention, pruned on every launch.
$LogsDir = Join-Path $DataDir 'logs'
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
Get-ChildItem -LiteralPath $LogsDir -Filter 'server-*.log' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item -Force -ErrorAction SilentlyContinue
$LogFile = Join-Path $LogsDir ("server-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
```

(b) After the `$env:NODE_ENV = 'production'` line (current line 207), add:

```powershell
# Managed mode: the server writes a per-boot shutdown token so stop.ps1 and
# the installer can request a graceful exit (POST /api/system/shutdown).
$env:GRM_MANAGED = '1'
# The ACTUAL port for this run (may differ from .env's PORT after the
# busy-port scan) — stop.ps1 and installer.iss read this to target the
# shutdown endpoint correctly.
Set-Content -LiteralPath (Join-Path $DataDir '.grm.port') -Value "$actualPort" -Encoding ascii
```

(c) REPLACE the whole spawn + pidfile + window-title block (current lines 209-256: the `$psi = ...` block through the end of the title `try/catch`) with:

```powershell
# Spawn node through a hidden cmd wrapper that appends ALL output to the log
# file. cmd (not PowerShell redirection) so no pipe pumping is needed: this
# script exits right after launch, and an unpumped .NET redirect would
# deadlock node once the pipe buffer filled. The wrapper waits on node, so
# its lifetime mirrors the server's; the pidfile below records the NODE pid
# (found via the wrapper's child list) because every kill/verify path
# (stop.ps1, installer.iss) checks name+path against runtime\node.exe.
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $env:ComSpec
$psi.Arguments = '/d /s /c ""' + $NodeExe + '" "' + $ServerEntry + '" >> "' + $LogFile + '" 2>&1"'
$psi.WorkingDirectory = $AppDir
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$wrapper = [System.Diagnostics.Process]::Start($psi)

$nodePid = $null
for ($i = 0; $i -lt 40; $i++) {
    if ($wrapper.HasExited) { break }
    $child = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($wrapper.Id) AND Name = 'node.exe'" -ErrorAction SilentlyContinue
    if ($child) {
        $nodePid = [int](($child | Select-Object -First 1).ProcessId)
        break
    }
    Start-Sleep -Milliseconds 250
}
if ($nodePid) {
    Set-Content -LiteralPath $PidFile -Value "$nodePid" -Encoding ascii
    Write-Host "GitHub Repo Manager starting (PID $nodePid, port $actualPort). Log: $LogFile"
} else {
    Write-Host "GitHub Repo Manager did not spawn correctly - checking health anyway. Log: $LogFile"
}

function Show-StartupFailure([string]$LogPath) {
    # CI (-NoBrowser) must stay dialog-free; a human launch gets a real
    # error surface instead of "nothing happened".
    if ($NoBrowser) { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        $choice = [System.Windows.Forms.MessageBox]::Show(
            ("GitHub Repo Manager failed to start.`n`nThe server log may explain why:`n{0}`n`nOpen the log now?" -f $LogPath),
            'GitHub Repo Manager',
            [System.Windows.Forms.MessageBoxButtons]::YesNo,
            [System.Windows.Forms.MessageBoxIcon]::Error)
        if ($choice -eq [System.Windows.Forms.DialogResult]::Yes) {
            Start-Process notepad.exe -ArgumentList $LogPath
        }
    } catch {
        Write-Host "Startup failed - see $LogPath"
    }
}
```

(d) REPLACE the final readiness block (current lines 258-273) with one that distinguishes "dead" from "slow" and applies to both browser modes:

```powershell
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    if (Test-HealthLive $actualPort) {
        $ready = $true
        break
    }
    if ($wrapper.HasExited -and -not (Test-HealthLive $actualPort)) { break }
    Start-Sleep -Milliseconds 500
}

if (-not $ready -and $wrapper.HasExited) {
    Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue
    Show-StartupFailure $LogFile
    Write-Error "Server process exited during startup - see $LogFile"
    exit 1
}
if (-not $NoBrowser) {
    if (-not $ready) {
        Write-Host "Server is taking longer than usual to start -opening the browser anyway; refresh if it errors."
    }
    Start-Process "http://127.0.0.1:$actualPort"
}
```

- [ ] **Step 2: Exercise both paths manually**

Build a package first: `npm run build` then `node scripts/package-windows.mjs`. From the staging dir (PowerShell):
`$env:GRM_PORT=18091; (Start-Process -FilePath '.\GitHub Repo Manager.exe' -ArgumentList '--no-browser' -Wait -PassThru).ExitCode` (Start-Process -Wait because PowerShell's `&` does not wait for GUI-subsystem exes) — expect: exit 0, NO window flash, `data\logs\server-*.log` growing, `data\.grm.pid` holds a PID whose process is `node`, `data\.grm.port` says `18091`, `data\.grm.shutdown-token` exists, `Invoke-WebRequest http://127.0.0.1:18091/api/health/live` → 200.
Failure path: temporarily rename `app\server\index.js`, launch WITHOUT `--no-browser`, expect the error dialog naming the log. Restore the file.

- [ ] **Step 3: Commit**

```bash
git add packaging/windows/start.ps1
git commit -m "feat(windows): hidden spawn with file logs, port marker, failure dialog"
```

---

### Task 8: `stop.ps1` — graceful first, kill as fallback

**Files:**
- Modify: `packaging/windows/stop.ps1`

**Interfaces:**
- Consumes: `.grm.shutdown-token` + `.grm.port` (Tasks 3/7 contracts), `POST /api/system/shutdown` (Task 4).

- [ ] **Step 1: Insert the graceful attempt**

In `stop.ps1`, after the path-verification block (current line 96, before `Stop-Process`), insert:

```powershell
# Graceful first: ask the server to shut itself down (workers stopped, DB
# closed, migration rows marked interrupted) and only escalate to the
# historical hard kill if that fails or stalls.
$TokenFile = Join-Path $DataDir '.grm.shutdown-token'
$PortFile = Join-Path $DataDir '.grm.port'
$targetPort = 3001
if (Test-Path -LiteralPath $PortFile) {
    $portText = (Get-Content -LiteralPath $PortFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($portText -match '^\d+$') { $targetPort = [int]$portText }
}
if (Test-Path -LiteralPath $TokenFile) {
    $token = (Get-Content -LiteralPath $TokenFile -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($token) {
        try {
            Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$targetPort/api/system/shutdown" `
                -Headers @{ 'X-GRM-Shutdown-Token' = $token } -TimeoutSec 5 | Out-Null
            for ($i = 0; $i -lt 20; $i++) {
                if (-not (Get-Process -Id $targetPid -ErrorAction SilentlyContinue)) {
                    Remove-Item -LiteralPath $PortFile -ErrorAction SilentlyContinue
                    Write-Host "GitHub Repo Manager stopped gracefully (PID $targetPid)."
                    exit 0
                }
                Start-Sleep -Milliseconds 500
            }
            Write-Host "Graceful shutdown timed out - stopping the process directly."
        } catch {
            Write-Host "Graceful shutdown request failed ($($_.Exception.Message)) - stopping the process directly."
        }
    }
}
```

and after the existing `Stop-Process -Id $targetPid -Force` line add cleanup:

```powershell
Remove-Item -LiteralPath $PortFile -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $TokenFile -ErrorAction SilentlyContinue
```

(`$TokenFile` stays defined even when the graceful branch was skipped — the definitions above sit before the branch.)

- [ ] **Step 2: Verify both stop paths against a staged package**

Graceful: start (`--no-browser`), then `Start-Process -FilePath '.\GitHub Repo Manager.exe' -ArgumentList 'stop' -Wait` — expect "stopped gracefully", process gone, `.grm.pid`/`.grm.port`/`.grm.shutdown-token` all gone, log's final lines show `Server shut down complete`.
Fallback: start, delete `data\.grm.shutdown-token` manually, stop again — expect the hard-kill message path, process gone.

- [ ] **Step 3: Commit**

```bash
git add packaging/windows/stop.ps1
git commit -m "feat(windows): stop gracefully via shutdown endpoint before killing"
```

---

### Task 9: Installer — exe shortcuts, autostart, maintenance form, close-app, uninstall choices

**Files:**
- Modify: `packaging/windows/installer.iss`

**Interfaces:**
- Consumes: `LAUNCHER_EXE_NAME` staged exe (Task 6), shutdown endpoint + token/port files (Tasks 4/7).
- Produces: tasks `desktopicon` + `autostart`; silent uninstall honors `/PURGEDATA`.

- [ ] **Step 1: Shortcuts, files, tasks, run entries**

In `installer.iss`:

(a) Change line 33 to `#define MyAppExeName "GitHub Repo Manager.exe"` and add below it:

```ini
#define MyStartupShortcut "{userstartup}\GitHub Repo Manager.lnk"
```

(b) `[Setup]` — add the dormant signing hook at the end of the section:

```ini
; Dormant code-signing hook: CI defines SIGN only when signing secrets exist
; (release.yml). With SignTool= set, Inno signs Setup.exe AND the embedded
; uninstaller — signing only the final artifact post-build would leave
; unins000.exe unsigned on user machines.
#ifdef SIGN
SignTool=ts
#endif
```

(c) `[Tasks]` — append:

```ini
Name: "autostart"; Description: "Start GitHub Repo Manager when Windows starts (background, no browser window)"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
```

(d) `[Files]` — add the exe next to the other staged launchers:

```ini
Source: "{#StagingRoot}\GitHub Repo Manager.exe"; DestDir: "{app}"; Flags: ignoreversion
```

(e) `[Icons]` — replace the Start/Stop/desktop entries (keep Open-data-folder and Uninstall):

```ini
Name: "{group}\GitHub Repo Manager"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Stop GitHub Repo Manager"; Filename: "{app}\{#MyAppExeName}"; Parameters: "stop"; WorkingDir: "{app}"
Name: "{group}\View server logs"; Filename: "{win}\explorer.exe"; Parameters: """{#MyDataDir}\logs"""
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--no-browser"; WorkingDir: "{app}"; Tasks: autostart
```

(the exe carries the brand icon itself — `IconFilename` no longer needed on those entries; keep it on none of the exe entries).

(f) `[Run]` — point the finish-page launch at the exe:

```ini
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; WorkingDir: "{app}"; Flags: postinstall nowait skipifsilent
```

- [ ] **Step 2: `[Code]` — maintenance form + graceful close + uninstall choices**

Keep `IsAppRunning()` and `CurStepChanged` as-is. ADD/REPLACE the following in `[Code]`:

```pascal
function CmdLineParamExists(const Value: string): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Value) = 0 then
    begin
      Result := True;
      exit;
    end;
end;

function GetUninstallString(): string;
begin
  Result := '';
  // PrivilegesRequired=lowest => per-user key in HKCU. The _is1 suffix and
  // the retained brace prefix are Inno's registered-key format quirks.
  if not RegQueryStringValue(HKCU,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1',
      'UninstallString', Result) then
    RegQueryStringValue(HKLM,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1',
      'UninstallString', Result);
end;

function GetInstalledVersion(): string;
begin
  Result := '';
  if not RegQueryStringValue(HKCU,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1',
      'DisplayVersion', Result) then
    RegQueryStringValue(HKLM,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1',
      'DisplayVersion', Result);
end;

// Numeric dotted compare; non-numeric fragments (e.g. "0.0.0-dev") count as
// 0 so a dev build never outranks a release. >0 A newer, <0 B newer.
function CompareVersionStrings(const A, B: string): Integer;
var
  PA, PB: TArrayOfString;
  I, NA, NB, Count: Integer;
begin
  PA := StringSplitEx(A, ['.', '-'], '"', stExcludeEmpty);
  PB := StringSplitEx(B, ['.', '-'], '"', stExcludeEmpty);
  Count := GetArrayLength(PA);
  if GetArrayLength(PB) > Count then Count := GetArrayLength(PB);
  Result := 0;
  for I := 0 to Count - 1 do
  begin
    NA := 0; NB := 0;
    if I < GetArrayLength(PA) then NA := StrToIntDef(PA[I], 0);
    if I < GetArrayLength(PB) then NB := StrToIntDef(PB[I], 0);
    if NA <> NB then
    begin
      if NA > NB then Result := 1 else Result := -1;
      exit;
    end;
  end;
end;

// Same-or-older setup run over an existing install: offer Repair (proceed —
// reinstall-over-itself IS Inno's repair) or Uninstall. A NEWER setup skips
// this entirely: the normal wizard is the update path. Silent runs skip it
// too (scripted installs must never grow an interactive fork).
function InitializeSetup(): Boolean;
var
  UninstPath: string;
  Form: TSetupForm;
  RepairBtn, UninstallBtn, CancelBtn: TNewButton;
  Prompt: TNewStaticText;
  ResultCode: Integer;
begin
  Result := True;
  if WizardSilent() then exit;
  UninstPath := RemoveQuotes(GetUninstallString());
  if UninstPath = '' then exit;
  if CompareVersionStrings('{#MyAppVersion}', GetInstalledVersion()) > 0 then exit;

  Form := CreateCustomForm();
  try
    Form.Caption := 'GitHub Repo Manager Maintenance';
    Form.ClientWidth := ScaleX(380);
    Form.ClientHeight := ScaleY(150);
    Form.Center();

    Prompt := TNewStaticText.Create(Form);
    Prompt.Parent := Form;
    Prompt.Left := ScaleX(16);
    Prompt.Top := ScaleY(16);
    Prompt.Width := Form.ClientWidth - ScaleX(32);
    Prompt.AutoSize := False;
    Prompt.WordWrap := True;
    Prompt.Height := ScaleY(40);
    Prompt.Caption := 'GitHub Repo Manager ' + GetInstalledVersion() +
      ' is already installed. What would you like to do?';

    RepairBtn := TNewButton.Create(Form);
    RepairBtn.Parent := Form;
    RepairBtn.Left := ScaleX(16);
    RepairBtn.Top := ScaleY(76);
    RepairBtn.Width := ScaleX(108);
    RepairBtn.Caption := 'Repair';
    RepairBtn.ModalResult := mrYes;
    RepairBtn.Default := True;

    UninstallBtn := TNewButton.Create(Form);
    UninstallBtn.Parent := Form;
    UninstallBtn.Left := ScaleX(136);
    UninstallBtn.Top := ScaleY(76);
    UninstallBtn.Width := ScaleX(108);
    UninstallBtn.Caption := 'Uninstall';
    UninstallBtn.ModalResult := mrNo;

    CancelBtn := TNewButton.Create(Form);
    CancelBtn.Parent := Form;
    CancelBtn.Left := ScaleX(256);
    CancelBtn.Top := ScaleY(76);
    CancelBtn.Width := ScaleX(108);
    CancelBtn.Caption := 'Cancel';
    CancelBtn.ModalResult := mrCancel;
    CancelBtn.Cancel := True;

    case Form.ShowModal() of
      mrYes: Result := True;
      mrNo:
      begin
        Result := False;
        Exec(UninstPath, '', '', SW_SHOW, ewNoWait, ResultCode);
      end;
    else
      Result := False;
    end;
  finally
    Form.Free();
  end;
end;

function ReadFirstLine(const FileName: string): string;
var
  Lines: TArrayOfString;
begin
  Result := '';
  if LoadStringsFromFile(FileName, Lines) and (GetArrayLength(Lines) > 0) then
    Result := Trim(Lines[0]);
end;

function GetShutdownPort(): string;
var
  PortText: string;
begin
  PortText := ReadFirstLine(ExpandConstant('{#MyDataDir}\.grm.port'));
  if PortText = '' then PortText := '3001';
  Result := PortText;
end;

// Ask the running server to exit cleanly (in-box curl.exe, Win10 1803+),
// wait, then escalate to a PID-targeted kill. Never kill by image name —
// node.exe may belong to anything.
function TryStopRunningApp(): Boolean;
var
  Token, PidStr: string;
  ResultCode, I: Integer;
begin
  Token := ReadFirstLine(ExpandConstant('{#MyDataDir}\.grm.shutdown-token'));
  if Token <> '' then
  begin
    Exec(ExpandConstant('{sys}\curl.exe'),
      '-s -m 5 -X POST -H "X-GRM-Shutdown-Token: ' + Token + '" ' +
      'http://127.0.0.1:' + GetShutdownPort() + '/api/system/shutdown',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    for I := 1 to 20 do
    begin
      if not IsAppRunning() then
      begin
        Result := True;
        exit;
      end;
      Sleep(500);
    end;
  end;
  PidStr := ReadFirstLine(ExpandConstant('{#MyDataDir}\.grm.pid'));
  if PidStr <> '' then
  begin
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/PID ' + PidStr + ' /T /F',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    for I := 1 to 10 do
    begin
      if not IsAppRunning() then
      begin
        Result := True;
        exit;
      end;
      Sleep(500);
    end;
  end;
  Result := not IsAppRunning();
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not IsAppRunning() then exit;
  if not WizardSilent() then
  begin
    if MsgBox('GitHub Repo Manager is currently running.' + #13#10 +
        'Close the application and continue with Setup?',
        mbConfirmation, MB_YESNO) <> IDYES then
    begin
      Result := 'Setup cannot continue while GitHub Repo Manager is running. ' +
        'Close it (Start Menu -> Stop GitHub Repo Manager) and run Setup again.';
      exit;
    end;
  end;
  // Silent installs proceed straight to the graceful stop: a scripted
  // upgrade wants "make it so", and graceful-then-PID-kill is strictly safer
  // than the old behavior of refusing (which forced admins to taskkill
  // themselves, without the graceful attempt).
  if not TryStopRunningApp() then
    Result := 'Could not stop the running GitHub Repo Manager instance. ' +
      'Close it manually, then run Setup again.';
end;
```

and REPLACE `CurUninstallStepChanged` with:

```pascal
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  PurgeData: Boolean;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Stop a running instance before files are removed — same policy as
    // install-time (graceful endpoint, then PID kill).
    if IsAppRunning() then
      TryStopRunningApp();

    // usUninstall (not usPostUninstall): the main uninstaller process
    // terminates before usPostUninstall runs in its temp-copied clone, so a
    // prompt there fires after any waiting caller already moved on.
    PurgeData := False;
    if UninstallSilent() then
      PurgeData := CmdLineParamExists('/PURGEDATA')
    else
      PurgeData := MsgBox('Also delete your local data?' + #13#10 + #13#10 +
        'This removes the database, settings, encryption keys and license at:' + #13#10 +
        ExpandConstant('{localappdata}\GitHubRepoManager') + #13#10 + #13#10 +
        'Choose No to keep it for a future reinstall.',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;

    if PurgeData then
      DelTree(ExpandConstant('{localappdata}\GitHubRepoManager'), True, True, True)
    else
      SuppressibleMsgBox(
        'Your data was left untouched at:' + #13#10 +
        ExpandConstant('{#MyDataDir}') + #13#10 +
        'Delete that folder yourself if you no longer need it.',
        mbInformation, MB_OK, IDOK);

    // App-created artifacts outside the uninstall log must go explicitly.
    DeleteFile(ExpandConstant('{#MyStartupShortcut}'));
  end;
end;
```

Also update the `[Dirs]` comment context if needed (no functional change) and DELETE the old `usPostUninstall` message block (now folded above).

- [ ] **Step 3: Build and hand-test the installer locally**

Run: `npm run build` (if dist stale) → `node scripts/package-windows.mjs` → `iscc packaging\windows\installer.iss` (Inno 6 must be installed locally; otherwise defer to CI and state so in the PR).
Manual checklist (also goes in the PR description for the colleague's pass):
1. Fresh install → finish-page launch works, browser opens, NO console window anywhere.
2. Start Menu: GitHub Repo Manager / Stop / View server logs / Open data folder / Uninstall all work.
3. Re-run same setup → maintenance form appears; Repair reinstalls and app still launches; form's Uninstall button starts the uninstaller.
4. Install with app running → consent prompt → graceful stop (check log's "Shutting down gracefully") → install proceeds.
5. Uninstall with data prompt No → data dir intact; Yes (on a throwaway install) → `%LOCALAPPDATA%\GitHubRepoManager` gone.
6. `setup.exe /VERYSILENT /NORESTART /SUPPRESSMSGBOXES` upgrade over running app → stops it, installs, no dialogs.
7. Autostart task checked → `shell:startup` shortcut exists with `--no-browser`; uninstall removes it.

- [ ] **Step 4: Commit**

```bash
git add packaging/windows/installer.iss
git commit -m "feat(windows): installer maintenance mode, graceful close, uninstall choices"
```

---

### Task 10: Rewrite `README-WINDOWS.txt`

**Files:**
- Modify: `packaging/windows/README-WINDOWS.txt`

- [ ] **Step 1: Replace the content**

```text
GitHub Repo Manager for Windows
===============================

A self-contained build of GitHub Repo Manager. It bundles its own Node.js
runtime - nothing else needs to be installed.

Getting started
  1. Double-click "GitHub Repo Manager.exe".
     The server starts in the background (no windows) and your browser
     opens automatically when it is ready.
  2. Click "Sign in" - the app walks you through connecting your GitHub
     account (a one-time, ~2 minute guided setup).
  3. To stop it, use "Stop GitHub Repo Manager" in the Start Menu, or run
     "GitHub Repo Manager.exe stop".

Where your data lives
  - Portable ZIP:  the ".\data" folder next to this file (SQLite database,
    backups, server logs, and the .env configuration file with this
    install's secrets). Back it up by copying that folder.
  - Installed via setup:  %LOCALAPPDATA%\GitHubRepoManager\data.

Logs
  Server logs are written to the "logs" folder inside your data folder
  (7-day retention). Start Menu -> "View server logs" opens it.

Updating
  - Installed: run the newer setup - it stops the app, upgrades in place,
    and never touches your data folder.
  - Portable: stop the app, then extract the newer ZIP over this folder
    ("app" and "runtime" are replaced; "data" is untouched).

Advanced (console mode)
  "Start GitHub Repo Manager.cmd" / "Stop GitHub Repo Manager.cmd" run the
  same launch scripts in a visible console - useful for diagnostics and
  automation. Flags: --no-browser, --data-dir <path> (or env vars
  GRM_NO_BROWSER=1 / GRM_DATA_DIR / GRM_PORT).

Full guide:
https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/docs/windows.md
```

- [ ] **Step 2: Commit**

```bash
git add packaging/windows/README-WINDOWS.txt
git commit -m "docs(windows): rewrite packaged README around the native launcher"
```

---

### Task 11: CI smoke — exercise the exe end to end

**Files:**
- Modify: `.github/workflows/release.yml` (windows job, after the existing `.cmd` smoke step)

**NOTE:** PRs touching `.github/workflows/` need the repository owner to merge — flag it in the PR description.

- [ ] **Step 1: Add the exe smoke step**

After the existing smoke-test step (which already extracted the ZIP and validated the `.cmd` path), add a step with the same working directory:

```yaml
      - name: Smoke test launcher exe (graceful stop path)
        shell: pwsh
        run: |
          Set-Location $env:SMOKE_DIR   # reuse the extraction dir variable/path the previous step established
          $env:GRM_PORT = '18081'
          # The launcher is a GUI-subsystem exe: PowerShell's & operator does
          # NOT wait for those (and $LASTEXITCODE stays stale). Start-Process
          # -Wait is the correct way to get its real exit code.
          $launch = Start-Process -FilePath '.\GitHub Repo Manager.exe' -ArgumentList '--no-browser' -Wait -PassThru
          if ($launch.ExitCode -ne 0) { throw "launcher exited $($launch.ExitCode)" }
          $ok = $false
          for ($i = 0; $i -lt 60; $i++) {
            try {
              $r = Invoke-WebRequest -Uri 'http://127.0.0.1:18081/api/health/live' -TimeoutSec 2 -UseBasicParsing
              if ($r.StatusCode -eq 200) { $ok = $true; break }
            } catch { }
            Start-Sleep -Seconds 1
          }
          if (-not $ok) { Get-Content (Get-ChildItem 'data\logs\server-*.log' | Select-Object -First 1); throw 'server never became live via exe' }
          if (-not (Test-Path 'data\.grm.shutdown-token')) { throw 'shutdown token missing' }
          if (-not (Test-Path 'data\.grm.port')) { throw 'port marker missing' }
          $log = Get-ChildItem 'data\logs\server-*.log' | Select-Object -First 1
          if ((Get-Item $log).Length -eq 0) { throw 'log file empty' }
          $srvPid = [int](Get-Content 'data\.grm.pid' | Select-Object -First 1)
          & '.\GitHub Repo Manager.exe' stop
          if ($LASTEXITCODE -ne 0) { throw "stop exited $LASTEXITCODE" }
          if (Get-Process -Id $srvPid -ErrorAction SilentlyContinue) { throw 'server still running after stop' }
          if (Test-Path 'data\.grm.shutdown-token') { throw 'token not cleaned up on graceful exit' }
```

Adapt `Set-Location`/dir handling to exactly match how the previous smoke step names its extraction directory (read it in the same edit; if it re-extracts per step, mirror that). If the existing `.cmd` smoke used port 18080 and left state, run this step against a FRESH extraction or after its stop completed.

- [ ] **Step 2: Validate workflow syntax**

Run: `npx yaml-lint .github/workflows/release.yml` if available, otherwise `node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml','utf8')); console.log('yaml ok')"`
Expected: `yaml ok`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(windows): smoke-test the launcher exe and graceful stop"
```

---

### Task 12: Full verification + PR

- [ ] **Step 1: Targeted suites green**

Run: `npx vitest run server/__tests__/loopback.test.js server/__tests__/shutdown-registry.test.js server/__tests__/managed-runtime.test.js server/__tests__/system-shutdown-route.test.js server/__tests__/system-update-check-route.test.js scripts/__tests__/package-windows.test.js`
Expected: ALL PASS

- [ ] **Step 2: Lint + full unit suite**

Run: `npm run lint` (zero warnings) then `npx vitest run` (full, ~5900 tests)
Expected: clean / all green

- [ ] **Step 3: Real-app verification (verification-before-completion)**

Repeat the Task 7 Step 2 + Task 8 Step 2 staged-package checks once more from a clean staging build. Evidence (command output) goes in the PR description.

- [ ] **Step 4: Push and open the PR**

```bash
git push -u origin feat/windows-premium-setup
gh pr create --title "feat(windows): premium launcher, graceful stop, installer maintenance" --body-file .dev/pr1-body.md
```

Write `.dev/pr1-body.md` first: what changed (launcher exe, shutdown endpoint, file logs, installer maintenance/uninstall), the manual installer checklist from Task 9 Step 3 for the colleague, the workflows-touch note (owner must merge), and test evidence. NO AI attribution.

---

## Deferred to follow-up plans (do NOT build here)

- PR 2 (one-click update + rollback + About UI + downgrade guard) — planned after this PR lands; consumes `LAUNCHER_EXE_NAME`, the shutdown endpoint, `.grm.port`, and the result-marker pattern defined in the spec.
- PR 3 (README/docs/images premium pass + honesty gates).
- Signing workflow gate (`CAN_SIGN` env + `iscc /DSIGN` branch in release.yml) — activates whenever Azure Trusted Signing secrets are configured; the `.iss` already accepts `/DSIGN` after this PR, so enabling it later is workflow-only.
