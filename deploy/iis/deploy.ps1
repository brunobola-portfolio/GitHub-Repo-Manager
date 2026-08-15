<#
.SYNOPSIS
    Deploys a released GitHub Repo Manager package onto a Windows server:
    validates the artifact, backs up what is running, swaps it with the
    service stopped, verifies the result, and rolls back on its own if the
    application does not come back healthy.

.DESCRIPTION
    Compatible with Windows PowerShell 5.1 (what ships with Windows Server)
    and PowerShell 7. Self-contained on purpose: the normal way to use it is
    to copy this one file to the server.

    ONE VERSION = ONE IMMUTABLE ARTIFACT. The package is
    `github-repo-manager-<version>-win-x64.zip`, built by CI and smoke-tested
    there (it boots, the native module loads, /api/health/ready answers). It
    is never rebuilt on the server: a production box has no business running
    `npm ci` against the network, and a build that happens twice can differ
    twice.

    Order of guarantees — no destructive step runs before the previous one is
    confirmed:

      1. Package validated (zip opens; contains server\, dist\ and a
         package.json whose version matches the file name).
      2. Enough free disk for the backup plus the new content.
      3. Backup of the current install, with the item count checked.
      4. Service stopped (releases the file handles, and stops traffic
         reaching a half-swapped tree).
      5. Content swapped, retrying files that are briefly locked.
      6. Service started.
      7. Health verified over HTTP: /api/health reports the version we just
         installed, and /api/health/ready reports every dependency ok.
      8. If verification fails: automatic rollback to the step-3 backup, and
         the service restarted from it.

    WHAT IS NEVER TOUCHED. DATA_DIR lives outside the install tree precisely
    so an upgrade cannot reach it — the database, the .env and the logs are
    not part of the swap and are not in the backup. Migrations run at boot,
    from the application itself.

.PARAMETER ZipPath
    Path to the release zip on disk. Required unless -FromRelease, -Rollback
    or -ListBackups is used.

.PARAMETER FromRelease
    Fetch the zip from a GitHub Release instead of reading it from disk:
    'latest', or a tag such as 'v4.18.1'.

.PARAMETER AppRoot
    The install directory the service runs from (e.g. C:\apps\GitHubRepoManager).

.PARAMETER ServiceName
    NSSM service name. Defaults to GitHubRepoManager.

.PARAMETER HealthUrl
    Where to verify. Defaults to http://127.0.0.1:3001/api/health — the local
    origin, not the public host: this checks the process, not the proxy.

.PARAMETER Rollback
    Restore the most recent backup (or -BackupName) and restart. Runs the same
    verification afterwards.

.PARAMETER ListBackups
    Print the available backups and exit.

.PARAMETER KeepBackups
    How many backups to retain after a successful deploy. Default 3.

.PARAMETER DryRun
    Validate the package and report the plan; change nothing.

.EXAMPLE
    .\deploy.ps1 -FromRelease latest -AppRoot C:\apps\GitHubRepoManager

