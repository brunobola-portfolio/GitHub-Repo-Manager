#Requires -Version 5.1
<#
.SYNOPSIS
    Registers GitHub Repo Manager as a Windows service behind an IIS reverse proxy.

.DESCRIPTION
    Creates (or updates) an NSSM-managed service that runs `node server/index.js`
    with NODE_ENV=production, restarts it on failure, and rotates its stdout /
    stderr logs.

    The service is deliberately the ONLY thing that starts the app. Do not also
    run `npm start` in a console on the same host — two processes racing for
    :3001 and the same SQLite file is the fastest way to a locked database.

    Idempotent: re-running against an existing service reconfigures it in place
    rather than failing, so it doubles as the post-upgrade step.

.PARAMETER AppRoot
    Directory containing package.json and server\index.js.

.PARAMETER EnvFile
    Path to the production .env. Passed to the service as GRM_ENV_FILE so the
    secrets file can live in the data directory, outside the install tree.

.PARAMETER ServiceName
    Windows service name. Default: GitHubRepoManager

.PARAMETER LogDir
    Where stdout/stderr are written. Default: <DATA_DIR from EnvFile>\logs,
    falling back to <AppRoot>\logs.

.PARAMETER NodePath
    node.exe to run. Defaults to the first node.exe on PATH. Must satisfy
    package.json's engines range (Node 24 LTS is the tested target; 22 LTS is
    the supported floor). The range is read from package.json, not hardcoded.

.PARAMETER NssmPath
    nssm.exe. Defaults to the first one on PATH. Get it from https://nssm.cc/.

.PARAMETER ServiceAccount
    Account the service runs as. Default: LocalSystem. For least privilege,
    pass a dedicated account with Modify on DATA_DIR and Read on AppRoot, and
    supply -ServicePassword.

