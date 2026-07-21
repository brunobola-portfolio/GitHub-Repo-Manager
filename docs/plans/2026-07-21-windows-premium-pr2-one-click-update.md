# Windows Premium PR 2 — One-Click Update with Verification and Rollback

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Update now" in Settings → About downloads the new release, verifies SHA256, snapshots the DB, applies the update (silent installer re-run or portable folder swap with automatic rollback), restarts, and reports the outcome as a toast.

**Architecture:** `server/lib/updater.js` owns download/verify/handoff and an in-memory progress object polled by the UI. Installed mode re-runs the downloaded `setup.exe /VERYSILENT ... /UPDATED=1` (registry/uninstaller stay correct; the installer's close-app flow from PR 1 is the wait guard). Portable mode hands off to `apply-update.ps1` (run from a copy in the data dir so the package-root original can be replaced) which swaps `app`/`runtime`+root launchers, health-checks, and rolls back app+runtime+DB snapshot together on failure. Outcome flows through an intent/result marker pair resolved at next boot, surfaced via `/api/system/status` → toast (mirrors the existing `dbRecovery` pattern). A schema-version guard refuses to boot an old app over a newer DB.

**Tech Stack:** Node 22/Express 5 (server), PowerShell 5.1 (apply script), Inno Setup 6, React 19 (About UI), Vitest.

**Spec:** `docs/specs/2026-07-21-windows-premium-install-experience.md` §4 (+ §8 CI smoke item)

## Global Constraints

- `.jsx`/`.js` only — NO TypeScript. Tests ONLY in `tests/` (frontend, mirroring `src/`) and `server/__tests__/` (backend).
- Comments explain WHY, never WHAT; no emojis; Conventional Commits, subject < 72 chars, NO AI attribution anywhere.
- `npm run lint` zero warnings; never weaken existing tests (extend them WITH changes).
- Managed-mode contracts from PR 1 (do not change): `GRM_MANAGED=1`, `<data>\.grm.shutdown-token`, `<data>\.grm.port`, `<data>\.grm.pid` (node PID), `POST /api/system/shutdown` (loopback + `X-GRM-Shutdown-Token`), `requestShutdown(reason)` single-fire registry, launcher exe `GitHub Repo Manager.exe` (`--no-browser`, `--data-dir`, `stop`).
- Mock/demo guard: any frontend mock import stays behind the inline `import.meta.env.DEV && import.meta.env.VITE_MOCK_MODE === 'true'` guard.
- PowerShell 5.1-compatible syntax in `.ps1`. In CI checks of GUI exes, wait with `-PassThru` + `.WaitForExit()` (NEVER `-Wait` — waits on descendant tree and hangs; NEVER `&` — doesn't wait at all).
- Branch: `feat/windows-one-click-update` (exists). Base: `ec4788e7` (main after PR 1).

## New cross-component contracts introduced by this PR

- `<data>\updates\` — downloads, staging, backups, logs, markers.
- `<data>\updates\update-intent.json` — `{ "from", "to", "mode": "installed"|"portable", "at" }` written before handoff.
- `<data>\updates\last-update-result.json` — `{ "status": "success"|"rolled-back"|"failed", "from", "to", "at", "logPath" }`; consumed once (read-and-clear) by `/api/system/status` as `updateResult`.
- `GRM_PACKAGE_ROOT` env var — set by `start.ps1`, the package root (dir containing `app\`, `runtime\`, the exe).
- Boot resolution (managed mode): intent exists and `intent.to === currentVersion` → write `success` result; intent exists and version ≠ to and intent older than 10 minutes → write `failed` result; then clear intent. `apply-update.ps1` writes only `rolled-back`/`failed` results itself.
- Update endpoints: `POST /api/system/update` (requireAuth + loopback + `isManaged()` + limiter 2/5min; 409 if already in progress; 400 if no newer version/assets), `GET /api/system/update/status` (requireAuth) → `{ phase: 'idle'|'downloading'|'verifying'|'staging'|'restarting'|'error', percent, error, target }`.
- `GET /api/system/update-check` response gains `assets` (from lib) and `canSelfUpdate` (route-level: `isManaged() && process.platform === 'win32'`).

---

### Task 1: `update-check.js` — release assets + route `canSelfUpdate`

**Files:** Modify `server/lib/update-check.js`, `server/routes/system.js` (update-check route only). Test: extend `server/__tests__/update-check.test.js` (find the existing lib test via `grep -l checkForUpdate server/__tests__`) and `server/__tests__/system-update-check-route.test.js`.

**Interfaces produced:** success result gains `assets: { setup, setupSha256, zip, zipSha256 }`, each `{ name, url, size } | null`, selected from the GitHub payload's `assets[]` (`name`, `browser_download_url`, `size`) by suffix: `-setup.exe`, `-setup.exe.sha256`, `-win-x64.zip`, `-win-x64.zip.sha256`. Inconclusive/disabled results carry `assets: null`. Route response adds `canSelfUpdate` (boolean, false when unmanaged/non-Windows/disabled).

- [ ] **Step 1 (TDD):** extend the lib test with a payload carrying 4 assets + a decoy (`Source code (zip)`), assert the mapping and that failure results carry `assets: null`. Extend the route test asserting `canSelfUpdate: false` propagates when `isManaged()` mocked false and `true` when mocked true (mock `server/lib/managed-runtime.js`; stub `process.platform` via `Object.defineProperty` or accept the platform of CI — simpler: route computes `isManaged() && process.platform === 'win32'`; on non-Windows dev machines the test mocks only isManaged and asserts the field equals `isManaged() && process.platform === 'win32'` computed the same way. This repo's dev+CI machines for these tests are Windows for Bruno and Linux in CI — write the assertion platform-independently).
- [ ] **Step 2:** implement in `update-check.js`:

```js
function pickAsset(assets, suffix) {
    const found = Array.isArray(assets)
        ? assets.find((a) => typeof a?.name === 'string' && a.name.endsWith(suffix))
        : null;
    if (!found || typeof found.browser_download_url !== 'string') return null;
    return { name: found.name, url: found.browser_download_url, size: Number(found.size) || 0 };
}

export function extractReleaseAssets(assets) {
    return {
        setup: pickAsset(assets, '-setup.exe'),
        setupSha256: pickAsset(assets, '-setup.exe.sha256'),
        zip: pickAsset(assets, '-win-x64.zip'),
        zipSha256: pickAsset(assets, '-win-x64.zip.sha256'),
    };
}
```

success result adds `assets: extractReleaseAssets(data?.assets)`; both failure paths and the disabled path add `assets: null`. In `system.js`'s update-check handler, spread the lib result and add `canSelfUpdate: isManaged() && process.platform === 'win32'` (import already available from PR 1... verify; add if missing). Update the route's degrade-path payload (`{ current: pkg.version }`) to also carry `canSelfUpdate: false`.
- [ ] **Step 3:** `npx vitest run` both test files → green. Commit `feat(server): expose release assets and self-update capability`.

---

### Task 2: Schema downgrade guard

**Files:** Modify `server/lib/db-migrations.js`. Test: extend the existing migrations test file (find via `grep -l runMigrations server/__tests__`).

**Interfaces produced:** `export const APP_SCHEMA_VERSION` (max of `MIGRATIONS[].version`); `export class DBSchemaFromFutureError extends Error` with `.dbVersion`/`.appVersion`; `runMigrations(db)` throws it BEFORE applying anything when the ledger's `MAX(version)` exceeds `APP_SCHEMA_VERSION`.

- [ ] **Step 1 (TDD):** test: create an in-memory better-sqlite3 db, run `runMigrations(db)` once (fine), then insert a fake ledger row `(APP_SCHEMA_VERSION + 1, 'from-the-future', datetime)` and assert a second `runMigrations(db)` throws `DBSchemaFromFutureError` whose message names both versions and mentions the pre-update snapshot.
- [ ] **Step 2:** implement:

```js
export const APP_SCHEMA_VERSION = Math.max(...MIGRATIONS.map((m) => m.version));

export class DBSchemaFromFutureError extends Error {
    constructor(dbVersion, appVersion) {
        super(
            `This database was created by a NEWER version of GitHub Repo Manager ` +
            `(schema v${dbVersion}; this app knows up to v${appVersion}). Refusing to start ` +
            `to protect your data. Reinstall the newer version, or restore the pre-update ` +
            `snapshot from the data directory's updates folder.`,
        );
        this.name = 'DBSchemaFromFutureError';
        this.dbVersion = dbVersion;
        this.appVersion = appVersion;
    }
}
```

In `runMigrations`, right after the `schema_migrations` table is ensured, read `SELECT MAX(version) AS v FROM schema_migrations` and throw when `v > APP_SCHEMA_VERSION`. (Idempotent re-runs and fresh DBs: `v` is null → no throw.)
- [ ] **Step 3:** targeted vitest green; also boot the dev server once to prove no regression (`NODE_ENV=test VITE_MOCK_MODE=true node server/index.js`, expect clean boot, kill). Commit `feat(server): refuse boot when DB schema is newer than the app`.

---

### Task 3: `server/lib/updater.js` — markers, mode, assets, sha256 (pure core)

**Files:** Create `server/lib/updater.js`. Test: `server/__tests__/updater-core.test.js`.

**Interfaces produced (consumed by Tasks 4/5/7):**

```js
export function updatesDir(dataDir)                    // path.join(dataDir, 'updates')
export function updateIntentPath(dataDir)
export function updateResultPath(dataDir)
export function writeUpdateIntent(dataDir, intent)     // mkdir -p + write JSON
export function readAndClearUpdateResult(dataDir)      // object | null; deletes file after read; never throws
export function writeUpdateResult(dataDir, result)
export function resolveIntentOnBoot(dataDir, currentVersion, staleMs = 10 * 60 * 1000)
    // intent.to === currentVersion -> success result; stale mismatch -> failed result; young mismatch -> leave (update still applying); always returns what it did: 'success'|'failed'|'none'|'pending'
export function isInstalledMode(packageRoot)           // existsSync(path.join(packageRoot, 'install-config.txt'))
export function selectUpdateAssets(checkResult, installed)
    // installed -> {asset: assets.setup, sha: assets.setupSha256}; portable -> zip pair; null when either half missing
export function parseSha256Sidecar(text)               // first 64-char hex token, lowercased; null if none
export async function verifyFileSha256(filePath, expectedHex)  // streams, boolean
```

- [ ] **Step 1 (TDD):** tests over tmp dirs: marker round-trip (write intent → resolveIntentOnBoot with matching version → result file says success, intent gone; mismatched version with old `at` → failed; mismatched young `at` → 'pending', intent stays); `readAndClearUpdateResult` returns once then null; `parseSha256Sidecar` on `"<hex> *file.zip"`, `"<hex>  file"`, garbage → null; `verifyFileSha256` against a fixture file hashed with node:crypto in the test; `selectUpdateAssets` both modes + missing halves; `isInstalledMode`.
- [ ] **Step 2:** implement (all sync fs except the hash stream; `resolveIntentOnBoot` computes staleness from `intent.at` vs `Date.now()`). `readAndClearUpdateResult`/`resolveIntentOnBoot` must never throw (corrupt JSON → treat as absent, delete the corrupt file).
- [ ] **Step 3:** targeted vitest + lint green. Commit `feat(server): updater core — markers, mode and asset selection, sha256`.

---

### Task 4: Updater orchestration + routes + status/boot wiring

**Files:** Modify `server/lib/updater.js` (orchestration), `server/routes/system.js` (2 routes + `/status` extension), `server/index.js` (boot intent resolution). Test: `server/__tests__/system-update-routes.test.js` (mock updater lib), `server/__tests__/updater-orchestration.test.js` (injected fetch/spawn).

**Interfaces produced:**

```js
export function getUpdateProgress()   // { phase, percent, error, target } — module singleton
export async function startUpdate({ currentVersion, dataDir, packageRoot, fetchImpl = fetch, spawnImpl = spawn, requestShutdownImpl = requestShutdown })
export function resetUpdaterForTests()
export class UpdateError extends Error // .code: 'already_running'|'no_update'|'no_assets'|'checksum_mismatch'|'download_failed'
```

`startUpdate` flow (throws `UpdateError` on preconditions; sets progress phases as it goes):
1. Refuse when phase not `idle`/`error` (`already_running`).
2. `checkForUpdate({ currentVersion })` — require `updateAvailable === true` and a non-null asset pair for the mode (`isInstalledMode(packageRoot)`), else `no_update`/`no_assets`.
3. Phase `downloading`: stream both the asset and its `.sha256` sidecar into `updatesDir(dataDir)` (percent from `content-length` when present; `fs.createWriteStream`, abort on non-2xx).
4. Phase `verifying`: `parseSha256Sidecar` + `verifyFileSha256`; mismatch → delete download, `checksum_mismatch`.
5. DB snapshot: `const backup = await runDbBackupOnce()`; when `backup?.destPath`, `copyFileSync(destPath, path.join(updatesDir, 'pre-update-' + currentVersion + '.db'))`.
6. `writeUpdateIntent(dataDir, { from: currentVersion, to: latest, mode, at: new Date().toISOString() })`.
7. Phase `restarting` + handoff:
   - installed: `spawnImpl(downloadedSetupPath, ['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/SP-', '/LOG=' + path.join(updatesDir, 'update-' + latest + '.log'), '/UPDATED=1'], { detached: true, stdio: 'ignore' }).unref()`
   - portable: copy `path.join(packageRoot, 'apply-update.ps1')` to `updatesDir` and `spawnImpl('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', copiedScript, '-PackageRoot', packageRoot, '-DataDir', dataDir, '-ZipPath', zipPath, '-FromVersion', currentVersion, '-ToVersion', latest, '-ServerPid', String(process.pid), '-Port', String(process.env.PORT || 3001)], { detached: true, stdio: 'ignore', windowsHide: true }).unref()`
   - then `setTimeout(() => requestShutdownImpl('update'), 500)` (unref'd).

Routes in `system.js`:

```js
router.post('/update', updateLimiter, requireAuth, async (req, res) => {
    if (!isManaged() || process.platform !== 'win32') return res.status(404).json({ error: 'Not found' });
    if (!isLoopbackRequest(req)) return res.status(403).json({ error: 'Updates can only be started from this machine' });
    try {
        await startUpdate({ currentVersion: pkg.version, dataDir: getDataDir(), packageRoot: process.env.GRM_PACKAGE_ROOT });
        res.status(202).json({ updating: true });
    } catch (error) {
        if (error instanceof UpdateError) {
            const status = error.code === 'already_running' ? 409 : 400;
            return res.status(status).json({ error: error.message, code: error.code });
        }
        res.status(500).json({ error: safeError(error, 'Update failed to start') });
    }
});
router.get('/update/status', requireAuth, (req, res) => res.json(getUpdateProgress()));
```

`updateLimiter`: 2 per 5 minutes, same shape as siblings. `/status` (existing route) additionally returns `updateResult: isManaged() ? readAndClearUpdateResult(getDataDir()) : null`. `server/index.js` boot (inside the managed `onListening` block from PR 1): `resolveIntentOnBoot(getDataDir(), pkg.version)` BEFORE `initManagedRuntime` logging (import pkg version the way index.js already does or via createRequire).

- [ ] **Step 1 (TDD):** route tests mirror `system-shutdown-route.test.js` mocking style (assert 404 unmanaged, 403 non-loopback, 202 happy, 409/400 mapping, status passthrough, `/status` carrying `updateResult` from the mocked lib). Orchestration tests inject `fetchImpl` (serving a small buffer + its real sha sidecar; then a corrupted one) and a recording `spawnImpl`/`requestShutdownImpl`; assert phase transitions, arg vectors for both modes, checksum failure cleanup, `already_running` refusal.
- [ ] **Step 2:** implement; full targeted suite + `npm run lint` green. Commit `feat(server): one-click update orchestration and routes`.

---

### Task 5: `apply-update.ps1` + packaging + `GRM_PACKAGE_ROOT`

**Files:** Create `packaging/windows/apply-update.ps1`. Modify `scripts/package-windows.mjs` (ship it — add to the launcher-copy list), `packaging/windows/installer.iss` (`[Files]` entry), `packaging/windows/start.ps1` (one line: `$env:GRM_PACKAGE_ROOT = $Root` next to the existing `GRM_MANAGED` line). Test: extend `scripts/__tests__/package-windows.test.js` if it enumerates shipped launchers; otherwise packaging is validated by the CI smoke (Task 8).

`apply-update.ps1` (PS 5.1; runs from a COPY in `<data>\updates`, so package-root files are all replaceable):

```powershell
# SPDX-License-Identifier: AGPL-3.0-only
#
# Applies a portable one-click update. Runs from a COPY inside the data dir
# (never from the package root - every root file gets replaced below). The
# server spawned this detached and is shutting itself down; we wait for its
# PID, swap app/runtime plus the root launcher files, relaunch, health-check,
# and roll back app+runtime+DB snapshot together if the new version fails.
param(
    [Parameter(Mandatory)][string]$PackageRoot,
    [Parameter(Mandatory)][string]$DataDir,
    [Parameter(Mandatory)][string]$ZipPath,
    [Parameter(Mandatory)][string]$FromVersion,
    [Parameter(Mandatory)][string]$ToVersion,
    [Parameter(Mandatory)][int]$ServerPid,
    [int]$Port = 3001
)
$ErrorActionPreference = 'Stop'
$UpdatesDir = Join-Path $DataDir 'updates'
$LogFile = Join-Path $UpdatesDir ("apply-update-{0}.log" -f $ToVersion)
function Log([string]$msg) { Add-Content -LiteralPath $LogFile -Value ("{0} {1}" -f (Get-Date -Format o), $msg) }
function Write-Result([string]$status) {
    $json = '{"status":"' + $status + '","from":"' + $FromVersion + '","to":"' + $ToVersion +
        '","at":"' + (Get-Date -Format o) + '","logPath":' + ($LogFile | ConvertTo-Json) + '}'
    Set-Content -LiteralPath (Join-Path $UpdatesDir 'last-update-result.json') -Value $json -Encoding utf8
    Remove-Item -LiteralPath (Join-Path $UpdatesDir 'update-intent.json') -ErrorAction SilentlyContinue
}
function Test-Ready {
    try {
        $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/api/health/ready" -TimeoutSec 2 -UseBasicParsing
        return $r.StatusCode -eq 200
    } catch { return $false }
}

try {
    Log "waiting for server PID $ServerPid to exit"
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Process -Id $ServerPid -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {
        Start-Sleep -Milliseconds 500
    }
    if (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue) {
        Log "server still alive - taskkill"
        & taskkill /PID $ServerPid /T /F 2>$null | Out-Null
        Start-Sleep -Seconds 2
    }

    $Staging = Join-Path $UpdatesDir ("staging-{0}" -f $ToVersion)
    if (Test-Path -LiteralPath $Staging) { Remove-Item -Recurse -Force -LiteralPath $Staging }
    Log "extracting $ZipPath"
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $Staging -Force

    # Older backups from previous updates: keep disk bounded, one is enough
    # for the manual-recovery story documented in docs/windows.md.
    Get-ChildItem -LiteralPath $UpdatesDir -Directory -Filter 'backup-*' -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    $Backup = Join-Path $UpdatesDir ("backup-{0}" -f $FromVersion)
    New-Item -ItemType Directory -Force -Path $Backup | Out-Null

    Log "swapping app/runtime"
    Move-Item -LiteralPath (Join-Path $PackageRoot 'app') -Destination (Join-Path $Backup 'app')
    Move-Item -LiteralPath (Join-Path $PackageRoot 'runtime') -Destination (Join-Path $Backup 'runtime')
    Move-Item -LiteralPath (Join-Path $Staging 'app') -Destination (Join-Path $PackageRoot 'app')
    Move-Item -LiteralPath (Join-Path $Staging 'runtime') -Destination (Join-Path $PackageRoot 'runtime')
    Get-ChildItem -LiteralPath $Staging -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $PackageRoot $_.Name) -Force
    }

    Log "relaunching"
    Start-Process -FilePath (Join-Path $PackageRoot 'GitHub Repo Manager.exe') -ArgumentList '--no-browser' | Out-Null
    $deadline = (Get-Date).AddSeconds(60)
    $healthy = $false
    while ((Get-Date) -lt $deadline) {
        if (Test-Ready) { $healthy = $true; break }
        Start-Sleep -Seconds 2
    }

    if ($healthy) {
        # Success result is written by the NEW server at boot (it sees the
        # intent's target version matches its own) - not here, so a healthy
        # boot and the toast can never disagree.
        Log "update applied and healthy"
        Remove-Item -LiteralPath $ZipPath -ErrorAction SilentlyContinue
        exit 0
    }

    Log "health check failed - rolling back"
    & (Join-Path $PackageRoot 'GitHub Repo Manager.exe') stop 2>$null | Out-Null
    Start-Sleep -Seconds 3
    Remove-Item -Recurse -Force -LiteralPath (Join-Path $PackageRoot 'app') -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force -LiteralPath (Join-Path $PackageRoot 'runtime') -ErrorAction SilentlyContinue
    Move-Item -LiteralPath (Join-Path $Backup 'app') -Destination (Join-Path $PackageRoot 'app')
    Move-Item -LiteralPath (Join-Path $Backup 'runtime') -Destination (Join-Path $PackageRoot 'runtime')
    $Snapshot = Join-Path $UpdatesDir ("pre-update-{0}.db" -f $FromVersion)
    if (Test-Path -LiteralPath $Snapshot) {
        # App and schema must revert together - the new version may have
        # migrated the DB past what the old app's downgrade guard accepts.
        $DbPath = Join-Path $DataDir 'manager.db'
        Copy-Item -LiteralPath $Snapshot -Destination $DbPath -Force
        Remove-Item -LiteralPath ($DbPath + '-wal'), ($DbPath + '-shm') -ErrorAction SilentlyContinue
    }
    Write-Result 'rolled-back'
    Start-Process -FilePath (Join-Path $PackageRoot 'GitHub Repo Manager.exe') -ArgumentList '--no-browser' | Out-Null
    exit 1
} catch {
    Log ("fatal: " + $_.Exception.Message)
    Write-Result 'failed'
    exit 1
}
```

- [ ] **Step 1:** write the script; parse-check both it and the modified `start.ps1` with `[System.Management.Automation.Language.Parser]::ParseFile`. Verify the DB filename (`manager.db`) against `server/lib/data-dir.js`/adapter (adjust if the actual name differs).
- [ ] **Step 2:** ship it: `package-windows.mjs` launcher list + `installer.iss` `[Files]` (`Source: "{#StagingRoot}\apply-update.ps1"; DestDir: "{app}"; Flags: ignoreversion`); `start.ps1` gains `$env:GRM_PACKAGE_ROOT = $Root`. Extend the packager test if a shipped-files list is asserted. ISCC compile gate (`%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`).
- [ ] **Step 3:** lint + targeted vitest green. Commit `feat(windows): portable update apply script with rollback`.

---

### Task 6: Installer `/UPDATED=1` relaunch entry

**Files:** Modify `packaging/windows/installer.iss`.

- [ ] **Step 1:** add to `[Code]`:

```pascal
// Set by the app's self-update flow (setup.exe ... /UPDATED=1): a silent
// update must relaunch the app itself, because postinstall+skipifsilent
// [Run] entries never execute under /VERYSILENT.
function IsUpdatedMode(): Boolean;
begin
  Result := CmdLineParamExists('/UPDATED=1');
