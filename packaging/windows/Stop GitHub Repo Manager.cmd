@echo off
rem SPDX-License-Identifier: Apache-2.0
rem Thin wrapper -see stop.ps1 for the actual logic. %~dp0 is quoted so this
rem works from an install path with spaces or non-ASCII characters. stop.ps1
rem takes no arguments, so there is nothing to translate/forward here.
setlocal
chcp 65001 >nul 2>&1
title GitHub Repo Manager - Stopping...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
set "EXITCODE=%ERRORLEVEL%"
endlocal & exit /b %EXITCODE%