.EXAMPLE
    .\install-service.ps1 -AppRoot C:\apps\GitHubRepoManager `
                          -EnvFile C:\ProgramData\GitHubRepoManager\data\.env

.NOTES
    Run from an elevated PowerShell. See docs/guides/deploy-iis-windows.md.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)] [string] $AppRoot,
    [Parameter(Mandatory = $true)] [string] $EnvFile,
    [string] $ServiceName = 'GitHubRepoManager',
    [string] $LogDir,
    [string] $NodePath,
    [string] $NssmPath,
    [string] $ServiceAccount = 'LocalSystem',
    # SecureString, not a plain [string]: a plain parameter shows up in
    # PowerShell transcripts and in `Get-History`, and this repo does not put
    # credentials in either.
    [System.Security.SecureString] $ServicePassword
)

$ErrorActionPreference = 'Stop'

function Assert-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'This script must be run from an elevated PowerShell (Run as Administrator).'
    }
}

function Resolve-Tool {
    param([string] $Explicit, [string] $Command, [string] $Hint)
    if ($Explicit) {
        if (-not (Test-Path -LiteralPath $Explicit)) { throw "Not found: $Explicit" }
        return (Resolve-Path -LiteralPath $Explicit).Path
    }
    $found = Get-Command $Command -ErrorAction SilentlyContinue
    if (-not $found) { throw "$Command not found on PATH. $Hint" }
    return $found.Source
}

# Reads one key out of the .env without sourcing it — we only need DATA_DIR to
# place the logs, and parsing the whole file would mean handling quoting rules
# that dotenv already owns.
function Get-EnvValue {
    param([string] $Path, [string] $Key)
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match "^\s*$([regex]::Escape($Key))\s*=\s*(.*)$") {
            $value = $Matches[1].Trim().Trim('"').Trim("'")
            if ($value) { return $value }
        }
    }
    return $null
}

Assert-Admin

$AppRoot = (Resolve-Path -LiteralPath $AppRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'server\index.js'))) {
    throw "server\index.js not found under $AppRoot — is this the app root?"
}
if (-not (Test-Path -LiteralPath (Join-Path $AppRoot 'dist\index.html'))) {
    throw "dist\index.html not found under $AppRoot. Run 'npm ci && npm run build' first — in production Express serves the built SPA from dist\."
}
if (-not (Test-Path -LiteralPath $EnvFile)) {
    throw "Env file not found: $EnvFile. Copy deploy\iis\production.env.example there and fill it in."
}
$EnvFile = (Resolve-Path -LiteralPath $EnvFile).Path

$node = Resolve-Tool -Explicit $NodePath -Command 'node' -Hint 'Install Node 24 LTS from https://nodejs.org/.'
$nssm = Resolve-Tool -Explicit $NssmPath -Command 'nssm' -Hint 'Download NSSM from https://nssm.cc/ and put nssm.exe on PATH (or pass -NssmPath).'

# Enforce package.json's engines range, read from the file rather than
# duplicated here — a hardcoded major silently becomes wrong the next time the
# project moves LTS lines, and this script would then reject a supported Node.
#
# The check is about supported/tested runtimes, not binary compatibility:
# better-sqlite3 13 builds against NAPI_VERSION=10 and ships ABI-independent
# prebuilds, so its binary loads across Node majors without recompiling. That
# is why one `npm ci` can serve both LTS lines, and why no Visual Studio build
# tools are needed on this server.
$engines = (Get-Content -LiteralPath (Join-Path $AppRoot 'package.json') -Raw | ConvertFrom-Json).engines.node
$nodeVersion = (& $node --version).Trim()

# Compare FULL versions, not just the major. The floor is 22.14 precisely
# because better-sqlite3 builds against NAPI_VERSION=10, which does not exist
# in 22.0-22.13 — so a major-only check would register the service on a Node
# that dies loading the native module, after this script reported success.
function ConvertTo-Version {
    param([string] $Text)
    $parts = ($Text -replace '^v', '') -split '\.'
    while ($parts.Count -lt 3) { $parts += '0' }
    [version]::new([int]$parts[0], [int]$parts[1], [int]$parts[2])
}

$nodeSemver = ConvertTo-Version $nodeVersion

foreach ($bound in [regex]::Matches($engines, '(>=|<=|<|>)\s*(\d+(?:\.\d+)*)')) {
    $op = $bound.Groups[1].Value
    $limit = ConvertTo-Version $bound.Groups[2].Value
    $ok = switch ($op) {
        '>=' { $nodeSemver -ge $limit }
        '>'  { $nodeSemver -gt $limit }
        '<'  { $nodeSemver -lt $limit }
        '<=' { $nodeSemver -le $limit }
    }
    if (-not $ok) {
        throw "Node $nodeVersion is outside package.json engines ($engines). Node 24 LTS is the tested target. Point -NodePath at a supported install."
    }
}

if (-not $LogDir) {
    $dataDir = Get-EnvValue -Path $EnvFile -Key 'DATA_DIR'
    $LogDir = if ($dataDir) { Join-Path $dataDir 'logs' } else { Join-Path $AppRoot 'logs' }
}
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# `& nssm set …` does NOT throw on failure, even with $ErrorActionPreference =
# 'Stop' — a native command that exits non-zero writes to stderr and carries on
# (verified on both PowerShell 7 and Windows PowerShell 5.1). Piping to
# Out-Null does not even hide that stderr; it only discards stdout. Without an
# explicit check, a wrong parameter name, an NSSM build that lacks a setting,
# or a service that exists but was not created by NSSM (which `nssm set`
# refuses) all yield a HALF-CONFIGURED service that this script then reports as
# healthy. Every mutation goes through here instead.
function Invoke-Nssm {
    param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $NssmArgs)
    $output = & $nssm @NssmArgs 2>&1
    if ($LASTEXITCODE -ne 0) {
        throw "nssm $($NssmArgs -join ' ') failed (exit $LASTEXITCODE): $output"
    }
}

$exists = $null -ne (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
if ($exists) {
    Write-Host "Service '$ServiceName' already exists — reconfiguring in place."
    # A stop failure is not fatal (it may already be stopped), so this one call
    # deliberately does not go through Invoke-Nssm. `confirm` is the `nssm
    # remove` idiom and is not a control verb — omitted.
    & $nssm stop $ServiceName 2>&1 | Out-Null
    # Wait for Stopped before reconfiguring: `nssm start` on a StopPending
    # service returns non-zero and would abort an otherwise-correct upgrade.
    $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 30 -and $svc -and $svc.Status -ne 'Stopped'; $i++) {
        Start-Sleep -Milliseconds 500
        $svc.Refresh()
    }
    if ($svc -and $svc.Status -ne 'Stopped') {
        throw "Service '$ServiceName' did not reach Stopped (currently $($svc.Status)). Stop it manually and re-run."
    }
} else {
    Write-Host "Creating service '$ServiceName'."
    Invoke-Nssm install $ServiceName $node 'server\index.js'
}

