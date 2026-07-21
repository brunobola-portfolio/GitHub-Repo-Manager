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
