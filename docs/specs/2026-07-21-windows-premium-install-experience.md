# Windows Premium Install & Update Experience

- **Date:** 2026-07-21
- **Status:** Approved design (pending user review of this spec)
- **Scope:** Windows distribution only (installer + portable ZIP). No changes to
  Docker/Railway/dev flows.

## Goals

1. Launching and stopping the app feels like a native application: real `.exe`
   entry point with the BolaLabs icon, zero console windows, zero window flash.
2. Updates are one click from inside the app, with SHA256 verification, automatic
   DB snapshot, and automatic rollback if the new version fails to boot.
3. The installer offers full maintenance: Repair, Uninstall (with a keep-your-data
   choice), optional desktop icon and start-with-Windows, and it can gracefully
   stop a running instance instead of aborting.
4. Server logs survive: file logging with rotation, and startup failures surface a
   clear native error dialog instead of silence.
5. README, `docs/windows.md`, and the packaged `README-WINDOWS.txt` read like a
   commercial product, while staying honest (SmartScreen warning stays documented
   until signing is enabled).
6. Code-signing pipeline is wired but dormant (activates when secrets appear).

## Non-goals

- No system-tray application (deliberately deferred; this design leaves room for
  one later without rework).
- No code-signing purchase now (unsigned; SmartScreen warning documented).
- No ARM64 native build, no winget submission change, no Tauri/Electron shell.

## Validated constraints (research findings)

These drove the design and must not be re-litigated during implementation:

- **VBScript is dying.** From Windows 11 24H2 it is a Feature-on-Demand; Microsoft
  disables it by default around 2027 and AVs already block `.vbs` launchers.
  A `launcher.vbs` is not acceptable.
- **`powershell -WindowStyle Hidden` always flashes a console** (console-subsystem
  process: conhost paints before the flag is parsed; upstream wontfix). A shortcut
  set to "Run: Minimized" only downgrades the flash to a taskbar blink.
