# Windows

A native Windows distribution — an installer and a portable ZIP, both
bundling their own Node.js runtime. No Docker, no separate Node.js install,
no admin rights required.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/windows-first-run.svg">
  <img alt="Windows first-run flow: Start.cmd launches the bundled runtime, first run idempotently generates a local .env with four random secrets (an existing .env is left untouched), a port check falls back to the next free port if the configured one is busy, the server boots bound to 127.0.0.1 with data under DATA_DIR, and once the health check passes the browser opens" src="images/windows-first-run.svg" width="900">
</picture>

> Windows assets ship from **v4.7.0** onward. On an earlier release, use
> [Docker](operations.md#deployment) or a manual Node.js install (see the
> [README](../README.md#installation)) instead.

## Contents

- [Install](#install)
- [Where your data lives](#where-your-data-lives)
- [Updating](#updating)
- [Connecting to GitHub / AI](#connecting-to-github--ai)
- [Troubleshooting](#troubleshooting)
- [Uninstall](#uninstall)
- [Limits (honest)](#limits-honest)

---

## Install

Both options are attached to the [latest release](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/latest).

### Option A — Installer

1. Download `github-repo-manager-<version>-setup.exe` from the latest
   release.
2. Run it. Windows SmartScreen will likely show **"Windows protected your
   PC"** — click **More info**, then **Run anyway**. This is expected: the
   installer isn't signed with a code-signing certificate yet, so SmartScreen
   flags it regardless of how safe it is. Verify the download instead of
   trusting the warning by checking its hash against the published
   `.sha256` sidecar (see [Troubleshooting](#troubleshooting)).
3. It installs **per-user** to `%LocalAppData%\Programs\GitHubRepoManager` —
   no UAC prompt.

**Silent install** (admins / scripted rollout):

```bat
github-repo-manager-<version>-setup.exe /VERYSILENT /NORESTART /SUPPRESSMSGBOXES
```

### Option B — Portable ZIP

1. Download `github-repo-manager-<version>-win-x64.zip` from the latest
   release.
2. Extract it anywhere you have write access.
3. Double-click **`Start GitHub Repo Manager.cmd`**.

### What first run does (both options)

- Generates a local `app\.env` with four independent random secrets
  (session, webhook signing, credential encryption, API key signing) —
  nothing leaves your machine and nothing is shared between installs.
- Binds the server to `127.0.0.1` only — **no Windows Firewall prompt, no
  LAN exposure.** The app is reachable only from the machine it runs on.
- Opens your default browser to the app once the server answers its health
  check.

---

## Where your data lives

| Install method | Data directory |
| --- | --- |
| Installer | `%LocalAppData%\GitHubRepoManager\data` |
| Portable ZIP | `.\data` next to `Start GitHub Repo Manager.cmd` |

This folder holds the SQLite database, its WAL sidecars, and the automatic
backups the app already writes on its own schedule (see
[Backup & restore](operations.md#backup--restore)). It survives both
**updates** and **uninstalls**. Back it up by copying the folder.

Under the hood this is just the `DATA_DIR` env var (see
[Runtime layout & bind](operations.md#runtime-layout--bind-v470)): the
installer writes it into `install-config.txt` next to `start.ps1` right
after install, and a portable-ZIP launch defaults to `.\data` unless you
override it with the `GRM_DATA_DIR` environment variable before running
`Start GitHub Repo Manager.cmd`.

---

## Updating

**Installer:** stop the app first ([Troubleshooting](#troubleshooting) below)
— the installer detects a running instance via its pidfile and refuses to
proceed rather than upgrade over a live process, so if you skip this step it
simply aborts with a message telling you to stop it. Download the new
`setup.exe` and run it over the existing install. Your data directory and
`app\.env` are untouched.

**Portable ZIP:** stop the app, extract the new ZIP over the existing
folder (overwrite when prompted), then Start again. The distributed ZIP
never contains a `data\` folder or an `app\.env` file, so neither is touched
by the overwrite.

### The in-app update notification

Settings → About (after logging in) shows a "vX.Y.Z available" banner when a
newer GitHub release exists. The check is a single unauthenticated `GET` to
GitHub's public releases API — no query params, no identifying data
attached — cached for 24 hours. It only notifies; nothing self-updates. To
disable the outbound check entirely, add `UPDATE_CHECK=false` to `app\.env`
and restart.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/update-check.svg">
  <img alt="Update-check flow: Settings About triggers an authenticated GET to /api/system/update-check, cached 24 hours on success or 1 hour after a failure, which makes a plain unauthenticated GET to GitHub's releases/latest API with no query parameters, no identifying data, and a 5 second timeout, then compares versions with strict semver-newer logic before showing a dismissable banner — UPDATE_CHECK=false skips the outbound call entirely, and a failed fetch degrades to an inconclusive result that never claims an update either way" src="images/update-check.svg" width="900">
</picture>

---

## Connecting to GitHub / AI

- **GitHub OAuth** — see the [README's GitHub OAuth section](../README.md#github-oauth)
  for creating an OAuth App and adding `GITHUB_CLIENT_ID` /
  `GITHUB_CLIENT_SECRET` to `app\.env`. If the launcher had to move to a
  different port because the configured one was busy, update the OAuth
  app's callback URL (and `FRONTEND_URL` in `app\.env`) to match.
- **AI providers (BYOK)** — see the [AI Providers guide](ai-providers.md);
  each user adds their own key in Settings → AI Configuration once logged
  in.
- **No zero-config demo mode here.** The mock/demo data layer is a
  development-only build feature — it's compiled out of every production
  bundle regardless of any setting, and this package ships a production
  build. A GitHub OAuth app (above) is required to actually use the
  packaged app; there's no key-free way to explore it first.

---

## Troubleshooting

**Port already in use.** The launcher checks the configured port (default
`3001`) and automatically picks the next free one if something else is
already using it — the browser tab that opens always follows the port
actually used. Your configured port in `app\.env` is left untouched.

**Antivirus / SmartScreen flags the download.** The binaries are unsigned
(see [Install](#install)). Verify the download against the published
checksum instead of trusting a warning on its own:

```bat
certutil -hashfile "github-repo-manager-<version>-setup.exe" SHA256
```

Compare the printed hash to the `.sha256` file published next to the
download on the same release page.

**Where are the logs?** There's no log file by default — the app prints
structured JSON to the console window that opens when you start it (titled
"GitHub Repo Manager Server"). Closing that window stops the server. Set
`LOG_LEVEL=debug` in `app\.env` for more detail.

**Fully reset the app.** Stop it, then delete the data directory (see
[Where your data lives](#where-your-data-lives)). The next Start recreates
an empty database.

**Stop a stuck instance.** Open Task Manager → Details tab, find the
`node.exe` process whose **Image path** points inside this app's install or
extract folder (there may be unrelated `node.exe` processes on your machine
— only end this one), and End Task. Delete `app\.grm.pid` afterwards if it's
still there.

---

## Uninstall

**Installer:** Start Menu → GitHub Repo Manager → **Uninstall**, or
**Settings → Apps** in Windows. This removes the app files only — your data
directory (`%LocalAppData%\GitHubRepoManager\data`) is left in place; the
uninstaller tells you the exact path and you can delete it yourself if you
no longer need it.

**Portable ZIP:** delete the extracted folder. To also remove your data,
delete the `data\` folder inside it first — there's no separate uninstall
step.

---

## Limits (honest)

- **x64 only.** ARM64 Windows (Surface Pro X and similar) runs it through
  Windows' built-in x64 emulation — there is no native ARM64 build.
- **Unsigned binaries.** Both the installer and the ZIP's contents are
  unsigned for now; expect the SmartScreen prompt above until code-signing
  is set up.
- **Not a tray app.** The backend is a local web server process with its own
  console window — it is not a system-tray background service and has no
  minimize-to-tray behavior. Closing the console window (or using Stop)
  stops the server.
- **winget — not yet.** Manifest scaffolding and an automated
  publish-on-release step exist in the repo, but nothing has been submitted
  to the `winget-pkgs` repository — `winget install` is not available today.
  Watch the [releases page](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases)
  or the in-app update notification instead.
