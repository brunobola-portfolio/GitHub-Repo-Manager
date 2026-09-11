# DORA, Sentry for SaaS, the site's screens, the VPS and e-mail — review

Date: 2026-09-11. Scope: GitHub Repo Manager (this repository, shipped as
4.25.0), the BolaLabs site (`BolaLabs/MainSite`, shipped as 1.5.0 and 1.5.1),
the production VPS that serves both, e-mail in both, and the Claude
artifacts published so far. Everything below was measured, not assumed:
unit and e2e suites, the site built and screenshotted at 390, 1440 and
1920 px in both themes, an outside-in audit of both hosts, and the VPS read
through the `ops-iis.yml` workflow (which never prints a secret).

## 1. DORA

**What it is.** DORA is DevOps Research and Assessment, the Google Cloud
research programme behind the *State of DevOps* reports. Its metrics are the
best-studied predictors of software delivery performance. dora.dev now lists
five: deployment frequency, change lead time, failed deployment recovery
time (formerly MTTR), change fail rate and deployment rework rate.

**What was wrong.**

| Finding | Effect |
| --- | --- |
| The acronym was never defined — not in the app, the docs or the site | A buyer or a new user could not tell what the tab measures |
| "Lead time" measured PR opened → merged | That is PR cycle time; DORA's change lead time ends when the change is running in production |
| "MTTR" | DORA renamed it failed deployment recovery time |
| Environment hard-coded to `production` | A team deploying to `prod` or `live` saw an empty tab |

**What shipped in 4.25.0.** Change lead time now runs from the PR being
opened (the earliest point a webhook shows) to the first successful
deployment of that repository after the merge. When nothing was deployed it
shows **PR cycle time** under that name, never under the DORA name. The tab
opens with a one-paragraph definition; each KPI has a definition control
with DORA's wording and how the figure is computed from GitHub; an
environment picker lists every environment that deployed in the last 30
days. `docs/work-board.md` has a "What DORA measures" table, including why
rework rate is not computed (GitHub has no incident signal). README, the
pricing table and the CSV export use the current names. Mutation-tested:
forcing the old basis turns the new test red.

## 2. Sentry in a SaaS deployment

**What the VPS had.** `SENTRY_DSN` set (organisation `o122775`, US region,
project `4512036544380928` — not in the `trigenius` organisation this
session can read), no browser DSN.

**What was wrong, in order of impact.**

1. **Handled server errors never reached Sentry.** Every route catches its
   exception and answers 500 through `safeError()`; only a throw that escaped
   every route was ever reported. In practice Sentry saw almost nothing.
2. **Browser reporting could not work.** The production CSP allows
   `connect-src 'self'` only, so events to `*.ingest.sentry.io` would have
   been blocked; and the DSN was a build-time variable baked into one bundle.
3. **No tenant-safe user context.** The server initialises Sentry in-process
   (not via `node --import`), so Sentry's per-request isolation is absent;
   `setUser()` would have attributed one tenant's error to the next request.
4. No data scrubbing, no release, no environment override.

**What shipped in 4.25.0.**

- `safeError()` reports every handled 5xx (4xx-class are skipped — a GitHub
  404 is not a fault) with the request id, the route and a pseudonymous user
  id (SHA-256 of the user id with the session secret) attached **per event**.
- Browser DSN is runtime configuration: `SENTRY_BROWSER_DSN` goes into a meta
  tag in the shell, the SDK is loaded only when it exists, and events go
  through `/api/monitoring/tunnel` on the app's own origin, which forwards
  only envelopes addressed to the configured project (tested; the host check
  is mutation-tested). CSP unchanged; ad blockers do not drop it.
- Credentials, cookies, request bodies and OAuth `code`/`state` stripped on
  both sides; `release: github-repo-manager@<version>`; `SENTRY_ENVIRONMENT`;
  `deployment_mode` tag; tracing off unless `SENTRY_TRACES_SAMPLE_RATE`.
- Bundle: the first attempt shipped the SDK to every visitor (index chunk 62
  → 86 KB gzipped, caught by the budget gate); the SDK is now loaded on demand.
- Verified on the VPS: `ops-iis.yml` → `sentry-test` sent event
  `3cd5412ad74f4411b67b9bf070e46174` with the service's own DSN — delivered.

**Still to do (owner).** In the Sentry organisation that owns project
`4512036544380928`: turn on *Data Scrubbing* and *Prevent Storing of IP
Addresses*, add an alert rule for new issues, and add a browser project (or
reuse the same) and put its DSN in `SENTRY_BROWSER_DSN` on the VPS. Optional:
source-map upload in the release job with a `SENTRY_AUTH_TOKEN` secret, so
browser stack traces are readable.

## 3. The site's product screens

**Diagnosis at 1440 px.** Dark captures hung under a white window bar; the
gallery was a wall of fifteen equal tiles stretched from 400 px JPEG
thumbnails (soft on any retina screen); AITOOL used a second component with
an orphan tile; the lightbox opened a 1920 px capture at 896 px.