- **`conhost --headless` is an EDR detection signature.** Never use it.
- **The flash-free mechanism is a GUI-subsystem parent.** A ~50-line C# WinExe
  stub targeting .NET Framework 4.8 (preinstalled on Windows 10 1903+/11),
  compiled with the in-box legacy `csc.exe`
  (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe`) which exists on
  every Windows machine and every GitHub `windows-latest` runner. ~10 KB output,
  zero new toolchain in the repo, custom icon via `/win32icon`. Files placed by
  the installer carry no Mark-of-the-Web, so the stub launches from the Start
  Menu with no SmartScreen prompt.
- **Inno Setup has no native maintenance mode.** Canonical pattern: detect the
  existing install via the HKCU uninstall key (`...\Uninstall\<AppId>_is1`),
  show a custom Repair/Uninstall form in `InitializeSetup`; "Repair" is
  reinstall-over-itself; Uninstall runs the registered `UninstallString`.
- **Inno `[Code]` has no HTTP client.** Graceful stop from the installer uses
  in-box `{sys}\curl.exe` (Windows 10 1803+) against the shutdown endpoint,
  then escalates to `taskkill /PID <pid> /T /F` (by PID, never by image name).
- **Self-update official pattern:** app downloads new `setup.exe`, spawns it
  detached with `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-`, exits
  immediately; Setup's auto-retry absorbs the lock window. Relaunch after a
  silent update needs a dedicated `[Run]` entry gated on a custom `/UPDATED=1`
  parameter (`postinstall skipifsilent` entries never run under `/VERYSILENT`).
- **Uninstall data prompt** must run in `CurUninstallStepChanged(usUninstall)`
  (not `usPostUninstall`, which runs in the temp clone after the caller moved
  on). Silent uninstall keeps data unless `/PURGEDATA` is passed.
- **Signing must go through Inno's `SignTool=` directive** (signs Setup.exe and
  the embedded uninstaller); signing only the final exe post-build leaves
  `unins000.exe` unsigned. Conditional via `#ifdef SIGN` + workflow env gate.

## Design

### 1. Launcher: `GitHub Repo Manager.exe` stub

A single C# source file `packaging/windows/launcher/Launcher.cs`, compiled during
packaging (`scripts/package-windows.mjs`, new step) with the in-box Framework 4.8
`csc.exe`: `/target:winexe /platform:anycpu /optimize
/win32icon:packaging/windows/assets/bolalabs.ico`. Output `GitHub Repo
Manager.exe` at package root (next to the current `.cmd` files).

Behavior (the stub stays dumb; all logic remains in PowerShell):

- `GitHub Repo Manager.exe [start] [--no-browser] [--data-dir <p>]` → spawns
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File start.ps1 <args>`
  with `UseShellExecute=false`, `CreateNoWindow=true`. A child console process
  of a windowless parent with `CreateNoWindow` never shows a window.
- `GitHub Repo Manager.exe stop` → same for `stop.ps1`.
- Sets an explicit `AppUserModelID` (`BolaLabs.GitHubRepoManager`) for clean
  taskbar identity.
- If spawning PowerShell fails (execution policy lockdown, missing binary), the
  stub shows a native `MessageBox` with the error and a pointer to
  `docs/windows.md#troubleshooting`.
- Exit code mirrors the child's exit code (CI-friendly).

Shortcuts (installer `[Icons]`) point at the exe: **GitHub Repo Manager**
(start/open), **Stop GitHub Repo Manager** (`stop`), plus existing data-folder
and uninstall entries. The `.cmd` files remain in the package for console-mode
diagnostics and the CI smoke test, and `README-WINDOWS.txt` demotes them to the
"advanced" section — portable users double-click the exe.

Single-instance behavior is unchanged (health-check in `start.ps1`: already
running → reopen browser and exit).

### 2. File logging + startup failure surfacing

- `start.ps1` redirects the spawned node's stdout/stderr to
  `<data>\logs\server-YYYY-MM-DD.log` (append). At each launch it prunes logs
  older than 7 days (name-sorted, same trick as `db-backup.js`).
- Pino config unchanged (JSON lines now land in the file instead of a doomed
  console buffer). `LOG_LEVEL` still honored via `.env`.
- If the health poll fails after spawn, `start.ps1` shows a native dialog
  (`System.Windows.Forms.MessageBox`, works from a hidden process): "GitHub Repo
  Manager failed to start" with the last log lines' path, and offers to open the
  log file. It also kills the dead-on-arrival child if still lingering.
- New Start Menu shortcut **View logs** → opens the logs folder.

### 3. Graceful shutdown endpoint

`POST /api/system/shutdown` in `server/routes/system.js`:

- **Auth model:** loopback-only (`isLoopbackRequest` — move it from
  `auth-setup.js` into a shared `server/lib/loopback.js` and re-export) **plus** a
  per-boot secret token. At boot the server writes 32 random bytes (base64url) to
  `<data>\.grm.shutdown-token` (user-profile ACL is sufficient; same trust level
  as `.env` beside it) and requires them in an `X-GRM-Shutdown-Token` header.
  Constant-time comparison. 404 when the token file/env is absent (non-packaged
  runs; gate on `GRM_MANAGED=1` set by `start.ps1`).
- **CSRF:** the route path is added to the CSRF bypass list in
  `server/middleware/csrf.js` — callers (stop.ps1, installer curl) have no
  session; security comes from loopback + token, which browser JS cannot read.
  Rate-limited (5/min) like the other system routes.
- **Mechanics:** `server/index.js` extracts `gracefulShutdown` into an exported
  registration (`server/lib/shutdown.js`: `registerShutdown(fn)` /
  `requestShutdown(reason)`), so both signal handlers and the route share it.
  The route responds `202 {"shuttingDown":true}` then `setImmediate(requestShutdown)`.
- **Consumers:**
  - `stop.ps1`: read token → `Invoke-RestMethod` POST → wait up to 10 s for the
    PID to exit → fallback to the existing verified `Stop-Process` path.
    Pidfile ownership is unchanged (`start.ps1` writes, `stop.ps1` clears); the
    server deletes only its own token file on clean exit.
  - Installer `PrepareToInstall` (see §5).
  - Portable update script (see §4).

### 4. One-click update with rollback

New `server/lib/updater.js` + routes in `system.js`. Enabled only when
`GRM_MANAGED=1` (packaged Windows run) — otherwise endpoints return 404.

**Mode detection:** installed mode when `install-config.txt` exists next to the
package root (written by the installer); portable otherwise.

**Flow — `POST /api/system/update` (requireAuth + loopback-only + rate limit):**

1. Re-check latest release (`checkForUpdate`, cache-busted). Refuse if not newer.
2. Download the correct asset to `<data>\updates\` — `setup.exe` (installed) or
   ZIP (portable) — plus its `.sha256` sidecar; verify before anything else.
   Progress is written to an in-memory status object exposed at
   `GET /api/system/update/status` (`{phase: idle|downloading|verifying|restarting, percent}`)
   so the UI can poll while the server is still up.
3. Snapshot the DB via `runDbBackupOnce()` and copy the snapshot to
   `<data>\updates\pre-update-<fromVersion>.db` (survives `backups/` pruning).
4. Write intent marker `<data>\updates\update-intent.json`
   (`{from, to, mode, asset, at}`).
5. Hand off and exit:
   - **Installed:** spawn detached
     `setup.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /LOG=<data>\updates\update-<to>.log /UPDATED=1`,
     then `requestShutdown()`. The installer's close-app wait loop (§5) is the
     deterministic guard; `[Run]` entry gated on `/UPDATED=1` relaunches
     `GitHub Repo Manager.exe` (normal start → opens browser).
   - **Portable:** extract ZIP to `<data>\updates\staging\<to>\`, then spawn
     detached hidden `powershell apply-update.ps1` (new file, ships in package
     root) and `requestShutdown()`. The script: waits for the PID to exit
     (30 s, then taskkill fallback) → renames `app` → `<data>\updates\backup-<from>\app`
     and `runtime` likewise → moves staged `app`/`runtime` in → relaunches the
     exe → polls `/api/health/ready` for 60 s.
6. **Rollback (portable):** on failed health check, `apply-update.ps1` restores
   the backed-up `app`/`runtime`, restores the pre-update DB snapshot (so app
   and schema revert together), relaunches, and records the outcome. The
   previous version's backup and the downloaded asset are kept until the next
   successful update (then pruned; keep 1).
7. **Result marker:** the update script / next boot writes
   `<data>\updates\last-update-result.json`
   (`{status: success|rolled-back|failed, from, to, at, logPath}`).
   `GET /api/system/status` returns it once (read-and-clear) as `updateResult`;
   `App.jsx` shows a success/warning toast — mirror of the existing `dbRecovery`
   pattern (`src/App.jsx:512`).

**Rollback (installed):** Inno upgrades of the same fixed AppId are themselves
transactional enough for file swap; if the new version fails to boot, the user
can reinstall the previous `setup.exe` kept at `<data>\updates\` (keep 1
previous). The result marker records `failed` with the log path; the About UI
offers the "reinstall previous version" file location in the error state. (Fully
automatic installed-mode rollback is deliberately out — it would need a watchdog
process; documented limitation.)

**Schema downgrade guard:** `runMigrations()` (db-migrations.js) compares
`MAX(schema_migrations.version)` against the app's known max **before** applying
anything; if the DB is newer, throw `DBSchemaFromFutureError` with a clear
message naming both versions and the pre-update snapshot path. Boot fails fast;
`start.ps1` surfaces it via the §2 failure dialog.

**UI (Settings → About, `AboutSection.jsx`):** the existing update banner gains
an **Update now** button (canonical Button/Badge primitives, motion vocabulary):
states downloading (percent) → verifying → restarting ("the app will restart —
this page reconnects automatically") → reload when `/api/health/ready` returns
with the new version. Errors render `AIErrorState`-style with the log path.
Update check response also gains `assets` (download URL + sha256 URL per asset)
in `update-check.js`.

### 5. Installer maintenance (installer.iss)

- **Maintenance form:** `InitializeSetup` reads the HKCU `_is1` uninstall key.
  Same-or-older installed version → custom form (`CreateCustomForm`) with
  **Repair** (proceed = reinstall-over-itself), **Uninstall** (exec registered
  `UninstallString`, abort setup), **Cancel**. Installed version older than the
  setup → skip the form; the normal wizard IS the update path. Silent installs
  never show the form.
- **Close-running-app:** `PrepareToInstall` keeps the pidfile+tasklist detection
  but instead of aborting: interactive → consent MsgBox "Close the application
  and continue?"; silent → proceed automatically. Then: read
  `.grm.shutdown-token`, `curl.exe -s -m 5 -X POST -H "X-GRM-Shutdown-Token: …"
  http://127.0.0.1:<port>/api/system/shutdown` (port read from `.env`, fallback
  3001) → poll up to 10 s → escalate `taskkill /PID <pid> /T /F` → poll 5 s →
  only then fail with the current message. Mirrored in `InitializeUninstall`.
