GitHub Repo Manager for Windows
===============================

A self-contained build of GitHub Repo Manager. It bundles its own Node.js
runtime - nothing else needs to be installed.

Getting started
  1. Double-click "GitHub Repo Manager.exe".
     The server starts in the background (no windows) and your browser
     opens automatically when it is ready.
  2. Click "Sign in" - the app walks you through connecting your GitHub
     account (a one-time, ~2 minute guided setup).
  3. To stop it, use "Stop GitHub Repo Manager" in the Start Menu, or run
     "GitHub Repo Manager.exe stop".

Where your data lives
  - Portable ZIP:  the ".\data" folder next to this file (SQLite database,
    backups, server logs, and the .env configuration file with this
    install's secrets). Back it up by copying that folder.
  - Installed via setup:  %LOCALAPPDATA%\GitHubRepoManager\data.

Logs
  Server logs are written to the "logs" folder inside your data folder
  (7-day retention). Start Menu -> "View server logs" opens it.

Updating
  - Installed: run the newer setup - it stops the app, upgrades in place,
    and never touches your data folder.
  - Portable: stop the app, then extract the newer ZIP over this folder
    ("app" and "runtime" are replaced; "data" is untouched).

Advanced (console mode)
  "Start GitHub Repo Manager.cmd" / "Stop GitHub Repo Manager.cmd" run the
  same launch scripts in a visible console - useful for diagnostics and
  automation. Flags: --no-browser, --data-dir <path> (or env vars
  GRM_NO_BROWSER=1 / GRM_DATA_DIR / GRM_PORT).

Full guide:
https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/docs/windows.md
