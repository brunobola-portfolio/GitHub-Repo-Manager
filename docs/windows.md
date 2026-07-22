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
- [Maintenance](#maintenance)
- [Connecting to GitHub / AI](#connecting-to-github--ai)
- [Troubleshooting](#troubleshooting)
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

Once installed, launch it from the finish-page **Launch** checkbox, the Start
Menu, or the desktop shortcut (if you added one). The server starts **hidden
in the background** — no console window — and your browser opens
automatically once it's ready.

**Scripted / unattended install** (admins, fleet rollout):

```bat
github-repo-manager-<version>-setup.exe /VERYSILENT /NORESTART /SUPPRESSMSGBOXES ^
    /LOG="%TEMP%\grm-setup.log" [/DIR="D:\Apps\GitHubRepoManager"]
```

- **Exit codes:** `0` = success; non-zero = failure. `/LOG=` writes a full
  transcript for diagnostics. A silent install over a running instance no
  longer aborts — it stops the app gracefully first, then upgrades (see
  [Maintenance](#maintenance)).
- **Per-user data, even when an admin installs:** the installer records the
  data-directory marker in its unexpanded `%LOCALAPPDATA%` form and the
  launchers expand it at run time, so each Windows account that launches the
  app gets its own database and configuration.
- **Pre-provisioning (zero-touch GitHub/license config):** the first launch
  never overwrites an existing `.env`, so a rollout script can create
  `%LOCALAPPDATA%\GitHubRepoManager\data\.env` *before* first start with
  `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (and optionally `LICENSE_KEY`)
  pre-filled — users then skip the in-app setup entirely. Note that the
  automatic secret generation only runs when the file is **absent**, so a
  pre-provisioned `.env` must also include `SESSION_SECRET`,
  `WEBHOOK_SECRET`, `CREDENTIAL_ENCRYPTION_KEY` and `API_KEY_SECRET` —
  generate a strong unique value per machine for each with
  `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`
  (plus `NODE_ENV=production`, `HOST=127.0.0.1`, `ALLOW_CONSOLE_EMAIL=true`,
  matching what first-run would have written).
- **Launcher overrides:** the `GRM_PORT`, `GRM_DATA_DIR`, `GRM_NO_BROWSER=1`
  environment variables are honoured on every launch — double-clicking
  `GitHub Repo Manager.exe`, a shortcut, or the console-mode scripts.
- **Verify downloads** against the published `.sha256` files (see
  [Troubleshooting](#troubleshooting)).
- **winget:** planned but not submitted yet — see
  [Limits](#limits-honest); until then, the silent installer above is the
  supported scripted channel.

### Option B — Portable ZIP

1. Download `github-repo-manager-<version>-win-x64.zip` from the latest
   release.
2. Extract it anywhere you have write access.
3. Double-click **`GitHub Repo Manager.exe`**.

The server starts hidden in the background and your browser opens when it's
ready — same as the installed copy. (For diagnostics or automation, the
folder also ships **`Start GitHub Repo Manager.cmd`** and
**`Stop GitHub Repo Manager.cmd`**, which run the same launch in a *visible*
console; they accept `--no-browser` / `--data-dir <path>` flags or the
`GRM_*` environment variables above.)

### What first run does (both options)

The launcher starts the server hidden and opens your browser once it answers
its health check. On that first launch it also:

- Generates a `.env` file **inside your data directory** with four
  independent random secrets (session, webhook signing, credential
  encryption, API key signing) — nothing leaves your machine and nothing is
  shared between installs. Because it lives with your data (not with the
  app files), it survives updates *and* uninstall/reinstall — important,
  since the credential-encryption key inside it is what unlocks any API
  keys/PATs you save in the app. (Installs made before v4.8.0 kept it at
  `app\.env`; the launcher migrates it automatically on the next start.)
- Binds the server to `127.0.0.1` only — **no Windows Firewall prompt, no
  LAN exposure.** The app is reachable only from the machine it runs on.
- Opens your default browser to the app once the server answers its health
  check.

---

## Where your data lives

| Install method | Data directory |
| --- | --- |
| Installer | `%LocalAppData%\GitHubRepoManager\data` |
| Portable ZIP | `.\data` next to `GitHub Repo Manager.exe` |

This folder holds the SQLite database and its WAL sidecars, the automatic
backups the app writes on its own schedule (see
[Backup & restore](operations.md#backup--restore)), the `.env` configuration
file with this install's secrets, a `logs\` folder of dated server logs
(7-day retention), and — after a one-click update — an `updates\` folder
holding the downloaded installer/ZIP, the pre-update database snapshot
(`pre-update-<version>.db`), a backup of the previous app, and the updater's
log. It survives both **updates** and **uninstalls**. Back it up by copying
the folder.

Under the hood this is just the `DATA_DIR` env var (see
[Runtime layout & bind](operations.md#runtime-layout--bind-v470)): the
installer writes it into `install-config.txt` next to `start.ps1` right
after install, and a portable-ZIP launch defaults to `.\data` unless you
override it with the `GRM_DATA_DIR` environment variable before launching.
Whenever this guide says "your `.env` file", it means the one **inside that
data directory**.

---

## Updating

Three ways to update, depending on how you run the app.

### One-click (Update now)

In the packaged Windows app, **Settings → About** shows an **Update now**
button whenever a newer release is available. This is offered only in the
packaged Windows build — the installer *and* the portable ZIP (both run in
managed mode) — and never for a Docker deployment, a self-hosted web install,
or dev/demo mode, which fall back to the manual steps below.

Clicking **Update now**:

1. Downloads the release asset that matches your install — the `setup.exe`
   for an installed copy, the ZIP for a portable one — with a download
   progress readout.
2. Verifies the download against its published **SHA256** checksum before
   touching anything; a mismatch aborts the update and the file is discarded.
3. Snapshots your database to `data\updates\pre-update-<version>.db` so the
   current state can be recovered.
4. Hands off to the updater and restarts the app. The page you're on
   **reloads automatically** once the new version passes its health check,
   and a toast confirms the update (`Updated to v<newversion>`).

### Automatic rollback (portable ZIP only)

On the **portable** build, if the freshly-swapped version fails its health
check, the updater reverts the app, the bundled runtime, and the database
snapshot **together**, relaunches the previous version, and shows a toast
that the update **failed and was rolled back**. You end up back on the
version you started from.

**Installed builds have no automatic rollback.** If an installed-mode update
fails, recovery is **manual**: the downloaded `setup.exe` is kept under
`data\updates\`, so you can re-run it (or an earlier one) to reinstall, or
restore the `pre-update-<version>.db` snapshot from that same folder. See
[Troubleshooting](#troubleshooting).

### Manual update

- **Installer:** download the new `setup.exe` and run it over the existing
  install. It detects a running instance and **stops it gracefully** first,
  then upgrades in place. Your data directory (database, backups, `.env`) is
  untouched.
- **Portable ZIP:** stop the app, extract the new ZIP over the existing
  folder (overwrite when prompted), then start it again. The distributed ZIP
  never contains a `data\` folder, so your database and `.env` are never
  touched by the overwrite.

### The in-app update notification

Settings → About (after logging in) shows a "vX.Y.Z available" banner when a
newer GitHub release exists. The check is a single unauthenticated `GET` to
GitHub's public releases API — no query params, no identifying data
attached — cached for 24 hours. In the packaged Windows app the banner
carries the **Update now** button above; everywhere else it just links to
the release for a manual update. To disable the outbound check entirely, add
`UPDATE_CHECK=false` to your `.env` file and restart.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="images/update-check.svg">
  <img alt="Update-check flow: Settings About triggers an authenticated GET to /api/system/update-check, cached 24 hours on success or 1 hour after a failure, which makes a plain unauthenticated GET to GitHub's releases/latest API with no query parameters, no identifying data, and a 5 second timeout, then compares versions with strict semver-newer logic before showing a dismissable banner — UPDATE_CHECK=false skips the outbound call entirely, and a failed fetch degrades to an inconclusive result that never claims an update either way" src="images/update-check.svg" width="900">
</picture>

---

## Maintenance

### Start Menu shortcuts (installer)

An installed copy adds a **GitHub Repo Manager** program group:

| Shortcut | What it does |
| --- | --- |
| GitHub Repo Manager | Starts the app (hidden server, opens your browser) |
| Stop GitHub Repo Manager | Stops a running instance gracefully |
| View server logs | Opens `data\logs` in Explorer |
| Open data folder | Opens your data directory in Explorer |
| Uninstall GitHub Repo Manager | Runs the uninstaller |

A **desktop shortcut** and **start-on-login** are both optional and
**unchecked by default** on the installer's "Additional shortcuts" page.
Start-on-login launches the app in the background with the browser
suppressed (`--no-browser`) each time you sign in to Windows.

### Repair or uninstall (re-running setup)

Running the **same or an older** `setup.exe` over an existing install opens a
**maintenance dialog** — **Repair** (reinstall the current files in place) or
**Uninstall**. A *newer* `setup.exe` skips this dialog and simply upgrades;
silent runs skip it too.

If the app is running when you install over it, setup **stops it gracefully**
first — a confirmation prompt on interactive runs, straight to the stop on
silent ones — instead of aborting the way older versions did.

### Uninstall

**Installer:** Start Menu → GitHub Repo Manager → **Uninstall**, or
**Settings → Apps** in Windows. By default this removes the app files but
**keeps your data**: the interactive uninstaller asks *"Also delete your
local data?"* and defaults to **No**, so reinstalling later picks up exactly
where you left off. Choosing **Yes** — or passing **`/PURGEDATA`** to a
silent uninstall — deletes `%LocalAppData%\GitHubRepoManager` entirely
(database, settings, encryption keys, and license included). Either way the
uninstaller tells you the exact data path.

**Portable ZIP:** delete the extracted folder. To also remove your data,
delete the `data\` folder inside it first — there's no separate uninstall
step.

---

## Connecting to GitHub / AI

### GitHub — guided setup (recommended)

Click **Sign in** on the landing page. On a fresh install the app detects
that GitHub isn't connected yet and opens a guided, one-time setup:

1. It opens GitHub's **New OAuth App** form for you, **pre-filled with the
   exact Homepage and Callback URLs for your install** (including the real
   port, even if the launcher had to pick a different one). You just click
   **Register application**.
2. Click **Generate a new client secret** on the page GitHub shows next.
3. Paste the **Client ID** and **Client Secret** back into the app.

That's it — the app saves them into your `.env`, applies them immediately
(no restart), and takes you to GitHub sign-in. For security, this in-app
setup only works from the machine the server runs on, only while OAuth is
not yet configured, and can be disabled outright with
`GRM_DISABLE_WEB_SETUP=true` in `.env`.

### GitHub — manual setup (fallback)

If you prefer editing files: create an OAuth App at
<https://github.com/settings/applications/new> with **exactly** these values
(the host must match what your browser shows — `127.0.0.1`, not
`localhost`; GitHub compares callback URLs character-for-character):

| Field | Value |
| --- | --- |
| Homepage URL | `http://127.0.0.1:3001` |
| Authorization callback URL | `http://127.0.0.1:3001/api/auth/callback` |

Then add to the `.env` file in your data directory and restart:

```ini
GITHUB_CLIENT_ID=<your Client ID>
GITHUB_CLIENT_SECRET=<your Client Secret>
```

You do **not** need to set `FRONTEND_URL` — the app defaults to the
address it's actually serving on, so post-login redirects follow the real
port automatically. Only the OAuth App's callback URL on GitHub needs
updating if you later change the port.

### AI providers (BYOK)

See the [AI Providers guide](ai-providers.md); each user adds their own key
in Settings → AI Configuration once logged in.

### License (Pro / Enterprise)

The package runs on the Free tier out of the box. If you purchased a
license key (`grm_lic_…`, delivered by email after checkout), activate it
**in-app**: Settings → License & Plan → paste the key. Activation is
validated and applied immediately — no `.env` editing, no restart — and the
key is stored in your database, so it survives updates and
uninstall/reinstall along with the rest of your data. (Setting `LICENSE_KEY`
in `.env` also works, for scripted installs.)

### No zero-config demo mode here

The mock/demo data layer is a development-only build feature — it's
compiled out of every production bundle regardless of any setting, and this
package ships a production build. Connecting a GitHub account (above) is
required to actually use the packaged app; there's no key-free way to
explore it first.

---

## Troubleshooting

**Port already in use.** The launcher checks the configured port (default
`3001`) and automatically picks the next free one if something else is
already using it — the browser tab that opens always follows the port
actually used, and so do login redirects. Your configured port in `.env`
is left untouched. The one thing that can't follow automatically is your
GitHub OAuth App's callback URL — if sign-in starts failing with a
callback/redirect error after a port change, update the callback URL on
GitHub to the new port.

**Antivirus / SmartScreen flags the download.** The binaries are unsigned
(see [Install](#install)). Verify the download against the published
checksum instead of trusting a warning on its own:

```bat
certutil -hashfile "github-repo-manager-<version>-setup.exe" SHA256
```

Compare the printed hash to the `.sha256` file published next to the
download on the same release page.

**Where are the logs?** The server writes structured JSON logs to
`data\logs\server-<date>.log` — a new file per day, kept for 7 days. On an
installed copy, Start Menu → **View server logs** opens that folder. Set
`LOG_LEVEL=debug` in `.env` for more detail.

**Stop a stuck instance.** Use Start Menu → **Stop GitHub Repo Manager**, or
run `GitHub Repo Manager.exe stop` from the install/extract folder — both
ask the server to shut down gracefully and fall back to stopping the process
if it doesn't. If a stale pidfile is ever left behind it lives at
`data\.grm.pid` and is safe to delete.

**An update failed or rolled back.** The toast on the next load tells you
what happened; the details are in `data\updates\apply-update-<version>.log`
(portable) or `data\updates\update-<version>.log` (installer). On the
**portable** build a failed update rolls back to the previous version
automatically. On an **installed** copy there is **no** automatic rollback —
re-run the retained `setup.exe` under `data\updates\`, or restore the
`pre-update-<version>.db` snapshot from that folder (see
[Updating](#updating)).

**"This database was created by a newer version."** If you downgrade — or
open a data folder that a newer build already migrated — the app refuses to
start rather than run migrations it doesn't understand, to protect your
data. Reinstall the newer version, or restore the `pre-update-<version>.db`
snapshot from `data\updates\`.

**Database won't open / corruption.** The app verifies the database on
every start. If it's damaged (crash, disk fault), it automatically
quarantines the broken file (renamed `manager.db.corrupt-<timestamp>`, kept
for manual recovery) and restores the most recent healthy automatic backup
— or starts fresh when no backup exists — telling you what it did in-app.
Nothing is ever deleted.

**Fully reset the app.** Stop it, then delete the data directory (see
[Where your data lives](#where-your-data-lives)). The next start recreates
an empty database with fresh secrets. Careful: this also deletes `.env` —
GitHub OAuth will need to be set up again, and anything encrypted with the
old secrets is gone with the database that held it.

---

## Limits (honest)

- **x64 only.** ARM64 Windows (Surface Pro X and similar) runs it through
  Windows' built-in x64 emulation — there is no native ARM64 build.
- **Unsigned binaries.** Both the installer and the ZIP's contents are
  unsigned for now; expect the SmartScreen prompt above until code-signing
  is set up.
- **Not a tray app.** The backend is a local web server that runs hidden in
  the background — but it is **not** a system-tray app: there's no tray
  icon and no minimize-to-tray. Start and stop it from the Start Menu (or
  `GitHub Repo Manager.exe` / `GitHub Repo Manager.exe stop`).
- **Installed-mode updates roll back manually.** A failed one-click update
  reverts automatically on the **portable** ZIP, but **not** on an installed
  copy — recovery there is a manual reinstall or snapshot restore (see
  [Updating](#updating)).
- **winget — not yet.** Manifest scaffolding and an automated
  publish-on-release step exist in the repo, but nothing has been submitted
  to the `winget-pkgs` repository — `winget install` is not available today.
  Watch the [releases page](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases)
  or the in-app update notification instead.