.EXAMPLE
    .\deploy.ps1 -ZipPath C:\tmp\github-repo-manager-4.18.1-win-x64.zip `
                 -AppRoot C:\apps\GitHubRepoManager

.EXAMPLE
    .\deploy.ps1 -AppRoot C:\apps\GitHubRepoManager -Rollback
#>
[CmdletBinding(SupportsShouldProcess = $false)]
param(
    [string] $ZipPath,

    [string] $FromRelease,

    [Parameter(Mandatory = $true)]
    [string] $AppRoot,

    [string] $ServiceName = 'GitHubRepoManager',

    [string] $HealthUrl = 'http://127.0.0.1:3001/api/health',

    [switch] $Rollback,

    [string] $BackupName,

    [switch] $ListBackups,

    [int] $KeepBackups = 3,

    [int] $HealthTimeoutSeconds = 120,

    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Repo = 'brunobola-portfolio/GitHub-Repo-Manager'

# ---------------------------------------------------------------- output ----

function Write-Section { param([string] $Title)
    Write-Host ''
    Write-Host "== $Title" -ForegroundColor Cyan
}
function Write-Ok     { param([string] $M, [string] $D) Write-Host "   [ok]   $M" -ForegroundColor Green; if ($D) { Write-Host "          $D" -ForegroundColor DarkGray } }
function Write-Step   { param([string] $M) Write-Host "   ...    $M" -ForegroundColor Gray }
function Write-WarnLn { param([string] $M) Write-Host "   [warn] $M" -ForegroundColor Yellow }
function Write-Fail   { param([string] $M) Write-Host "   [FAIL] $M" -ForegroundColor Red }

function Assert-Admin {
    $identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run this from an elevated PowerShell — stopping a service and writing to Program Files both need it.'
    }
}

# ------------------------------------------------------------- discovery ----

function Get-BackupRoot {
    param([string] $Root)
    $parent = Split-Path -Parent $Root
    $leaf   = Split-Path -Leaf   $Root
    return @{ Parent = $parent; Pattern = "$leaf.backup-*" }
}

function Get-Backups {
    param([string] $Root)
    $b = Get-BackupRoot -Root $Root
    if (-not (Test-Path $b.Parent)) { return @() }
    Get-ChildItem -Path $b.Parent -Directory -Filter $b.Pattern -ErrorAction SilentlyContinue |
        Sort-Object CreationTime -Descending
}

# ------------------------------------------------------------ validation ----

function Get-ZipEntries {
    param([string] $Path)
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try { return @($zip.Entries | ForEach-Object { $_.FullName }) }
    finally { $zip.Dispose() }
}

function Read-ZipText {
    param([string] $Path, [string] $Entry)
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    $zip = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $e = $zip.Entries | Where-Object { $_.FullName -eq $Entry } | Select-Object -First 1
        if (-not $e) { return $null }
        $reader = New-Object System.IO.StreamReader($e.Open())
        try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
    } finally { $zip.Dispose() }
}

function Test-Package {
    param([string] $Path)

    if (-not (Test-Path $Path)) { throw "Package not found: $Path" }
    $size = (Get-Item $Path).Length
    if ($size -lt 1MB) { throw "Package is only $([math]::Round($size/1KB)) KB — that is not a build." }

    $entries = Get-ZipEntries -Path $Path

    # The zip may or may not be wrapped in a single top-level folder; find the
    # prefix that holds package.json so both shapes work.
    $manifest = $entries | Where-Object { $_ -match '(^|/)package\.json$' } |
                Sort-Object { ($_ -split '/').Count } | Select-Object -First 1
    if (-not $manifest) { throw 'Package has no package.json — wrong archive.' }
    $prefix = if ($manifest -match '/') { $manifest -replace 'package\.json$', '' } else { '' }

    foreach ($required in @('server/', 'dist/')) {
        if (-not ($entries | Where-Object { $_ -like "$prefix$required*" })) {
            throw "Package is missing $required — this is not a server build."
        }
    }

    $pkgJson = Read-ZipText -Path $Path -Entry $manifest
    $version = ($pkgJson | ConvertFrom-Json).version
    if (-not $version) { throw 'Package.json inside the zip has no version.' }

    # The file name carries the version; if the two disagree, somebody renamed
    # a build, and every later "which version is live" answer becomes a guess.
    $named = [regex]::Match((Split-Path -Leaf $Path), '(\d+\.\d+\.\d+)')
    if ($named.Success -and $named.Groups[1].Value -ne $version) {
        throw "File name says $($named.Groups[1].Value) but package.json says $version — refusing a mislabelled artifact."
    }

    return @{ Version = $version; Prefix = $prefix; Entries = $entries.Count; SizeMb = [math]::Round($size/1MB, 1) }
}

function Get-ReleaseAsset {
    param([string] $Tag)

    $api = if ($Tag -eq 'latest') { "https://api.github.com/repos/$Repo/releases/latest" }
           else { "https://api.github.com/repos/$Repo/releases/tags/$Tag" }

    Write-Step "Querying $api"
    $headers = @{ 'User-Agent' = 'grm-deploy'; 'Accept' = 'application/vnd.github+json' }
    if ($env:GITHUB_TOKEN) { $headers['Authorization'] = "Bearer $env:GITHUB_TOKEN" }
    $release = Invoke-RestMethod -Uri $api -Headers $headers -TimeoutSec 60

    $asset = $release.assets | Where-Object { $_.name -like '*-win-x64.zip' } | Select-Object -First 1
    if (-not $asset) { throw "Release $($release.tag_name) has no *-win-x64.zip asset." }

    $dest = Join-Path ([System.IO.Path]::GetTempPath()) $asset.name
    Write-Step "Downloading $($asset.name) ($([math]::Round($asset.size/1MB,1)) MB)"
    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dest -Headers $headers -TimeoutSec 900

    # Verify against the published checksum when the release carries one.
    $sha = $release.assets | Where-Object { $_.name -eq "$($asset.name).sha256" } | Select-Object -First 1
    if ($sha) {
        $expected = (Invoke-WebRequest -Uri $sha.browser_download_url -Headers $headers -TimeoutSec 120).Content
        $expected = ([regex]::Match($expected, '[A-Fa-f0-9]{64}')).Value
        $actual   = (Get-FileHash -Path $dest -Algorithm SHA256).Hash
        if ($expected -and $actual -ne $expected) {
            Remove-Item $dest -Force -ErrorAction SilentlyContinue
            throw "Checksum mismatch on $($asset.name). Downloaded file discarded."
        }
        Write-Ok 'Checksum verified' $actual.Substring(0, 16)
    } else {
        Write-WarnLn 'Release has no .sha256 sidecar — integrity not verified.'
    }

    return $dest
}

# ------------------------------------------------------------- mechanics ----

function Get-ServiceSafe {
    param([string] $Name)
    Get-Service -Name $Name -ErrorAction SilentlyContinue
}

function Stop-App {
    param([string] $Name)
    $svc = Get-ServiceSafe -Name $Name
    if (-not $svc) { Write-WarnLn "Service '$Name' not installed — nothing to stop."; return $false }
    if ($svc.Status -eq 'Stopped') { Write-Ok "Service '$Name' already stopped"; return $true }
    Write-Step "Stopping $Name"
    Stop-Service -Name $Name -Force
    (Get-ServiceSafe -Name $Name).WaitForStatus('Stopped', '00:01:00')
    Write-Ok "Service stopped"
    return $true
}

function Start-App {
    param([string] $Name)
    $svc = Get-ServiceSafe -Name $Name
    if (-not $svc) { Write-WarnLn "Service '$Name' not installed — start it yourself."; return }
    Write-Step "Starting $Name"
    Start-Service -Name $Name
    (Get-ServiceSafe -Name $Name).WaitForStatus('Running', '00:01:00')
    Write-Ok 'Service running'
}

function Copy-TreeWithRetry {
    param([string] $From, [string] $To, [int] $Retries = 5)
    for ($i = 1; $i -le $Retries; $i++) {
        try {
            Copy-Item -Path (Join-Path $From '*') -Destination $To -Recurse -Force -ErrorAction Stop
            return
        } catch {
            if ($i -eq $Retries) { throw }
            # A stopped service can still be releasing handles; antivirus and
            # the indexer hold files briefly too. Back off rather than fail.
            Write-WarnLn "Copy attempt $i failed ($($_.Exception.Message.Split([char]10)[0])) — retrying"
            Start-Sleep -Seconds ($i * 2)
        }
    }
}

function Test-Health {
    param([string] $Url, [string] $ExpectVersion, [int] $TimeoutSeconds)

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastError = 'never answered'
    while ((Get-Date) -lt $deadline) {
        try {
            $health = Invoke-RestMethod -Uri $Url -TimeoutSec 10
            if ($health.status -ne 'ok') { $lastError = "status=$($health.status)"; Start-Sleep -Seconds 3; continue }
            if ($ExpectVersion -and $health.version -ne $ExpectVersion) {
                # The old build answering is the most dangerous "success" there
                # is: healthy, and not what you deployed.
                $lastError = "version=$($health.version), expected $ExpectVersion"
                Start-Sleep -Seconds 3; continue
            }
            $readyUrl = ($Url -replace '/api/health$', '/api/health/ready')
            $ready = Invoke-RestMethod -Uri $readyUrl -TimeoutSec 10
            if ($ready.status -ne 'ready') { $lastError = "ready=$($ready.status) $($ready.checks | ConvertTo-Json -Compress)"; Start-Sleep -Seconds 3; continue }
            return @{ Ok = $true; Version = $health.version; Checks = $ready.checks }
        } catch {
            $lastError = $_.Exception.Message.Split([char]10)[0]
            Start-Sleep -Seconds 3
        }
    }
    return @{ Ok = $false; Error = $lastError }
}

# ------------------------------------------------------------------ main ----

Write-Host ''
Write-Host 'GitHub Repo Manager — deploy' -ForegroundColor White

if ($ListBackups) {
    Write-Section 'Backups'
    $backups = Get-Backups -Root $AppRoot
    if (-not $backups) { Write-WarnLn 'None.'; exit 0 }
    $backups | ForEach-Object {
        $count = (Get-ChildItem $_.FullName -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
        Write-Host ("   {0,-46} {1}  {2} files" -f $_.Name, $_.CreationTime.ToString('yyyy-MM-dd HH:mm'), $count)
    }
    exit 0
}

if (-not (Test-Path $AppRoot)) { throw "AppRoot does not exist: $AppRoot" }

# ---- Rollback path -----------------------------------------------------
if ($Rollback) {
    Write-Section '1. Selecting backup'
    $backups = Get-Backups -Root $AppRoot
    if (-not $backups) { throw 'No backups to roll back to.' }
    $chosen = if ($BackupName) { $backups | Where-Object { $_.Name -eq $BackupName } | Select-Object -First 1 }
              else { $backups | Select-Object -First 1 }
    if (-not $chosen) { throw "Backup not found: $BackupName" }
    Write-Ok "Restoring $($chosen.Name)" $chosen.CreationTime.ToString('yyyy-MM-dd HH:mm:ss')

    if ($DryRun) { Write-WarnLn 'DryRun — stopping here.'; exit 0 }

    Assert-Admin

    Write-Section '2. Restoring'
    [void](Stop-App -Name $ServiceName)
    Get-ChildItem -Path $AppRoot -Force | Remove-Item -Recurse -Force
    Copy-TreeWithRetry -From $chosen.FullName -To $AppRoot
    Write-Ok 'Content restored'
    Start-App -Name $ServiceName

    Write-Section '3. Verifying'
    $verdict = Test-Health -Url $HealthUrl -ExpectVersion $null -TimeoutSeconds $HealthTimeoutSeconds
    if (-not $verdict.Ok) { Write-Fail "Rollback restored but the app is not healthy: $($verdict.Error)"; exit 1 }
    Write-Ok "Healthy on version $($verdict.Version)"
    Write-Host ''
    Write-Host 'Rolled back.' -ForegroundColor Green
    exit 0
}

# ---- Deploy path -------------------------------------------------------
Write-Section '1. Package'

if ($FromRelease) {
    if ($ZipPath) { throw 'Pass either -ZipPath or -FromRelease, not both.' }
    $ZipPath = Get-ReleaseAsset -Tag $FromRelease
}
if (-not $ZipPath) { throw 'Pass -ZipPath or -FromRelease.' }

$pkg = Test-Package -Path $ZipPath
Write-Ok "Valid package: v$($pkg.Version)" "$($pkg.Entries) entries, $($pkg.SizeMb) MB"

$current = $null
$currentManifest = Join-Path $AppRoot 'package.json'
if (Test-Path $currentManifest) {
    $current = (Get-Content $currentManifest -Raw | ConvertFrom-Json).version
    Write-Ok "Currently installed: v$current"
    if ($current -eq $pkg.Version) {
        Write-WarnLn "Same version already installed. Continuing — a redeploy of the same version is a valid repair."
    }
}

Write-Section '2. Disk'
$drive = (Get-Item $AppRoot).PSDrive
$needed = ((Get-ChildItem $AppRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum) + ($pkg.SizeMb * 3MB)
if ($drive.Free -lt $needed) {
    throw "Not enough free space on $($drive.Name): need ~$([math]::Round($needed/1GB,2)) GB, have $([math]::Round($drive.Free/1GB,2)) GB."
}
Write-Ok "Free space sufficient" "$([math]::Round($drive.Free/1GB,1)) GB available"

if ($DryRun) {
    Write-Section 'DryRun'
    Write-Ok "Would deploy v$($pkg.Version) into $AppRoot and verify at $HealthUrl"
    Write-Step 'Nothing was changed. Elevation is only required from step 3 onwards.'
    exit 0
}

# Everything above this line only reads. Everything below moves files and
# stops a service, so the elevation check belongs exactly here.
Assert-Admin

Write-Section '3. Backup'
$stamp      = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = "$AppRoot.backup-$stamp"
$sourceCount = (Get-ChildItem $AppRoot -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
Copy-TreeWithRetry -From $AppRoot -To $backupPath
$backupCount = (Get-ChildItem $backupPath -Recurse -File -ErrorAction SilentlyContinue | Measure-Object).Count
if ($backupCount -lt $sourceCount) {
    Remove-Item $backupPath -Recurse -Force -ErrorAction SilentlyContinue
    throw "Backup incomplete ($backupCount of $sourceCount files) — refusing to continue without a way back."
}
Write-Ok "Backed up $backupCount files" $backupPath

Write-Section '4. Stopping the service'
[void](Stop-App -Name $ServiceName)

Write-Section '5. Swapping content'
$staging = Join-Path ([System.IO.Path]::GetTempPath()) "grm-deploy-$stamp"
New-Item -ItemType Directory -Path $staging -Force | Out-Null
try {
    Expand-Archive -Path $ZipPath -DestinationPath $staging -Force
    $newRoot = if ($pkg.Prefix) { Join-Path $staging ($pkg.Prefix.TrimEnd('/')) } else { $staging }

    Get-ChildItem -Path $AppRoot -Force | Remove-Item -Recurse -Force
    Copy-TreeWithRetry -From $newRoot -To $AppRoot
    Write-Ok "v$($pkg.Version) in place"
} finally {
    Remove-Item $staging -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Section '6. Starting the service'
Start-App -Name $ServiceName

Write-Section '7. Verifying'
$verdict = Test-Health -Url $HealthUrl -ExpectVersion $pkg.Version -TimeoutSeconds $HealthTimeoutSeconds

if ($verdict.Ok) {
    Write-Ok "Healthy on v$($verdict.Version)" ($verdict.Checks | ConvertTo-Json -Compress)

    Write-Section '8. Pruning old backups'
    $stale = Get-Backups -Root $AppRoot | Select-Object -Skip $KeepBackups
    foreach ($old in $stale) {
        Remove-Item $old.FullName -Recurse -Force -ErrorAction SilentlyContinue
        Write-Step "Removed $($old.Name)"
    }
    Write-Ok "Keeping the $KeepBackups most recent"

    Write-Host ''
    Write-Host "Deployed v$($pkg.Version)." -ForegroundColor Green
    Write-Host "Roll back with: .\deploy.ps1 -AppRoot '$AppRoot' -Rollback" -ForegroundColor DarkGray
    exit 0
}

# ---- Automatic rollback ------------------------------------------------
Write-Fail "Verification failed: $($verdict.Error)"
Write-Section '8. Rolling back'
[void](Stop-App -Name $ServiceName)
Get-ChildItem -Path $AppRoot -Force | Remove-Item -Recurse -Force
Copy-TreeWithRetry -From $backupPath -To $AppRoot
Start-App -Name $ServiceName

$after = Test-Health -Url $HealthUrl -ExpectVersion $null -TimeoutSeconds $HealthTimeoutSeconds
if ($after.Ok) {
    Write-Ok "Rolled back to v$($after.Version) — the site is up on the previous build"
    Write-Host ''
    Write-Host "Deploy of v$($pkg.Version) failed and was reverted." -ForegroundColor Yellow
    Write-Host "Logs: check <DATA_DIR>\logs\service-err.log" -ForegroundColor DarkGray
    exit 1
}

Write-Fail 'Rollback restored the files but the app is still not healthy.'
Write-Host "Backup kept at: $backupPath" -ForegroundColor Yellow
Write-Host 'This is a .env / database / port problem, not a package problem — service-err.log will say which.' -ForegroundColor Yellow
exit 2
