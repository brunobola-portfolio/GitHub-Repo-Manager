GitHub Repo Manager for Windows
================================

What this is: a self-contained, portable build of GitHub Repo Manager. It
bundles its own Node.js runtime (runtime\node.exe) — nothing else needs to
be installed.

Getting started:
  1. Double-click "Start GitHub Repo Manager.cmd". Your browser opens
     automatically once the server is ready.
  2. To stop it, double-click "Stop GitHub Repo Manager.cmd".

Where your data lives:
  - Portable ZIP: the ".\data" folder next to this file (SQLite database,
    backups, clone scratch space). Back it up by copying that folder.
  - Installed via the setup wizard: %LOCALAPPDATA%\GitHubRepoManager\data.

Updating: download the newer ZIP and replace the "app" and "runtime"
folders (or reinstall via the setup wizard) — your data folder is untouched.
Full guide: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/blob/main/docs/index.md
