# SPDX-License-Identifier: Apache-2.0
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
    #
    # Returns [bool]: $true only if every sub that had a backup was verifiably
    # restored to PackageRoot; $false if restoration could not be confirmed
    # (e.g. the half-started new instance still held a file handle after the
    # wait below, so Remove/Move silently no-op'd). Callers must not report
    # 'rolled-back' on $false - PackageRoot may still hold the broken new
    # version, and telling the user otherwise would be a lie.
    param([string]$Reason)
    Log ("restoring from backup: " + $Reason)
    # Capture the half-started new instance's PID *before* calling stop below:
    # stop deletes the pidfile as soon as it reads it (see stop.ps1), so by
    # the time stop returns there is nothing left here to read.
    $newInstancePidFile = Join-Path $DataDir '.grm.pid'
    $newInstancePid = $null
    if (Test-Path -LiteralPath $newInstancePidFile) {
        $pidText = (Get-Content -LiteralPath $newInstancePidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
        if ($pidText -match '^\d+$') { $newInstancePid = [int]$pidText }
    }
    # Stop any half-started new instance before touching its files.
    try { & (Join-Path $PackageRoot 'GitHub Repo Manager.exe') stop 2>$null | Out-Null } catch { }
    # The 2s sleep is only a floor. When the new instance's PID is known, poll
    # up to ~8s more for it to actually exit - a held file handle is exactly
    # what makes the Remove/Move below silently no-op, which is why the
    # end-state gets verified below instead of trusting cmdlet "success".
    Start-Sleep -Seconds 2
    if ($newInstancePid) {
        $handleDeadline = (Get-Date).AddSeconds(8)
        while ((Get-Process -Id $newInstancePid -ErrorAction SilentlyContinue) -and ((Get-Date) -lt $handleDeadline)) {
            Start-Sleep -Milliseconds 500
        }
    }
    [bool]$ok = $true
    foreach ($sub in @('app', 'runtime')) {
        $backupSub = Join-Path $Backup $sub
        $liveSub = Join-Path $PackageRoot $sub
        if (Test-Path -LiteralPath $backupSub) {
            # We have a backed-up original -> it is the source of truth. Remove
            # whatever partial/new copy is live, then move the original back.
            if (Test-Path -LiteralPath $liveSub) {
                Remove-Item -Recurse -Force -LiteralPath $liveSub -ErrorAction SilentlyContinue | Out-Null
            }
            if (Test-Path -LiteralPath $liveSub) {
                # A held file handle survived the remove attempt, so $liveSub
                # still exists as a (partial) directory. Move-Item onto an
                # EXISTING directory nests the source inside it (app\app\...)
                # instead of replacing it - moving here would silently
                # corrupt the tree while a naive Test-Path check would still
                # call it restored. Refuse the move and leave the backup in
                # place for manual recovery instead.
                Log ("restore verification FAILED for '" + $sub + "' - live dir survived removal (held file?), refusing to move over it")
                $ok = $false
            } else {
                Move-Item -LiteralPath $backupSub -Destination $liveSub -ErrorAction SilentlyContinue | Out-Null
                # -ErrorAction SilentlyContinue means a held handle above leaves
                # this a silent no-op instead of a throw, so the only honest
                # signal is the resulting filesystem state: the live dir must now
                # exist AND the backup must be gone (consumed by the move).
                $restored = (Test-Path -LiteralPath $liveSub) -and -not (Test-Path -LiteralPath $backupSub)
                if (-not $restored) {
                    Log ("restore verification FAILED for '" + $sub + "' - live present: " + (Test-Path -LiteralPath $liveSub) + ", backup still present: " + (Test-Path -LiteralPath $backupSub))
                    $ok = $false
                }
            }
        }
        # else: nothing was backed up for this sub -> PackageRoot still has the
        # original in place; leave it.
    }
    $Snapshot = Join-Path $UpdatesDir ("pre-update-{0}.db" -f $FromVersion)
    if (Test-Path -LiteralPath $Snapshot) {
        # App and schema must revert together - the new version may have
        # migrated the DB past what the old app's downgrade guard accepts.
        # Best-effort regardless of $ok: a DB revert is still worth attempting
        # even when app/runtime restoration could not be confirmed.
        $DbPath = Join-Path $DataDir 'manager.db'
        Copy-Item -LiteralPath $Snapshot -Destination $DbPath -Force -ErrorAction SilentlyContinue | Out-Null
        Remove-Item -LiteralPath ($DbPath + '-wal'), ($DbPath + '-shm') -ErrorAction SilentlyContinue | Out-Null
    }
    # --start-only (server only), not tray mode: a resident tray holds the
    # single-instance mutex, so relaunching as a tray would not restart the
    # server. --start-only brings the (rolled-back) server back and the tray
    # picks it up.
    Start-Process -FilePath (Join-Path $PackageRoot 'GitHub Repo Manager.exe') -ArgumentList '--start-only','--no-browser' | Out-Null
    return $ok
}

