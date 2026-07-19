; SPDX-License-Identifier: AGPL-3.0-only
;
; Inno Setup script for the GitHub Repo Manager Windows installer. Builds
; from the SAME staged tree as the portable ZIP (scripts/package-windows.mjs)
; -StagingRoot below defaults to that script's own default staging
; location so a local `iscc installer.iss` "just works" after running
; `node scripts/package-windows.mjs`; CI overrides it explicitly via /D.
;
; MyAppVersion is the one thing that must change every release, so it is
; passed in from CI (/DMyAppVersion=x.y.z, read from package.json -single
; source of truth) rather than hardcoded; the #ifndef fallback below keeps a
; bare `iscc installer.iss` invocation working for local experimentation.
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0-dev"
#endif
#ifndef StagingRoot
  #define StagingRoot "..\..\.dev\package-windows\staging"
#endif
#ifndef OutputDir
  #define OutputDir "..\..\.dev\package-windows\out"
#endif

; MyAppPublisher: single source of truth is scripts/package-windows.mjs's
; getPublisher() (derives it from package.json's "author" field) - CI passes
; it in via /DMyAppPublisher, same mechanism as MyAppVersion. The fallback
; here exists only so a bare local `iscc installer.iss` still works.
#ifndef MyAppPublisher
  #define MyAppPublisher "Bola Labs, Inc."
#endif

#define MyAppName "GitHub Repo Manager"
#define MyAppURL "https://github.com/brunobola-portfolio/GitHub-Repo-Manager"
#define MyAppExeName "Start GitHub Repo Manager.cmd"
#define MyDataDir "{localappdata}\GitHubRepoManager\data"

[Setup]
; Fixed forever once published -this is the winget / Add-or-Remove-Programs
; identity. Generated once; must NEVER change across versions (unlike
; MyAppVersion, which changes every release).
AppId={{A6F13D8E-2B4C-4A9F-8E3D-7C5B9A1F0D26}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
; No admin prompt, no UAC -installs per-user under LocalAppData, exactly
; what winget expects for a "user" scope installer.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=commandline
DefaultDirName={localappdata}\Programs\GitHubRepoManager
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
OutputDir={#OutputDir}
OutputBaseFilename=github-repo-manager-{#MyAppVersion}-setup
; better-sqlite3's .node binary and node.exe itself are already-compressed/
; signed-ish binaries; nothing here needs special uncompressed handling.
UninstallDisplayName={#MyAppName}
; ChangesEnvironment not needed -the app binds to loopback only and never
; touches PATH/registry beyond its own uninstall key.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Dirs]
; uninsneveruninstall: the data dir must survive uninstall unconditionally
; (brief requirement), not merely "survives because it happened to be
; non-empty" -pre-created here so the "Open data folder" shortcut works
; immediately after install, before the app has ever been launched.
Name: "{#MyDataDir}"; Flags: uninsneveruninstall

[UninstallDelete]
; The running app writes files under {app}\app that were never part of the
; [Files] manifest (app\.env, app\.grm.pid) -Inno's uninstaller only removes
; files/dirs it tracked from [Files], so without this, those orphans would
; block {app} from being removed cleanly. {#MyDataDir} lives outside {app}
; entirely (LocalAppData\GitHubRepoManager\data, not LocalAppData\Programs\
; GitHubRepoManager\...), so this blanket removal can never touch user data.
Type: filesandordirs; Name: "{app}"

[Files]
Source: "{#StagingRoot}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StagingRoot}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StagingRoot}\start.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingRoot}\stop.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingRoot}\Start GitHub Repo Manager.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingRoot}\Stop GitHub Repo Manager.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingRoot}\README-WINDOWS.txt"; DestDir: "{app}"; Flags: ignoreversion isreadme

[Icons]
; No --data-dir Parameters here (deliberately, as of the marker-file fix
; below): a user launching {app}\Start GitHub Repo Manager.cmd DIRECTLY
; (README-WINDOWS.txt tells them this works) never goes through these
; shortcuts at all, so a Parameters-only fix would leave that path
; defaulting to the portable ".\data" layout under {app} - wrong for an
; installed copy, and exactly what [UninstallDelete]'s "Type: filesandordirs;
; Name: {app}" would then delete on uninstall. install-config.txt (written
; in [Code] below, read by start.ps1) makes EVERY launch path - shortcut or
; raw .cmd - resolve to the same LocalAppData data dir, so there is only one
; mechanism to keep correct instead of two that can disagree.
Name: "{group}\Start GitHub Repo Manager"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Stop GitHub Repo Manager"; Filename: "{app}\Stop GitHub Repo Manager.cmd"; WorkingDir: "{app}"
Name: "{group}\Open data folder"; Filename: "{win}\explorer.exe"; Parameters: """{#MyDataDir}"""
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Code]
// Detects a currently-running instance via the pidfile Start writes next to
// app\.env (packaging/windows/start.ps1), and - since this repo's Node
// server has no OS-level named mutex to hook AppMutex into - confirms via
// `tasklist` that the PID is actually our bundled node.exe before treating
// it as "running". Blocks the install/upgrade rather than silently
// proceeding over a live process, which could corrupt the SQLite DB
// mid-write. This intentionally blocks even under /SUPPRESSMSGBOXES: the
// safest default for an unattended upgrade over a live instance is to abort,
// not to guess. CI/local smoke tests never hit this path (always a fresh
// install with nothing running yet). Only ever called from
// PrepareToInstall (below) - {app} must already be resolved to the user's
// actual chosen directory (default or a custom /DIR=), which is NOT true
// yet at InitializeSetup time, before the directory-selection page/switch
// has been processed.
function IsAppRunning(): Boolean;
var
  PidFile, TasklistOut, PidStr: string;
  Lines: TArrayOfString;
  ResultCode, I: Integer;
begin
  Result := False;
  PidFile := ExpandConstant('{app}\app\.grm.pid');
  if not FileExists(PidFile) then
    exit;
  if not LoadStringsFromFile(PidFile, Lines) or (GetArrayLength(Lines) = 0) then
    exit;
  PidStr := Trim(Lines[0]);
  if (PidStr = '') then
    exit;

  TasklistOut := ExpandConstant('{tmp}\grm-tasklist.txt');
  if not Exec(ExpandConstant('{cmd}'),
      '/C tasklist /FI "PID eq ' + PidStr + '" /FI "IMAGENAME eq node.exe" /NH > "' + TasklistOut + '" 2>&1',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    exit;
  if not LoadStringsFromFile(TasklistOut, Lines) then
    exit;
  for I := 0 to GetArrayLength(Lines) - 1 do
    if Pos('node.exe', Lowercase(Lines[I])) > 0 then
      Result := True;
end;

// PrepareToInstall runs after the destination directory is fully resolved
// (the wizard page or a silent /DIR= switch has already been applied), so
// ExpandConstant('{app}') above is trustworthy here - unlike in
// InitializeSetup, which fires before that. Returning a non-empty string
// makes Setup stop at the "Preparing to Install" page with that message and
// exit with Inno's dedicated PrepareToInstall-failure exit code; per Inno's
// own docs this does not require an interactive dialog to be shown to
// terminate, so a /VERYSILENT /SUPPRESSMSGBOXES run still fails closed
// (aborts, non-zero exit) instead of hanging or installing over a live
// process.
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if IsAppRunning() then
    Result := 'GitHub Repo Manager appears to be running. Please close it first ' +
      '(Start Menu -> Stop GitHub Repo Manager), then run Setup again.';
end;

// Writes {app}\install-config.txt after files are copied (ssPostInstall),
// recording the resolved data dir so start.ps1 can find it regardless of
// how the app is launched (Start Menu shortcut, desktop shortcut, or the
// raw .cmd README-WINDOWS.txt tells users they can double-click directly).
// The value itself ({#MyDataDir}, under LocalAppData) does not depend on
// {app}, but WHERE this marker lives does - so a custom /DIR= install still
// gets a correct, self-describing copy of the app that finds its own data
// dir without needing the installer to also update a Start Menu shortcut's
// Parameters (removed above) that a raw .cmd launch would never see anyway.
procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    SaveStringToFile(ExpandConstant('{app}\install-config.txt'),
      'DATA_DIR=' + ExpandConstant('{#MyDataDir}') + #13#10,
      False);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    SuppressibleMsgBox(
      'GitHub Repo Manager has been removed. Your data was left untouched at:' + #13#10 +
      ExpandConstant('{#MyDataDir}') + #13#10 +
      'Delete that folder yourself if you no longer need it.',
      mbInformation, MB_OK, IDOK);
  end;
end;