**What shipped in 1.5.0.** One component, `ProductShot`, for every product
screen on the site: the same dark application window on both themes (three
dots, the screen's name), layered depth, a few degrees of tilt and a
pointer-following highlight on precise pointers (still on touch and with
reduced motion), and a zoom control that opens the lightbox. `Screenshot`
keeps its API on top of it; the hero film uses the same frame. The gallery
(`Showcase`) is a mosaic — featured 2×2 and tall 1×2 tiles that close with no
gaps — with AVIF/WebP widths matched to each tile, captions on the featured
tiles and on hover for the rest, and a snap carousel with position dots on
phones. The lightbox opens at up to 1520 px in the same window style. Applied
to Home, RepoManager, Community Platform and AITOOL.

## 4. The VPS

| Host | Check | Before | Now |
| --- | --- | --- | --- |
| bolalabs.pt | `http://` → | `http://bolalabs.pt/pt/` then https (two hops, first in clear text) | straight to `https://` (1.5.1) |
| bolalabs.pt | `Server` header | `Microsoft-IIS/10.0` | removed (1.5.1) |
| bolalabs.pt | hashed assets | `max-age=31536000` | `+ immutable` (1.5.1) |
| bolalabs.pt | hero film | `no-cache` | one day (1.5.1) |
| repomanager | unknown path | 200 with the shell (soft 404) | 404 with the shell; `/`, `/status`, `/settings`, `/pricing` stay 200 (4.25.0) |
| repomanager | `X-Powered-By` | `ARR/3.0` | blank (`ops-iis.yml` → `harden`; the rule ships in `deploy/iis/web.config`) |
| both | TLS 1.3, HTTP/2, HSTS, CSP, nosniff, Referrer/Permissions-Policy, robots, sitemap, www → apex | pass | pass |

Resend and the browser DSN are written by `ops-iis.yml` →
`configure-integrations` from GitHub secrets and variables (backup, health
check, rollback). Still open, low priority: gzip rather than Brotli on
bolalabs.pt (IIS needs the Brotli module). Certificates renew
automatically; the first renewal window opens 2026-10-06 — look at
`renew.log` on 2026-10-07.

## 5. E-mail (Resend)

| Where | State | Effect |
| --- | --- | --- |
| Repo Manager (VPS `.env`) | `EMAIL_PROVIDER=console`, `ALLOW_CONSOLE_EMAIL=true`, `EMAIL_FROM=no-reply@example.pt` | Licence keys, retention notices and digests are written to the log, never delivered. `ALLOW_CONSOLE_EMAIL` is documented for single-user installs only |
| Site (Convex prod) | `email:emailVerificationStatus` → `{"enabled":false}` | The client-portal login link is never sent, so portal sign-in cannot complete. The contact form stores messages in the database and notifies no one |

One Resend account covers both: verify `bolalabs.pt` (DKIM, return-path
CNAME, SPF include), create one API key, then

```text
# Site (from the repo, no redeploy needed)
npx convex env set RESEND_API_KEY "re_..." --prod

# Repo Manager (on the VPS, C:\ProgramData\GitHubRepoManager\data\.env)
EMAIL_PROVIDER=resend
RESEND_API_KEY=re_...
EMAIL_FROM=no-reply@bolalabs.pt
# delete the ALLOW_CONSOLE_EMAIL line, then: nssm restart GitHubRepoManager
```

Then run `ops-iis.yml` → `env-check` to confirm, and sign in to the site's
client portal with your own address: the link arriving proves both halves.

## 6. Artifacts

| Artifact | Date | State |
| --- | --- | --- |
| RepoManager Launch Guide | 09-06 → updated today | Current: the plan and everything shipped |
| BolaLabs Release Runbook | 08-31 | Valid procedure; its open items are now closed except Resend (§5) |
| Repo Manager Launch Board | 08-28 | Historical — describes the pre-install server |
| BolaLabs IIS Deploy Board | 08-29 | Historical — superseded by the runbook |
| BolaLabs Social Launch | 08-24 | Historical — site v1.0.2, RM 4.22; superseded by the launch guide |
| GitHub Repo Manager — Launch Pack v4.7.0 | 07-20 | Historical |
| Alinhamento de Lançamento SaaS | 08-14 | Historical (licence decision taken since: Apache-2.0) |
| RepoManager brand & media kit, six marks | 08-09 | Reference; the brand in `brand/` is the source of truth |
| AITOOL (10), VOA (3, one v3 plan duplicated 08-11/08-14), ARCVA (2), BetterDesk (2), Primavera SQL (1), site direction studies (5) | — | Other projects; not assessed here |

## 7. Also closed

- Dependabot: vitest security update merged; js-yaml (high, dev-only)
  rebasing. `adm-zip` (medium, runtime, no fixed version): used only to
  extract the TFVC download into a fresh temporary directory, where the
  advisory's precondition (a symlink already at the destination) cannot
  exist — tolerable until a fix ships.

## 8. What I would do next, in order

1. Resend (§5) — the one thing that makes both products fully functional.
2. Sentry project settings and `SENTRY_BROWSER_DSN` (§2).
3. Stripe keys when Pro is to be sold (`STRIPE_*` unset; the site already
   says "Request a demo" for Pro, so nothing is broken meanwhile).
4. The two low-priority VPS items (§4) and the 2026-10-07 renewal check.
