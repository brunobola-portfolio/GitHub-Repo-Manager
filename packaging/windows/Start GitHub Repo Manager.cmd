@echo off
rem SPDX-License-Identifier: AGPL-3.0-only
rem
rem Thin wrapper: the real logic lives in start.ps1. %~dp0 is quoted
rem throughout so this works from an install path with spaces or non-ASCII
rem characters; `chcp 65001` improves non-ASCII rendering/handling for the
rem rest of this script's own console output (best-effort, never fatal).
rem
rem Known flags are translated to environment variables rather than
rem forwarded as re-quoted CLI args -env vars can hold a value verbatim
rem (spaces and all) with no risk of cmd.exe mis-tokenizing a rebuilt
rem command line, which a naive "%~2" -> string-concat -> re-parse round
rem trip cannot guarantee. start.ps1 reads these directly (see its header).
rem
rem IMPORTANT: do not initialize GRM_DATA_DIR/GRM_NO_BROWSER to empty here -
rem a caller (CI) may already have set them in the environment this .cmd
rem inherits; only a flag actually present on argv should override them.
setlocal
chcp 65001 >nul 2>&1
title GitHub Repo Manager - Starting...

:parse_args
if "%~1"=="" goto :run
if /I "%~1"=="--no-browser" (
    set "GRM_NO_BROWSER=1"
    shift
    goto :parse_args
)
if /I "%~1"=="--data-dir" (
    set "GRM_DATA_DIR=%~2"
    shift
    shift
    goto :parse_args
)
shift
goto :parse_args

:run
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
set "EXITCODE=%ERRORLEVEL%"
endlocal & exit /b %EXITCODE%
