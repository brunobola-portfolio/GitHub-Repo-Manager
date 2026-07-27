# Operations Runbook

Day-two guide for people who run GitHub Repo Manager in production. For the
how-to-build side, see [`docs/index.md`](index.md).

## Contents

- [Quick reference](#quick-reference)
- [Deployment](#deployment)
- [Reverse proxy & TLS](#reverse-proxy--tls)
- [Release flow](#release-flow)
- [Backup & restore](#backup--restore)
- [Data & event retention](#data--event-retention)
- [Dead-letter queues](#dead-letter-queues-email--webhook)
- [Health probes (`/live` vs `/ready`)](#health-probes-live-vs-ready)
- [Public status page](#public-status-page)
- [Monitoring (Prometheus metrics)](#monitoring-prometheus-metrics)
- [Bundle budget](#bundle-budget)
- [Audit trail](#audit-trail)
- [Admin access](#admin-access)
- [Common incidents](#common-incidents)

---

## Quick reference

| Concern | Where |
| ------- | ----- |
| Liveness probe | `GET /api/health/live` (kill-if-dead; no dependency checks) |
| Readiness probe | `GET /api/health/ready` and public [`/status`](#public-status-page) |
| Update notifications | Settings → About, sourced from `GET /api/v1/system/update-check`; disable with `UPDATE_CHECK=false` |
| Admin DLQ UI | `/admin/dlq` (requires `users.is_admin = 1`) |
| Admin DLQ CLI | `npm run admin:dlq -- --help` |
| Release notes | [`CHANGELOG.md`](../CHANGELOG.md) + [GitHub Releases](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases) |
| Security boundaries | [`docs/security-hardening.md`](security-hardening.md) (G1–G9) |
| Env reference | [`.env.example`](../.env.example) |
| CI pipelines | `.github/workflows/` (`ci.yml`, `deploy.yml`) |

---

## Deployment

**Prebuilt image (primary path).** A multi-arch image is published to GHCR
on every tagged release by `.github/workflows/docker.yml`. The package is
public — no login required:

```bash
docker pull ghcr.io/brunobola-portfolio/github-repo-manager:latest
```

Point `docker-compose.yml`'s `app.build: .` at the pulled image instead
(`image: ghcr.io/brunobola-portfolio/github-repo-manager:latest`, drop
`build: .`), or run it directly:

```bash
docker run --env-file .env -p 3001:3001 \
  -v app-data:/app/server/data \
  -v app-backups:/app/server/data-backups \
  -e DB_BACKUP_DIR=/app/server/data-backups \
  ghcr.io/brunobola-portfolio/github-repo-manager:latest
```

**Local build (alternative, always available).**

```bash
git clone https://github.com/brunobola-portfolio/GitHub-Repo-Manager.git
cd GitHub-Repo-Manager
cp .env.example .env      # edit your values
docker compose up -d      # app at http://localhost:3001
```

See [`docker-compose.yml`](../docker-compose.yml) for the full environment
whitelist (required secrets use Compose's `${VAR:?message}` form and abort
`up` with an explicit error if unset) and the [Backup & restore](#backup--restore)
section below for the `app-data` / `app-backups` volume split.

Running on Windows without Docker → [`docs/windows.md`](windows.md) (native
installer + portable ZIP, no Node.js install required).

### Runtime layout & bind (v4.7.0+)

Four env vars, introduced for the Windows package but equally usable by any
self-host, control where the app binds and where it persists state:

| Var | Default | Meaning |
| --- | ------- | ------- |
| `HOST` | unset (binds all interfaces) | Bind address passed to `app.listen(port, host)`. Set to `127.0.0.1` to restrict the server to loopback only — no OS firewall prompt, no LAN exposure. The Windows package sets this by default. |
| `DATA_DIR` | unset (`server/data`) | Root directory for **all** persisted state: the SQLite DB + session store, the default backups directory (unless `DB_BACKUP_DIR` overrides it), and import/wiki clone scratch space. Set an absolute path when the app directory is read-only (resolver: [`server/lib/data-dir.js`](../server/lib/data-dir.js)). |
| `ALLOW_CONSOLE_EMAIL` | unset (`false`) | Single-user/local installs only. Downgrades the production `EMAIL_PROVIDER=console` boot error to a warning — there's no one else to email, so license/retention notices just log. Every other production secret/config guard is unaffected; do **not** set this on a hosted, multi-user deployment. |
| `GRM_ENV_FILE` | unset (`<cwd>/.env`) | Explicit path to the `.env` file dotenv loads at boot. The Windows package launcher points this at `<DATA_DIR>\.env` so the secrets file survives uninstall/reinstall and the install dir can stay read-only. Must be set as a real OS env var (it can't live inside the file it locates). |
| `GRM_DISABLE_WEB_SETUP` | unset (`false`) | Set to `true` to turn off the in-app first-run GitHub OAuth setup (`POST /api/auth/setup-oauth`) entirely. The endpoint is already restricted to loopback clients while OAuth is unconfigured; this is the belt-and-suspenders off switch for operators who want `.env` to be the only configuration channel. |
| `UPDATE_CHECK` | unset (enabled) | Notify-only "new version available" signal for Settings → About. Set to `false` to disable the outbound `GET /api/v1/system/update-check` call entirely — the endpoint then just echoes the current version. |

---

## Reverse proxy & TLS

The app is a single Node process. In production (`NODE_ENV=production`)
Express serves the built frontend (`dist/`) **and** every `/api/*` route from
the same port (see `server/index.js`) — there is no separate static-site
origin to configure. Put one TLS-terminating reverse proxy in front of it;
a ready-to-copy Caddy config lives at
[`deploy/Caddyfile.example`](../deploy/Caddyfile.example) (auto-TLS via
Caddy's built-in ACME client, no certbot/manual renewal). An equivalent
nginx config is below for nginx-based hosts.

### `trust proxy` and why the hop count matters

```js
// server/index.js
if (config.nodeEnv === 'production') {
    app.set('trust proxy', 1);
}
```

This tells Express "trust exactly one hop of `X-Forwarded-*` headers." Two
things downstream depend on that being *correct*, not just present:

- **Secure session cookies.** The session cookie is issued with `secure:
  config.nodeEnv === 'production'` (`server/index.js`) and `sameSite: 'lax'`.
  A `Secure` cookie is only sent by the browser over HTTPS, and Express only
  considers the request "HTTPS" when it trusts the proxy's
  `X-Forwarded-Proto: https` header. Get the trust-proxy setting wrong and
  either (a) the app never sees itself as HTTPS and no cookie is ever set —
  users can't stay logged in — or (b) with `trust proxy` misconfigured as a
  bare `true`, the app trusts `X-Forwarded-Proto` from *any* upstream hop,
  including ones an attacker could spoof if your edge doesn't strip
  client-supplied forwarded headers.
- **Rate-limit keying.** `express-rate-limit` and the per-tenant limiters
  (`server/middleware/tenant-rate-limit.js`) key off `req.ip`, which Express
  derives from `X-Forwarded-For` when `trust proxy` is set. If the hop count
  is *too low* (e.g. `1` but there are actually two proxies — your reverse
  proxy plus a CDN/load balancer in front of it), `req.ip` resolves to the
  IP of your own inner proxy, not the client — every request looks like it
  comes from the same address and the rate limiter either blocks everyone
  together or effectively does nothing. If it's *too high*, a client can
  forge extra `X-Forwarded-For` entries to spoof an IP the limiter will
  trust.

**Rule of thumb:** set the number to the exact count of proxies/load
balancers between the internet and this Node process. One reverse proxy
(Caddy or nginx) directly in front of the app = `1` (already the default
above). Add a CDN or another load balancer in front of *that* and you have
two hops — `app.set('trust proxy', 1)` would then be wrong and needs to
become `2`, or better, an explicit list of trusted proxy IPs (see the
[Express `trust proxy` docs](https://expressjs.com/en/guide/behind-proxies.html)
for the array/subnet form). This is a code change, not an env var — update
the literal `1` in `server/index.js` if your topology has more than one hop.

### HTTPS is required in production, not optional

Because of the `secure` cookie flag above, running `NODE_ENV=production`
**without** a TLS-terminating proxy in front of the app leaves the session
cookie unusable — the browser silently drops it on plain HTTP, and every
request looks logged-out. There is no supported HTTP-only production mode;
put Caddy, nginx, or your platform's managed TLS (Railway, Fly.io, etc.) in
front before flipping `NODE_ENV=production`.

### nginx equivalent

```nginx
# /etc/nginx/sites-available/github-repo-manager
server {
    listen 443 ssl http2;
    server_name your-domain.example.com;

    ssl_certificate     /etc/letsencrypt/live/your-domain.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.example.com/privkey.pem;

    # Single upstream — Express serves the SPA + /api/* from one port.
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;

        # These three headers are what `trust proxy` reads. Without them
        # (or with a proxy in front of nginx that doesn't chain them)
        # secure cookies and rate-limit keying both break — see above.
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # SSE endpoints (AI chat streaming: /api/ai/chat, /api/ai/pr-chat,
    # dev-toolkit; assisted-install: /api/env/tooling/*/install; migration
    # progress: /api/migration/stream/:id) send `Content-Type:
    # text/event-stream` and must reach the client as each chunk is
    # written, not batched. nginx buffers proxied responses by default,
    # which turns streaming into one delayed blob and defeats the
    # server's abort-on-client-disconnect handling. Disable buffering for
    # those paths (or globally — this app has no large non-streaming
    # response that benefits from proxy buffering):
    location ~ ^/api/(ai/|env/tooling/|migration/stream/) {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        # Long-lived AI generations should not be cut off mid-stream.
        proxy_read_timeout 300s;
    }
}

server {
    listen 80;
    server_name your-domain.example.com;
    return 301 https://$host$request_uri;
}
```

No WebSocket upgrade headers (`Upgrade`/`Connection: upgrade`) are needed
anywhere in this config — the app has no WebSocket endpoints. All
real-time delivery (AI chat, assisted-install progress) goes over plain
SSE on top of a normal HTTP response, which is why the buffering setting
above is the only special case; there's no `proxy_set_header Upgrade`
dance to get right.

---

## Release flow

Releases are cut from `main` as annotated tags. CI + Deploy workflows must be
green before and after the tag.

1. Confirm `main` is green: `gh run list --branch main --limit 3 --workflow CI`.
2. Update `CHANGELOG.md` with a new dated section under `[Unreleased]`
   (Keep-a-Changelog format). Move the Unreleased compare-link anchor.
3. Bump `package.json` `version` to match.
4. If the "What's new in v..." link in `README.md` points to the previous
   tag, refresh it.
5. Commit as `chore(release): vX.Y.Z` (no `Co-Authored-By` lines per
   [CLAUDE.md](../CLAUDE.md)).
6. Tag: `git tag vX.Y.Z && git push origin main vX.Y.Z`.
7. Watch CI: `gh run watch <id> --exit-status`.
8. GitHub Release notes are generated from the tag — attach the relevant
   `CHANGELOG.md` section.

**Do not force-push tags.** If a release is wrong, cut a `vX.Y.(Z+1)` patch.

Publishing the GitHub Release (step 8) is also what lights the "new version
available" banner in Settings → About for every self-hosted install that
hasn't disabled `UPDATE_CHECK` — the check reads the same public releases
API endpoint, so a tag pushed but not yet published as a Release doesn't
count.

---

## Backup & restore

SQLite (better-sqlite3) is the only supported database — there is no
PostgreSQL option. A `DATABASE_URL` that points at Postgres fails fast at
boot (see [`server/lib/db-adapter.js`](../server/lib/db-adapter.js)).

`server/data` is the default data directory — every path below assumes it.
If `DATA_DIR` is set (see [Runtime layout & bind](#runtime-layout--bind-v470)
above), the database, its WAL sidecars, and the default backups directory
all live under that path instead, and every command in this section shifts
accordingly (e.g. `<DATA_DIR>/manager.db` rather than `server/data/manager.db`).

The single SQLite file (`manager.db`) holds users, AES-GCM-encrypted
BYOK credentials and Azure PATs, migration plans/marks, audit logs and sessions.
The DB runs in **WAL mode**, so a naive `cp manager.db` produces an
*inconsistent* snapshot (recent pages live in the `-wal` sidecar). Use the
scheduled online backup instead — it is WAL-safe.

### Automatic backups

The daily maintenance pass (`server/lib/maintenance-janitors.js`) runs a
better-sqlite3 online backup (`db.backup()`) into `DB_BACKUP_DIR`:

| Env var | Default | Meaning |
| ------- | ------- | ------- |
| `DB_BACKUP_DIR` | `server/data/backups` | Where timestamped `manager-<ISO>.db` files are written. Absolute path recommended (point at a separate mounted volume). **Empty string disables backups.** |
| `DB_BACKUP_KEEP` | `7` | How many of the most-recent backups to retain; older ones are pruned. |

Backups are enabled by default. For a real disaster-recovery posture, set
`DB_BACKUP_DIR` to a path on a **different volume** than the live database, and
ship those files off-box (rsync/object storage) on your own schedule.

### Restore

1. **Stop the server** (`docker compose stop app`, or kill the node process).
   Never swap the DB file while the process holds it open.
2. Pick a backup from `DB_BACKUP_DIR` (newest that predates the incident).
3. Replace the live DB:

   ```bash
   cp /path/to/backups/manager-2026-07-05T02-00-00-000Z.db server/data/manager.db
   ```

4. **Delete the stale WAL sidecars** — they belong to the *old* database and
   would corrupt the restored one:

   ```bash
   rm -f server/data/manager.db-wal server/data/manager.db-shm
   ```

5. **Start the server.** It re-opens WAL mode cleanly and runs migrations.

> The backup files are full, self-contained SQLite databases — you can inspect
> one read-only before restoring: `sqlite3 manager-<ISO>.db ".tables"`.

### Scale expectations

SQLite is a single-writer, single-file database. It comfortably handles this
app's workload for a single-instance self-host (WAL mode allows concurrent
readers alongside the one writer), but two things follow directly from that:

- **No horizontal write scaling.** You cannot run multiple app instances
  against the same `manager.db` for write throughput — pick one instance as
  the writer, or scale vertically (more CPU/RAM/disk IOPS on that one box).
- **No built-in replication.** High availability means restoring from the
  most recent backup onto a standby, not automatic failover. Plan your
  `DB_BACKUP_DIR` retention and off-box shipping cadence accordingly (see
  above).

If you outgrow a single SQLite file (very large teams, multi-region writes),
that is a genuine re-architecture, not a config flag — there is no
"just set DATABASE_URL" escape hatch.

---

## Data & event retention

Three scheduled purges keep unbounded tables in check. All run from the daily
maintenance pass and log per-table counts.

| Data | Env var | Default | Notes |
| ---- | ------- | ------- | ----- |
| AI credential auto-deletion (G2) | `DATA_RETENTION_DAYS` | `365` | The 365-day promise users are emailed about. |
| GitHub event tables | `EVENT_RETENTION_DAYS` | `365` | `pr_events`, `issue_events`, `deployment_events`, `review_assignments`, `workflow_runs`. Deleted by creation timestamp, batched to avoid long write locks. `0`/empty disables. |
| `gh_cache` | `GH_CACHE_MAX_AGE_DAYS` | `30` | Cached GitHub responses. |

If you rely on `workflow_runs` / event history for long-horizon DORA stats,
raise `EVENT_RETENTION_DAYS` (or set it to `0` and prune manually) — the daily
purge is the only thing bounding those tables.

---

## Dead-letter queues (email + webhook)

Two sources of failed async work land in DLQs — both replayable.

- **Email DLQ** (`email_dead_letter` table). Populated by `server/lib/email.js`
  when Resend rejects terminally (4xx that isn't rate-limit) or the retry
  budget is exhausted. Each row carries the full payload and the last error.
- **Webhook DLQ** (`webhook_events_dead_letter` table). Populated by the
  signature-verified ingest path when handler logic throws after the event
  is already committed to the inbox.

### CLI

```bash
npm run admin:dlq -- --help                 # subcommands
npm run admin:dlq -- summary                # counts by source + resolved state
npm run admin:dlq -- list --source email    # list unresolved email entries
npm run admin:dlq -- retry --id 42          # re-invoke the original handler
npm run admin:dlq -- resolve --id 42        # soft-delete (keeps audit trace)

npm run admin:dlq:sweep                     # dry-run: hard-delete resolved > 30d
npm run admin:dlq:sweep -- --apply          # actually delete
```

All retry/resolve mutations are written to the SOC 2 CC7.2 audit chain
(`audit_log_v2`) under category `dlq.*`.

### UI

`/admin/dlq` — tabs for Email / Webhook, filter (All / Unresolved / Resolved),
per-row Retry + Resolve, side-panel detail with full payload. Chunk is
lazy-loaded (~4.5 KB gzip) and gated behind `requireAdmin` on the server and
`useIsAdmin()` on the client (fail-closed when `users.is_admin !== 1`).

### When to retry vs. resolve

| Symptom | Action |
| ------- | ------ |
| Resend was down, failed 5xx | Retry (provider came back) |
| Webhook handler threw on a transient upstream error | Retry |
| Payload has a permanent bad field (malformed event from a retired integration) | Resolve (document in the commit) |
| Duplicate of an already-processed event | Resolve |

If the retry throws again, the DLQ row updates with the new error — inspect
the stored error before retrying a third time.

---

## Health probes (`/live` vs `/ready`)

Two K8s-style probes live in [`server/routes/health.js`](../server/routes/health.js),
both unauthenticated and un-rate-limited (they fire before any session exists):

| Probe | Wire it to | Semantics |
| ----- | ---------- | --------- |
| `GET /api/health/live` | orchestrator **liveness** (restart-if-dead) | Returns `200 {status:'alive'}` immediately. Touches **no** dependency, so a degraded DB/Redis can't get the pod killed. Returns `503 {status:'shutting_down'}` once graceful shutdown starts, so traffic drains before the socket closes. |
| `GET /api/health/ready` | orchestrator **readiness** + LB + `/status` | Runs the DB (`SELECT 1`) and session-store checks (Redis `ping` if `REDIS_URL`, else a trivial SQLite check), each with a 100 ms budget. `200 {status:'ready',checks}` when all pass, `503 {status:'degraded',checks}` with a per-check map otherwise. |

The legacy shallow `GET /api/health` (version/uptime/DB connectivity) is
preserved for backward compatibility. Add or remove readiness checks in
`health.js`; keep each read-only and timeout-bounded.

## Public status page

`/status` is unauthenticated, renders from `src/components/PublicStatus/StatusPage.jsx`,
and polls `GET /api/health/ready` every 30 s. It ships in its own chunk
(~2 KB gzip) and is linked from the footer of every page.

- **Green pill** — all checks return `ok`.
- **Amber pill** — at least one check is `degraded`; the per-check table
  shows which. Typically GitHub-rate-limit or BYOK-provider degradation.
- **Red pill** — `/api/health/ready` returned 5xx or the endpoint is
  unreachable. The app itself is down — check your load balancer first.

The status indicator also appears in the header (`useSystemHealth`) for
logged-in users, with a popover listing the failing checks.

Add or remove checks in `server/routes/health.js`. Each check should be
read-only and timeout-bounded (default 2 s).

---

## Monitoring (Prometheus metrics)

`GET /metrics` exposes a Prometheus-format scrape endpoint — deliberately
mounted at the root (`/metrics`, not `/api/metrics`) so scrapers bypass the
CSRF / per-tenant rate-limit / tier-attachment middleware built for the app
API. It is **never exposed unauthenticated**: every request must satisfy one
of two gates (`server/middleware/metrics-auth.js`):

1. **Admin session** — same `requireAdmin` check (`users.is_admin = 1`) used
   everywhere else in the app.
2. **Static bearer token** — `Authorization: Bearer <METRICS_TOKEN>`, for
   unattended scrapers. Only active when the `METRICS_TOKEN` env var is set;
   compared with `crypto.timingSafeEqual`. Leave it unset to restrict the
   endpoint to admin sessions only.

### Enabling it

```bash
# .env
METRICS_TOKEN=<random 32+ byte value>
```

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Metrics exposed

| Metric | Type | Labels | Meaning |
| ------ | ---- | ------ | ------- |
| `http_request_duration_seconds` | Histogram | `method`, `route`, `status` | Request latency. `route` is the **normalized Express route path** (e.g. `/api/repos/:owner/:repo`), never the raw URL — this keeps label cardinality bounded regardless of how many distinct owner/repo/id values are requested. Unmatched routes (404s) report `route="unmatched"`. |
| `http_requests_in_flight` | Gauge | — | Requests currently being handled, across the whole process. |
| `process_*`, `nodejs_*` | Various | — | Standard Node.js process metrics from `prom-client`'s `collectDefaultMetrics()` (CPU, RSS/heap, event-loop lag, GC pauses, active handles, fd count). |

Instrumentation is mounted in `server/index.js` before routing, so every
request is counted — including ones that never match an `/api/` route. See
`server/lib/metrics.js`.

### Sample Prometheus scrape config

```yaml
scrape_configs:
  - job_name: github-repo-manager
    scheme: https
    metrics_path: /metrics
    authorization:
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ['your-host.example.com']
```

---

## Bundle budget

The enforced gate is the test **`tests/build/bundle-budget.test.js`**. It runs
its own `vite build --mode production` and is wired into CI
(`.github/workflows/ci.yml`), which invokes it explicitly:

```bash
RUN_BUILD_TESTS=1 npx vitest run tests/build/build-honesty.test.js tests/build/bundle-budget.test.js
```

Without `RUN_BUILD_TESTS=1` it self-skips, so it never slows down a normal
`npx vitest run`. It budgets the **eager** set rather than named chunks:

| Check | Budget (gzip) |
| ----- | ------------- |
| `index-*.js` entry chunk | 72 KB |
| Sum of every chunk statically imported by the entry | 365 KB |
| Any `esm-*.js` chunk eagerly imported by the entry | must not exceed 50 KB |

Budgets track current actuals and are a ratchet: lowering them is always fine,
raising them needs a deliberate, documented reason (the rationale for the
current numbers is in the test's header comment).

If it fails, run `npm run build:analyze` to open the
`rollup-plugin-visualizer` treemap and identify the regression. Common
causes: importing a new icon pack eagerly instead of behind `vendor-icons`,
inlining a markdown/shiki module that should be lazy-loaded, or a
non-tree-shaken util dragging a big transitive dep.

> **Lazy chunks are not budgeted.** The gate covers the eager set only.
> The largest lazy chunks (`vendor-diff` ~88 KB gz, `cytoscape` ~138 KB gz,
> `MigrationWizard` ~54 KB gz) are unguarded, so a regression inside one of
> them will not fail CI. They are lazy by construction — check them by hand
> with `npm run build:analyze` when touching the diff viewer, the diagram
> renderer, or the migration wizard.

---

## Audit trail

Every privileged mutation (admin actions, DLQ retries, license operations,
migration state changes) lands in `audit_log_v2` as a SOC 2 CC7.2
hash-chained event:

- Each row stores `actor_id`, `category`, `action`, `payload` (JSON), and a
  `prev_hash` + `this_hash` linking the row to the previous one.
- A chain break (mismatched `this_hash`) indicates tampering — chain
  integrity can be verified with `npm run audit:verify` (wraps
  `server/scripts/verify-audit-chain.mjs`).
- Rows are append-only; there is no API surface that updates or deletes
  audit entries.

---

## Admin access

Administrative endpoints require `users.is_admin = 1`. This is intentionally
distinct from subscription tier (`pro`, `enterprise`) — paying customers
are not operators.

```bash
npm run admin:grant -- --login <github-login>
npm run admin:revoke -- --login <github-login>
```

Granting admin is audit-logged. The flag is read on every request
(`requireAdmin` queries the users table, not the session), so revocation
takes effect immediately.

---

## Common incidents

### "All tabs in RepoDetail show a spinner forever"

Fixed in v3.7.1 — `useRepoDetail` returned a non-memoised object, so
`useTabData`'s `[api, filter]` deps caused an abort-retry loop. If a similar
symptom appears elsewhere, check that any hook returning multiple callbacks
wraps the return in `useMemo` with all callback refs as deps.

### `dev:server` exits with `Port is already in use` (local dev only)

Pattern: `npm run dev:all` fails with `FATAL: Port is already in use` on
3001, or Vite reports `Port 5173 is in use, trying another one...` and
cascades to 5174 / 5175. A previous dev run left a node process bound to
the port — common after a hung Ctrl+C, a crashed terminal, or a switch
between machines without clean shutdown.

```bash
npm run dev:kill   # cross-platform: 3001 + 5173–5180
npm run dev:all    # re-run
```

The script (`scripts/kill-dev-ports.js`) uses `netstat`+`taskkill` on
Windows and `lsof`+`kill` elsewhere; it only kills processes in `LISTEN`
state on the dev ports, so it's safe to run any time. Manual fallback is
documented in the README troubleshooting section.

### CSRF 403 on every mutation after a deployment

Symptoms: every POST/PATCH/PUT/DELETE returns 403 `csrf_invalid` right
after a deploy. The session cookie from the old process encodes a CSRF
token that the new process rejects because `SESSION_SECRET` rotated.

- Short-term: users re-login, or the client retries once after fetching
  `GET /api/auth/csrf-token`.
- `fetchWithRetry` already implements the auto-retry (`src/utils/api.js`).

### Stripe webhook retries duplicating licenses

Fixed in v3.6.0 (B2). If it reappears: confirm the webhook handler still
uses a synchronous better-sqlite3 transaction + explicit
`forgetIdempotency()` on async failure. Do **not** wrap the idempotency
write in an async callback.

### GitHub API circuit breaker open

Pattern: every GitHub-backed endpoint suddenly returns 503 with
`breaker_open`. The client tripped after 5 failures in 60 s and will stay
open for 30 s. Usually GitHub was briefly degraded — wait it out. If it
doesn't recover, check the logs for the underlying status code.

### DLQ filling up

Check the status page first — if email / webhook providers are degraded,
expect DLQ growth. Once recovered: `npm run admin:dlq -- summary` to size
the backlog, then `admin:dlq -- list` + `retry` in batches. For a large
backlog, script the retry loop against the CLI output (stable flags).

After the incident, run `npm run admin:dlq:sweep` to hard-delete resolved
rows older than the retention window.