try {
    # Every checkpoint below is timestamped by Log(). Together they bracket the
    # four phases that can take real time — waiting for the old server to exit,
    # extracting the package, swapping app/runtime, and waiting for the new
    # server to report ready — so the log alone answers "where did the update
    # spend its time", for a user's support ticket as much as for CI.
    Log ("apply-update starting: {0} -> {1}, packageRoot={2}" -f $FromVersion, $ToVersion, $PackageRoot)
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
    Log ("extracting {0} ({1:N1} MB) to staging" -f $ZipPath, ((Get-Item -LiteralPath $ZipPath).Length / 1MB))
    # NOT Expand-Archive. This script is launched with powershell.exe — Windows
    # PowerShell 5.1 — whose Expand-Archive is a pure-PowerShell implementation
    # with per-entry pipeline overhead. On the shipped 128 MB package that took
    # 16 minutes (measured in CI: 22:48:05 -> 23:04:08), during which the user
    # sees an app that has stopped and not come back. The pwsh 7 build of the
    # same cmdlet is .NET-backed and fast, which is why the workflow's own
    # extraction steps looked fine and hid this for so long.
    #
    # ZipFile::ExtractToDirectory is that same .NET path, and it is available
    # on 5.1. Benchmarked under 5.1 on 4000 small files: 74.0 s -> 2.3 s, 32x.
    #
    # ExtractToDirectory throws if the destination exists, where Expand-Archive
    # -Force overwrote. The staging sweep above already removed every
    # staging-* directory, so the only way it can exist here is a same-run
    # collision — remove it explicitly rather than relying on that.
    if (Test-Path -LiteralPath $Staging) {
        Remove-Item -LiteralPath $Staging -Recurse -Force
    }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $Staging)

    Get-ChildItem -LiteralPath $UpdatesDir -Directory -Filter 'backup-*' -ErrorAction SilentlyContinue |
        Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    New-Item -ItemType Directory -Force -Path $Backup | Out-Null

    Log "extraction done; swapping app/runtime"
    Move-Item -LiteralPath (Join-Path $PackageRoot 'app') -Destination (Join-Path $Backup 'app')
    Move-Item -LiteralPath (Join-Path $PackageRoot 'runtime') -Destination (Join-Path $Backup 'runtime')
    Move-Item -LiteralPath (Join-Path $Staging 'app') -Destination (Join-Path $PackageRoot 'app')
    Move-Item -LiteralPath (Join-Path $Staging 'runtime') -Destination (Join-Path $PackageRoot 'runtime')
    # Root launchers (the .exe, .ps1, .cmd). SilentlyContinue tolerates a
    # resident tray holding a lock on its own "GitHub Repo Manager.exe": the
    # stub is version-stable, so the old stub running against the new
    # app/runtime is fine, and it refreshes on the next non-resident launch.
    Get-ChildItem -LiteralPath $Staging -File | ForEach-Object {
        Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $PackageRoot $_.Name) -Force -ErrorAction SilentlyContinue
    }

    # --start-only, not tray mode: this restarts the SERVER only. A tray already
    # resident from before the update holds the single-instance mutex and would
    # bounce a fresh tray launch to "reopen browser" without restarting the
    # server; --start-only sidesteps the mutex and the resident tray picks the
    # restarted server back up via its health poll. With no tray, the server
    # simply runs headless as it did before.
    Log "relaunching"
    Start-Process -FilePath (Join-Path $PackageRoot 'GitHub Repo Manager.exe') -ArgumentList '--start-only','--no-browser' | Out-Null
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

    if (Restore-FromBackup 'health check failed') {
        Write-Result 'rolled-back'
    } else {
        Write-Result 'failed'
    }
    exit 1
} catch {
    $fatalMessage = $_.Exception.Message
    try {
        if (Restore-FromBackup ('fatal: ' + $fatalMessage)) {
            Write-Result 'rolled-back'
        } else {
            Write-Result 'failed'
        }
    } catch {
        # Last resort: recovery itself failed (e.g. backup also inaccessible).
        # PackageRoot may be left unbootable, but we must still report status
        # honestly rather than silently exiting.
        Log ("restore-from-backup also failed: " + $_.Exception.Message + " (original fatal: " + $fatalMessage + ")")
        Write-Result 'failed'
    }
    exit 1
}
