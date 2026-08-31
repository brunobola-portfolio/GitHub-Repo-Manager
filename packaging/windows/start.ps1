# SPDX-License-Identifier: Apache-2.0
#
# Boots GitHub Repo Manager using the bundled runtime\node.exe. Shared by both
# distribution forms:
#   - portable ZIP:      no install-config.txt next to this script -> DataDir
#                        defaults to ".\data" next to this script.
#   - Inno installer:    installer.iss writes install-config.txt (DATA_DIR=
#                        %LOCALAPPDATA%\GitHubRepoManager\data) next to this
#                        script right after install, so DataDir resolves
#                        there for EVERY launch path -- Start Menu shortcut,
#                        desktop shortcut, or double-clicking this .cmd
#                        directly -- with no dependence on how it was
#                        launched. User data survives reinstall/uninstall
#                        because that dir lives outside {app} entirely.
#
# -NoBrowser is the CI/automation switch: skip opening a browser and never
# show an error dialog; the script still waits for the health check (or an
# early server exit) before returning so callers get a meaningful exit code.
#
# $PSScriptRoot resolves to this script's own directory regardless of spaces
# or non-ASCII characters in the install path, and every path built from it
# below is passed as a single PowerShell argument (not string-concatenated
# into a shell command line), so none of this needs manual quoting the way an
# equivalent .cmd/batch script would.