- **Tasks:** existing `desktopicon` + new `autostart` (unchecked) → `[Icons]`
  `{userstartup}` shortcut to the exe with `--no-browser`.
- **Uninstall:** `CurUninstallStepChanged(usUninstall)` — interactive: MsgBox
  "Delete your local data (database, settings, license)?" with `MB_DEFBUTTON2`
  (default **No**); Yes → `DelTree` on `%LOCALAPPDATA%\GitHubRepoManager`.
  Silent: keep data unless `/PURGEDATA`. Always delete the `{userstartup}`
  shortcut. The existing "data preserved" notice stays for the keep path.
- **Run entries:** existing `postinstall skipifsilent` launch (now pointing at
  the exe) + new entry `Check: IsUpdatedMode` (reads `/UPDATED=1`), `Flags:
  nowait`, for the silent self-update relaunch.
- **Signing (dormant):** `#ifdef SIGN → SignTool=ts` in the `.iss`; release
  workflow gains an env gate (`CAN_SIGN` from secret presence) choosing
  `iscc /DSIGN "/Sts=signtool … /dlib Azure.CodeSigning.Dlib.dll /dmdf
  metadata.json $f"` vs the current unsigned invocation. No secrets today →
  permanently takes the unsigned branch; enabling Azure Trusted Signing later is
  configuration only.

