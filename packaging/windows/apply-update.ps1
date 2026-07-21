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
# Defined up front (not just once the swap starts) so Restore-FromBackup can
# resolve it from any failure point, including one before a backup exists.
$Backup = Join-Path $UpdatesDir ("backup-{0}" -f $FromVersion)
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
function Restore-FromBackup {
    # Idempotent recovery: leave PackageRoot holding the OLD app+runtime+DB and
    # relaunch. Safe to call from a mid-swap throw (some moves done, some not),
    # from the health-timeout path, and from an early failure where nothing was
    # moved yet (backup dirs absent -> PackageRoot already holds the original).
    param([string]$Reason)
    Log ("restoring from backup: " + $Reason)
    # Stop any half-started new instance before touching its files.
    try { & (Join-Path $PackageRoot 'GitHub Repo Manager.exe') stop 2>$null | Out-Null } catch { }
    Start-Sleep -Seconds 2
    foreach ($sub in @('app', 'runtime')) {
        $backupSub = Join-Path $Backup $sub
        $liveSub = Join-Path $PackageRoot $sub
        if (Test-Path -LiteralPath $backupSub) {
            # We have a backed-up original -> it is the source of truth. Remove
            # whatever partial/new copy is live, then move the original back.
            if (Test-Path -LiteralPath $liveSub) {
                Remove-Item -Recurse -Force -LiteralPath $liveSub -ErrorAction SilentlyContinue
            }
            Move-Item -LiteralPath $backupSub -Destination $liveSub -ErrorAction SilentlyContinue
        }
        # else: nothing was backed up for this sub -> PackageRoot still has the
        # original in place; leave it.
    }
    $Snapshot = Join-Path $UpdatesDir ("pre-update-{0}.db" -f $FromVersion)
    if (Test-Path -LiteralPath $Snapshot) {
        # App and schema must revert together - the new version may have
        # migrated the DB past what the old app's downgrade guard accepts.
        $DbPath = Join-Path $DataDir 'manager.db'
        Copy-Item -LiteralPath $Snapshot -Destination $DbPath -Force -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath ($DbPath + '-wal'), ($DbPath + '-shm') -ErrorAction SilentlyContinue
    }
    Start-Process -FilePath (Join-Path $PackageRoot 'GitHub Repo Manager.exe') -ArgumentList '--no-browser' | Out-Null
}

try {
    Log "waiting for server PID $ServerPid to exit"
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Process -Id $ServerPid -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $deadline)) {
        Start-Sleep -Milliseconds 500
    }
    if (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue) {
        # Mirror stop.ps1's PID-identity guard: only taskkill a PID that is
        # still verifiably OUR server (node.exe under this package's
        # runtime\), never a PID Windows may since have reassigned to an
        # unrelated process.
        $proc = Get-Process -Id $ServerPid -ErrorAction SilentlyContinue
        $isOurServer = $false
        if ($proc -and $proc.ProcessName -eq 'node') {
            $procPath = $null
            try { $procPath = $proc.Path } catch { $procPath = $null }
            $runtimeDir = (Resolve-Path -LiteralPath (Join-Path $PackageRoot 'runtime') -ErrorAction SilentlyContinue).Path
            if ($procPath -and $runtimeDir) {
                $runtimePrefix = $runtimeDir.TrimEnd('\') + '\'
                if ($procPath.StartsWith($runtimePrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                    $isOurServer = $true
                }
            }
        }
        if ($isOurServer) {
            Log "server still alive - taskkill"
            & taskkill /PID $ServerPid /T /F 2>$null | Out-Null
            $killDeadline = (Get-Date).AddSeconds(5)
            while ((Get-Process -Id $ServerPid -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $killDeadline)) {
                Start-Sleep -Milliseconds 250
            }
            if (Get-Process -Id $ServerPid -ErrorAction SilentlyContinue) {
                # A held file handle here would break the swap below - bail
                # out before touching anything on disk.
                Log "PID $ServerPid would not die after taskkill - aborting before touching files"
                Write-Result 'failed'
                exit 1
            }
        } else {
            Log "PID $ServerPid is no longer this package's runtime\node.exe (reused or already exited) - skipping taskkill"
        }
    }

    $Staging = Join-Path $UpdatesDir ("staging-{0}" -f $ToVersion)

    # Old staging/backup dirs from previous (possibly interrupted) updates:
    # keep disk bounded; one backup is enough for manual recovery.
    Get-ChildItem -LiteralPath $UpdatesDir -Directory -Filter 'staging-*' -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Log "extracting $ZipPath"
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $Staging -Force

    Get-ChildItem -LiteralPath $UpdatesDir -Directory -Filter 'backup-*' -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
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

    Restore-FromBackup 'health check failed'
    Write-Result 'rolled-back'
    exit 1
} catch {
    $fatalMessage = $_.Exception.Message
    try {
        Restore-FromBackup ('fatal: ' + $fatalMessage)
        Write-Result 'rolled-back'
    } catch {
        # Last resort: recovery itself failed (e.g. backup also inaccessible).
        # PackageRoot may be left unbootable, but we must still report status
        # honestly rather than silently exiting.
        Log ("restore-from-backup also failed: " + $_.Exception.Message + " (original fatal: " + $fatalMessage + ")")
        Write-Result 'failed'
    }
    exit 1
}