param(
    [string]$DataDir,
    [int]$Port,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

# Direct PowerShell callers use -NoBrowser/-DataDir/-Port. The .cmd wrapper
# (and the Inno Setup shortcut, and CI) use the env var form instead -
# GRM_NO_BROWSER=1 / GRM_DATA_DIR=<path> / GRM_PORT=<n> -because an env var
# holds a value verbatim (spaces, non-ASCII, all of it) with no risk of
# cmd.exe mis-tokenizing a rebuilt "-DataDir \"...\"" command-line string the
# way a naive shift/concat batch parser can.
if (-not $PSBoundParameters.ContainsKey('NoBrowser') -and $env:GRM_NO_BROWSER -eq '1') {
    $NoBrowser = $true
}
if (-not $DataDir -and $env:GRM_DATA_DIR) {
    $DataDir = $env:GRM_DATA_DIR
}
if (-not $Port -and $env:GRM_PORT) {
    $Port = [int]$env:GRM_PORT
}
# A -Port/GRM_PORT override is a per-run instruction from the caller (CI, the
# updater, a power user), not a configuration change -the busy-port fallback
# further down must never write it back into .env.
$PortWasRequested = [bool]$Port

$Root = $PSScriptRoot
$AppDir = Join-Path $Root 'app'
$NodeExe = Join-Path $Root 'runtime\node.exe'
$ServerEntry = Join-Path $AppDir 'server\index.js'
$FirstRun = Join-Path $AppDir 'scripts\first-run.mjs'
$InstallConfigFile = Join-Path $Root 'install-config.txt'

# installer.iss writes install-config.txt (DATA_DIR=<LocalAppData path>)
# right after copying files, into the SAME directory as this script -- so an
# installed copy defaults correctly here regardless of how it's launched
# (Start Menu shortcut, desktop shortcut, or double-clicking this .cmd
# directly, which README-WINDOWS.txt explicitly tells users works). Without
# this, only a shortcut's --data-dir Parameters would get it right, and a
# direct launch would silently default to the portable ".\data" layout
# under the install dir -- which [UninstallDelete] then deletes wholesale on
# uninstall. A portable ZIP extraction never has this file, so it keeps the
# portable default below untouched.
function Get-InstalledDataDir {
    if (Test-Path -LiteralPath $InstallConfigFile) {
        foreach ($line in Get-Content -LiteralPath $InstallConfigFile) {
            if ($line -match '^\s*DATA_DIR\s*=\s*(.+?)\s*$') {
                # 4.8.2+ markers hold %LOCALAPPDATA%\... unexpanded so each
                # user resolves their OWN data dir even when another account
                # (admin rollout) ran the installer. Pre-4.8.2 markers hold an
                # absolute path — expansion is a no-op on those.
                return [System.Environment]::ExpandEnvironmentVariables($Matches[1])
            }
        }
    }
    return $null
}

if (-not $DataDir) {
    $installedDataDir = Get-InstalledDataDir
    if ($installedDataDir) {
        $DataDir = $installedDataDir
    } else {
        $DataDir = Join-Path $Root 'data'
    }
}

# All WRITABLE state lives in the data dir (v4.8.0+): the SQLite DB, .env
# (it holds CREDENTIAL_ENCRYPTION_KEY — losing it on uninstall/reinstall
# would strand every encrypted credential in the surviving database), and
# the pidfile. The app/install dir can be read-only (e.g. an elevated
# custom /DIR= under Program Files) without breaking anything.
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# All server output (including pre-boot crashes that never reach pino) goes
# to a dated log file: with the launcher running everything hidden there is
# no console buffer anymore, and "closing the window" no longer exists as a
# way to lose diagnostics. 7-day retention, pruned on every launch.
$LogsDir = Join-Path $DataDir 'logs'
New-Item -ItemType Directory -Force -Path $LogsDir | Out-Null
$LogFile = Join-Path $LogsDir ("server-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))

# Age alone is not a size ceiling: the log NAME is fixed at launch, so an
# autostart install that stays up for weeks appends to one file forever and
# the age prune never reaches it. Both bounds below run here, while nothing
# holds the file handle: a single-file roll to `.log.1` and a directory-total
# cap. -Filter is avoided (its 8.3 short-name matching can pick up unrelated
# names); a -like on the real name is exact.
$LogMaxBytes = 10MB
$LogsTotalMaxBytes = 50MB
function Get-ServerLogFiles {
    Get-ChildItem -LiteralPath $LogsDir -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -like 'server-*.log*' }
}

Get-ServerLogFiles |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

$existingLog = Get-Item -LiteralPath $LogFile -ErrorAction SilentlyContinue
if ($existingLog -and $existingLog.Length -ge $LogMaxBytes) {
    $rolledLog = "$LogFile.1"
    Remove-Item -LiteralPath $rolledLog -Force -ErrorAction SilentlyContinue
    Move-Item -LiteralPath $LogFile -Destination $rolledLog -Force -ErrorAction SilentlyContinue
}

# Oldest-first deletion until the directory total is back under the cap:
# the roll above bounds ONE file, this bounds an install that rolls many.
$logFiles = @(Get-ServerLogFiles | Sort-Object LastWriteTime)
$logTotalBytes = ($logFiles | Measure-Object -Property Length -Sum).Sum
$logIndex = 0
while ($logTotalBytes -gt $LogsTotalMaxBytes -and $logIndex -lt $logFiles.Count) {
    $logTotalBytes -= $logFiles[$logIndex].Length
    Remove-Item -LiteralPath $logFiles[$logIndex].FullName -Force -ErrorAction SilentlyContinue
    $logIndex++
}

$EnvFile = Join-Path $DataDir '.env'
$PidFile = Join-Path $DataDir '.grm.pid'

# One-time migration from the pre-4.8.0 layout, where .env lived at
# app\.env inside the install/extract dir. Move (not copy) so exactly one
# copy of the secrets exists; fall back to copy if the app dir turns out
# to be read-only.
$LegacyEnvFile = Join-Path $AppDir '.env'
if ((Test-Path -LiteralPath $LegacyEnvFile) -and -not (Test-Path -LiteralPath $EnvFile)) {
    try {
        Move-Item -LiteralPath $LegacyEnvFile -Destination $EnvFile
        Write-Host "Migrated app\.env to the data directory: $EnvFile"
    } catch {
        Copy-Item -LiteralPath $LegacyEnvFile -Destination $EnvFile
        Write-Host "Copied app\.env to the data directory: $EnvFile (could not remove the old copy)"
    }
}

if (-not (Test-Path -LiteralPath $NodeExe)) {
    Write-Error "Bundled Node runtime not found at: $NodeExe`nThis package looks corrupt or incomplete -re-download it."
    exit 1
}
if (-not (Test-Path -LiteralPath $ServerEntry)) {
    Write-Error "Server entry point not found at: $ServerEntry`nThis package looks corrupt or incomplete -re-download it."
    exit 1
}

# Idempotent: only writes the data-dir .env (with fresh random secrets) if it
# does not already exist. An existing .env is never touched, so a user's own
# edits (e.g. a custom PORT) survive every subsequent launch.
& $NodeExe $FirstRun $EnvFile '--data-dir' $DataDir
if ($LASTEXITCODE -ne 0) {
    Write-Error "first-run bootstrap failed (exit $LASTEXITCODE) -see output above."
    exit 1
}

function Get-ConfiguredPort {
    if (Test-Path -LiteralPath $EnvFile) {
        foreach ($line in Get-Content -LiteralPath $EnvFile) {
            if ($line -match '^\s*PORT\s*=\s*(\d+)\s*$') {
                return [int]$Matches[1]
            }
        }
    }
    return 3001
}

function Test-EnvFileSetsHost {
    if (Test-Path -LiteralPath $EnvFile) {
        foreach ($line in Get-Content -LiteralPath $EnvFile) {
            if ($line -match '^\s*HOST\s*=') {
                return $true
            }
        }
    }
    return $false
}

$configuredPort = if ($Port) { $Port } else { Get-ConfiguredPort }

function Test-HealthLive([int]$TargetPort) {
    try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$TargetPort/api/health/live" -TimeoutSec 2 -UseBasicParsing
        return $resp.StatusCode -eq 200
    } catch {
        return $false
    }
}

function Test-PortBusy([int]$TargetPort) {
    # Get-NetTCPConnection ships with the NetTCPIP module on every supported
    # Windows client/server SKU and on GitHub's windows-latest runners.
    $listening = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
    return [bool]$listening
}

if (Test-HealthLive $configuredPort) {
    Write-Host "GitHub Repo Manager is already running on port $configuredPort -reusing it."
    if (-not $NoBrowser) {
        Start-Process "http://127.0.0.1:$configuredPort"
    }
    exit 0
}

