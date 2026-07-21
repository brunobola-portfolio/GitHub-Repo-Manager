# SPDX-License-Identifier: AGPL-3.0-only
#
# Stops the server started by start.ps1. Reads the PID that Start wrote to
# .grm.pid in the data directory (pre-4.8.0: app\.grm.pid) and terminates
# it -but only after
# confirming the PID still belongs to OUR bundled node.exe. A stale pidfile
# (crash, manual kill, reboot) can point at a PID that Windows has since
# reassigned to an unrelated process; killing blindly by PID alone would be
# a real (if rare) footgun, so this checks both process name and, when
# accessible, the exact executable path against runtime\node.exe.
#
# A managed-mode run (started with GRM_MANAGED=1, i.e. via start.ps1) gets a
# graceful shutdown attempt first: POST /api/system/shutdown, authorized by
# the per-boot token in .grm.shutdown-token, runs server/index.js's
# gracefulShutdown() in-process (workers stopped, DB closed, in-flight
# migration_jobs/migration_plans rows marked 'interrupted'). Only when that
# is unavailable (no token/port file - portable or pre-4.8.2 launch), fails,
# or times out does this fall back to the historical hard kill below.
#
# The fallback is a hard TerminateProcess (Stop-Process -Force), not a POSIX
# SIGTERM -verified empirically on this machine: neither `Stop-Process`
# without -Force nor `taskkill` without /F can deliver any catchable signal
# to a node.exe console process (taskkill refuses outright: "This process
# can only be terminated forcefully"), so gracefulShutdown() never runs via
# this path on Windows. Data safety does not depend on it: better-sqlite3
# runs in WAL mode, which is crash-safe by design. The only thing lost is
# gracefulShutdown's cosmetic bookkeeping (those same rows staying 'running'
# instead of 'interrupted' after a crash) -a UI accuracy nicety, not a
# correctness or data-loss concern.

$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
$AppDir = Join-Path $Root 'app'
$NodeExe = Join-Path $Root 'runtime\node.exe'
$InstallConfigFile = Join-Path $Root 'install-config.txt'

# Resolve the data dir exactly like start.ps1 does (GRM_DATA_DIR env var →
# installer's install-config.txt marker → portable .\data default): the
# pidfile lives there since v4.8.0 so the install dir can be read-only.
$DataDir = $env:GRM_DATA_DIR
if (-not $DataDir -and (Test-Path -LiteralPath $InstallConfigFile)) {
    foreach ($line in Get-Content -LiteralPath $InstallConfigFile) {
        if ($line -match '^\s*DATA_DIR\s*=\s*(.+?)\s*$') {
            # Same runtime env-var expansion as start.ps1's Get-InstalledDataDir.
            $DataDir = [System.Environment]::ExpandEnvironmentVariables($Matches[1])
            break
        }
    }
}
if (-not $DataDir) {
    $DataDir = Join-Path $Root 'data'
}

$PidFile = Join-Path $DataDir '.grm.pid'
if (-not (Test-Path -LiteralPath $PidFile)) {
    # Pre-4.8.0 layout fallback: a still-running instance started by an older
    # launcher wrote its pidfile next to app\.env inside the install dir.
    $LegacyPidFile = Join-Path $AppDir '.grm.pid'
    if (Test-Path -LiteralPath $LegacyPidFile) {
        $PidFile = $LegacyPidFile
    }
}

if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Host "GitHub Repo Manager is not running (no pidfile found)."
    exit 0
}

$pidText = (Get-Content -LiteralPath $PidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
# Always clear the pidfile once we've read it -whatever happens next, a
# stale/consumed pidfile must never linger and mislead the next Start/Stop.
Remove-Item -LiteralPath $PidFile -ErrorAction SilentlyContinue

if (-not $pidText -or -not ($pidText -match '^\d+$')) {
    Write-Host "GitHub Repo Manager is not running (pidfile was empty or invalid)."
    exit 0
}
$targetPid = [int]$pidText

$proc = Get-Process -Id $targetPid -ErrorAction SilentlyContinue
if (-not $proc) {
    Write-Host "GitHub Repo Manager is not running (PID $targetPid is no longer active)."
    exit 0
}

if ($proc.ProcessName -ne 'node') {
    Write-Host "PID $targetPid is not GitHub Repo Manager (found '$($proc.ProcessName)') -this PID was likely reused by another program. Not stopping it."
    exit 0
}

# Path is unavailable when running without sufficient privilege against a
# process owned by another user/session; fall back to the name-only check
# above in that case rather than failing the whole stop.
$procPath = $null
try { $procPath = $proc.Path } catch { $procPath = $null }
if ($procPath) {
    $resolvedNodeExe = (Resolve-Path -LiteralPath $NodeExe -ErrorAction SilentlyContinue).Path
    if ($resolvedNodeExe -and ($procPath -ne $resolvedNodeExe)) {
        Write-Host "PID $targetPid is a node.exe process, but not this package's runtime\node.exe -this PID was likely reused. Not stopping it."
        exit 0
    }
}

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

Stop-Process -Id $targetPid -Force
Remove-Item -LiteralPath $PortFile -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $TokenFile -ErrorAction SilentlyContinue
Write-Host "GitHub Repo Manager stopped (PID $targetPid)."
