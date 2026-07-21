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
#define MyAppExeName "GitHub Repo Manager.exe"
#define MyStartupShortcut "{userstartup}\GitHub Repo Manager.lnk"
#define MyDataDir "{localappdata}\GitHubRepoManager\data"
; The UNEXPANDED form written into install-config.txt (see CurStepChanged):
; the launchers expand it at run time, so an install performed by one user
; (an admin pushing a scripted rollout, or a custom /ALLUSERS-style setup)
; still resolves to EACH user's own LocalAppData instead of pinning every
; user to the installing account's data directory.
#define MyDataDirMarker "%LOCALAPPDATA%\GitHubRepoManager\data"

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
; BolaLabs brand assets (packaging/windows/assets, generated from the master
; art at 2x so Inno's DPI scaling only ever scales DOWN). BMP is required by
; Inno for wizard images; the .ico carries PNG-compressed 16..256 entries.
SetupIconFile=assets\bolalabs.ico
WizardImageFile=assets\wizard-banner.bmp
WizardSmallImageFile=assets\wizard-small.bmp
OutputDir={#OutputDir}
OutputBaseFilename=github-repo-manager-{#MyAppVersion}-setup
; better-sqlite3's .node binary and node.exe itself are already-compressed/
; signed-ish binaries; nothing here needs special uncompressed handling.
UninstallDisplayName={#MyAppName}
; Branded icon in Add/Remove Programs (the file is installed by [Files] below).
UninstallDisplayIcon={app}\bolalabs.ico
; ChangesEnvironment not needed -the app binds to loopback only and never
; touches PATH/registry beyond its own uninstall key.

; Dormant code-signing hook: CI defines SIGN only when signing secrets exist
; (release.yml). With SignTool= set, Inno signs Setup.exe AND the embedded
; uninstaller — signing only the final artifact post-build would leave
; unins000.exe unsigned on user machines.
#ifdef SIGN
SignTool=ts
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "autostart"; Description: "Start GitHub Repo Manager when Windows starts (background, no browser window)"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Dirs]
; uninsneveruninstall: keeps Inno's own uninstall-log-driven removal from
; ever touching this dir, not merely "survives because it happened to be
; non-empty" -pre-created here so the "Open data folder" shortcut works
; immediately after install, before the app has ever been launched. Deletion
; is still possible, but only as the explicit, user-chosen DelTree in
; CurUninstallStepChanged below (the "Also delete your local data?" prompt /
; /PURGEDATA) -never as a side effect of the standard file-removal pass.
Name: "{#MyDataDir}"; Flags: uninsneveruninstall

[UninstallDelete]
; Since v4.8.0 the launcher keeps ALL writable state (.env, .grm.pid, DB) in
; {#MyDataDir}, so {app} normally holds only [Files]-tracked content — but a
; pre-4.8.0 install being uninstalled may still have legacy app\.env /
; app\.grm.pid orphans that would block {app} removal (Inno only removes
; files it tracked). {#MyDataDir} lives outside {app} entirely
; (LocalAppData\GitHubRepoManager\data, not LocalAppData\Programs\
; GitHubRepoManager\...), so this blanket removal can never touch user data —
; including the .env that now lives there and must survive reinstall (it
; holds the credential-vault encryption key).
Type: filesandordirs; Name: "{app}"

[Files]
Source: "{#StagingRoot}\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StagingRoot}\runtime\*"; DestDir: "{app}\runtime"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#StagingRoot}\start.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingRoot}\stop.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingRoot}\Start GitHub Repo Manager.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingRoot}\Stop GitHub Repo Manager.cmd"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingRoot}\GitHub Repo Manager.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#StagingRoot}\README-WINDOWS.txt"; DestDir: "{app}"; Flags: ignoreversion isreadme
; Brand icon for shortcuts + Add/Remove Programs. Sourced from the repo (next
; to this script), not the staging tree — it's installer-only branding.
Source: "assets\bolalabs.ico"; DestDir: "{app}"; Flags: ignoreversion

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
; No IconFilename on the exe-based entries below: the flashless launcher exe
; carries the brand icon in its own resources, unlike the old .cmd launchers
; which needed an explicit IconFilename to avoid the generic console icon.
Name: "{group}\GitHub Repo Manager"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\Stop GitHub Repo Manager"; Filename: "{app}\{#MyAppExeName}"; Parameters: "stop"; WorkingDir: "{app}"
Name: "{group}\View server logs"; Filename: "{win}\explorer.exe"; Parameters: """{#MyDataDir}\logs"""
Name: "{group}\Open data folder"; Filename: "{win}\explorer.exe"; Parameters: """{#MyDataDir}"""
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{commondesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon
Name: "{userstartup}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--no-browser"; WorkingDir: "{app}"; Tasks: autostart

[Run]
; Finish-page "launch now" checkbox (checked by default, like every polished
; installer). nowait: the launcher opens the server console + browser on its
; own; Setup must not sit blocked behind it. skipifsilent: unattended
; installs decide themselves when to first start the app.
Filename: "{app}\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; WorkingDir: "{app}"; Flags: postinstall nowait skipifsilent

[Code]
// Detects a currently-running instance via the pidfile Start writes into the
// data dir (packaging/windows/start.ps1; pre-4.8.0 launchers wrote it to
// {app}\app\.grm.pid instead, so that legacy location is checked too), and -
// since this repo's Node server has no OS-level named mutex to hook AppMutex
// into - confirms via `tasklist` that the PID is actually our bundled
// node.exe before treating it as "running". Blocks the install/upgrade
// rather than silently proceeding over a live process, which could corrupt
// the SQLite DB mid-write. This intentionally blocks even under
// /SUPPRESSMSGBOXES: the safest default for an unattended upgrade over a
// live instance is to abort, not to guess. CI/local smoke tests never hit
// this path (always a fresh install with nothing running yet). Only ever
// called from PrepareToInstall (below) - {app} must already be resolved to
// the user's actual chosen directory (default or a custom /DIR=), which is
// NOT true yet at InitializeSetup time, before the directory-selection
// page/switch has been processed.
function IsAppRunning(): Boolean;
var
  PidFile, TasklistOut, PidStr: string;
  Lines: TArrayOfString;
  ResultCode, I: Integer;
begin
  Result := False;
  PidFile := ExpandConstant('{#MyDataDir}\.grm.pid');
  if not FileExists(PidFile) then
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

function CmdLineParamExists(const Value: string): Boolean;
var
  I: Integer;
begin
  Result := False;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), Value) = 0 then
    begin
      Result := True;
      exit;
    end;
end;

function GetUninstallString(): string;
begin
  Result := '';
  // PrivilegesRequired=lowest => per-user key in HKCU. The _is1 suffix and
  // the retained brace prefix are Inno's registered-key format quirks.
  if not RegQueryStringValue(HKCU,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1',
      'UninstallString', Result) then
    RegQueryStringValue(HKLM,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1',
      'UninstallString', Result);
end;

function GetInstalledVersion(): string;
begin
  Result := '';
  if not RegQueryStringValue(HKCU,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1',
      'DisplayVersion', Result) then
    RegQueryStringValue(HKLM,
      'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#emit SetupSetting("AppId")}_is1',
      'DisplayVersion', Result);
end;

// Numeric dotted compare; non-numeric fragments (e.g. "0.0.0-dev") count as
// 0 so a dev build never outranks a release. >0 A newer, <0 B newer.
function CompareVersionStrings(const A, B: string): Integer;
var
  PA, PB: TArrayOfString;
  I, NA, NB, Count: Integer;
begin
  PA := StringSplitEx(A, ['.', '-'], '"', stExcludeEmpty);
  PB := StringSplitEx(B, ['.', '-'], '"', stExcludeEmpty);
  Count := GetArrayLength(PA);
  if GetArrayLength(PB) > Count then Count := GetArrayLength(PB);
  Result := 0;
  for I := 0 to Count - 1 do
  begin
    NA := 0; NB := 0;
    if I < GetArrayLength(PA) then NA := StrToIntDef(PA[I], 0);
    if I < GetArrayLength(PB) then NB := StrToIntDef(PB[I], 0);
    if NA <> NB then
    begin
      if NA > NB then Result := 1 else Result := -1;
      exit;
    end;
  end;
end;

// Same-or-older setup run over an existing install: offer Repair (proceed —
// reinstall-over-itself IS Inno's repair) or Uninstall. A NEWER setup skips
// this entirely: the normal wizard is the update path. Silent runs skip it
// too (scripted installs must never grow an interactive fork).
function InitializeSetup(): Boolean;
var
  UninstPath: string;
  Form: TSetupForm;
  RepairBtn, UninstallBtn, CancelBtn: TNewButton;
  Prompt: TNewStaticText;
  ResultCode: Integer;
begin
  Result := True;
  if WizardSilent() then exit;
  UninstPath := RemoveQuotes(GetUninstallString());
  if UninstPath = '' then exit;
  if CompareVersionStrings('{#MyAppVersion}', GetInstalledVersion()) > 0 then exit;

  // CreateCustomForm's signature (ClientWidth, ClientHeight, KeepSizeX,
  // KeepSizeY) as of Inno 6.4+ takes the initial size directly instead of
  // the pre-6.4 no-arg form + separate ClientWidth/ClientHeight assignment;
  // KeepSizeX/KeepSizeY True on both axes pins this dialog at its authored
  // size since none of its controls are meant to auto-expand it.
  Form := CreateCustomForm(ScaleX(380), ScaleY(150), True, True);
  try
    Form.Caption := 'GitHub Repo Manager Maintenance';
    Form.CenterOnShow := True;

    Prompt := TNewStaticText.Create(Form);
    Prompt.Parent := Form;
    Prompt.Left := ScaleX(16);
    Prompt.Top := ScaleY(16);
    Prompt.Width := Form.ClientWidth - ScaleX(32);
    Prompt.AutoSize := False;
    Prompt.WordWrap := True;
    Prompt.Height := ScaleY(40);
    Prompt.Caption := 'GitHub Repo Manager ' + GetInstalledVersion() +
      ' is already installed. What would you like to do?';

    RepairBtn := TNewButton.Create(Form);
    RepairBtn.Parent := Form;
    RepairBtn.Left := ScaleX(16);
    RepairBtn.Top := ScaleY(76);
    RepairBtn.Width := ScaleX(108);
    RepairBtn.Caption := 'Repair';
    RepairBtn.ModalResult := mrYes;
    RepairBtn.Default := True;

    UninstallBtn := TNewButton.Create(Form);
    UninstallBtn.Parent := Form;
    UninstallBtn.Left := ScaleX(136);
    UninstallBtn.Top := ScaleY(76);
    UninstallBtn.Width := ScaleX(108);
    UninstallBtn.Caption := 'Uninstall';
    UninstallBtn.ModalResult := mrNo;

    CancelBtn := TNewButton.Create(Form);
    CancelBtn.Parent := Form;
    CancelBtn.Left := ScaleX(256);
    CancelBtn.Top := ScaleY(76);
    CancelBtn.Width := ScaleX(108);
    CancelBtn.Caption := 'Cancel';
    CancelBtn.ModalResult := mrCancel;
    CancelBtn.Cancel := True;

    case Form.ShowModal() of
      mrYes: Result := True;
      mrNo:
      begin
        Result := False;
        Exec(UninstPath, '', '', SW_SHOW, ewNoWait, ResultCode);
      end;
    else
      Result := False;
    end;
  finally
    Form.Free();
  end;
end;

function ReadFirstLine(const FileName: string): string;
var
  Lines: TArrayOfString;
begin
  Result := '';
  if LoadStringsFromFile(FileName, Lines) and (GetArrayLength(Lines) > 0) then
    Result := Trim(Lines[0]);
end;

function IsAllDigits(const S: string): Boolean;
var
  I: Integer;
begin
  Result := (Length(S) > 0) and (Length(S) <= 5);
  if Result then
    for I := 1 to Length(S) do
      if (S[I] < '0') or (S[I] > '9') then
      begin
        Result := False;
        exit;
      end;
end;

function GetShutdownPort(): string;
var
  PortText: string;
begin
  PortText := ReadFirstLine(ExpandConstant('{#MyDataDir}\.grm.port'));
  // Corrupt or malformed marker must degrade to default port, not produce
  // a malformed curl URL that fails unpredictably.
  if not IsAllDigits(PortText) then PortText := '3001';
  Result := PortText;
end;

// Ask the running server to exit cleanly (in-box curl.exe, Win10 1803+),
// wait, then escalate to a PID-targeted kill. Never kill by image name —
// node.exe may belong to anything.
function TryStopRunningApp(): Boolean;
var
  Token, PidStr: string;
  ResultCode, I: Integer;
begin
  Token := ReadFirstLine(ExpandConstant('{#MyDataDir}\.grm.shutdown-token'));
  if Token <> '' then
  begin
    Exec(ExpandConstant('{sys}\curl.exe'),
      '-s -m 5 -X POST -H "X-GRM-Shutdown-Token: ' + Token + '" ' +
      'http://127.0.0.1:' + GetShutdownPort() + '/api/system/shutdown',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    for I := 1 to 20 do
    begin
      if not IsAppRunning() then
      begin
        Result := True;
        exit;
      end;
      Sleep(500);
    end;
  end;
  PidStr := ReadFirstLine(ExpandConstant('{#MyDataDir}\.grm.pid'));
  if PidStr <> '' then
  begin
    Exec(ExpandConstant('{sys}\taskkill.exe'), '/PID ' + PidStr + ' /T /F',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    for I := 1 to 10 do
    begin
      if not IsAppRunning() then
      begin
        Result := True;
        exit;
      end;
      Sleep(500);
    end;
  end;
  Result := not IsAppRunning();
end;

// PrepareToInstall runs after the destination directory is fully resolved
// (the wizard page or a silent /DIR= switch has already been applied), so
// ExpandConstant('{app}') above is trustworthy here - unlike in
// InitializeSetup, which fires before that. Unlike the old blocking-only
// behavior, a running app is no longer a hard stop: interactive runs get a
// confirm prompt then a graceful-stop attempt (curl shutdown endpoint, then
// PID kill - see TryStopRunningApp); silent runs skip the prompt and go
// straight to the stop attempt, since a scripted upgrade wants "make it so"
// rather than aborting with the process still alive.
function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if not IsAppRunning() then exit;
  if not WizardSilent() then
  begin
    if MsgBox('GitHub Repo Manager is currently running.' + #13#10 +
        'Close the application and continue with Setup?',
        mbConfirmation, MB_YESNO) <> IDYES then
    begin
      Result := 'Setup cannot continue while GitHub Repo Manager is running. ' +
        'Close it (Start Menu -> Stop GitHub Repo Manager) and run Setup again.';
      exit;
    end;
  end;
  // Silent installs proceed straight to the graceful stop: a scripted
  // upgrade wants "make it so", and graceful-then-PID-kill is strictly safer
  // than the old behavior of refusing (which forced admins to taskkill
  // themselves, without the graceful attempt).
  if not TryStopRunningApp() then
    Result := 'Could not stop the running GitHub Repo Manager instance. ' +
      'Close it manually, then run Setup again.';
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
    // Deliberately the UNEXPANDED %LOCALAPPDATA% form (not ExpandConstant):
    // the launchers expand env vars at run time, so whichever user launches
    // the app gets their own data dir — see MyDataDirMarker above. Markers
    // written by pre-4.8.2 installers hold an absolute path; runtime
    // expansion leaves those untouched (no env vars to expand).
    SaveStringToFile(ExpandConstant('{app}\install-config.txt'),
      'DATA_DIR={#MyDataDirMarker}' + #13#10,
      False);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  PurgeData: Boolean;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Stop a running instance before files are removed — same policy as
    // install-time (graceful endpoint, then PID kill).
    if IsAppRunning() then
      TryStopRunningApp();

    // usUninstall (not usPostUninstall): the main uninstaller process
    // terminates before usPostUninstall runs in its temp-copied clone, so a
    // prompt there fires after any waiting caller already moved on.
    PurgeData := False;
    if UninstallSilent() then
      PurgeData := CmdLineParamExists('/PURGEDATA')
    else
      PurgeData := MsgBox('Also delete your local data?' + #13#10 + #13#10 +
        'This removes the database, settings, encryption keys and license at:' + #13#10 +
        ExpandConstant('{localappdata}\GitHubRepoManager') + #13#10 + #13#10 +
        'Choose No to keep it for a future reinstall.',
        mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;

    if PurgeData then
      DelTree(ExpandConstant('{localappdata}\GitHubRepoManager'), True, True, True)
    else
      SuppressibleMsgBox(
        'Your data was left untouched at:' + #13#10 +
        ExpandConstant('{#MyDataDir}') + #13#10 +
        'Delete that folder yourself if you no longer need it.',
        mbInformation, MB_OK, IDOK);

    // App-created artifacts outside the uninstall log must go explicitly.
    DeleteFile(ExpandConstant('{#MyStartupShortcut}'));
  end;
end;