$actualPort = $configuredPort
if (Test-PortBusy $configuredPort) {
    Write-Host "Port $configuredPort is in use by something else -looking for a free port..."
    $found = $false
    $candidate = $configuredPort
    for ($i = 0; $i -lt 50; $i++) {
        $candidate++
        if (-not (Test-PortBusy $candidate)) {
            $actualPort = $candidate
            $found = $true
            break
        }
    }
    if (-not $found) {
        Write-Error "Could not find a free port after $configuredPort -closing whatever is using it and retrying is recommended."
        exit 1
    }
    Write-Host "Using port $actualPort for this run (configured port was $configuredPort)."

    # Persisting the drifted port is what keeps GitHub login working.
    # server/routes/auth.js builds redirect_uri from the request host, so it
    # follows the REAL port while the callback registered on the GitHub OAuth
    # App still points at the old one -the user lands on GitHub's raw
    # redirect_uri-mismatch page. Leaving .env untouched made that permanent:
    # the scan re-ran every launch and could pick a different port each day,
    # so even re-registering the callback broke again tomorrow. Written via
    # scripts/first-run.mjs --set-port, which goes through
    # server/lib/env-file.js's allowlisted, atomic (temp file + rename, mode
    # 0600) writer -this file also holds CREDENTIAL_ENCRYPTION_KEY, and a
    # truncated write would strand every encrypted credential in the database.
    if ($PortWasRequested) {
        Write-Host "Port $configuredPort was requested explicitly for this run, so $EnvFile is left unchanged."
    } else {
        $persistFailure = $null
        try {
            & $NodeExe $FirstRun $EnvFile '--set-port' "$actualPort" 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { $persistFailure = "exit $LASTEXITCODE" }
        } catch {
            $persistFailure = $_.Exception.Message
        }
        # Re-read the file rather than trusting the exit code alone: under
        # ErrorActionPreference=Stop any stray line node writes to stderr
        # becomes a catchable NativeCommandError even when the write succeeded,
        # and reporting a failed save that actually landed would send the user
        # chasing the wrong problem.
        if ((Get-ConfiguredPort) -eq $actualPort) {
            Write-Host "Saved PORT=$actualPort to $EnvFile so this port stays stable across launches."
            Write-Host "If GitHub sign-in is already configured, update the OAuth App callback URL to http://127.0.0.1:$actualPort/api/auth/callback."
        } elseif ($persistFailure) {
            Write-Host "Could not save PORT=$actualPort to $EnvFile ($persistFailure) - the port may change again on the next launch."
        } else {
            Write-Host "Could not save PORT=$actualPort to $EnvFile - the port may change again on the next launch."
        }
    }
}

$env:PORT = "$actualPort"
$env:DATA_DIR = $DataDir
# server/index.js binds ALL interfaces when HOST is unset, so the loopback-only
# default must not depend on one line surviving in a user-editable text file:
# deleting HOST=127.0.0.1 from .env would silently LAN-expose the app (and
# raise a Windows Firewall prompt). Setting it as a real process env var makes
# the safe bind the managed runtime's floor. dotenv does not override real env
# vars, so a HOST the user deliberately put in .env still wins - this only
# fills the gap where there is none.
if (-not $env:HOST -and -not (Test-EnvFileSetsHost)) {
    $env:HOST = '127.0.0.1'
}
# Tell the server exactly which .env to load (server/config.js) — it no
# longer sits at the app dir default location.
$env:GRM_ENV_FILE = $EnvFile
# Set as a real process env var, not left to app\.env's NODE_ENV=production
# line: server/lib/logger.js reads process.env.NODE_ENV at its own top-level
# module-load time, and server/routes/migration.js (imported before
# server/config.js in server/index.js's own import order) pulls logger.js in
# transitively before config.js's dotenv.config() has run - so if NODE_ENV
# only ever comes from the .env file, logger.js still sees it unset at that
# point and reaches for the pino-pretty dev transport, which does not exist
# in this package's production-pruned node_modules (crashes on boot). Every
# other deployment path (Docker's `ENV NODE_ENV=production`, a host's process
# manager) sets this as a real OS env var before node even starts for the
# same reason; this mirrors that instead of relying on dotenv timing.
$env:NODE_ENV = 'production'

# Managed mode: the server writes a per-boot shutdown token so stop.ps1 and
# the installer can request a graceful exit (POST /api/system/shutdown).
$env:GRM_MANAGED = '1'
# Read by server/routes/system.js's POST /update (server/lib/updater.js's
# startUpdate) to find apply-update.ps1 and the app/runtime dirs it swaps -
# $Root is this script's own directory, which for both distribution forms
# (portable ZIP extraction or an Inno-installed {app}) is exactly the
# package root apply-update.ps1 needs to operate on.
$env:GRM_PACKAGE_ROOT = $Root
# The ACTUAL port for this run — stop.ps1 and installer.iss read this to
# target the shutdown endpoint correctly. It normally matches .env's PORT now
# that a drifted port is persisted above, but an explicit -Port/GRM_PORT run
# deliberately leaves .env alone, so this marker stays the authority.
Set-Content -LiteralPath (Join-Path $DataDir '.grm.port') -Value "$actualPort" -Encoding ascii

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
