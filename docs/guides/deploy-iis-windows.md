# Deploying behind IIS on Windows Server

End-to-end runbook for putting GitHub Repo Manager on a public domain with IIS
terminating TLS and reverse-proxying to the Node process.

Ready-to-copy artefacts live in [`deploy/iis/`](../../deploy/iis/):

| File | Purpose |
| ---- | ------- |
| [`web.config`](../../deploy/iis/web.config) | ARR reverse-proxy rule, SSE buffering off, request limits |
| [`production.env.example`](../../deploy/iis/production.env.example) | Annotated production `.env` |
| [`install-service.ps1`](../../deploy/iis/install-service.ps1) | Registers the Windows service and health-checks it |

Running on Linux or in Docker instead? Use
[`deploy/Caddyfile.example`](../../deploy/Caddyfile.example) and the nginx
config in the [Operations runbook](../operations.md#reverse-proxy--tls) — the
application-side steps below still apply.

---

## What you are deploying

One Node process. In production (`NODE_ENV=production`) Express serves the
built SPA from `dist/` **and** every `/api/*` route from the same port
(`server/index.js`). There is no separate static origin.

```text
Internet ──HTTPS──▶ IIS site (443)  ──HTTP──▶  node server/index.js
                    ARR reverse proxy          127.0.0.1:3001
                    TLS terminates here        SQLite in DATA_DIR
```

IIS handles TLS, the public binding, and nothing else. **Do not point the IIS
site at `dist/` and do not add SPA fallback rewrite rules** — Express already
serves the shell with the correct `Cache-Control`, and a second static handler
would keep serving a stale copy after each deploy.

### The two things IIS gets wrong by default

Both are configured for you by `deploy/iis/web.config`, but they are worth
understanding because each fails in a way that looks like an application bug:

1. **ARR does not send `X-Forwarded-Proto`.** It sends `X-ARR-SSL`, which
   Express does not read. Without the header, `app.set('trust proxy', 1)` has
   nothing to work with and `req.secure` is false.

   The app degrades gracefully rather than breaking: because `FRONTEND_URL`
   pins the public origin, the OAuth `redirect_uri` is still built as
   `https://` and login works (`resolveCallbackOrigin`,
   `server/routes/auth.js`). **What you silently lose is the `Secure` flag on
   the session cookie** — measured against a real production boot, with the
   header the cookie is `HttpOnly; Secure; SameSite=Lax`, without it the
   `Secure` attribute is simply absent. The cookie still travels over your
   TLS, but nothing stops a downgrade from replaying it.

   One exception: **Azure DevOps OAuth has no such fallback** and does break
   outright — `server/routes/azure/oauth.js` derives its redirect URI from
   `req.protocol` alone. Do step 5.2, and use check 2 below to confirm it
   took.
2. **ARR buffers responses** (256 KB threshold by default). Server-Sent
   Events — AI chat streaming, PR chat, migration progress, assisted install —
   arrive as one delayed blob at the end instead of token by token. ARR
   ignores the `X-Accel-Buffering: no` header the app sends for nginx's
   benefit; `responseBufferThreshold="0"` is the only lever that works here.

---

## Prerequisites

- **Windows Server 2019+** (or Windows 10/11 Pro) with IIS installed.
- **[URL Rewrite 2.1](https://www.iis.net/downloads/microsoft/url-rewrite)**
  and **[Application Request Routing 3.0](https://www.iis.net/downloads/microsoft/application-request-routing)**.
- **Node 24 LTS** ("Krypton"). `package.json` allows `>=22.14 <25` — both current
  LTS lines — and CI tests both, but 24 is the deployment target. No C++
  toolchain is needed: `better-sqlite3` 13 builds against Node-API
  (`NAPI_VERSION=10`) and ships ABI-independent prebuilds, so `npm ci`
  downloads a binary rather than compiling one, and that binary keeps working
  across Node majors. If another app on the same host already runs Node 24
  (Hermes, for example), share that runtime — there is no reason for two.
- **[NSSM](https://nssm.cc/)** on `PATH`, to run Node as a service.
- A **DNS A record** for your hostname pointing at the server, and a TLS
  certificate (Let's Encrypt via [win-acme](https://www.win-acme.com/) is the
  usual choice on IIS).

Confirm before you start:

```powershell
node --version          # v24.x (v22.x also supported)
(Get-Command nssm).Source
Get-WebGlobalModule | Where-Object Name -match 'ApplicationRequestRouting|RewriteModule'
```

---

## 1. Build the app

Build on the server, or on any Windows box — `better-sqlite3` ships a
prebuilt, Node-API binary, so the artefact is not tied to the Node version
that produced it (see the prerequisite note above).

```powershell
cd C:\apps\GitHubRepoManager
npm ci
npm run build
```

`npm ci` runs a postinstall native-module check; if it reports a
`better-sqlite3` problem, run `npm run fix:native`.

`npm run build` writes `dist/`. The frontend mock layer cannot leak into it:
`src/config.js` defines `MOCK_MODE` as `import.meta.env.DEV && VITE_MOCK_MODE
=== 'true'`, and `DEV` is `false` in a production build, so Vite folds the whole
expression away and drops every guarded branch. The hazard is on the **server
side** instead — see step 2.

> Node and npm are only needed to build and to run the service. Nothing else
> on the box needs them.

---

## 2. Create the data directory and the `.env`

Keep persisted state out of the install tree so upgrades never touch it.

Lock the directory down **before** anything secret is written into it.
`C:\ProgramData` grants `BUILTIN\Users:(OI)(CI)(RX)` and children inherit it,
so a file created first and secured afterwards is world-readable for the whole
gap — and `DATA_DIR` keeps that inherited ACL permanently otherwise, which also
exposes `manager.db` (the session store), `logs\` and `backups\`.

SIDs, not names: on a non-English Windows (`Administrators` is
`Administradores` on a pt-PT server) the localized form fails with *"No mapping
between account names and security IDs was done."*

```powershell
$data = 'C:\ProgramData\GitHubRepoManager\data'
New-Item -ItemType Directory -Force -Path $data | Out-Null
# *S-1-5-18 = SYSTEM, *S-1-5-32-544 = Administrators
icacls $data /inheritance:r /grant '*S-1-5-18:(OI)(CI)(F)' '*S-1-5-32-544:(OI)(CI)(F)'
Copy-Item deploy\iis\production.env.example "$data\.env"
```

Generate the four secrets — each independently random, appended in place:

```powershell
node scripts\generate-secrets.mjs --append "$data\.env"
```

`npm run gen:secrets` prints them to stdout instead if you would rather paste
them yourself — but note that PowerShell **transcription**, if your server
hardening baseline enables it, writes stdout to a plaintext log. The
`--append` form only prints a confirmation, so prefer it on the server.

`--append` refuses to run if any of the four keys is already populated. That
guard exists because a second append would silently *shadow* the existing
values (dotenv takes the last occurrence of a duplicated key), swapping
`CREDENTIAL_ENCRYPTION_KEY` under a database full of credentials encrypted
with the old one. Rotation is supported, but it is a deliberate two-key
procedure — set the new value and put the old one in
`CREDENTIAL_ENCRYPTION_KEY_PREVIOUS`, which keeps existing blobs decryptable
while every re-save re-encrypts under the new key
(`server/lib/credential-encryption.js`).

Now edit `$data\.env` and set at least:

| Variable | Value |
| -------- | ----- |
| `FRONTEND_URL` | `https://your-host.example` — must match the IIS binding exactly, no trailing slash |
| `DATA_DIR` | `C:\ProgramData\GitHubRepoManager\data` |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | from step 3 |
| `RESEND_API_KEY` | production boot **aborts** on `EMAIL_PROVIDER=console`, and on `resend` without this key. `EMAIL_FROM` is not validated at boot but is required for delivery |

`HOST=127.0.0.1` and `PORT=3001` are already set in the template. Binding
loopback is deliberate: the public surface is the IIS site, and binding all
interfaces would expose the app on the LAN with no TLS and no access log.

Tighten the file itself — it holds the key that decrypts every stored
credential. The directory ACL above already covers it; this makes it explicit
and read-only for the service:

```powershell
icacls "$data\.env" /inheritance:r /grant '*S-1-5-18:(R)' '*S-1-5-32-544:(F)'
```

Running the service as a **dedicated account** instead of LocalSystem
(`-ServiceAccount` in step 4)? Grant it as well, or the service cannot read its
own configuration and will not boot:

```powershell
icacls "$data\.env" /grant '<DOMAIN\svc-account>:(R)'
icacls $data       /grant '<DOMAIN\svc-account>:(OI)(CI)(M)'
```

> **Back up `CREDENTIAL_ENCRYPTION_KEY` separately from the database.** Losing
> it makes every stored BYOK key and Azure PAT unrecoverable. Losing both
> together — one backup holding both — defeats the point of encrypting them.

---

## 3. Register the GitHub OAuth App

[github.com/settings/developers](https://github.com/settings/developers) →
**OAuth Apps** → **New OAuth App**:

| Field | Value |
| ----- | ----- |
| Application name | GitHub Repo Manager |
| Homepage URL | `https://your-host.example` |
| Authorization callback URL | `https://your-host.example/api/auth/callback` |

GitHub matches the callback **exactly**. Copy the Client ID, generate a Client
Secret, and put both in the `.env`.

Different from a GitHub *App* (`docs/setup/github-app.md`), which is a separate
roadmap item for bot identity. Login uses the OAuth App.

---

## 4. Install the Windows service

From an **elevated** PowerShell:

```powershell
cd C:\apps\GitHubRepoManager
.\deploy\iis\install-service.ps1 `
    -AppRoot C:\apps\GitHubRepoManager `
    -EnvFile C:\ProgramData\GitHubRepoManager\data\.env
```

The script validates the Node major, registers an NSSM service with
`NODE_ENV=production` and `GRM_ENV_FILE` pointing at your `.env`, sets restart
and log rotation, starts it, then polls `/api/health` until it answers. It
exits non-zero if the service comes up dead, so a failed production secret
check surfaces immediately rather than at first page load.

Logs land in `<DATA_DIR>\logs\service-out.log` / `service-err.log`.

Verify before touching IIS:

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/health
# status : ok
# version: 4.13.0
# database: connected
```

If this fails, IIS cannot fix it — read `service-err.log`. Production boot
aborts with an explicit message on a missing or too-short (<32 char) secret
(a weak-looking one only warns)
(`server/lib/startup-secrets-check.js`).

---

## 5. Configure IIS

### 5.1 Enable the ARR proxy

Once per server. IIS Manager → server node → **Application Request Routing
Cache** → *Actions* → **Server Proxy Settings** → tick **Enable proxy** →
Apply. Or:

```powershell
Import-Module WebAdministration
Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' `
    -Filter 'system.webServer/proxy' -Name 'enabled' -Value 'True'
```

### 5.2 Allow the forwarded-proto server variable

A rewrite rule may not set an arbitrary server variable until it is
allowlisted at server level. Skip this and IIS answers **HTTP 500.19**.
`HTTP_X_FORWARDED_PROTO` is the only one the shipped `web.config` sets:

```powershell
Add-WebConfiguration -PSPath 'MACHINE/WEBROOT/APPHOST' `
    -Filter 'system.webServer/rewrite/allowedServerVariables' `
    -Value @{ name = 'HTTP_X_FORWARDED_PROTO' }
```

(GUI equivalent: server node → **URL Rewrite** → *Actions* → **View Server
Variables** → **Add**.)

> `X-Forwarded-For` is *not* set by the rewrite rule and does not need
> allowlisting — ARR appends the real client IP itself, controlled by
> **Server Proxy Settings → Preserve client IP in the following header**
> (on by default). That is the knob to check if `req.ip` comes out wrong.

### 5.3 Unlock the per-site proxy section

`deploy/iis/web.config` sets four `<proxy>` attributes per site, which
requires the section to be unlocked once:

```powershell
& "$env:windir\system32\inetsrv\appcmd.exe" unlock config -section:system.webServer/proxy
```

On some IIS/ARR builds `system.webServer/proxy` is declared
`allowDefinition="AppHostOnly"` and cannot be unlocked at all. If you still get
500.19 after the command above, delete the `<proxy …>` element from the
web.config and set the same **four** values globally in **Server Proxy
Settings**: *Enable proxy* on, **Response buffer threshold (KB) = 0**,
**Time-out (seconds) = 1200**, **HTTP version = HTTP/1.1**, and keep
**Preserve host header** ticked — the app reads `Host` for its loopback gate
(`server/lib/loopback.js`), so dropping that fourth one quietly weakens a
control.

### 5.4 Create the site

The site serves no files, so the physical path only needs to hold the
web.config.

> Run the IIS blocks in **Windows PowerShell 5.1**, not PowerShell 7. The
> `IIS:` PSDrive from `WebAdministration` does not work under 7 even with
> `-UseWindowsPowerShell`.

**Order matters here.** The shipped `web.config` redirects HTTP→HTTPS and only
proxies over TLS, so the site needs a working HTTPS binding before it can serve
anything. But you also need port 80 reachable to *get* a certificate. Create the
site first, get the certificate, and drop the `web.config` in last:

```powershell
Import-Module WebAdministration        # Windows PowerShell 5.1

$sitePath = 'C:\inetpub\repomanager'
New-Item -ItemType Directory -Force -Path $sitePath | Out-Null

New-WebAppPool -Name 'RepoManagerProxy'
# No managed code: this pool only runs the native ARR/Rewrite modules.
Set-ItemProperty IIS:\AppPools\RepoManagerProxy managedRuntimeVersion ''

# Port 80 only, and deliberately WITHOUT web.config yet — win-acme's HTTP-01
# challenge is served from this site over plain HTTP.
New-Website -Name 'RepoManager' -PhysicalPath $sitePath `
    -ApplicationPool 'RepoManagerProxy' `
    -HostHeader 'your-host.example' -Port 80
```

Now run **win-acme**; it validates over port 80 and adds the HTTPS binding for
you. Only then:

```powershell
Copy-Item C:\apps\GitHubRepoManager\deploy\iis\web.config $sitePath
```

The redirect rule exempts `/.well-known/` precisely so renewals keep working
after the file is in place — it is only the *first* issuance that needs the
file absent, because until then there is no HTTPS binding to redirect to.

The app sends HSTS with `includeSubDomains` and `preload` as soon as it is
reachable over TLS, so get the certificate right **before** announcing the
hostname (see 6b).

### 5.5 Restart and verify the proxy

Recycling this one pool is enough — `iisreset` would bounce every site on the
box, including anything you are co-hosting.

```powershell
Restart-WebAppPool RepoManagerProxy
Invoke-RestMethod https://your-host.example/api/health
```

---

## 6. Post-deploy verification

Do all seven. Each one covers a failure mode the others miss.

| # | Check | Command / action | Expected |
| - | ----- | ---------------- | -------- |
| 1 | App is up | `Invoke-RestMethod https://your-host.example/api/health` | `status: ok`, `database: connected` |
| 2 | Forwarded scheme reaches Node | Log in, then inspect the session cookie in DevTools → Application → Cookies | `connect.sid` has **Secure** ✓ and **HttpOnly** ✓. A missing **Secure** is the one symptom of a skipped step 5.2 — login itself will look fine |
| 3 | OAuth round-trip | Click **Sign in with GitHub** | Lands back on the dashboard signed in — not `?error=redirect_uri_mismatch` or `?error=invalid_state` |
| 4 | SSE is not buffered | Open any repo → **AI Chat**, ask a question | Answer streams word by word; if it appears all at once after a pause, revisit 5.3 |
| 5 | No demo data in the database | Dashboard repo list, and the users table | Your actual repositories and no seeded demo accounts. `VITE_MOCK_MODE=true` in the runtime `.env` seeds both at boot |
| 6 | Client IP is real | From another machine, hammer any `/api/*` path past 100 requests in 15 min and watch the `RateLimit-Remaining` response header | It decrements per client. If two different machines share one counter, ARR is not forwarding `X-Forwarded-For` and every visitor is rate-limited as one — see the note in 5.2 |
| 7 | Forwarded-proto cannot be spoofed | `curl -H 'X-Forwarded-Proto: http' https://your-host.example/api/auth/login -D-` | `Set-Cookie` still carries **Secure**. The rewrite rule *assigns* the header, so a client value is replaced; if it were appended, Express reads the first value and the client would control `req.secure` |

Check 2 and check 6 both fail together when step 5.2 was skipped: that is the
single most common IIS mistake here.

---

## 6b. Going public — the order that matters

The steps above bring the app up. These are about the moment the hostname
becomes reachable from the internet, where the mistakes are one-way.

**Before you point public DNS at it:**

1. **Get TLS right first.** The app sends
   `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
   as soon as it serves over HTTPS. Two years, and browsers that have seen it
   will refuse plain HTTP for the host afterwards. A misissued or wrong-host
   certificate discovered *after* HSTS is cached is painful to back out of —
   `includeSubDomains` also binds every future `*.repomanager` name.
2. **Run the seven checks in section 6 against the real hostname** while it is
   still only in your `hosts` file. Everything except public DNS is testable
   that way.
3. **Confirm `VITE_MOCK_MODE` is not `true` in the runtime `.env`.** The
   server reads it at boot and, when true, seeds demo users and repositories
   straight into your production database (`seedMockData`, `server/index.js`)
   — and `startup-secrets-check.js` only *warns* about it, so boot succeeds.
   The frontend half is inert in a production build (see step 1); the database
   half is not.
4. **Decide about `/metrics` and `/api/health` at the edge.** `/metrics`
   returns 401 unauthenticated (verified), and the health probes are
   deliberately open so a load balancer can reach them — they leak the version
   string and DB reachability. That is normal, but if you would rather not
   publish it, block `/metrics` at the IIS layer rather than in the app.

**Sizing and limits worth knowing before real traffic:**

| Limit | Value | Where |
| ----- | ----- | ----- |
| JSON body | 10 KB globally, 4 MB on paths under `/api/ai/` and `/api/v1/ai/` | `server/index.js` — a 20 KB post to a normal route returns **413** |
| Upload / import body | 30 MB | `maxAllowedContentLength` in the shipped `web.config` |
| Anonymous rate limit | 100 requests / 15 min per IP (the Free-tier `api` bucket; a 200/15 min pre-session safety net sits in front) | Keyed on `req.ip`, which is why check 6 matters |
| Response timeout | 20 min | ARR `timeout` in `web.config`, sized for long AI streams |
| Session | 24 h rolling, 7-day absolute | `server/index.js`, `session-absolute-timeout.js` |

**Single instance only, for now.** Sessions and rate limits fall back to
SQLite/in-process when `REDIS_URL` is unset, and SQLite is one writer. Do not
put two Node processes behind the same site expecting them to share state —
set `REDIS_URL` first if you ever need to.

**Back up before you announce.** `CREDENTIAL_ENCRYPTION_KEY` and the database
are only meaningful together, and only the database gets a daily backup. Copy
the `.env` somewhere else, once, now.

---

## 7. Optional integrations

Configure only what you enable. Each endpoint is already mounted; it just needs
the matching secret.

| Integration | Endpoint to register | Notes |
| ----------- | -------------------- | ----- |
| GitHub webhooks | `https://your-host.example/api/v1/webhooks/github` | Content type **application/json**, secret = `WEBHOOK_SECRET`. See [webhook setup](github-webhook-setup.md). |
| Stripe | `https://your-host.example/api/v1/webhooks/stripe` | Setting `STRIPE_SECRET_KEY` makes `STRIPE_WEBHOOK_SECRET` **and** `LICENSE_SIGNING_PRIVATE_KEY_PEM` mandatory — boot aborts without them. See [Stripe setup](stripe-setup.md). |
| Azure DevOps OAuth | `https://your-host.example/api/azure/oauth/callback` | For the migration wizard's OAuth mode; PAT mode needs nothing here. **This one genuinely requires step 5.2** — `server/routes/azure/oauth.js` builds its redirect URI from `req.protocol`, with no `FRONTEND_URL` fallback, so without `X-Forwarded-Proto` it sends `http://` and Azure rejects it. |

Webhook routes are signature-verified and mounted before the CSRF middleware,
so they need no extra IIS configuration. (`express.raw` already preserves the
exact bytes the HMAC is computed over. IIS compression is switched off for an
unrelated reason — it is response-side, and re-compressing a proxied response
re-buffers SSE.)

---

## 8. Upgrading

One command, and it puts itself back if the new build does not come up:

```powershell
.\deploy\iis\deploy.ps1 -FromRelease latest -AppRoot C:pps\GitHubRepoManager
```

`-FromRelease latest` pulls the release zip, verifies its SHA-256 against the
published sidecar, and refuses a mislabelled artifact — a file called
`…-4.18.1-…` whose `package.json` says something else never gets unpacked.

**One version, one immutable artifact.** The package is
`github-repo-manager-<version>-win-x64.zip`, built and smoke-tested by CI (it
boots, the native module loads, `/api/health/ready` answers). It is never
rebuilt here: a production box has no business running `npm ci` against the
network, and a build that happens twice can differ twice.

| Step | What must hold before the next one runs |
|------|------------------------------------------|
| 1 | Package opens, carries `server/` + `dist/`, version matches its file name |
| 2 | Free disk covers the backup **and** the new content |
| 3 | Backup taken, file count verified against the source |
| 4 | Service stopped — releases file handles, and stops traffic hitting a half-swapped tree |
| 5 | Content swapped, retrying files that are briefly locked |
| 6 | Service started |
| 7 | `/api/health` reports **the version just installed**, `/api/health/ready` reports every dependency ok |
| 8 | If step 7 fails: automatic rollback to the step-3 backup, service restarted from it |

Step 7 is the one that matters most. A health check that only asks "are you
alive?" passes when the old build is still running — healthy, and not what you
deployed.

**`DATA_DIR` is never touched.** The database, the `.env` and the logs live
outside the install tree precisely so an upgrade cannot reach them. Migrations
run at boot, from the application.

Other things it does:

```powershell
# See what would happen; changes nothing, needs no elevation
.\deploy\iis\deploy.ps1 -ZipPath .\pkg.zip -AppRoot C:pps\GitHubRepoManager -DryRun

# What can I go back to?
.\deploy\iis\deploy.ps1 -AppRoot C:pps\GitHubRepoManager -ListBackups

# Go back (most recent, or -BackupName)
.\deploy\iis\deploy.ps1 -AppRoot C:pps\GitHubRepoManager -Rollback
```

Three backups are kept by default (`-KeepBackups`). Re-run
`install-service.ps1` instead if the Node version or the `.env` location
changed — that reconfigures the service in place; `deploy.ps1` only swaps
content.

---

## 9. Backups

The daily maintenance pass writes a WAL-safe online backup of the SQLite
database (`DB_BACKUP_KEEP=7` by default). Point `DB_BACKUP_DIR` at a different
volume — a backup on the same disk survives corruption but not disk loss.

Back up separately, and store apart from the database:

- `CREDENTIAL_ENCRYPTION_KEY` — without it the backup's encrypted credentials
  are unrecoverable.
- The rest of `.env`.

Restore steps: [Operations runbook → Backup & restore](../operations.md).

---

## Troubleshooting

| Symptom | Cause | Fix |
| ------- | ----- | --- |
| HTTP 500.19 on every request | `HTTP_X_FORWARDED_PROTO` not allowlisted, or `<proxy>` locked | Steps 5.2 and 5.3 |
| HTTP 502.3 | Node service not running, or wrong port | `Get-Service GitHubRepoManager`; read `service-err.log` |
| Login → `redirect_uri_mismatch` | Callback URL in the OAuth App ≠ `FRONTEND_URL` + `/api/auth/callback` | Step 3; both must be `https://`, same host, no trailing slash. Note `FRONTEND_URL` is what fixes the scheme, so a wrong value here breaks login even with step 5.2 done |
| Login → `invalid_state` | The session cookie did not survive the redirect to GitHub and back | Confirm the cookie is being set at all (check 2); a `SameSite=Lax` cookie is sent on this top-level GET, so a missing one means the session store, not the flag |
| Session cookie has no `Secure` flag | Step 5.2 skipped — `req.secure` is false without `X-Forwarded-Proto` | Step 5.2. Everything else keeps working, which is why this needs an explicit check |
| AI answers appear all at once | ARR response buffering | Step 5.3 — `responseBufferThreshold` must be `0` |
| Stream cuts off after ~2 minutes | ARR default timeout | Raise `timeout` in the web.config (`00:20:00` in the shipped file) |
| Rate limits trigger for everyone at once | `req.ip` is `127.0.0.1` for all requests | Step 5.2 — `X-Forwarded-For` must reach Node |
| Demo users/repos appear in the database | `VITE_MOCK_MODE=true` in the runtime `.env` seeded them at boot | Set it to `false` and restart. Existing seeded rows stay — remove them before going public |
| Boot aborts: `EMAIL_PROVIDER must be set…` | `console` provider on a hosted install | Configure Resend, or set `ALLOW_CONSOLE_EMAIL=true` only for a single-user install |
| `better-sqlite3` fails to load | Prebuild missing for this platform, so it fell back to compiling | `npm run fix:native`. It is Node-API, so the Node major is *not* the cause |
| `npm ci` warns `Unsupported engine` | Node outside `>=22.14 <25` | Install Node 24 LTS; `install-service.ps1` refuses to register the service on an unsupported major |
| 404.13 on a large import | IIS request body limit | `maxAllowedContentLength` in the web.config |

---

## Related

- [Operations runbook](../operations.md) — `trust proxy` hop counting, release
  flow, incidents, backup & restore.
- [Security hardening](../security-hardening.md) — G1–G9 controls and the
  full production environment-variable table.
- [`.env.example`](../../.env.example) — every variable the server reads, with
  defaults.
- [Windows guide](../windows.md) — the desktop installer, which is a different
  product shape: single-user, loopback-only, no reverse proxy.