Invoke-Nssm set $ServiceName Application $node
Invoke-Nssm set $ServiceName AppParameters 'server\index.js'
Invoke-Nssm set $ServiceName AppDirectory $AppRoot
Invoke-Nssm set $ServiceName DisplayName 'GitHub Repo Manager'
Invoke-Nssm set $ServiceName Description 'GitHub Repo Manager (Express + SQLite), reverse-proxied by IIS.'
Invoke-Nssm set $ServiceName Start SERVICE_AUTO_START

# NODE_ENV and GRM_ENV_FILE must be real OS env vars: GRM_ENV_FILE is what
# tells dotenv where the file is, so it cannot live inside that file, and
# server/config.js reads NODE_ENV before dotenv has loaded anything.
Invoke-Nssm set $ServiceName AppEnvironmentExtra "NODE_ENV=production" "GRM_ENV_FILE=$EnvFile"

Invoke-Nssm set $ServiceName AppStdout (Join-Path $LogDir 'service-out.log')
Invoke-Nssm set $ServiceName AppStderr (Join-Path $LogDir 'service-err.log')
Invoke-Nssm set $ServiceName AppRotateFiles 1
Invoke-Nssm set $ServiceName AppRotateOnline 1
Invoke-Nssm set $ServiceName AppRotateBytes 10485760

# Restart on unexpected exit, backing off so a crash-loop does not hammer the
# disk. AppExit Default Restart is NSSM's per-exit-code action table.
Invoke-Nssm set $ServiceName AppExit Default Restart
Invoke-Nssm set $ServiceName AppRestartDelay 5000
Invoke-Nssm set $ServiceName AppThrottle 10000

# Graceful shutdown: SQLite needs the process to close its handles cleanly, so
# give Node a real chance to exit before NSSM escalates to TerminateProcess.
Invoke-Nssm set $ServiceName AppStopMethodConsole 15000
Invoke-Nssm set $ServiceName AppStopMethodWindow 5000
Invoke-Nssm set $ServiceName AppStopMethodThreads 5000

if ($ServiceAccount -ne 'LocalSystem') {
    if (-not $ServicePassword) {
        throw "-ServicePassword is required when -ServiceAccount is not LocalSystem."
    }
    $plainPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR(
        [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ServicePassword))
    try {
        Invoke-Nssm set $ServiceName ObjectName $ServiceAccount $plainPassword
    } finally {
        # NSSM takes the password as an argument, so it is briefly visible in
        # the process table — unavoidable with this tool. Clearing the managed
        # copy at least keeps it out of the rest of this session.
        $plainPassword = $null
    }
    Write-Host ""
    Write-Warning "Running as '$ServiceAccount'. That account needs: Read on $EnvFile, Modify on the DATA_DIR tree, and Modify on $LogDir. Grant those before the next start or the service will fail to boot."
}

Write-Host "Starting '$ServiceName'..."
Invoke-Nssm start $ServiceName

# Poll rather than sleep-and-hope: a config error (bad secret, unwritable
# DATA_DIR) makes the process exit within a second or two, and reporting
# "installed successfully" over a dead service is worse than a clear failure.
#
# The check is on the BODY, not the status code. /api/health answers 200 even
# when SQLite is unreachable — it reports that as status:"degraded",
# database:"disconnected" in the payload (server/index.js). Accepting any 200
# would green-light exactly the broken deploy this poll exists to catch.
$port = Get-EnvValue -Path $EnvFile -Key 'PORT'
if (-not $port) { $port = '3001' }
$healthy = $false
$lastBody = ''
foreach ($attempt in 1..15) {
    Start-Sleep -Seconds 2
    try {
        $res = Invoke-WebRequest -Uri "http://127.0.0.1:$port/api/health" -UseBasicParsing -TimeoutSec 5
        $lastBody = $res.Content
        if ($res.StatusCode -eq 200) {
            $health = $res.Content | ConvertFrom-Json
            if ($health.status -eq 'ok' -and $health.database -eq 'connected') { $healthy = $true; break }
            # Answering but degraded: the process is up, so keep polling —
            # the DB may still be running migrations on a first boot.
        }
    } catch {
        $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
        if ($svc -and $svc.Status -ne 'Running') { break }
    }
}

if ($healthy) {
    Write-Host ""
    Write-Host "Service '$ServiceName' is running and healthy on http://127.0.0.1:$port" -ForegroundColor Green
    Write-Host "Next: point the IIS site at it with deploy\iis\web.config."
} else {
    Write-Warning "Service installed, but /api/health never reported status=ok with database=connected on port $port."
    if ($lastBody) { Write-Warning "Last response: $lastBody" }
    Write-Warning "Read $LogDir\service-err.log — a failed production secret check aborts boot with an explicit message."
    exit 1
}