end;
```

and to `[Run]`:

```ini
Filename: "{app}\{#MyAppExeName}"; Parameters: "--no-browser"; WorkingDir: "{app}"; Check: IsUpdatedMode; Flags: nowait
```

(`--no-browser`: the user's browser tab is already open polling for the restart — reopening a second tab would be noise.)
- [ ] **Step 2:** ISCC compile gate. Commit `feat(windows): relaunch app after silent self-update install`.

---

### Task 7: About UI + boot toast + mocks

**Files:** Modify `src/components/Settings/AboutSection.jsx`, `src/App.jsx` (the existing `/api/system/status` effect at ~512), `src/__mocks__/mockSystem.js`. Tests: extend the existing AboutSection test (`tests/components/Settings/AboutSection.test.jsx` — locate with glob; if absent, create) and the App-level status-toast test if one exists.

**Behavior:**
- `AboutSection`: when `showBanner && data.canSelfUpdate === true`, render an **Update now** button next to Dismiss. Click → `apiCall('/api/system/update', { method: 'POST' })` → enter updating state: poll `apiCall('/api/system/update/status')` every 1s rendering phase + percent (`downloading 42%`, `verifying`, `restarting`). When a poll REJECTS (server going down) OR phase is `restarting`: switch to "Restarting — this page will reload automatically", then poll `fetch('/api/health/ready')` (plain fetch, no auth) every 2s up to 3 minutes; on 200 → `window.location.reload()`. Poll rejection during `downloading`/`verifying` → inline error with the message. 409 (`already_running`) → jump straight into the polling state. Keep all styling on existing patterns in this file (Card/Badge/button classes already present); no new motion values.
- `App.jsx`: in the existing status effect, after the `dbRecovery` handling add:

```jsx
if (data.updateResult) {
    const r = data.updateResult
    if (r.status === 'success') {
        toast.success(`Updated to v${r.to}`)
    } else if (r.status === 'rolled-back') {
        toast.warning(`Update to v${r.to} failed and was rolled back to v${r.from}. See the update log in your data folder.`)
    } else if (r.status === 'failed') {
        toast.warning(`Update to v${r.to} did not complete. See the update log in your data folder.`)
    }
}
```

- `mockSystem.js`: `getMockUpdateCheck` gains `canSelfUpdate: false` (demo mode must never show the button — grounded honesty).

- [ ] **Step 1 (TDD):** extend AboutSection tests: button hidden when `canSelfUpdate` false/absent; visible when true+updateAvailable; click posts and renders `downloading 42%` from a mocked status poll (use vi.useFakeTimers or resolve-once mocks per the file's existing style — READ the existing test file first and follow its idioms).
- [ ] **Step 2:** implement; `npx vitest run` on the touched test files; `npm run lint`. Drive the real app in mock mode (backend `NODE_ENV=test VITE_MOCK_MODE=true node server/index.js` + `npx vite --mode test`) and screenshot-check Settings → About renders unchanged (button absent in mock). Commit `feat(ui): one-click update flow in Settings About`.

---

### Task 8: CI smoke — portable update dry-run

**Files:** Modify `.github/workflows/windows-package.yml` (primary) and `.github/workflows/release.yml` (mirror — repo policy keeps both in sync).

- [ ] **Step 1:** add a step after each workflow's exe smoke: from a fresh extraction of the SAME built zip, boot via exe (`--no-browser`, fresh scratch data dir, free port), then simulate the server-side handoff directly (no GitHub download in CI): copy `apply-update.ps1` to `<data>\updates\`, write an `update-intent.json` with `from`/`to` = the SAME package version, then invoke the copied script with `-PackageRoot <extract> -DataDir <data> -ZipPath <the built zip> -FromVersion <v> -ToVersion <v> -ServerPid <pid from .grm.pid> -Port <port>`, wait for it to exit (it kills/waits the server, swaps same-version dirs, relaunches, health-checks). Assert: script exit 0, health 200 afterwards, `backup-<v>\app` exists, and boot-resolution wrote `last-update-result.json` with `"status":"success"`... NOTE: success result is written by the server at boot from the intent — assert the file exists AND `status` is `success` after health returns 200 (poll up to 30s for the file). Then stop via exe and clean up. Wait on the script with `Start-Process powershell -PassThru` + `.WaitForExit()`.
- [ ] **Step 2:** js-yaml validation of both workflows; lint. Commit `ci(windows): portable self-update dry-run smoke`.

---

### Task 9: Verification + PR

- [ ] Targeted suites (all files touched this PR) green; `npm run lint` zero warnings; full `npx vitest run` (report flakes honestly, re-run failures in isolation).
- [ ] Staged-package REAL update dry-run locally (same procedure as the CI step, against `.dev/package-windows/staging` after a fresh `node scripts/package-windows.mjs` — needs Node 22 on PATH for npm ci; nvm has 22.23.1).
- [ ] Write `.dev/pr2-body.md`: summary, the update flow design (installed vs portable, rollback semantics), evidence, workflows-touched owner-merge note, and a manual test note for the colleague (update from previous release once both are published). NO AI attribution.
- [ ] Push `feat/windows-one-click-update`, `gh pr create` — then final whole-branch review before merge.
