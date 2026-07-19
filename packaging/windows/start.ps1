# SPDX-License-Identifier: AGPL-3.0-only
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
# -NoBrowser is the CI/automation switch: skip opening a browser, skip the
# window-title dance (no visible window is wanted), and return as soon as the
# server process has been spawned so the caller (a CI workflow) can poll
# /api/health/live itself on its own schedule.
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

$Root = $PSScriptRoot
$AppDir = Join-Path $Root 'app'
$NodeExe = Join-Path $Root 'runtime\node.exe'
$ServerEntry = Join-Path $AppDir 'server\index.js'
$FirstRun = Join-Path $AppDir 'scripts\first-run.mjs'
$EnvFile = Join-Path $AppDir '.env'
$PidFile = Join-Path $AppDir '.grm.pid'
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
                return $Matches[1]
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

if (-not (Test-Path -LiteralPath $NodeExe)) {
    Write-Error "Bundled Node runtime not found at: $NodeExe`nThis package looks corrupt or incomplete -re-download it."
    exit 1
}
if (-not (Test-Path -LiteralPath $ServerEntry)) {
    Write-Error "Server entry point not found at: $ServerEntry`nThis package looks corrupt or incomplete -re-download it."
    exit 1
}

# Idempotent: only writes app\.env (with fresh random secrets) if it does not
# already exist. An existing .env is never touched, so a user's own edits
# (e.g. a custom PORT) survive every subsequent launch.
& $NodeExe $FirstRun '--data-dir' $DataDir
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
    Write-Host "Using port $actualPort for this run (configured port stays $configuredPort in app\.env)."
}

$env:PORT = "$actualPort"
$env:DATA_DIR = $DataDir
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

# Spawn via raw ProcessStartInfo/Process.Start() rather than the Start-Process
# cmdlet's -ArgumentList parameter. Verified empirically on this machine
# (both pwsh and Windows PowerShell 5.1): Start-Process -ArgumentList mangles
# a non-ASCII path in the argument array (the process launches with a
# corrupted path and exits immediately, silently, under -WindowStyle Hidden)
# - a known Start-Process quirk. A single manually-quoted Arguments string
# via ProcessStartInfo does not have this problem. UseShellExecute differs
# per branch: ShellExecuteEx (=true) is what gives a console app its own new
# window for WindowStyle to apply to; CreateNoWindow (=false path) is the
# correct way to fully suppress a window when none is wanted. Either way the
# child inherits this process's environment block (PORT/DATA_DIR/NODE_ENV
# above), since EnvironmentVariables is never touched here.
$psi = [System.Diagnostics.ProcessStartInfo]::new()
$psi.FileName = $NodeExe
$psi.Arguments = '"' + $ServerEntry + '"'
$psi.WorkingDirectory = $AppDir
if ($NoBrowser) {
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true
} else {
    $psi.UseShellExecute = $true
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Normal
}
$proc = [System.Diagnostics.Process]::Start($psi)
Set-Content -LiteralPath $PidFile -Value "$($proc.Id)" -Encoding ascii

Write-Host "GitHub Repo Manager starting (PID $($proc.Id), port $actualPort)..."

if (-not $NoBrowser) {
    # Best-effort console window title -cosmetic only, never fatal. Polls
    # briefly because the child process needs a moment to allocate its
    # console window before MainWindowHandle is populated.
    try {
        Add-Type -Name Win32Title -Namespace GRM -MemberDefinition @'
[DllImport("user32.dll", CharSet = CharSet.Auto)]
public static extern bool SetWindowText(IntPtr hWnd, string lpString);
'@ -ErrorAction SilentlyContinue
        for ($i = 0; $i -lt 20; $i++) {
            Start-Sleep -Milliseconds 150
            $proc.Refresh()
            if ($proc.MainWindowHandle -ne [IntPtr]::Zero) {
                [GRM.Win32Title]::SetWindowText($proc.MainWindowHandle, 'GitHub Repo Manager Server') | Out-Null
                break
            }
        }
    } catch {
        # Cosmetic only -a failure here must never stop the server launch.
    }

    # Bounded readiness wait so the browser doesn't open to a connection
    # error; the workflow-driven CI path (-NoBrowser) does its own longer,
    # independent poll and never reaches this branch.
    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        if (Test-HealthLive $actualPort) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 500
    }
    if (-not $ready) {
        Write-Host "Server is taking longer than usual to start -opening the browser anyway; refresh if it errors."
    }
    Start-Process "http://127.0.0.1:$actualPort"
}