### 6. Edge cases ledger

| Case | Handling |
| --- | --- |
| Port 3001 busy | Existing +50 scan stays; chosen port now also written to `<data>\.grm.port` so `stop.ps1`/installer curl target the real port. |
| OAuth callback vs drifted port | `setup-oauth` already derives URLs from the live origin; additionally store the origin at config time in `.env` (`GRM_OAUTH_ORIGIN`) and `AboutSection`/login page warn when current origin differs (stale GitHub callback likely). |
| PowerShell blocked by policy | Stub catches spawn failure → native dialog + docs link (`-ExecutionPolicy Bypass` already used; dialog covers AppLocker-style lockdowns). |
| App killed mid-update download | Nothing was touched yet; intent marker without result marker → next boot clears stale intent + status stays idle. |
| Update ZIP corrupted | SHA256 verified before any file swap; failure = error state, nothing stopped. |
| New version fails boot (portable) | Automatic rollback of app+runtime+DB snapshot, toast on next boot. |
| New version fails boot (installed) | Result marker `failed`, previous setup.exe retained, About error state instructs; documented limitation. |
| DB schema newer than app (manual downgrade) | `DBSchemaFromFutureError` fast-fail + failure dialog naming the snapshot. |
| Wrong/other process on recorded PID | All kill paths verify PID → `node.exe` → this package's `runtime\node.exe` (existing pattern, kept everywhere). |
| VBScript removal, .vbs AV blocks | Not applicable — no VBS anywhere in the design. |
| Console `.cmd` users / CI | `.cmd` files kept; smoke test continues to exercise them plus new exe start/stop pass. |
| Legacy pre-4.8.0 layout | Existing migration in `start.ps1` untouched. |

### 7. Docs & README premium pass

- **`README.md`:** stronger Windows section — 3-step install (download → run
  setup → sign in), the one-click update story, shortcuts/autostart, silent
  install one-liner for admins; screenshots/SVGs updated (`docs/images/`,
  1920x1080 convention). All claims must land in the same PR as the features
  (`tests/build/readme-honesty.test.js` and pricing parity updated together —
  never weakened).
- **`docs/windows.md`:** rewrite — Install (installer/portable/silent), Daily
  use (shortcuts, logs, stop), Updates (one-click, rollback semantics, manual
  fallback), Maintenance (repair/uninstall/keep-data/`/PURGEDATA`),
  Troubleshooting matrix (SmartScreen, port, OAuth callback drift, policy
  lockdown, DB recovery, update rollback), Limits (honest: unsigned, x64, no
  tray, installed-mode rollback manual).
- **`packaging/windows/README-WINDOWS.txt`:** rewritten around the exe;
  `.cmd`/console demoted to Advanced.

### 8. Testing & verification

- **Unit (Vitest):** `server/__tests__/` — shutdown route (loopback + token +
  CSRF bypass + 404 when unmanaged), `updater.js` pure parts (asset selection,
  sha256 verify, intent/result marker lifecycle, mode detection), schema
  downgrade guard, `update-check.js` assets extension. `scripts/__tests__/`
  — stub compile step (csc invocation args, exe existence), launcher file list.
- **Honesty gates:** README claims ↔ features updated in lockstep.
- **CI smoke (release.yml):** existing `.cmd` smoke stays; add: launch via
  `GitHub Repo Manager.exe --no-browser`, health, stop via exe (token path),
  assert token/pidfile cleanup; assert `logs/server-*.log` non-empty; portable
  `apply-update.ps1` dry-run against a same-version staged tree (swap +
  health + result marker `success`).
- **Installer `[Code]`:** not unit-testable — validated via the existing
  colleague feedback loop; a manual test checklist ships in the PR description
  (install → repair → update-over → uninstall keep → uninstall purge → silent).

### 9. Delivery — 3 PRs

1. **feat(windows): native launcher, graceful stop, logs, installer maintenance**
   — §1, §2, §3, §5 (minus the `/UPDATED` Run entry), README-WINDOWS.txt. This
   is the release the installer-feedback colleague retests (includes the
   pending 2026-07-20 fixes already merged on main).
2. **feat(windows): one-click update with verification and rollback** — §4,
   `/UPDATED` Run entry, downgrade guard, About UI, edge-case markers.
3. **docs: Windows premium docs pass** — §7 (README, docs/windows.md, images),
   honesty gates updated.
