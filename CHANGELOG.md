# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [4.20.0] - 2026-08-17

### Security

- **Work Board aggregations were unscoped across tenants.** The webhook event
  tables carry no `user_id` — one ingest writes every customer's events into
  one pool keyed on repo — and `repoIdsFilter` took a single *optional,
  client-supplied* `repoIds`, returning an empty clause when it was absent.
  That is the default call. So `/stale-prs`, `/review-load`, `/tech-debt` and
  the four DORA metrics returned every tenant's private repo names, PR titles,
  issue titles and reviewer logins to any authenticated user on any tier, and
  the Work Board AI fact sheet put them into that user's prompt.

  The boundary now lives in `repoIdsFilter`: `scopeRepoIds` is mandatory and
  derived from the session user's tracked repos, the client's `repoIds` can
  only intersect it, an empty scope produces `AND 0` rather than no clause,
  and a caller that forgets it gets a `TypeError` naming the boundary instead
  of a silent full-table read. Threaded through 19 call sites.

- **An API key could permanently rewrite the browser session.**
  `apiKeyAuth` assigned `req.session.userId` on the real express-session
  object; with `resave:false` the store persists it. One GET with a read-only
  key rewrote the caller's cookie session to another identity — and on every
  later cookie-only request `req.apiKeyId` was undefined, so `requireScope`'s
  session waiver applied and the key's scope limits were gone. Revoking the
  key did not help: revocation is only checked on requests carrying it.
  Mixed-identity requests are now refused, and the identity is written to a
  request-scoped object rather than the store's.

- **Encoded path traversal in the Contents routes.** The guard compared each
  segment to the literal `..`; Express decodes once, so `%252e%252e` arrived
  as `%2e%2e` and passed, and the URL parser inside fetch collapsed it —
  turning `/repos/o/r/contents/%2e%2e/%2e%2e/%2e%2e/user/repos` into
  `/repos/user/repos`, reached with the caller's OAuth token (scopes include
  `delete_repo` and `admin:org`) on GET, PUT **and** DELETE. Segments are now
  decoded to a fixed point before comparison, and encoded per segment at all
  three sinks.

- **An instance licence upgraded every tenant.** `getUserTier` used the userId
  only for the Stripe lookup, then returned the module-global licence tier to
  any caller — including anonymous requests, since `attachTier` runs on all of
  them. Correct for self-hosting, wrong the moment billing is on. The instance
  licence is now gated on `DEPLOYMENT_MODE` (default `self-host`, so nothing
  changes for existing installs) and never applies to an anonymous caller.

### Fixed

- **The upgrade section of the IIS guide was unusable.** Four commands carried
  a BEL control character where `C:\apps` should be — a `\a` escape written
  literally — so every copy-paste failed with `AppRoot does not exist:
  C:pps\GitHubRepoManager`. Same corruption class fixed in
  `production.env.example`.

- **No distributed artifact carried the licence.** The Docker image, the
  Windows ZIP and the installer all omitted `LICENSE` and `NOTICE`, so a
  downstream redistributor could not comply with Apache-2.0 §4(a)/§4(d) from
  what they were given. The installer now shows the terms, and the package
  carries `LICENSE`, `NOTICE` and `TRADEMARKS.md`.

- **`deploy.ps1` deleted its own tooling on the first upgrade.** It empties
  `AppRoot` and repopulates from the release zip, which did not contain
  `deploy/` — so the rollback command it prints on the way out pointed at a
  file it had just removed, and the documented secret-rotation tool went with
  it. The package now carries both.

- **The licence sweep was incomplete.** The visible ones mattered most: the
  app footer read "Source code (AGPL v3)" on every view, the landing page
  labelled the Apache text "AGPL v3", and the pricing FAQ told buyers the app
  was "self-hostable under AGPL". Also corrected: the winget manifest, the CLA
  bot's comment to first-time contributors, `.env.example`'s §13 instructions,
  seven `packaging/windows` headers, `CLA.md` and `CONTRIBUTING.md`'s
  "dual-license model", and the repository's own `agpl` topic.

- **`production.env.example` was missing the two variables that stand between
  a public launch and an open-ended bill** — `AI_SPEND_CAP_CENTS_*` and
  `AI_REQUIRE_USER_CONFIG`. The per-user quotas are counts, not money.

## [4.19.0] - 2026-08-15

### Changed

- **The licence is now Apache-2.0.** It was AGPL-3.0-only, with a commercial
  licence sold as an exemption from copyleft. Apache-2.0 has no copyleft, so
  there is nothing left to exempt and nothing of the sort is sold: run it,
  modify it, embed it in a proprietary product, redistribute it — no
  permission, no fee.

  What money buys is unchanged, because it never described legal permissions:
  headroom, a hosted instance, support with a response commitment, compliance
  deliverables. `docs/LICENSE-COMMERCIAL.md` is now a **subscription
  agreement** and opens by saying, in as many words, that nothing on it is
  required to use the software.

  **The name and the mark are reserved** — Apache-2.0 §6, spelled out in the
  new [`TRADEMARKS.md`](TRADEMARKS.md): fork freely, rename the fork. A
  `NOTICE` file ships alongside, which §4(d) gives meaning to.

  The relicence touched 213 source headers, the manifest, eight live
  documents and the provenance endpoint, and it is gated:
  `tests/build/license-consistency.test.js` fails if the LICENSE text is
  truncated, if any header still says AGPL, if a document claims a copyleft
  obligation that no longer exists, or if anything links a reader at
  `bolalabs.pt/license`, which 404s. Historical plans and specs are exempt on
  purpose — they record what was true when they were written.

  `GET /api/system/source` stays. Under AGPL it discharged §13; now it is a
  courtesy, and reports `Apache-2.0`.

### Added

- **`deploy/iis/deploy.ps1` — a server deploy that can undo itself.** The
  documented upgrade was `git checkout; npm ci; npm run build` on the
  production box: a clone, a toolchain and a network build, with no backup and
  no way back. The new script consumes the immutable artifact CI already
  builds and smoke-tests (`github-repo-manager-<version>-win-x64.zip`) and
  never rebuilds anything on the server.

  Eight ordered guarantees, none running before the previous is confirmed:
  package validated → free disk → backup with the file count verified →
  service stopped → content swapped → service started → **health checked
  against the version just installed** → automatic rollback if it is not.

  That seventh step is the one that matters: a check that only asks "are you
  alive?" passes when the *old* build is still running. `-FromRelease latest`
  verifies the download against the published SHA-256 and refuses an artifact
  whose file name disagrees with its own `package.json`. `-DryRun` and
  `-ListBackups` need no elevation, so you can look before you commit.

### Removed

- **`.github/workflows/deploy.yml`.** It was named "Build Verify" and
  contained deploy jobs for Railway and Vercel, behind a variable nobody ever
  set, next to a real IIS server. Its one surviving job existed only to gate
  those two. `ci.yml` is what actually runs; the README badge now points
  there.

- **`preload` from the HSTS header.** The preload list only accepts apex
  domains and this app is served from a subdomain whose apex sends a bare
  `max-age` — the directive could never be honoured. `includeSubDomains` and
  the two-year max-age stay.

## [4.18.1] - 2026-08-10

### Changed

- **The solid brand surface is one decision, not two.** Primary buttons and
  selected chips set a fill in one class and its text colour in another, so a
  theme override of the fill left the wrong foreground behind — and on the dark
  canvas the deep green read as a dull olive slab, which is the first thing
  anyone noticed about the selected chip. `.ds-brand-solid` now owns both
  halves: deep green under white in light (5.06:1), the **lime under ink** in
  dark (8.43:1), which is also the only way the spec lets the lime carry text.
  Declared in `@layer components` so it beats Preflight's `button {
  background-color: transparent }` and still loses to a caller's `bg-*`.

- **Screenshots in the docs show the product as it is now.** Thirteen of them —
  dashboard, repositories, work board, teams, the Live Inbox and the command
  palette, both themes plus mobile — were captured before the brand was
  applied and still showed the violet UI.

### Fixed

- **The floating assistant no longer covers the footer.** It is fixed, the
  footer is not, so at the end of a page they wanted the same pixels and the
  button won — it sat on top of "Status" and "Commercial license".
  `--ds-fab-safe-bottom` reserves its footprint at the end of the document, so
  it comes to rest in empty space. Measured at six widths from 390 to 1920:
  seven overlaps before, zero after.

- **Idle is quieter, not dimmer.** The assistant faded to 60% opacity when
  idle, which on a dark canvas reads as unfinished and took its label under AA
  on the way down. It keeps full contrast and gives back width instead: a
  circular mark that grows into the labelled pill on hover or focus.

## [4.18.0] - 2026-08-10

### Changed

- **The brand is applied, not just documented.** The product carried a violet
  identity while `brand/` held a lime mark: the app drew its own logo by hand
  (four gradients, three blurs, a different silhouette from every file in the
  kit), the nav used GitHub's Octocat as the product icon, and indigo, violet
  and purple were used interchangeably for the same job.

  - The mark the app renders is now GENERATED from the same geometry as the
    kit — `scripts/gen-brand.mjs` emits `src/components/ui/BrandMark.jsx`,
    which picks its own optical cut from the requested size. The header and the
    landing nav show the real tile: the mark on its own ground, the same
    artwork a user sees pinned to a taskbar.
  - **One accent ramp**, `brand-*`, replaces indigo / violet / purple /
    fuchsia / sky / cyan / pink / teal across ~1,650 call sites. Every step is
    luminance-matched to the Tailwind indigo step it replaced, to within 0.003,
    which is what let them all move without re-checking a pairing. Two steps
    are anchored to the literals `docs/BRAND.md` names: 300 is `#8fd23f`, 600
    is `#3f7d12`.
  - **The affirmative-action green is the brand's.** `--ds-cta` was GitHub's
    `#1f883d` — a palette borrow the brand spec forbids, and a second green two
    hues from the first on the same screen. White on it reads 5.06:1 now, up
    from 4.52.
  - **Decoration by hue is gone.** The dashboard tiles were purple / amber /
    emerald / indigo for variety, and the count inherited the tone — "Issues
    for you: 3" rendered in the product's own colour for a passing check.
    Counts are foreground; only genuinely-overdue work keeps a warning tone.
    `emerald` / `amber` / `rose` / `slate` stay where they mean something, and
    the per-language chart colours are categorical data, exempt.

### Fixed

- **Cards in a grid row are the same height at every width.** The grid
  stretched each motion wrapper, but the `Card` inside sized to its own
  content, so one card whose hint wrapped to a second line left its neighbours
  floating. At 1024px the two dashboard charts differed by 312px. Audited at
  six widths from 390 to 1920; the row-height spread is now zero at all of
  them.
- **White on a brand fill is no longer dimmed.** `text-white/90` measures
  4.43:1 on the brand green — it read as harmless softening under indigo, where
  the base was 6.29 and had the headroom to absorb it. The axe gate caught it
  on the repositories view in both themes.

## [4.17.0] - 2026-08-10

### Security

- **Every GitHub request is pinned to `api.github.com`.** `githubApi()`
  accepted any string starting with `http` verbatim and sent the user's OAuth
  token to it. It now resolves through `resolveGitHubUrl()`, which roots
  relative paths and accepts an absolute URL only when its origin is exactly
  `https://api.github.com` — suffix confusion (`api.github.com.evil`), a
  plaintext downgrade and a protocol-relative `//host` are all rejected.

- **`full_name` is validated, not just split.** `parseRepoFullName()` kept
  whatever followed the first slash, so `octocat/a/../../users/victim` produced
  a repo segment carrying its own path separators — and every caller
  interpolates that into `/repos/${owner}/${repo}/…`. Both halves are now
  checked against one definition of a legal GitHub name
  (`server/lib/github-names.js`), shared with the route-level `router.param`
  guards that used to hold a second copy of the same rules.

- **Inbound webhooks have a ceiling.** The Stripe, Actions and GitHub-events
  endpoints mount before session and before the global limiter — necessarily,
  since they need the raw body for HMAC — which left them the one
  unauthenticated write path with no limit at all. They now share a per-IP
  limiter placed ahead of the body parser, so a flood is rejected before it is
  parsed. 1000 per 5 minutes is far above any real sender, and senders retry
  on a 429.

- **Smaller ones, each real:** the SVG sanitizer, the README normaliser and
  the Azure work-item converter now strip to a fixed point instead of in one
  pass; `htmlToText` decoded `&amp;` first and turned `&amp;lt;` into `<`; the
  DevToolkit's copy-paste `git commit -m "…"` escaped the quote but not the
  backslash (and now also defuses `$` and backtick); the markdown tables
  published to PRs had the same bug; the outbox idempotency nonce used
  `Math.random()`; the credential-scrubbing regex was quadratic on long input;
  `buildPatSettingsUrl` fed an operator-typed host straight into an `href`;
  `generate-keys` checked for an existing private key before writing it rather
  than letting an exclusive create be the guard; and the credential scrub in
  `sanitizeOutput` was quadratic — 200 KB of adversarial input took 36 seconds
  and now takes 24 ms.

  Dependabot #14 (`brace-expansion`, dev-only, via eslint's `minimatch@3`) is
  pinned by an override. The 48 remaining CodeQL alerts were reviewed one by
  one and dismissed with a written reason — 31 in test fixtures, 17 false
  positives where the query cannot see an Express `router.param` guard, an
  environment-dependent cookie flag, or a checksum verified after download.

## [4.16.0] - 2026-08-10

### Added

- **The brand guide is now a real destination, not a file in a clone.** Every
  deployment serves it at **`/brand`** — the marks at true pixel sizes on both
  grounds, the palette, the type, and the whole kit as one download. Vite
  copies `brand/` into `dist/` at build time and the route is registered ahead
  of the SPA fallback, so there is no separate hosting to maintain. Settings →
  About links to it in-app, and the page carries OG/Twitter cards so a shared
  link previews correctly.

- **A media kit you can hand to someone.**
  [`brand/repomanager-media-kit.zip`](brand/repomanager-media-kit.zip) — every
  mark, both optical cuts, the three OS tiles, the `.ico`, the rasters, the
  fonts with their OFL licence, `BRAND.md`, and a plain `README.txt` carrying
  the two rules that matter most (below 25 px use the small cut; the lime is
  fill only and never means "healthy"), the palette, the type and the
  trademark notice. Built by `scripts/gen-brand-kit.mjs` from whatever the
  generators produced, so it can never contain a mark they did not make.
  `npm run gen:brand` now emits it alongside the assets, and it is
  byte-reproducible: entry timestamps are pinned, so regenerating it does not
  churn 220 KB of binary in the diff.

### Fixed

- **The download button vanished in dark mode.** The only action on the brand
  page filled itself with the tile ground `#020617` and sat on a `#0B0F19`
  page. It now inverts ink-on-paper against whichever ground is active, rather
  than taking the lime — a page arguing that the lime is spent on one element
  should not break that rule in its first screenful. The near-black `Ground`
  swatch gained an inset hairline for the same reason.

## [4.15.0] - 2026-08-09

### Added

- **A visual brand guide in the repository** — [`brand/index.html`](brand/index.html).
  It shows the marks at true pixel sizes on a fixed light ground and a fixed
  dark one, the palette, the type in the real faces, the three OS tiles and
  every file in the kit. Open it straight from a clone: it is self-contained,
  needs no server, and carries Archivo, IBM Plex Sans and JetBrains Mono under
  SIL OFL-1.1 (`brand/fonts/`, licence included).

  It is **generated** by `scripts/gen-brand-page.mjs` from the same constants
  as the assets — it embeds the very SVG strings `gen-brand.mjs` emits and
  reads its colours from the same `COLOR` object. A hand-kept HTML guide would
  be a second source of truth and would drift from the assets it documents,
  which is the failure mode this repository has spent considerable effort
  removing elsewhere. `npm run gen:brand:check` now covers it, and the test
  gate fails if the page, the fonts or the licence go missing.

  `docs/BRAND.md` stays the written spec — the rules and the reasoning. The
  page is the visual counterpart, doing the one thing prose cannot: showing
  the marks at 16 px.


## [4.14.1] - 2026-08-09

Consistency pass. No product change.

### Fixed

- **The brand gate failed on a Windows checkout.** `.gitattributes` normalised
  `.js`/`.json`/`.yml` to LF but said nothing about `.svg`, so a clone with
  `core.autocrlf=true` materialised the twelve generated marks as CRLF while the
  generator writes LF — twelve failures on a developer machine, green on the
  Linux runner, for a difference no renderer can see. SVGs are now pinned to LF,
  binary assets are marked explicitly so a stray `text=auto` cannot corrupt an
  icon, and both the gate and `gen:brand:check` normalise line endings so a
  pre-existing clone reports real drift rather than false alarms.
- Stale claims corrected: the README's "what's new" link still pointed at
  v4.13, its test badge and tech table said 6,000+ (the suite is 7,099),
  AGENTS.md said ~5,900, `docs/index.md` said "the 4 latest" above five
  entries, and a CI comment quoted a long-dead 6,769-test count.


## [4.14.0] - 2026-08-09

A brand system, generated from one file.

### Added

- **`docs/BRAND.md`** — the mark, the two optical cuts, the inherited palette
  and typography, the per-OS tile specs, and what breaks it.
- **`npm run gen:brand`** — `scripts/gen-brand.mjs` holds the geometry as
  constants and emits all twelve SVGs; `scripts/gen-brand-raster.mjs` renders
  the PNGs and assembles the Windows `.ico` container itself, so each slot gets
  the optically correct cut. `npm run gen:brand:check` runs in CI and fails if a
  checked-in asset was edited by hand.
- **`tests/build/brand-assets.test.js`** — 43 assertions covering generator
  drift, missing rasters, filters creeping back into the marks, the mono file
  staying single-colour, and the `.ico` keeping all six slots.

### Changed

- **The logo is replaced.** The previous mark carried four gradients on its
  connector lines alone, three Gaussian blurs, an orbital ring, a halo per node
  and six sparkles at 1–2 px — 8 KB of SVG whose central glyph was 24 units in a
  512 viewBox, so it vanished below about 128 px. Every filter was dropped when
  it was converted to `.ico`, and in a browser tab it read as a violet square.

  The new mark is a commit rail with one node lifted off it: git's own
  vocabulary, saying the one thing the product does. It ships in two optical
  cuts — below about 24 px the ring closes into a smudge, so the small cut drops
  it, grows the node and thickens the strokes.
- **Colour and typography are inherited, not re-picked.** The official BolaLabs
  lime `#7fc528`, Archivo / IBM Plex Sans / JetBrains Mono, and the house rule
  that the lime is fill-only and never text.
- **The installer ships the product icon.** It used to ship `bolalabs.ico` — the
  *company* flask — as the application icon. The flask is BolaLabs; the rail is
  RepoManager. `packaging/windows/assets/repomanager.ico` replaces it.
- The social card and `apple-touch-icon` are now real brand assets rather than a
  cropped dashboard screenshot.

### Fixed

- **`.gitignore` would have dropped every brand raster.** The blanket `*.png`
  rule had exceptions only for `docs/images/`, so the favicon, apple-touch icon
  and social card would have been silently untracked — the site would have
  shipped the browser's default icon.


## [4.13.1] - 2026-08-09

Dependency maintenance only — no product change. Seven Dependabot updates,
merged after the 4.13.0 release and validated as a batch.

### Changed

- **Dependencies** — `better-sqlite3` 13.0.1 → 13.0.3, `stripe` 22.3.2 →
  22.4.0, `jose` 6.2.4 → 6.2.8, `pino` 10.3.1 → 10.4.0, `lucide-react` 1.27.0
  → 1.28.0, `mermaid` 11.16.0 → 11.16.1, `dompurify` 3.4.12 → 3.4.13,
  `ip-address` 10.2.0 → 10.4.0, both Sentry SDKs 10.68.0 → 10.69.0, plus the
  dev-tooling group and `actions/download-artifact` 7 → 8.

  `better-sqlite3` still builds against `NAPI_VERSION=10` and still ships
  ABI-independent prebuilds, so nothing about the Node 22.14/24 story changes;
  the `compat (node 22 floor)` job exercises `check:native` on the floor to
  keep that honest.


## [4.13.0] - 2026-08-09

Production hardening for the first public deployment, and the review panel that
found what the first pass missed. Nothing here adds a feature; several things
stop being silently wrong in production, and a security review of the new
surface caught two issues in the licence-minting path.

### Changed

- **Node 24 LTS is now the target runtime.** `engines` moves from `>=22 <23` to
  `>=22.14 <25` — 22.14 because better-sqlite3 builds against `NAPI_VERSION=10`,
  which does not exist before it — so both current LTS lines are supported and a host already
  running Node 24 for something else does not need a second runtime. CI, the
  Dockerfile and the bundled Windows runtime (24.19.0) all move to 24; a new
  `compat (node 22 floor)` job installs clean and runs the runtime-sensitive
  suites on 22, so the lower bound is tested rather than asserted. No
  recompilation is involved: better-sqlite3 13 builds against
  `NAPI_VERSION=10` and ships ABI-independent prebuilds, which is also why one
  lockfile serves both majors and why no C++ toolchain is needed on a
  deployment host. Three comments claiming the opposite ("compiled per ABI")
  were corrected.

### Accessibility

- **99 muted-text tokens failed WCAG AA in both themes.** `text-slate-400
  dark:text-slate-500` measures 2.56:1 on white and 3.74:1 on slate-900; the
  correct pairing is the inverse. Five of them sit in views the axe e2e suite
  already scans, so they were live failures rather than latent ones. The same
  inverted pair is *correct* for icons (3:1 applies), and 41 of those were left
  untouched — including two byte-identical adjacent lines in `CredCard.jsx`
  where a global replace would have broken the icon while fixing the text.
- Four hardcoded easing strings replaced with the `EASE` vocabulary from
  `src/components/ui/motion.js`.

### Added

- **IIS deployment guide and artefacts** for publishing on a public domain from
  Windows Server: [`docs/guides/deploy-iis-windows.md`](docs/guides/deploy-iis-windows.md)
  plus a ready-to-copy `deploy/iis/web.config` (ARR reverse proxy, SSE
  buffering off, request limits), an annotated `production.env.example`, and
  `install-service.ps1`, which registers the Windows service and refuses to
  report success until `/api/health` answers.
- **`npm run gen:secrets`** (`scripts/generate-secrets.mjs`) emits all four
  production secrets at once, each independently random, and can append them
  to an env file — refusing to do so if any is already set, since rotating
  `CREDENTIAL_ENCRYPTION_KEY` in place strands every credential encrypted
  under the old one. `npm run gen:keys` now names the existing licence-keypair
  generator, which previously had no script entry.
- **[Licence keys & the portal](docs/guides/license-keys-and-portal.md)** — how
  keys are signed and delivered, the three issuance paths (Stripe self-service,
  GitHub `repository_dispatch` for manual/enterprise keys, and why the signing
  key must not live on the marketing site), and the claims an external site
  must not make, since the pricing-parity gates cannot reach it.

### Fixed

- **`DATA_DIR` set in `.env` was ignored for the database.** `server/db.js`
  resolves the SQLite path during module evaluation, and the ESM import graph
  reached it before `config.js` had run `dotenv.config()` — so the file's
  `DATA_DIR` arrived too late. It still applied to the later-evaluated
  tmp/scratch directories, which made the split invisible: the data directory
  looked right while `manager.db` was created under `server/data`, inside the
  install tree where the next upgrade overwrites it. Only a real OS
  environment variable worked. The `.env` load now happens in a dedicated
  module imported first by the server entry point **and by every operator CLI**
  (`retention`, `admin:grant`, `admin:dlq`, `admin:dlq:sweep`, `audit:verify`)
  — those reach the same database and had the same bug, so `npm run
  audit:verify` could return a clean SOC 2 tamper check against a file that was
  not the production database.

  > **Upgrading with `DATA_DIR` set in `.env`?** Your live database is at
  > `<install>/server/data/manager.db` today, because that setting was being
  > ignored. After this release the app reads `<DATA_DIR>/manager.db` — which
  > does not exist yet, so it would boot as a brand-new install with no users,
  > licence or credentials. **Move `manager.db` (and its `-wal`/`-shm`
  > siblings, plus `backups/`) into `DATA_DIR` before starting.** Installs that
  > set `DATA_DIR` as a real environment variable are unaffected. The same
  > applies to `DATABASE_URL`: a stale value in `.env` was previously inert and
  > will now be honoured.
- **OAuth login broke behind a proxy that does not forward
  `X-Forwarded-Proto`.** The `redirect_uri` was built from `req.protocol`, so
  such a proxy (IIS/ARR, out of the box) produced an `http://` URI against an
  `https://` OAuth App registration and GitHub answered
  `redirect_uri_mismatch`. When `FRONTEND_URL` names the same host the request
  arrived on, its scheme is now authoritative; a different host (dev, where
  Vite fronts the API on another port) still uses the request origin.
- **The theme bootstrap was blocked by the production CSP.** `index.html`
  carried an inline `<script>` while production sends `script-src 'self'` with
  no nonce or hash, so every dark-mode page load on a hosted install flashed
  white and logged a CSP violation. Moved to `public/theme-init.js`; a build
  gate now fails on any inline script in the app shell.
- **AI streaming and migration progress omitted the anti-buffering header.**
  Both now send `X-Accel-Buffering: no`, so an nginx or Cloudflare hop cannot
  batch an SSE stream into one delayed blob. (IIS/ARR ignores the header —
  see the deployment guide for the `responseBufferThreshold` setting.)
- **The licence email told every paying customer something untrue.** It said
  keys are "not remotely revocable", and both policy documents — including the
  commercial licence terms — explained the design as having "no revocation
  list to maintain" and "no runtime revocation check". Revocation shipped in
  v4.11.0 and `verifyLicenseKey()` consults the list on every check. The copy
  now states what is actually true, including the limit that survives: the
  list is per-instance, so it never reaches a customer's own self-hosted
  install. Gated by `tests/build/license-claims.test.js`.
- **The unit suite was non-deterministic under load, and raising timeouts was
  never going to fix it.** Roughly one App test per full run failed, a
  different one each time, every one green in isolation — the symptom that
  earlier pushed `testTimeout` from 5 s to 15 s and then added 8–12 s
  per-assertion budgets. Root cause: the views these tests wait on are
  `React.lazy()`, so each assertion window also covered vitest's on-demand
  transform of a very large subtree. The wait was timing a compiler, not the
  app. Reproduced deterministically under 2x CPU oversubscription — one test
  went 1237 ms → 8047 ms against its 8 s ceiling — and fixed by stubbing the
  leaf views in the App routing tests, which are about which view mounts with
  which props, not about rendering it. Same load now runs those tests in
  0.6–1.9 s.
- **Licence minting by `repository_dispatch` never ran.** The workflow gated on
  `github.actor == github.repository_owner`, which cannot match when the owner
  is an Organization — so every dispatched mint was skipped. Skipped is not
  failed, so the failure-notify step stayed quiet and the caller saw GitHub's
  `204` with no key ever delivered. Gates on a login now, overridable via the
  `MINT_ACTOR` repository variable.
- **Expression injection in the licence-minting workflow.** The recipient email
  was interpolated with `${{ }}` directly into a `run:` script — in the one
  step whose environment carries `LICENSE_PRIVATE_PEM`. It is bound to an
  environment variable now, which matters more since the new portal guide
  documents feeding customer-supplied addresses into that path.
- **The IIS `web.config` asserted HTTPS unconditionally.** It set
  `X-Forwarded-Proto: https` on every request including plain HTTP, so the
  session cookie was stamped `Secure` on an `http://` origin — which browsers
  discard, killing every login with `invalid_state`. Now conditioned on
  `{HTTPS}`, with an HTTP→HTTPS redirect rule ordered ahead of the proxy rule
  (which is `stopProcessing`, so a redirect after it never ran).
- **`gen:secrets --append` could silently rotate the encryption key.** Its
  guard missed `export KEY=value` and a BOM-prefixed first line — both of which
  dotenv honours — so an already-configured file looked empty, a second
  assignment was appended, and dotenv takes the last one. It also created a
  missing target world-readable on POSIX.
- **A dated fixture failed on its own.** `BranchesTab`'s stale-branch test
  pinned calendar dates against a rolling 90-day cutoff; one branch crossed it
  on 2026-08-05 and the test went red with no code change. Dates are now
  relative.

## [4.12.0] - 2026-07-29

Correctness work on the paths that cost money, and a pass over every claim the
product makes about itself. Nothing here adds a feature; several things stop
charging for work that did not happen, and several stop advertising things that
were not true.

### Fixed

- **An aborted AI stream recorded zero spend.** Disconnecting mid-stream billed
  the operator for the input tokens while `ai_spend` recorded nothing, so the
  monthly spend cap never fired. On Pro and Enterprise the count quotas are
  unlimited, which made the spend cap the only cost control on streaming — and
  hanging up evaded it. Providers now report the tokens they measured, flagged
  partial, and the SSE helpers carry that out of an aborted stream.
- **Four streaming routes kept generating after the client left.** Without an
  abort signal the provider ran to completion and the operator paid for output
  nobody received.
- **Repo Insights and Semantic Search spent the operator's key.** Both were
  bound to the server-wide key while the routes gated on the caller's BYOK
  provider. With a server key configured, every BYOK user's indexing and search
  billed the operator; in a BYOK-only deployment they threw instead.
- **A burst of concurrent requests could spend past an AI cap.** Reading a quota,
  awaiting the provider, then incrementing leaves the whole call open as a race
  window — every request arriving in it reads the same stale count. Reproduced
  on image generation: three requests generated against one remaining slot. All
  nineteen affected routes now reserve atomically and refund on failure.
- **Per-route output budgets never applied.** A route asking for 80 tokens
  generated up to the 2048 default, because the global cap replaced the
  route-supplied value instead of bounding it.
- **`GET /config/ai-status?probe=1` needed no authentication** and bypassed the
  five-minute cache, so an anonymous caller could drive a fresh provider call
  per request against the operator's key.
- **Three routes returned 400 on every call.** Creating a branch, the
  create-repo name-availability check, and commit generation for any repository
  with no description. The name check was broken in both directions — fixing
  the request alone would have left the indicator reporting "available" forever.
- **Refining a large diff failed after generating from it.** Commit generation
  accepted 60 000 characters and the refine step capped the same text at 20 000.
- **Selecting more than 100 repositories for a bulk action failed opaquely** —
  and on the destructive actions, only after the user had confirmed. It now
  says how many are selected and what the limit is, before contacting the
  server.
- **Two taps on Approve posted two reviews to GitHub.**
- **The dashboard invented data and reported failures as successes.**
- **AI-suggested repository topics could never be applied.** "Machine Learning"
  and "CI/CD" are rejected by GitHub and by this app's own validation; they are
  normalised at the source now, and anything unusable is dropped rather than
  shown.
- **"Enable stats caching" did nothing when switched off.** The off position
  sends a zero TTL, which was read as "unset" and fell back to the five-minute
  default. The slider worked, which is what hid it.

### Changed

- **The seat counter is gone.** It showed a limit that does not exist and that
  every paying customer appeared to violate: seat counts are minted as 1 on
  every Stripe licence, nothing anywhere enforces them, and every pricing
  surface promises unlimited team members. The panel now reports the real
  active-account count against Unlimited.
- **Displayed prices come from Stripe.** They were hardcoded while
  `/billing/config` returned booleans only, so an operator whose price is not
  $19/mo advertised one number and charged another. A price that cannot be
  resolved is omitted rather than guessed, and the yearly saving is derived from
  the real yearly price instead of a fixed 20%.
- **The Migration Assistant cap is now visible.** It has been enforced at
  25/month since it shipped and appeared on no pricing surface and in no usage
  panel, so users met "AI limit reached (25/25)" for a feature nothing had ever
  named.
- **Pro no longer advertises priority support**, which is an Enterprise
  deliverable on every other surface.
- **Generated SECURITY.md no longer invents a support policy or a response-time
  commitment.** The prompt asked for both from nothing but a repository name and
  an email, and the result was published under the user's name.
- **"20+ bulk operations" is now the counted 10.**
- **Corrections to claims made in 4.11.0 and earlier.** "Repo Advisor is
  operator-enabled" was false for the conversational assistant, which needs no
  deployment flag and works out of the box — only the Repo Advisor card inside
  the Work Board is gated. The AI-query FAQ said every Repo Advisor call counts
  against the monthly total; the Work Board card is metered separately. The
  README stated a Node.js 20 floor two majors after it moved to 22, and the
  architecture diagram said "no Redis" in three places including its
  screen-reader label, when `REDIS_URL` enables distributed sessions, rate
  limiting and the job queue.
- **better-sqlite3 upgraded to 13.0.1** (N-API). The Windows packaging guard
  was taught the new prebuilt-binary layout.

### Internal

- The intermittent CI failure where a whole suite failed to import with zero
  failed tests was worker contention on a shared SQLite file; every worker now
  gets its own.
- New guards keep the above from drifting back: the advertised Node floor
  against `package.json`, documented route counts against the source, the
  diagram's action allow-list against the code, pricing claims across every
  surface rather than one, and a scanner for the read-then-increment race that
  proves itself against a fixture.

## [4.11.0] - 2026-07-27

Two audit panels' worth of correctness work: money paths, BYOK metering, and
the honesty of what the product claims. Nothing here changes what the product
does for a user who was already getting correct behaviour.

### Changed
- **Two benefits previously advertised on paid tiers were withdrawn.** Neither
  was ever enforced in code, so no customer loses a capability they had:
  - The **1,000-repository Free ceiling** never existed — `maxRepos` is
    unlimited on every tier and repository count is never counted. It has been
    removed from the commercial licence agreement, the billing guide and the
    architecture docs, following the eight surfaces corrected in 4.10.
  - **"Higher AI $ spend-cap headroom"** was identical across tiers, so it
    differentiated nothing. Where the spend cap is mentioned, the docs now say
    plainly that it ships disabled and only applies once an operator enables it.
- **Repo Advisor** is marked operator-enabled on the in-app pricing surfaces.
  It needs `WORK_BOARD_AI_ENABLED=true` plus a per-user opt-in; the README
  already said so, the pricing page did not.

### Added
- **Enterprise audit-log export** — `GET /api/audit/export`, CSV or JSON, with
  keyset paging and the hash-chain columns so a download can be verified
  offline. Now documented in the API reference.
- **`npm run audit:verify`** — the audit-chain integrity CLI that two runbooks
  already told operators to run, and which did not exist.
- **Licence revocation** — revoked keys fail closed with an actionable error.

### Fixed
- **Billing.** A refunded or disputed subscription could be checked out again,
  billing the customer twice. A *partial* refund downgraded a fully-paying
  customer to Free. A refund suspension was silently undone the next time the
  customer opened the billing portal. A deferred licence key (SEPA/Boleto) was
  lost permanently if the first delivery attempt failed.
- **BYOK users were metered against the operator's spend cap** at ten call
  sites, so enabling the cap would have throttled exactly the people costing
  the operator nothing.
- **Every AI mutation from PR Review, PR Chat, PR Commands and Prompt Studio
  returned 403** — the CSRF token was never sent — and surfaced as
  "Something went wrong" behind a Retry that could not succeed.
- **BYOK-only deployments were told "AI is not configured"** while their key
  worked, because the status endpoint only looked at the server key.
- Exhausting one AI feature's quota blocked every other AI feature for five
  minutes, naming the wrong feature.
- An expired session on an AI route was reported as a rejected provider key.
- Publishing an AI review replaced the app with the error overlay.
- **Windows self-update aborted** with the server stopped: the resident tray
  kept a lock on the executable and was never asked to exit.
- Six text surfaces were below WCAG AA in light theme; the org menu gave a
  keyboard user no visible focus at all.
- `http_requests_in_flight` leaked permanently on every abandoned SSE stream.
- A backup that died mid-write became "the newest backup" and suppressed
  retries; the email retry worker could send the same licence key twice.
- Semantic search returned NaN for every result once the corpus held vectors
  from two different embedding models.
- `data/updates` grew without limit — one installer and one full database
  snapshot per update, kept forever.

### Security
- **GitHub OAuth tokens are encrypted at rest**, in both the SQLite and Redis
  session backends.
- **Licence installation no longer self-promotes to admin** on a shared
  instance. It is scoped to a genuinely fresh single-user install.
- The Enterprise audit-log CSV export neutralises spreadsheet formulas planted
  in client-supplied fields.
- `.gitignore`/`.dockerignore` were filename lists, not patterns —
  `.env.staging`, `keys/private.key` and `*.pfx` were not ignored.

## [4.10.0] - 2026-07-22

A system-tray app for the Windows build, plus two installer fixes found in
real-world v4.9.0 testing.

### Added
- **System-tray app.** Launching the Windows build now shows a tray icon (near
  the clock) that indicates the server is running (**● Running on port N**) and
  offers **Open in browser**, **View server logs**, **Restart server**,
  **Start with Windows**, and **Quit** (graceful shutdown). Double-click the
  icon to reopen the app. Still the same in-box-compiled launcher — no extra
  toolchain, no runtime dependency — and a single-instance guard means clicking
  the shortcut again just reopens the browser. Updates stop and relaunch the
  tray cleanly so a self-update never leaves the app without its indicator.

### Fixed
- **Desktop shortcut "access denied".** The optional desktop shortcut was
  created on the all-users desktop, which a per-user (no-UAC) install cannot
  write to. It now uses the current user's own Desktop.
- **Installer Repair/Uninstall menu never appeared.** Re-running Setup over an
  existing install silently did a plain over-install instead of offering
  **Repair / Uninstall**, because the existing-install lookup read the wrong
  registry key (a brace-escaping mismatch). The maintenance dialog now appears
  as intended.

## [4.9.0] - 2026-07-22

Premium Windows experience: a native launcher that runs the server hidden with
no console window, one-click in-app updates with automatic rollback on the
portable build, and full installer maintenance.

### Added
- **Native launcher `GitHub Repo Manager.exe`.** A flashless GUI-subsystem
  stub (compiled at package time with the in-box .NET Framework 4.8 `csc.exe`
  — no toolchain added, no runtime dependency on stock Windows 10/11) that
  launches the server hidden: no console window, no window flash, proper
  taskbar identity and icon. Start Menu shortcuts for launch, **Stop**, and
  **View server logs**; an opt-in "start with Windows" (background) task.
- **File-based server logs.** All server output goes to
  `data\logs\server-YYYY-MM-DD.log` with 7-day retention (previously a
  console buffer that vanished with the window), and a native error dialog
  surfaces a failed startup with a one-click "open the log".
- **Graceful shutdown endpoint.** `POST /api/system/shutdown` — loopback-only,
  authenticated by a per-boot secret token file, CSRF-exempt by design (its
  callers have no browser session), rate-limited. `Stop` and the installer
  ask the server to exit cleanly (workers stopped, DB closed, in-flight
  migration rows marked interrupted) before any hard kill.
- **One-click updates.** Settings → About gains **Update now** on the packaged
  Windows build (installer or portable): it downloads the new release,
  verifies its SHA-256, snapshots the database, applies the update, restarts,
  and reports the result as a toast. Progress (downloading / verifying /
  restarting) streams to the UI while the server stays responsive.
- **Automatic rollback (portable ZIP).** A failed post-update health check
  reverts the app, runtime, and the pre-update database snapshot together and
  relaunches — so a bad update can't leave a broken install or a mismatched
  schema. Installer-mode recovery is manual (the previous `setup.exe` is
  retained under `data\updates\`).
- **Installer maintenance.** Re-running Setup over an existing install offers
  **Repair / Uninstall**; installing over a running instance stops it
  gracefully instead of aborting; uninstall keeps your data by default (or
  deletes it via the prompt / silent `/PURGEDATA`).
- **Schema-downgrade guard.** The app refuses to boot (with a clear message,
  not a stack trace) if the database was migrated by a newer version than it
  knows, pointing at the retained pre-update snapshot — an old build can never
  silently corrupt a newer-schema database.

### Changed
- Windows documentation (`docs/windows.md`, README, docs index) rewritten for
  the launcher, one-click update, and maintenance flows, correcting the prior
  console-window / manual-update description.

## [4.8.2] - 2026-07-21

### Added
- **"Launch GitHub Repo Manager" checkbox** on the installer's finish page
  (checked by default; skipped in silent installs).
- **Scripted / unattended install guide** in `docs/windows.md`: silent
  flags with `/LOG=` and `/DIR=`, exit-code semantics (including the
  deliberate abort over a running instance), launcher env-var overrides,
  and a zero-touch pre-provisioning recipe for `.env` (GitHub OAuth +
  license) so fleet rollouts skip the in-app setup entirely. winget remains
  documented as planned, not yet submitted.

### Fixed
- **Admin-driven installs no longer pin every user to the installing
  account's data directory.** The installer now records the data-dir marker
  in its unexpanded `%LOCALAPPDATA%` form and the launchers expand it at
  run time, so each Windows account resolves its own database and `.env`.
  Markers from older installs (absolute paths) keep working unchanged.

## [4.8.1] - 2026-07-21

### Added
- **Branded Windows installer.** The setup wizard now carries the BolaLabs
  identity: branded `setup.exe` icon, Welcome/Finish banner and header tile,
  Add/Remove Programs icon, and Start Menu/desktop shortcuts that show the
  product icon instead of the generic console icon (the launchers are `.cmd`
  files). Assets live in `packaging/windows/assets/`, generated at 2x from
  the master art so DPI scaling only ever scales down.

## [4.8.0] - 2026-07-20

First-run experience overhaul for the Windows package and self-hosts: signing
in now works out of the box, GitHub connection is a guided 2-minute in-app
setup instead of hand-editing `.env`, and the database self-heals from
corruption.

### Added
- **Guided GitHub connection setup.** On an install without OAuth
  credentials, clicking **Sign in** opens an in-app wizard that pre-fills
  GitHub's "New OAuth App" form with the exact Homepage/Callback URLs for
  that install (real port included), accepts the Client ID/Secret, persists
  them to `.env` and applies them live — no restart, no manual file editing.
  New endpoints `GET /api/auth/setup-status` and `POST /api/auth/setup-oauth`
  (only while unconfigured, loopback-only with Host-header allowlist against
  DNS rebinding, CSRF-enforced, rate-limited, atomic allowlisted `.env`
  writes; disable outright with `GRM_DISABLE_WEB_SETUP=true`). Hosted
  deployments get operator instructions instead of the form.
- **Automatic database corruption recovery.** Every boot runs a SQLite
  `quick_check`; a damaged database is quarantined (renamed alongside its
  WAL/SHM sidecars — never deleted) and replaced by the newest healthy
  scheduled backup, or a fresh database when none exists. What happened is
  reported through `GET /api/system/status` and surfaced in-app.
- **Human-readable OAuth failure messages.** Every `?error=` code from the
  sign-in flow (cancelled on GitHub, callback URL mismatch, rejected
  credentials, expired state, …) now shows a clear explanation; the GitHub
  callback forwards GitHub's own sanitized error code instead of a generic
  one.

### Fixed
- **Windows package sign-in was impossible.** Production builds set the
  session cookie `Secure`-only, which a plain `http://127.0.0.1` install can
  never store — OAuth state died across the GitHub redirect
  (`invalid_state`) and no CSRF token ever matched. The cookie is now
  `secure: 'auto'` (still `Secure` behind a TLS-terminating proxy via
  `trust proxy`), and the packaging CI asserts session persistence over
  plain-HTTP loopback so it can't regress.
- **`Sign in` without OAuth configured dead-ended on a GitHub 404**
  (`client_id=undefined`). `/api/auth/login` now validates credentials first
  and redirects back to the app with `error=oauth_not_configured`, which
  opens the guided setup.
- **Post-login redirect defaulted to the Vite dev server**
  (`http://localhost:5173`) when `FRONTEND_URL` was unset — a dead port on
  any packaged/self-host install. All OAuth redirects now fall back to the
  request's own origin, following the real port automatically (including the
  launcher's next-free-port fallback).

### Changed
- **Windows package: all writable state now lives in the data directory**
  (`.env` and the launcher pidfile moved out of the install dir). The `.env`
  — which holds the credential-vault encryption key — now survives
  uninstall/reinstall with the database it unlocks, and the install dir can
  be read-only. Existing installs are migrated automatically on next start;
  a still-running pre-4.8.0 instance is still detected by the installer and
  Stop launcher via the legacy pidfile path.
- `docs/windows.md` rewritten around the guided setup, with exact manual
  OAuth values for the package (`127.0.0.1`, not `localhost` — GitHub
  compares callback URLs character-for-character), in-app license
  activation, and the new data-directory layout.

## [4.7.0] - 2026-07-19

GitHub Repo Manager runs natively on Windows: a CI-boot-validated installer
and portable ZIP, first-run bootstrap, and in-app update notifications.

### Added
- **Windows distribution — installer + portable ZIP.** A self-contained
  Windows package (bundled Node.js runtime, no separate install, no admin
  rights for the installer) with `Start`/`Stop` launchers, automatic
  next-free-port fallback, and CI boot-validation (headless boot + health
  checks, plus a full install → uninstall cycle) on every PR and release.
  See [`docs/windows.md`](docs/windows.md).
- **First-run bootstrap for desktop/self-hosted installs.** A fresh install
  generates its own random secrets and a sane local `.env` automatically
  (`scripts/first-run.mjs`); new `HOST` (bind address) and `DATA_DIR`
  (persisted-state root) env vars support installed layouts whose app
  directory isn't writable; `ALLOW_CONSOLE_EMAIL` opts a single-user install
  out of the hosted-deployment email-provider guard.
- **In-app update notifications.** Settings → About shows a "new version
  available" banner sourced from a single unauthenticated GitHub releases
  check (no identifying data sent, cached 24h) — notify-only, no
  self-updating. Disable the outbound check with `UPDATE_CHECK=false`.
- **winget scaffolding.** Manifest templates and an automated
  publish-on-release CI step exist, but nothing has been submitted to
  `winget-pkgs` yet — `winget install` is not available yet.

## [4.6.1] - 2026-07-19

Launch-readiness hardening: every finding from the 2026-07-19 seven-dimension
panel (`docs/reports/2026-07-19-launch-readiness-panel.md`) fixed, plus the
docs overhaul and CI/CD hardening that landed since v4.6.0.

### Security
- **AI metering gaps closed (launch-readiness panel, 2026-07-19).**
  `POST /api/migration/analyze` was completely unmetered (no quota, no spend
  cap, no `recordAISpend`, no `requireScope('ai')`) and could inflate a
  prompt across up to 200 repos in one call — now routed through
  `guardedGenerate`. The non-streaming branches of `/ai/generate-commit`,
  `/ai/generate-pr`, `/ai/refine`, `/ai/analyze-context`, and
  `/ai/review-summary` called the AI provider directly, so a client could
  bypass the per-tier $ spend cap simply by omitting `?stream` — converted to
  `guardedGenerate` (the streaming branches were already guarded). Work
  Board's AI summary/suggest-action/draft-comment routes and the Community
  Health AI summary route charged quota but skipped the spend cap entirely —
  both now call `checkAISpendCap`/`recordAISpend`.

### Fixed
- **Docker + CI gates (#227).** Fixed the license-key public-key path so the
  production Docker image's health check no longer blocks image startup
  (`keys/public.pem` now ships in the image); re-activated the
  `build-honesty` and `bundle-budget` CI gates, which had been silently
  skipping; re-baselined the honest gzip budget for the entry chunk
  (66 → 89 KB, reflecting real growth rather than a stale number).
- **Usage dashboard read bug on non-UTC hosts.** `GET /api/v1/usage` built
  its `period_start` key from the server's *local* calendar
  (`now.getFullYear()/getMonth()`) while every write path buckets in UTC
  (`getCurrentPeriod()`) — on a host east of UTC, Settings → Usage could read
  0 for the whole month. The read path now shares the exact same UTC period
  helper every write uses.
- **README FAQ false privacy claim.** "What data is sent to the AI
  provider?" answered "never your code content" — untrue for AI Deep Review
  (sends the full PR diff) and the Commit Generator (works from diffs).
  Rewritten per-feature, and the exact phrase is now hard-gated by
  `tests/build/readme-honesty.test.js` so it can't silently reappear.
- **WCAG AA contrast on small status text.** Delta badges on the Dashboard
  "What needs you" grid and deletion counts/error text in the Dev Toolkit
  used 500-level colors (~2.3:1 on light backgrounds) — moved to the
  600/400 light/dark pattern used everywhere else.

### Added
- **10 previously-invisible Free-tier quotas surfaced** in
  `GET /api/v1/usage` and the Settings → Usage dashboard: AI Deep Review, PR
  Chat, PR Commands, Prompt Studio test runs, AI Diagrams, Agent Rules,
  Security Posture AI summary, AI Image Generation, full migration
  executions, and mirror-sync apply. All ten were already enforced
  server-side — users previously only discovered the cap at the 429.
- **Docker image quickstart.** README + `docs/operations.md` now lead with
  `docker pull ghcr.io/brunobola-portfolio/github-repo-manager:latest` as
  the primary Docker path, local build kept as the alternative.

### Changed
- **License key duration now matches what was actually paid for.** A
  monthly $19 subscription used to emit a 12-month, non-revocable JWT
  regardless of billing cadence. `checkout.session.completed` now issues a
  1-month key for monthly plans and a 12-month key for yearly; each paid
  monthly renewal invoice (`invoice.paid`, `billing_reason:
  subscription_cycle`) mints and emails a fresh 1-month key automatically,
  so an active subscriber's key never actually expires. Documented in
  `docs/billing-and-licensing.md`, including the honest caveat that keys
  are not remotely revocable.
- **docker-compose.yml forwards the vars a paying self-host customer
  needs.** `LICENSE_KEY` was missing from the environment whitelist, so a
  self-hosted Pro/Enterprise deployment silently ran as Free; also added
  `DB_BACKUP_DIR`, `DB_BACKUP_KEEP`, and `ALLOWED_AZURE_HOSTS`. Database
  backups now default to their own named volume (`app-backups`) instead of
  landing in the same volume as the live database.
- **Docs corrected to match free-first pricing.** The AI Deep Review guide,
  `docs/api/API.md`, and `docs/index.md` still described Prompt Studio
  presets, PR slash commands, and PR Chat as Pro-only and cited a
  `requireTier('pro')` gate that no longer exists anywhere in
  `server/routes/` — all three are Free with generous per-feature monthly
  caps (unlimited on Pro). Numbers cross-checked against
  `server/lib/feature-flags.js`.
- **Documentation overhaul (README + docs excellence).** Restructured the
  README into a lean, premium landing page (1026 → ~490 lines): a theme-aware
  `<picture>` hero, curated badges, a scannable feature layout with the v4.6 AI
  screenshots, progressive-disclosure `<details>`, and a trailhead
  `## Documentation` section. Version history now lives solely in `CHANGELOG.md`
  + GitHub Releases (git tags as the source of truth) — the duplicated "Recently
  Shipped" section was removed.
- **Honesty fixes.** Corrected the README's "DORA Metrics (Enterprise)" label
  (DORA is free on all tiers), the stale `v4.5.0` header link, the "5,200+"
  test count (now 6,000+), the OAuth scope table (aligned to the code), and the
  migration wizard step list. Refreshed stale docs (`work-board.md`,
  `architecture/backend.md`, `architecture/overview.md`, `event-ingestion.md`,
  `api/WORK-BOARD-API.md`, `setup/github-app.md`, `LICENSE-COMMERCIAL.md`) and
  rewrote `docs/ARTICLE.md` for v4.6 (AGPL not MIT; Azure-only migration;
  SSO/SAML marked roadmap).

### Added
- **Theme-aware SVG diagram set** (`docs/images/*.svg`) — architecture, AI
  spend-cap flow, action dispatch, migration flow, tier gating, event
  ingestion, and AI Deep Review, all rendering correctly on GitHub light and
  dark (embedded `prefers-color-scheme`), SQLite-only and provider-neutral.
- **`npm run docs:linkcheck`** — a zero-dependency relative-link checker over
  every Markdown file (0 broken links across the repo, including historical
  plans/specs/reports).

### Removed
- Archived 47 orphaned/superseded screenshots and one legacy dark-only SVG to
  `docs/images/archive/` (curated the live image set from 84 to 42).

### Performance
- **App shell code-split: entry chunk 88.7 → 78.8 KB gzipped (−11%).** Most
  of the win came from fixing a `manualChunks` misconfiguration that forced
  Recharts into the eager graph even though it is only reachable via dynamic
  import; conditional shell pieces (org sidebar, notification layer) are now
  lazy with paint-safe fallbacks. The CI bundle budget was lowered to lock
  the gain.

### UI polish
- The Pricing page's Free card (29 feature rows) now collapses behind an
  accessible "Show all features" toggle, so the three plan cards sit at a
  balanced height; hardcoded easing/spring literals across
  Landing/Pricing/Roadmap were replaced with the shared motion vocabulary;
  raw `z-[45]` layers were tokenized and the z-index guard now catches any
  raw value ≥ 30; the four AI diff modals (README Studio, README Enhance,
  Diagrams, Agent Rules) switch to unified diff view below the `md`
  breakpoint; the Work Board keyboard help shows OS-aware `⌘K / Ctrl+K`; and
  onboarding gained a fourth step introducing README Studio, AI Diagrams,
  Agent Rules and the Security Posture panel. The anti-Portuguese UI guard
  now also covers `src/contexts`, `src/actions`, `src/config`, and
  `src/__mocks__`.

### CI/CD
- The Docker publish workflow now boots the freshly built amd64 image with
  production-shaped dummy secrets and polls `/api/health/live` before
  pushing anything to GHCR; CodeQL (`security-extended`) runs on pushes,
  PRs, and weekly; the redundant duplicate test suite on every main push
  was removed (it only existed to gate deploys, which are opt-in).

## [4.6.0] - 2026-07-19

Six production-premium waves plus the "Community WOW" feature set, executed
directly on `main` following the 2026-07-17 audit: hardening and free-first
pricing, a premium migration/reading pass, ops readiness, dark-mode/list
performance, and four new AI-grounded repo tools with deterministic,
zero-AI-cost fallbacks throughout.

### Added

- **Community WOW — README Studio, AI Diagrams, Agent Rules, Security
  Posture, AI Images** — four new AI-grounded repo tools, all metered on
  Free with generous caps and Pro/Enterprise unlimited:
  - **README Studio** — a free deterministic README quality score (license
    correctness, badge/reality consistency, install-vs-stack match,
    screenshots, section order) plus a grounded, quota-gated improve flow
    (25/month, shares the existing README Generator cap) that never invents
    license claims, commands, or badges. A zero-AI-cost deterministic patch
    (License/Install/TOC) is offered whenever the AI call is unavailable.
  - **AI Diagram Generator** (15/month) — architecture diagrams grounded in
    the repo's real file tree and README, with a retry-once self-repair pass
    on invalid Mermaid, SSE streaming, and embedding into the repo as an
    idempotent README Mermaid fence or a sanitized, size-guarded SVG file —
    plus a zero-AI-cost deterministic fallback diagram.
  - **Agent Rules Generator** (20/month) — AGENTS.md / CLAUDE.md generated
    from real detected build/test/lint/CI signals (never a fabricated
    command), diff-aware refresh mode, and a deterministic template fallback
    that never hard-blocks on AI availability.
  - **Security Posture Panel** — a 10-check deterministic report card
    (branch protection, alert severity, secret scanning + push protection,
    Dependabot security updates, code scanning, `SECURITY.md`, workflow
    token permissions, org 2FA) layered on the existing alerts scan, now
    Free tier, plus an optional cached AI narrative summary (75/month) fed
    only whitelisted check results, never raw alert bodies.
  - **AI Image Generation** (5/month) — repo banner / README hero / logo
    draft images across three fixed presets, capability-gated per provider,
    with typed refusal/pricing-unavailable handling and binary-safe commits.
  - Demo mode gained matching mock branches (a realistic deterministic score
    payload, a canvas-drawn "SIMULATED" watermark image) so exploring the
    product with no API keys never errors on these four surfaces.
- **Free-first pricing rebalance** — bulk ops (transfer/mirror/cross-org),
  mirror sync apply, AI Deep Review, Prompt Studio, PR Chat, and PR slash
  commands all moved off the Pro paywall to Free with generous per-feature
  monthly caps; team size and API-key ceilings raised; a tier-independent
  daily anti-abuse ceiling added for destructive bulk ops. Pro's role
  shrinks to AI headroom (higher per-feature caps, a higher $ spend-cap
  ceiling) and more API keys rather than feature unlocks.
- **Premium migration experience** — cancel now actually stops the
  in-flight clone/LFS/push (previously the background task kept running to
  completion); the simple Import path gained matching cancel + crash
  recovery; a completed mirror push landing during the cancellation window
  is no longer discarded as failed; oversized-file LFS-upload failures gain
  an actionable one-click retry; a Migration Health rollup card summarizes
  per-task caveats (LFS failures, replaced/reused repos, empty sources) in
  plain English.
- **Premium README reading experience** — tokenized fenced code blocks,
  gh-cache-backed reads with stale-data fallback on a GitHub outage, a
  reading-width cap, a copy-code button, and a sticky "On this page" TOC.
- **Risk-aware diff navigation** — a unified `ds-risk-*` risk-color
  vocabulary across PR review, commit browsing, and diagrams; a file-level
  risk heat rail with click-to-jump; commit browsing gains an on-demand AI
  summary, real pagination, and shareable `?commit=<sha>` deep links.
- **Ops readiness** — a Prometheus metrics endpoint, a reverse-proxy/TLS
  deployment guide, ARIA progressbar + live-region semantics and a
  "Connection lost — retrying" pill on migration progress, and cancellation
  checkpoint parity for wiki migration.
- **List virtualization** — a dependency-free windowed-rendering hook
  applied to RepoGrid's list view above a 50-row threshold, so large
  workspaces mount only the visible rows.
- **Team invite notifications** — the previously-simulated "team member
  added" invite now sends a real transactional email (best-effort; never
  blocks the member-add on a delivery failure).

### Changed

- Non-functional PostgreSQL adapter path removed — SQLite (better-sqlite3)
  is the only supported database; a `postgres://` `DATABASE_URL` now fails
  fast at boot with an actionable error instead of silently exercising a
  broken code path.
- Binary-safe repo-content commits (`commitOrOpenPR` gains a base64
  passthrough encoding) so AI-generated images are never corrupted by a
  hardcoded UTF-8 re-encode.
- Remaining Portuguese UI copy translated to English; AGENTS.md and
  CLAUDE.md rebuilt on the shared agents.md standard.

### Fixed

- AI spend-cap gaps closed on `/ai/index`, `/ai/batch-index`, and the
  semantic-search embed path; a check-then-increment usage-meter race
  closed with atomic guarded-increment primitives, mirroring the existing
  migration-quota pattern.
- Dashboard inbox item-id shape validated on archive/restore/snooze;
  destructive replace/LFS config mutations on migration retry are rolled
  back when the retry never actually starts.
- Truncated-README signal and image-generation-failure diagram fallback
  handled honestly rather than silently misreported; security posture
  checks render `unknown` (never a same-severity `fail`) wherever the
  underlying signal genuinely can't be determined.
- `HeroHalo` no longer overflows the viewport horizontally on mobile.

### Security

- `adm-zip` bumped to 0.6.0 (GHSA memory-allocation DoS).

## [4.5.0] - 2026-07-06 — never tagged

> **Not a released version.** There is no `v4.5.0` git tag and no `v4.5.0`
> GitHub Release: the work below merged to `main` and first reached users in
> **[4.6.0](#460---2026-07-19)**. The entry is kept as history — every *tagged*
> release has an entry here, but this entry has no tag. The compare link at the
> bottom of this file therefore spans v4.4.0…v4.6.0.

The production-readiness release: a 10-specialist audit (88 findings) followed
by eight remediation waves executed directly on `main`, plus the Repo Advisor
AI assistant rebuild, the end-to-end migration Replace experience, and an
environment-tooling readiness system. Quality gates grew with the product:
5,200+ unit tests, a dual-theme accessibility gate, and lint rules that stop
design drift at commit time.

### Added

- **Repo Advisor** — the AI assistant rebuilt end-to-end: provider-neutral
  `AI_PROVIDER` config, answer-first error knowledge base with grounded,
  cited sources, code-block copy, SSE streaming replies, per-call output-token
  caps and a global AI spend cap (OWASP LLM10), PII-safe audit metadata,
  Pro-tier quota metering across all AI routes, BYOK hardening (key rotation,
  model-id validation, DNS re-checks), golden-eval suite with an optional
  real-model LLM-as-judge mode, and a CI eval gate.
- **Migration Replace, end-to-end** — naming conflicts on the Repos step are
  now resolvable (replace / rename / skip) with a destructive type-to-confirm
  modal; failed conflict tasks offer one-click "Replace & retry" from both the
  progress and summary screens; oversized-file failures offer "Retry with Git
  LFS" (automatic `git lfs migrate` conversion + LFS object push).
- **Environment tooling readiness** — declarative tool registry (git,
  git-lfs, git-tfs…), `npm run doctor` CLI, `/api/env` status endpoint with
  admin-gated in-app installs (SSE progress, sanitized output), an operator
  Settings panel, and per-plan preflight that fails migrations with an
  actionable error instead of a mid-job crash.
- **GDPR data lifecycle** — registry-driven account erasure covering every
  user-scoped table (with a schema-introspection completeness test so new
  tables cannot be missed) and a corrected data export; erasure responds with
  a per-table deletion receipt.
- **Operations hardening** — WAL-safe scheduled SQLite backups with retention
  (`DB_BACKUP_DIR` / `DB_BACKUP_KEEP`), daily/hourly maintenance janitors
  (retention, gh-cache, outbox, undo-log, event purge), `/live` + `/ready`
  health probes wired into Docker/Railway, HTTP compression with immutable
  asset caching, SSE-aware graceful shutdown, request-id log correlation with
  secret redaction, and a documented restore runbook.
- **Yearly billing** — `billingPeriod` threaded through Stripe checkout
  end-to-end; the pricing page hides the yearly toggle unless yearly prices
  are actually configured (probed via the public `GET /api/v1/billing/config`).
- **Browser history model** — drill-ins (repo detail, PR review) push real
  history entries; Back/Forward now traverse the app the way users expect.
- **Ultrawide layout** — shell tokens (`--layout-px`, `--layout-max-w`) plus
  named breakpoints (`nav:` / `wide:` / `ultra:`); >1920 px displays gain a
  fourth repo-grid column and balanced gutters instead of 320 px of dead space.
- **Collapsed sidebar, real data** — the slim rail's Quick Actions, History
  and Activity popovers now show live entries (shared row renders with the
  expanded sidebar) with count badges on the rail icons.
- **Server request validation** — shared zod schemas + `validateBody` on all
  PR write-backs, repo contents writes, issue labels/assignees, webhook
  update, workflow dispatch and community-health endpoints; invalid bodies
  return a consistent `400 { error, code: 'validation_failed' }`.

### Changed

- **One canonical Badge** — `ui/Badge` gained a tone/size/ring/icon/dot API
  (9 AA-safe palettes, light+dark); 18 bespoke pills migrated onto it.
- **One tooltip convention** — interactive controls use `ui/Tooltip` (Escape
  dismissal per WCAG 1.4.13); native `title` reserved for static text.
- **One motion scale** — every hardcoded `duration-300` migrated to the
  design-system tokens (200 ms micro-interactions / 320 ms layout); an ESLint
  anti-drift gate blocks raw durations, raw pixel breakpoints and shell-scale
  width caps from creeping back.
- **One time vocabulary** — nine relative-time dialects unified on
  `formatRelativeTime`; five byte formatters unified on `formatFileSize`;
  dates pinned to a single locale.
- Azure route monolith split into focused sub-routers; migration task
  execution extracted into per-type task runners; schema changes now run
  through a real versioned migration ledger (v28) instead of `try/catch`.
- Migration AI review no longer performs approval theater: the plan gate is
  real, hedge-free analysis text is enforced server-side.

### Fixed

- Naive SQLite UTC timestamps parsed correctly app-wide (times no longer
  drift by the local offset); migration status vocabulary canonicalized
  (`complete` → `completed`) with a data migration.
- Stale-chunk loads after a redeploy self-heal with a one-shot reload;
  provenance-badge 401s no longer spam the console per card.
- Teams and AI Assistant surfaces show honest load-error states with retry
  (no more fabricated demo activity on production errors); AI chat preserves
  partial text with a retry marker when a stream disconnects.
- Work Board KPI tiles, transfer dry-run previews, org repo counts and
  legacy `visualstudio.com` host handling all corrected.
- Draft persistence gained a 30-day TTL sweep so abandoned drafts stop
  accumulating in localStorage.

### Security

- SSRF: hardened internal-IP/host checks in `isInternalUrl`; `/ai/batch-index`
  body validation with strict `full_name` regex; per-user rate limit on the
  Work Board AI interpreter; outbox idempotency keys scoped per user.
- Production boot now fails fast when `ALLOW_MOCK_AUTH` is set.
- License signing private key excluded from the Docker build context; SQLite
  WAL sidecars and root-anchored ignore patterns added to `.gitignore`.
- 4 MB body limit on v1 AI routes; pino redaction backstop for tokens.

### Accessibility

- Axe gate widened from 4 views/critical-only to **9 views × 2 themes,
  critical + serious, zero deferred contrast rules** — 18 hard-gated scans.
- `nested-interactive` eliminated at the source: repo cards, PR/issue rows and
  Work Board rows use the stretched-control pattern (real keyboard-reachable
  buttons layered under lifted sibling controls).
- 104 light-mode and all dark-mode color-contrast violations driven to zero
  (issue-label chips derive AA-safe text from the label colour per theme).
- Migration progress announces via `role="status"` live region + progressbar
  semantics; destructive icon buttons named.

### Performance

- Action-leading indexes on `issue_events` / `pr_events`; Work Board event
  aggregation bounded to the caller's slice; community-health/compare GitHub
  fetches parallelized; command palette code-split behind idle warm-up.

## [4.4.0] - 2026-06-13

Azure DevOps / TFS credential hardening plus a production-readiness pass that
closed a boot-stopping deployment bug and a login DoS surfaced by a full
multi-dimension audit.

### Added

- **Self-fix host allowlist UX** — when a saved Azure/TFS credential or the
  migration wizard hits a host that isn't authorized, a panel offers admins a
  1-click add (no restart, audited) and non-admins the exact host + `.env`
  guidance. New shared `useHostAllowlist` hook + `AllowlistFixPanel`.
- Live host-allowlist status in Settings → Azure Credentials while typing a host.
- Structured `HOST_NOT_ALLOWED` / `UNSAFE_URL` / `PRIVATE_ADDRESS` codes from the
  host validator so the UI can act instead of showing a dead-end string.
- README / AI / PR / issue markdown now renders styled prose (`@tailwindcss/typography`).

### Security

- **SSRF: userinfo smuggling blocked** — a strict host-shape gate stops
  `dev.azure.com:0@attacker` from passing the allowlist while the request
  (PAT included) was routed to the smuggled host.
- **DNS-rebinding guard** now validates every resolved A/AAAA record incl. IPv6
  private/loopback/link-local/mapped ranges (was IPv4-first-record only).
- Allowlist entry details (internal hostnames, notes, admin usernames) are
  admin-only; non-admins see guidance, not the list.
- Credential-vault KDF versioned to PBKDF2-SHA512 @ 210k (OWASP); legacy v1
  blobs still decrypt.
- API keys: CSRF correctly bypassed for `Bearer grm_live_` requests (header
  auth is CSRF-immune) **and** a central write-scope gate blocks read-only keys
  from any mutation — making the documented write/admin scopes usable + safe.
- OAuth `/callback` fails closed: no half-authenticated session is saved when
  the GitHub `/user` fetch fails or returns no id.
- 21 source files relicensed from stray MIT headers to AGPL-3.0-only.

### Fixed

- **CRITICAL: production server could not boot** — Express 5 / path-to-regexp v8
  rejected the bare `app.get('*')` SPA fallback (`Missing parameter name`);
  switched to the named splat `'/{*splat}'`.
- **Login DoS** — the rate limiter passed the whole `req` to `ipKeyGenerator`,
  collapsing every client into one shared bucket; now keyed on `req.ip`.
- Migration progress UI froze after 100 SSE events (length cursor vs sliding
  window) — now consumed by a monotonic sequence number.
- Import duplicate-detection read the wrong shape off the `githubApi()` wrapper.
- Work Board "Approve" was a no-op — wired to the working review action.
- TFVC `forceStrategy` enum mismatch (kebab vs camelCase) and ignored
  `savedCredentialId`; TFVC routes gained schema validation, a shared PAT
  resolver, a bounded folder-size fan-out, and a canonical temp dir.

### Changed

- Lazy-loaded the command palette out of the entry chunk (main bundle 86 → 66 KB gzip).
- System-health indicator no longer flashes "unknown" on load and retries with backoff.

## [4.3.0] - 2026-05-18

A **premium-through-restraint** release. The visual language pivots from
"AI-template" (rainbow gradients, glow shadows, shimmer everywhere) to a
GitHub-tasteful aesthetic — see
[`docs/specs/2026-05-14-premium-non-llm-theme-design.md`](docs/specs/2026-05-14-premium-non-llm-theme-design.md).
121 commits, **3896 unit + 84 e2e tests** green; lint, build, e2e all green
on `main` for every push.

### Added — Mobile peek FAB with reveal-on-touch UX

- **Peek-out trigger.** `MobileQuickActionsFab` and the PR review AI insights
  FAB sit translated 55 % off the right edge by default — only ~25 px peeks
  past the viewport so phone content reclaims the full width. Hover, focus,
  focus-within, active tap, or opening the menu slides the button fully in
  via a 300 ms cubic-bezier (or framer-motion spring for the quick actions
  trigger).
- **Premium effects.** Indigo → violet 2-stop gradient, soft breathing halo
  pulse (3.2 s loop), 3 × 24 px white edge stripe, `whileTap` scale 0.92,
  `shadow-xl` lifting to `shadow-2xl` on reveal. The halo fades on reveal so
  the lock-in state reads decisive.

### Added — Hash deep-linking

- **Bidirectional sync** between `activeView` state and `window.location.hash`
  for the six static views: `#/repos`, `#/work`, `#/teams`, `#/roadmap`,
  `#/pricing`, `#/ai/prompts`. Hash → state runs in `startTransition`; state
  → hash uses `replaceState` (no history pollution) with a first-render guard
  so a deep-link hash on mount drives the view rather than being stripped by
  the state-to-hash effect's initial run.
- Dashboard is the canonical home: empty hash + `#` + `#/` all route there.

### Added — Premium scrollbar contract

- Page-level `<html>` scrollbar now mirrors `.ds-scrollbar`: transparent
  default, 8 px overlay thumb on hover (slate-400/50 light, white/20 dark).
- Under `(pointer: coarse)` or `≤ 767 px`, **every** scrollbar (html + all
  internal scroll containers) is fully hidden — touch already gets the OS's
  native transient indicator.
- The styling is applied to `*` so modals, drawers, dropdowns and tab panes
  inherit it without needing the `.ds-scrollbar` opt-in class.

### Performance — Lazy chunk splits (~91 KB gzipped deferred from first paint)

- **RepoDetail tabs.** Only `OverviewTab` is eager; Branches / Commits /
  Releases / Actions / Issues / Pull Requests / Settings each ship as their
  own chunk loaded behind `Suspense` + `SectionSpinner`. Initial chunk
  **331 KB → 188 KB (-43 %, gzip 89 → 58 KB)**; per-tab chunks 4.5–32 KB.
- **WorkBoard tabs.** Five non-default tabs (Stale PRs, My Issues, Review
  Load, Tech Debt, DORA) lazy-loaded. **75 KB → 42 KB (gzip 19 → 12 KB)**.
- **SettingsModal sections.** API Keys / AI Config (59 KB) / AI Instructions
  / Work Board (38 KB) / License / Audit Log / Probe Stats each split per
  tab. Modal opening chunk **165 KB → 18 KB (gzip 40 → ~5 KB)**.
- **MigrationWizard late steps.** AIReview / Schedule / Progress / Simple
  Progress / Summary / WorkItems / Wiki lazy-loaded. **228 KB → 139 KB**.

### Changed — Premium non-LLM theme sweep

Aligned every dialog, toast, banner, empty-state, error-state and
loading-state surface with the `2026-05-14-premium-non-llm-theme` spec.

- **Modals / dialogs.** `text-2xl font-bold` stat readouts downgraded to
  `text-lg font-semibold tabular-nums` in `PublishReviewModal`,
  `OrgManagerModal`; `CircularScore` ring numeric `text-3xl` → `text-xl`.
- **Toasts / banners.** `SessionBanner` lost its `shadow-amber-500/30`
  glow; `Toast` and `PendingSyncBanner` shadow scale brought back to
  `shadow-lg`; `RateLimitNotice` retry icon dropped
  `group-hover:-rotate-45`.
- **Empty / error / state surfaces.** `UpgradeRequired` shed its
  `DecorativeOrbs` (twin `blur-3xl` glow pair) and `NoiseGrain` SVG overlay;
  `ServiceUnavailable` deleted `Halo()` (28rem `blur-3xl` orb);
  `FeatureError`, `ViewErrorFallback`, `ErrorBoundary` dropped backdrop
  blur, colored shadows and glow rings; `EmptyState` CTA buttons now use the
  `Button` primitive.
- **AIReview loading.** `AnalysisLoadingState` lost its atmospheric radial
  glow; the step-connector vertical line went from a 3-stop violet-to-slate
  gradient to a solid divider.

### Changed — Primitive consolidation (agent-audited surgical sweeps)

- **`<select>` → `<Select>`.** Last native `<select>` in `src/components`
  migrated (BranchesTab sort, CollaboratorsSection permission picker,
  StalePRsTab stale-after, EmbeddingSection provider).
- **`<EmptyState>`.** TeamHub, TeamDetails, three MigrationWizard steps,
  ActionsTab — all hand-rolled empty cards swapped to the primitive.
- **`<Button>`.** Five raw indigo CTAs (RepoInsightsModal Done, PolishReview
  Cancel/Apply, SuggestNameDescriptionModal Apply, TeamHub View Pricing,
  TeamDetails View Statistics) plus the amber `AINotHealthyBanner` Verify
  button.
- **`<PageHeader>`.** Last hand-rolled `<h1 text-2xl font-bold>` migrated
  (PromptStudioPage).
- **`<Spinner>` tone-aware.** 14 `Loader2` callsites swapped to
  `<Spinner tone="...">` where the parent's text colour was stable; sites
  with variant-switching parents kept `Loader2` for `currentColor`
  inheritance.
- **`ds-focus-ring`.** Final raw `focus:outline-none focus:ring-2`
  patterns unified (Select primitive trigger, InlineEditField,
  MigrationWizard RepoRow chevron).
- **Tooltip primitive.** Refactored with `forwardRef` + Radix
  `useComposedRefs` so it now works inside `<Popover.Trigger asChild>`;
  rolled out to InlineActions, AISummaryCard, DevToolkit, diff toolbar,
  Header user dropdown / More sheet, command palette, AI assistant
  composer, banner dismiss buttons.

### Fixed — Mobile FAB stacking

- Removed the duplicate hamburger Menu FAB in `App.jsx` that stacked
  behind `MobileQuickActionsFab` at the same bottom-right slot,
  producing two indigo circles with an 8 px offset. The right-side
  Sidebar drawer it opened is covered on mobile by the quick-actions
  menu + SelectionBar + bottom-nav More drawer.
- Lifted the PR Review AI insights FAB to `bottom-[152 px + safe-area]`
  with a 24 px breathing gap above the quick-actions trigger, then
  applied the same peek pattern.
- AIPromoStrip dismiss `×` moved to the card's top-right (was overlapping
  the FAB in the action row); actions converted to a 2-col grid with
  short labels (`Assistant` / `Insights`) on mobile.

### Fixed — Accessibility

- `aria-label` added to seven icon-only buttons that previously surfaced
  only via `title=` (MigrationHistory rerun / export, OrgPanel view-mode
  toggle + create-org, TeamHub team menu with `aria-expanded` +
  `aria-haspopup`, AuditLogSection pagination).
- Header logo wrapper made symmetric on mobile (`pr-3` gated to `sm:`),
  killing the dark slate "tail" on the right side of the indigo square.

### Fixed — e2e regressions

- `ui/ContextMenu` root backdrop was `z-[99]` (above `--ds-z-ceiling = 80`),
  silently intercepting hover on its own menu items. Moved to
  `z-[var(--ds-z-modal)]` so submenu hover works again — repairs four
  spec families (context-menu, suggest-name-description, migration-autofix,
  ai-search).
- `responsive.spec` — replaced the removed "Open navigation menu" FAB tests
  with new "Quick actions" coverage; dropped the double-click pattern that
  toggled open ↔ closed on the toggle FAB; uses `evaluate(el.click())` for
  the peek-state click to avoid hit-test races under parallel CI workers.
- `ai-search.spec` — `getByTitle` → `getByRole 'button' { name }` after the
  quick-action icons moved from `title` to `aria-label` via the Tooltip
  primitive.
- `assistant-paste-url.spec` — `getByRole('textbox', { name })` →
  `getByPlaceholder` after the Field primitive started wrapping labels.
- `migration-autofix.spec` — mock 'huge' repo size was 11 MB (below the
  10 GB `SIZE_CRITICAL_BYTES` threshold); fixed to 11 GB so the
  `SizeStrategyCard` + AI Accept banner actually mounts.

### Removed

- `src/components/ui/MobileFAB.jsx` primitive + companion test (~5 unit
  tests) — defined but never imported; the peek pattern it documented is
  now reproduced inline in `MobileQuickActionsFab` and `PRReviewView`.
- `App.jsx` mobile hamburger FAB + companion right-side Drawer wrapper +
  `drawerOpen` state.

## [4.2.0] - 2026-05-13

A premium polish cycle on top of v4.1.1. Three big surfaces — the AI model
picker, the dashboard quota indicators, and the dashboard's Live Inbox — all
move from "functional" to "feels right". Plus a settings redesign, unified
modal primitives, and a security bump for mermaid. **3811 unit tests + the
full e2e suite pass on `main`; lint, test, build, and e2e are all green on CI
for the first time in days (the lockfile drift that had been breaking `npm ci`
since 2026-05-11 is fixed).**

### Added — Premium AI Configuration model picker

- **Sectioned dropdown.** `ModelDropdown` replaces the flat list with
  per-tier sections (`pro` / `mid` / `free` / `legacy`), each introduced by a
  `ModelSectionHeader` divider. `useFilteredModels` is the new hook that
  drives the partition; unknown tier items are skipped defensively.
- **Sticky tier filter chips.** `TierFilterChips` at the top of the dropdown
  stays visible while scrolling — filters the catalogue down to a single
  tier in one click. `hideTierBadge` prop is documented for callers that
  already show tier context elsewhere (so the chips don't double up).
- **Per-model premium card.** `ModelRow` surfaces capability icons
  (`vision`, `tools`, `reasoning`, `long-context`) and pricing pulled from
  the OpenRouter catalogue where available. Legacy entries get a tier label
  with muted styling; a NEW badge highlights recently released models
  (guarded against future-dated entries).
- **Live capability + pricing.** `providerModels.js` and `providerPricing.js`
  map the OpenRouter live catalogue into the picker. `$0` is correctly
  classified as priced (not "free"), and the legacy entry for Opus 4.1 is
  preserved across catalogue refreshes.
- **Premium colour-coding.** `pricingTier()` helper assigns five tiers
  (`free` / `low` / `mid` / `premium` / `frontier`) with WCAG-AA contrast
  in both light and dark mode. Aligned with the spec's mid shade
  (`slate-600`/`slate-300`).
- **Uses the `ds-z-floating` design-system token** — no raw z-index values.

### Added — Premium AI quota indicators (dashboard)

- **`<AIQuotaMeter />`.** A compact pill (~96×28px) with a thin SVG progress
  ring + numeric label (`47 / 200`) — always visible in the `AttentionFeed`
  and `Premium/InboxPanel` headers. Tone shifts indigo (<60%) → amber
  (60–90%) → rose (≥90% with subtle pulse), or emerald for unlimited
  tiers. Click opens a popover with reset countdown, "Manage usage"
  deep-link to Settings, and an "Upgrade to Pro" CTA on the free tier.
- **`<AIQuotaExhaustedCard />`.** Premium inline replacement for the amber
  "quota reached" banner: rose→amber gradient gauge icon, Pro-only
  benefits list, gradient indigo→purple Upgrade CTA. Mirrors the language
  of the existing `QuotaExceededState` full-page surface, scaled down to
  fit inside a dashboard card. Pro-only benefits are gated on
  `upgradeTo === 'pro'` (key-based, not label) so future tier additions
  don't silently hide the wrong copy.
- **`useAIUsage` hook.** Fetches `/api/v1/usage`, normalises the shape to
  `{ aiQueries: { current, limit, percent }, aiFeatures, tier }`. 30-second
  module-level TTL coalesces requests across multiple co-mounted consumers;
  focus events and quota-gate flips bypass the cache for fresh numbers.
- **Accessibility.** `aria-label` reads "AI quota: 47 of 200 requests used.
  Resets in 18 days. Click for details." Popover has `role="dialog"`,
  closes on Escape (focus restored to the trigger) and outside-click.
  `prefers-reduced-motion: reduce` disables the ring fill and rose pulse.

### Added — Premium Dashboard Phase 1: Live Inbox

- **Live Inbox replaces Attention Feed.** `InboxPanel` renders six sections
  (`needs_review`, `my_prs`, `mentions`, `failing_ci`, `stale_drafts`,
  `dependabot_ready`) on the dashboard hero. Gated behind
  `localStorage.setItem('dashboard_premium_v2_inbox', '1')`. Lazy-loaded —
  bundle delta is **3.6 KB gzip** (88% under the 30 KB spec budget).
- **`dashboard-aggregator.js`.** New `server/lib` module.
  `composeInbox(userId, opts)` fans out to `listMyPendingReviews`,
  `listMyOpenPRs`, `listMyOpenIssues`, `listStalePRs` with priority-based
  dedup so each item appears in only its most urgent section.
- **Four endpoints** under `GET|POST /api/v1/dashboard/inbox[/:itemId/archive|restore|snooze]`. All free-tier; no tier gate.
- **`dashboard_inbox_state` table.** `(user_id INTEGER, item_id TEXT, archived_at TEXT, snoozed_until TEXT)` — composite PK `(user_id, item_id)`. Stable `item_id` format: `pr:owner/repo#N` / `issue:owner/repo#N`.
- **AI narrative on top 3.** Active section's first 3 items get Gemini one-liners via the existing `POST /api/ai/attention-narrative`. Quota exhaustion halts fan-out; no cascading errors.
- **Keyboard shortcuts.** `e` archives, `s` opens snooze modal, chevron / title click expand/navigate row. Guard skips inputs, textareas, selects, and contenteditable elements.
- **Premium polish.** Skeleton loading state (per design rule 7), per-section empty-state copy, `aria-live` count updates, focus-visible action buttons (reachable by keyboard), focus-trapped `SnoozeModal`.

### Added — Settings premium pass

- **Two-column layout for the General tab.** Tighter modal height; primary
  preferences (theme, defaults) live on the left and account/danger-zone
  on the right. Better information hierarchy on wide screens, single
  column on narrow ones.

### Changed — Free-tier per-feature quotas

| Metric                   | Before | After  |
| ------------------------ | ------ | ------ |
| `semanticSearchPerMonth` | 50     | **75** |
| `repoInsightsPerMonth`   | 10     | **15** |

Conservative bumps on the two metrics where the cap binds most often,
keeping the global `aiQueriesPerMonth` deliberately at 200 (the cost
knob from the 2026-04-15 expansion). Amends
`docs/specs/2026-04-15-free-tier-expansion.md`.

### Changed — UI primitives

- **Modal / Confirm / Wizard primitives unified.** One shared shell;
  callers reclaim screen real estate that the old separate components
  wasted on duplicated chrome. No public-API breaks for consumers; the
  internal shell is what changed.
- **Shared `formatTimeUntil(iso)` in `src/utils/format.js`.** Both
  `AIQuotaMeter` and `AIQuotaExhaustedCard` consume the same helper
  instead of inlining their own divergent rounding. Future surfaces that
  need "in N days/h/min" countdowns reuse this.

### Fixed

- **`dashboard-inbox` e2e tests unblocked.** `src/api/dashboardInbox.js`
  now follows the project's mock-mode pattern (mirroring
  `fetchAttentionFeed` and the teams API): seeded in-memory inbox in
  `VITE_MOCK_MODE=true`, no-op archive/snooze acks that compose with the
  hook's optimistic UI. The e2e job has been failing on CI ever since the
  Live Inbox feature shipped; now green.
- **`package-lock.json` resynced.** Missing `@emnapi/core@1.10.0` /
  `@emnapi/runtime@1.10.0` transitive entries (optional Linux deps for
  Rolldown's native bindings) were blocking `npm ci` on CI runners since
  2026-05-11. Regenerated cross-platform.
- **Unhandled errors bridge to the toast surface.** A new error event
  bridge turns unhandled promise rejections + window errors into user-
  visible toasts, filtering noise from browser extensions so the toast
  area only shows actionable signal.
- `listStalePRs` correctly handles reopened PRs (latest lifecycle event
  check, parallel to `listMyOpenPRs` fix shipped on the same branch).
- `useInbox` snapshot capture uses a ref to avoid stale-closure race on
  rapid archives.
- ESLint config now ignores `dist/`, worktrees, and `.dev/` build
  artifacts so `npm run lint` is usable as a CI gate again.

### Security

- **`mermaid` 11.14.0 → 11.15.0.** Fixes moderate advisories surfaced by
  Dependabot. No usage changes.

### Known stubs (Phase 1)

- `failing_ci` and `dependabot_ready` sections return `[]` — data wired in
  Phase 2.
- DORA card deferred to Phase 2; Service Scorecards to Phase 3.

## [4.1.1] - 2026-05-10

Bundle hygiene patch on top of v4.1.0. Ships the perf work from PR #32
(merged post-tag) and unblocks the CLA check on contributor PRs.

### Performance — bundle size

- **`vendor-diff` -74% gzip (332 KB → 82.8 KB).**
  `@git-diff-view/lowlight` was calling `createLowlight(all)`, bundling
  all ~190 highlight.js grammars. The diff renderer only needs ~26.
  `src/lib/diff-highlighter-shim.js` is a drop-in replacement that calls
  `createLowlight(common)` (~40 langs) plus `dart` and `vue`, exporting
  the identical `highlighter` API. `vite.config.js` aliases
  `@git-diff-view/lowlight` → shim, so the redirect propagates
  transitively (Vite resolves it inside `node_modules`).
- **`LandingPage` lazy-loaded.** `LandingPage` and its sub-components
  (`HeroSection`, `FeaturesSection`, `PricingPreview`, `CTASection`)
  are only rendered for unauthenticated visitors; now `React.lazy()`
  with the existing `<Suspense fallback={<RouteFallback />}>` wrapper
  at the render site. Drops the main `index-*` chunk from 65 KB to
  57.1 KB gzip.
- **Bundle budgets net-tightened across the board.** New `vendor-diff`
  budget (86 KB). `index` 65 → 60 KB. `vendor-react` 65 → 57 KB.
  `vendor-ui` 35 → 28 KB. `vendor-icons` 20 → 15 KB. All passing with
  headroom.

### Fixed — CI

- **`cla-check` no longer crashes on contributor PRs.**
  `signatures/cla.json` was `[]` (malformed) instead of the
  `{"signedContributors":[]}` schema the action expects, which crashed
  `contributor-assistant@v2.6.1` with "Cannot read properties of
  undefined (reading 'some')" on every contributor PR. Schema fixed;
  contributors can now sign normally via the bot comment flow.

### Known follow-ups

- **`vendor-charts` (108 KB gzip) stays deferred.** Tested a recharts
  v3 → v2 downgrade — neutral on gzip (108.13 → 108.25 KB) because v2
  pulls d3 directly where v3 wraps it via `victory-vendor`, so reverted.
  Splitting recharts further requires Rolldown's `advancedChunks.groups`,
  which currently conflicts with `manualChunks` in the same output
  config (Rolldown 1.0.0-rc.15). Re-evaluate when Rolldown stabilises or
  swap to `visx` / `nivo`.

## [4.1.0] - 2026-05-10

The PR-review surface gets a deep premium pass: faster huge-diff
rendering, tightened mobile parity, better a11y, and a comment system
that finally feels coherent. The cycle bundles the last unreleased
work (Post-migration AI Polish Phase A) so users get one consolidated
upgrade. **3679 unit tests + the mobile e2e pass; ESLint clean; main
entry stays at 64.5 KB gzip (under the 65 KB budget).**

### Added — PR review premium pass

- **Layered render strategy for huge diffs.** Files >500 changed lines
  fold by default with a one-screen preview (`<DiffCollapser>`); files
  >50 000 changed lines render a click-to-compute placeholder
  (`<DiffComputeOnDemand>`) mirroring Monaco's `maxFileSize` pattern.
  Tab expansion runs through `useDeferredValue`. CSS
  `content-visibility: auto` on the diff wrapper for cheap paint
  savings on off-screen diffs.
- **Floating inline-comment composer.** Position-fixed card with the
  Modal design language (`rounded-2xl ring-1` + 25px shadow stack);
  bottom sheet on mobile with `safe-area-inset-bottom`. Keeps the diff
  scrollable behind it instead of trapping the user in a modal.
- **Sticky review action bar with animated SVG progress ring.** Framer
  Motion spring on the stroke offset + thumb-zone Approve / Comment /
  Request changes buttons sized to the 44 px Apple HIG touch target;
  `aria-live` live region for screen readers.
- **Mobile parity.** File tree opens as a bottom sheet
  (`<MobileFileTreeSheet>`) below the `md` breakpoint; AI Deep Review
  panel reachable via a gradient FAB drawer below `lg`. Both reuse the
  existing `<Modal mobileVariant="sheet">` primitive — no new top-level
  dependency. Focus is restored to the originating button on close via
  the new `useFocusTrap({ initialFocusRef, restoreFocusRef })` API.
- **Layout-animated FileTreeItem.** Marking a file viewed reorders the
  row smoothly via Framer Motion `layout='position'` + a scale-in
  check icon, all gated on `useReducedMotion`.
- **Keyboard help overlay (`?`).** Modal with shortcuts grouped by
  Navigate / Review / Diff / Help. PR-review-scoped commands appear in
  the global Command Palette (`cmd+k`) when the surface is focused —
  Mark current file viewed, Approve, Comment, Request changes,
  Toggle file tree, Show keyboard shortcuts.
- **Unified comment chrome.** Synced threads, pending drafts, and AI
  Deep Review suggestions now share one neutral container in the
  diff stack; distinction lives in a small status badge in the header
  (pending pill / AI gradient orb + severity chip) instead of three
  competing card styles.

### Added — Z-index design tokens

- **Documented z-index scale** in `src/design-system.css`
  (`--ds-z-surface/floating/composer/popover/modal/toast/ceiling`).
  Toast layer sits above modal so system messages are never hidden by
  whatever sheet the user is in.
- **37 UI surfaces converted** to use the tokens (modals, drawers,
  popovers, dropdowns, FABs, sticky bars, tooltips). Replaces the
  previous implicit `z-30 / z-40 / z-[60] / z-[100]` drift.
- **Pre-commit guard** (`scripts/check-no-raw-z-index.mjs`) rejects new
  staged files containing raw numeric z-classes outside
  `src/design-system.css`. Wired into lint-staged. `focus:` /
  `hover:` variant prefixes are exempt (correct for a11y skip-links).

### Added — Bundle hygiene

- **Pre-commit guard** (`scripts/check-no-static-mock-imports.mjs`)
  rejects top-level `import ... from '.../__mocks__/...'`. Static
  imports of mock modules pin them in production bundles even when the
  runtime branch is dead-code-eliminated. Four hooks
  (`useAIDeepReview`, `usePRChat`, `usePRCommand`, `usePromptStudio`)
  converted to dynamic `await import()` inside inlined
  `import.meta.env.DEV && VITE_MOCK_MODE === 'true'` branches.
- **Verified bundle clean.** A grep for the mock symbol names in
  `dist/assets/*.js` returns zero matches after build.

### Added — Backend

- **Structured `code: 'INSUFFICIENT_PERMISSIONS'`** on the branch-
  protection 403 response when GitHub returns "no admin" without the
  Pro-required hint. Lets the client render a quiet inline "admin
  required" affordance instead of a generic error toast.

### Added — Mobile e2e

- `e2e/pr-review-mobile.spec.js` (gated on `E2E_MOBILE=1`) drives the
  full mobile flow on iPhone 13: dashboard → Repos → repo detail →
  Pull requests → open PR → Files tab → "Files (N)" bottom sheet →
  select large file → fold placeholder → Show diff → diff renders. A
  large fixture file (`src/big-refactor.js`, 600/200 lines) is added
  to `mockRepoDetail.js` so the fold path is reachable in mock mode.
- `data-testid="repo-card-open"` on the RepoCard title button so e2es
  can navigate without triggering selection mode.

### Fixed

- **403 noise on `BranchProtectionPanel`.** Non-admin collaborators
  previously saw an alarming red toast. Now they see a calm "Admin
  access required" card (or "🔒 admin only" chip in the inline
  variant). Console + toast layer stay quiet for what is an expected,
  structural state.
- **`@git-diff-view/core` mismatch warnings.** Dev-only sanity
  warnings from the diff lib that fire because we feed it GitHub patch
  fragments without full file content are silenced via a module-load
  console-warn filter (gated on `import.meta.env.DEV`,
  sentinel-protected against HMR double-install). Production builds
  unchanged.
- **`h-screen` on iOS Safari.** PRReviewView used `h-screen` which the
  iOS URL bar eats; switched to `h-[100dvh]`.
- **Floating composer ↔ AI FAB collision.** The AI FAB hides while the
  inline composer is open via a `pr-review:composer-open / -close`
  event pair so rounded corners can't poke through each other.
- **`useReviewKeyboard` interfering with native dropdowns.** The
  `j` / `k` / `x` / `?` shortcuts now correctly bail when focus is in
  a `<select>`, `[role=combobox]`, `[role=textbox]`, or
  `[role=listbox]`.
- **AI FAB bypassing reduced-motion.** The `hover:scale-105`
  transition was a Tailwind transform that ignored
  `prefers-reduced-motion`; switched to `motion-safe:` /
  `motion-reduce:` variants and bumped the FAB to the Material 56 px
  standard.
- **`showHints` session counter overshoot in `ReviewStatusBar`.** Was
  incrementing on every remount; now uses a `sessionStorage` flag so
  it counts at most once per tab session (3-session lifecycle
  intended).
- **Action-bar visual hierarchy.** Approve is now the primary CTA
  (semibold + emerald shadow), Comment is a ghost button, Request
  changes uses calmer rose tones — three competing peers became one
  obvious primary plus two fallbacks.
- **`AISummaryPanel` + `AIReviewPanel` duplication.** The lightweight
  heuristic summary now hides as soon as a deep-review draft exists
  and `useReviewAI` skips its LLM call when `deep.draft` is already on
  screen — saves a token round-trip per PR view.
- **Unit-test repair.** `aiActions.test.js` (added `open_ai_polish` to
  the expected registry sort) and
  `suggest-name-description-route.test.js` (loosened the deterministic-
  fallback assertion to accept either valid template).

### Changed

- **Palette unification.** `gray-*` → `slate-*` across every modified
  surface; zero raw `gray-N` classes left in `src/`.
- **Build budget.** Main entry stays at 64.5 KB gzip after every
  change in this cycle (the 65 KB budget gate is honoured).

### Added — Post-migration AI Polish (Phase A)

- **Batch description suggestions for migrated repos.** When a migration
  plan completes, the SSE `plan-complete` payload now carries
  `createdRepos[]` (full_name + html_url) aggregated from successful task
  metadata. `ProgressStep` re-emits this as a `migration:complete` window
  event so anything in the app can react.
- **Assistant proactive nudge.** A bridge in `App.jsx` injects a system
  message into the AI Assistant ("Migrei N repos — queres polir?") with
  an `open_ai_polish` action chip. Discoverable even if the wizard was
  closed before clicking.
- **`open_ai_polish` action.** New entry in `aiActions.js` with payload
  validation (`repoFullNames` array, max 50, owner/repo regex). Same
  whitelist + sanitisation as model-generated actions.
- **`AIPolishModal` + `PolishReview`.** Batch table with one row per
  migrated repo: per-row include checkbox, editable description input
  pre-filled with the AI suggestion, status pill (loading / ready /
  applying / done / error / quota), Framer Motion stagger on row arrival.
  `useAIPolish` hook handles concurrency-3 fetch + apply + 429 short-
  circuit + per-row retry.
- **Instant repo-list propagation.** Apply runs in parallel with
  concurrency 3; each successful PATCH funnels through
  `patchRepoEverywhere` so the personal + org-scoped repo lists update
  in-place without refetch.
- **`AIAssistant.jsx` system message injection.** New `window` event
  `ai-assistant:inject-message` lets any caller append a validated
  assistant message + actions to the chat history (subject to
  `sanitizeActions`).

### Fixed

- **Repo description / topics edits no longer go stale.** When the user
  was viewing an organisation, the repo list (`orgRepos`) was never
  refreshed after a `RepoDetail` mutation — the user had to switch orgs
  to see their own change. Replaced the post-mutation `refresh()` with a
  surgical `patchRepoEverywhere(updatedRepo)` helper that mutates the
  matching item in both `repos` and `orgRepos` in place. No refetch,
  instant feedback.

### Tests — Post-migration AI Polish

- 5 hook tests for `useAIPolish` (mount/fetch/ready, apply with included
  rows only, 429 quota state, edited proposal sent on apply, empty input
  no-op).
- 3 component tests for `AIAssistant` system message injection (validates
  through `sanitizeActions`, renders chips, ignores empty events).
- 2 server tests for `migration-engine` `createdRepos[]` aggregation
  (happy path, excludes failed + non-repo tasks).
- 2 hook tests for `useGitHub` exposing `patchRepoLocal` /
  `patchOrgRepoLocal` / `patchRepoEverywhere`.

Spec: [`docs/specs/2026-05-08-post-migration-ai-polish.md`](docs/specs/2026-05-08-post-migration-ai-polish.md). Phase A
is description-only; topics + README columns + summary-step card +
wizard step ship in Phase B/C.

## [4.0.0] - 2026-05-08

The full premium PR review surface lands in this cycle, alongside a sweep
of premium UX consolidation (unified error vocabulary, surface primitives,
single drawer system) and the long-promised Suggest Name & Description
modal. End-user docs: [`docs/features/ai-deep-review.md`](docs/features/ai-deep-review.md).

A multi-agent audit at the end of the cycle hardened the AI/import
surface (input validation, prompt-injection guards, SSRF + DNS-rebinding
defence, cross-user cache isolation), repaired several silently-broken
UX flows (upgrade CTA, quota reset date, BYOK provider label), and
deduplicated ~600 lines of copy-pasted plumbing. **1740 server tests +
3501 frontend tests pass; ESLint clean.**

### Added — AI Deep Review (slice 1a, free core)

- **`runDeepReview` engine** produces a markdown walkthrough, per-file
  change table, Mermaid sequence diagram, and up to 25 line-level review
  comments with editable `suggestion` blocks. Drafts persist in
  `ai_pr_reviews`; `<PRReviewView>` + `<AIReviewPanel>` render Walkthrough
  / Comments / Commands / Chat tabs with diff overlays.
- **One-click batched publish** through the existing outbox with
  idempotency key `pr-deep-review:{draftId}:{event}` — double-clicks across
  server restarts collapse into a single GitHub review row.
- **5 routes under `/api/ai/deep-review/*`** with rate limiting on
  generate, cost wiring, and a Playwright E2E smoke that exercises the
  full happy path.
- **MOCK_MODE** returns canned fixture; publish in mock mode is honest
  (no fabricated `githubReviewId`) and surfaces a `<DemoModeBanner>`.

### Added — AI Deep Review (slice 1a-2, production hardening)

- **Provider `usageMetadata` threading** across Gemini / Anthropic /
  OpenAI / OpenRouter / local backends.
- **Unified `computeCostUSD`** cost wiring; OpenRouter pricing prefix
  normalisation so `anthropic/claude-*` resolves to real Anthropic
  pricing rather than fallback.
- **LRU sweep** on the in-memory rate limiter to prevent unbounded growth;
  Mermaid theme observer for dark-mode parity; modal focus trap via
  shared `useFocusTrap` hook.

### Added — AI Deep Review (slice 1b, Premium Prompt Studio — Pro)

- **`ai_review_prompts` table** + 5 built-in preset lenses (general,
  security, performance, accessibility, refactor).
- **Preset store + resolver** with scope precedence
  (explicit `presetKey` → repo-default → user-default → org-default →
  built-in `general`) and `${REPO_STYLE_GUIDE}` token substitution from
  `.repomanager/review-rules.md` (capped at 16 KB).
- **Path-scoped rules** (capped at 20 in editor) and **severity floor**
  threading into the engine.
- **7 routes under `/api/ai/prompt-studio/*`** — CRUD requires Pro; GET
  endpoints are free so the picker renders for every tier.
- **`/ai/prompts` page** with Library + Editor + `PromptPicker` dropdown
  wired into `<AIReviewPanel>`. PromptPicker a11y: Escape / click-outside
  dismiss, arrow nav, `aria-controls`.

### Added — PR Slash Commands (Pro)

- **`/describe`, `/test_plan`, `/improve`** invokable from a Commands tab
  in the AI Review Panel.
- **`/describe` → "Apply to PR"** PATCHes the PR body via the outbox with
  body-hash + `updatedAt` idempotency key (guards double-publish across
  test-env retries).
- **4 routes under `/api/ai/pr-commands/*`**, all `requireTier('pro')`.
  Per-user 20/h rate limit. New `ai_pr_commands` table.

### Added — PR Chat tab (Pro)

- **Streaming Q&A** via SSE on `POST /api/ai/pr-chat/:owner/:repo/:pr`
  using the existing `useStreaming` infra (preserves `err.code` +
  `retryAfterSec` on failure).
- **Per-`(user, PR)` history** persisted in `ai_pr_chat_messages` with
  `MAX_HISTORY_TURNS = 10` collapse.
- **Defence in depth** — every PR-derived string sanitised via
  `sanitizeForPrompt`. AbortController on unmount + new-send + cancel.

### Added — Org-shared prompts (Pro)

- **`scope='org'`** end-to-end. New `github-org-membership.js` helper
  (`isOrgMember`, `filterOrgsByMembership`, `getCurrentUserOrgs`) cached
  5 min via gh-cache.
- **Resolution chain** extended to include `org-default` between
  user-default and built-in.
- **Org members read org-shared presets** even when not authors;
  PATCH / DELETE / set-default still author-only. `shared · {org}` and
  `read-only` badges in the Prompt Library.

### Added — Premium UX unification

- **Unified AI error vocabulary** (17 codes) and shared `<AIErrorState>`
  mounted on 5 high-traffic AI surfaces.
- **`<SafeMarkdown>`** (react-markdown + rehype-sanitize + remark-gfm)
  for every model-output surface.
- **Global `<DemoModeBanner>`** for honest mock-mode signal across the
  app shell.
- **`PromptPicker` discoverability** — surfaced in AI Review Panel and
  reachable from Settings → AI + Command Palette.
- **PRFilesTab "reviewed" state** persisted to `localStorage` per
  `(user, PR)`.

### Added — Surface uniformity primitives

- **`<SectionPanel>`, `<HeroHalo>`, `<CountUp>`, `<PageMount>`** — four
  shared primitives applied across Dashboard / RepoDetail / WorkBoard.
  All honour `prefers-reduced-motion` and hit the WCAG contrast bar.
- **RepoDetail tabs** upgraded from flat `<Card>` to `<SectionPanel>`.

### Added — Suggest Name & Description

- **Dedicated modal** proposes a concrete name and description for a
  repository; users accept / edit / reject each field independently and
  the change is applied via the existing repos `PATCH` endpoint.
- **Works with or without an AI key** — falls back to a deterministic
  generator that draws from indexed AI metadata, README h1 + first
  sentence, topics, and primary language.
- Available from the repo context menu and from a new **"Suggest with
  AI"** button in the Settings tab.

### Changed — Drawer consolidation

- **Unified `<Drawer side="left|right|bottom">` primitive** replacing
  `Sheet`, `MobileDrawer`, `SidePanel`, and `AutoFixDrawer`'s bespoke
  shells. Bottom variant adds drag handle + `safe-area-inset-bottom` +
  swipe-to-dismiss (drag-y > 100 px or velocity > 500). 10 consumers
  migrated; 3 primitives deleted.

### Fixed

- **`MobileDrawer side="bottom"` was silently routing to `right`** —
  `RepoFilterBar` and `SelectionSheet` were sliding from the wrong edge
  before the Drawer consolidation. Bottom-anchored sheets now actually
  anchor to the bottom on mobile.
- **AI provider auth errors** (`401`) collided with session-expiry
  handling — remapped to `422` so the AI Configuration modal reopens
  instead of triggering a logout flow.
- **`ConfirmModal` ported to `<Modal>`** primitive — fixes scrollbar
  shift and inconsistent focus return on close.
- **`AIAssistantPasteDialog`** dialog semantics — proper `role="dialog"`
  + `aria-labelledby` + Escape handler.
- **`core.js` AI endpoints** (chat / suggest / readme / readme-enhance)
  unified through `quotaExceededResponse` + `handleAIError`.
- **Prompt Studio preset upsert** — wrap NULL-scope-target case in a
  transaction to close a TOCTOU window.
- **`app:open-billing` had no listener** in `App.jsx` — the upgrade CTA
  on every `<AIErrorState>` whose action was `type: 'upgrade'` was a
  no-op. Now routes through the same `setActiveView('pricing')` path as
  `app:navigate-pricing`.
- **`limit.resetDate` was always undefined** — the dev-toolkit endpoints
  fell back to a hardcoded "Resets next month" string instead of the
  real reset date. Replaced four inline 429 envelopes with
  `quotaExceededResponse` so users now see the actual UTC reset date.
- **`/ai/review-summary` 429 missed `code: 'QUOTA_EXCEEDED'`** —
  client-side quota gate (`aiFetch`) didn't fire for that endpoint, so
  the UI kept retrying instead of surfacing `<QuotaExceededState>`.
- **`/config/ai-status` hard-coded `provider: 'gemini'`** — BYOK users
  on Anthropic / OpenAI / OpenRouter saw "Gemini" in Settings. Now
  resolves and reports the actual provider id.
- **`importSchema` silently stripped `makePrivate` / `credentials` /
  `description`** — `makePrivate: false` was being ignored (every
  import forced private) and basic-auth credentials never reached
  `importService`. Schema now declares the fields explicitly.
- **`WorkBoardCapReachedBanner` progress bar was hard-coded to 100 %**
  — now reflects `spentCents / capCents` and exposes `role="progressbar"`
  with `aria-valuenow`.
- **AIInstructionsSection setState after unmount** — added a
  `cancelled` flag to the load `useEffect`.
- **Modal accidental dismiss** — `closeOnBackdrop=true` was the default
  on every large modal (Settings, RepoInsights, OrgManager, Migration
  History, Compare Diff, Suggest Name & Description, Community Health,
  Commit Detail, Codeowners, Batch Index, Publish Review,
  PatternSelect, License Activation, Security Scan, Keyboard Help,
  My Reviews) — accidental clicks outside discarded in-progress edits.
  All 16 large modals now require an explicit X-button or Escape
  dismiss. Drawer gains the same `closeOnBackdrop` opt-out, applied to
  AutoFix migration drawer + DLQ admin detail panel. ConfirmModal /
  shortcuts overlays / mobile sidebars retain backdrop close because
  they are transient or navigation-only.

### Security — multi-agent audit fixes

- **Prompt-injection hardening on `/ai/suggest`, `/ai/readme`,
  `/ai/readme/enhance`, `/ai/quality-report`** — replaced
  `JSON.stringify(req.body.repo)` (raw user-supplied object inlined into
  the LLM prompt) with `validateBody(...Schema)` + per-field
  `sanitizeForPrompt`. Added `aiRepoMetadataSchema` allow-list of
  whitelisted repo fields.
- **Cross-user data leak in `/ai/analyze-context`** — the in-memory
  `contextCache` keyed entries by `repo:files:additions:deletions`
  without `userId`, so two users with the same repo + diff stats could
  receive each other's AI analysis. Key now includes `userId` and the
  Map is replaced by the bounded `createCache` LRU+TTL primitive.
- **Mermaid SVG XSS defence** — `WalkthroughTab` no longer assigns the
  model-derived SVG via `innerHTML`. New `parseAndSanitizeSvg`
  (`src/utils/sanitizeSvg.js`) parses with `DOMParser`, strips
  `<script>` / `<foreignObject>` / `<iframe>` / `on*` attributes /
  `javascript:` hrefs, and adopts the result via `replaceChildren`.
  Mermaid `securityLevel: 'strict'` is pinned explicitly.
- **`requireTier('pro')` on every `/api/ai/deep-review` route** — five
  handlers (POST generate, GET draft, PATCH comment, POST publish,
  DELETE) were free for any authenticated user with BYOK; gating now
  matches `pr-chat` / `pr-commands`.
- **DNS-rebinding defence on import routes** — `/import/url`,
  `/import/validate-url`, `/import/azure`, `/import/azure/batch` now run
  both `assertSafeExternalUrl` (string-level) **and**
  `resolveAndValidateHost` (DNS-resolution) before handing the URL to
  git. The Azure import paths previously skipped both, so an Azure org
  could return a clone URL pointing at internal addresses.
- **Zod schemas on every AI / import endpoint** — `aiReviewSummarySchema`,
  `aiGenerateCommitSchema`, `aiGeneratePrSchema`, `aiRefineSchema`,
  `aiChatRefineSchema`, `aiAnalyzeContextSchema`,
  `azureImportSchema`, `azureImportBatchSchema`,
  `importValidateUrlSchema`, `importCheckDuplicatesSchema`. Allow-list
  enforcement on `/ai/refine` instruction (drops the
  `|| instruction` raw fallback). History `role` enum on
  `/ai/chat-refine` blocks role-spoofing.
- **`hook_id` route-param validator** in `repos/actions-community.js`
  (`^\d{1,15}$`) — the value was previously interpolated into GitHub
  API URLs verbatim.
- **License-cache TTL** — `getUserTier` now best-effort-refreshes the
  in-memory license cache after 5 min for DB-sourced licences, so
  hot-revoked keys propagate without a server restart.
- **`req.session.isAdmin` cached for 10 min** — `/session-info` polled
  every 5 min and triggered a synchronous `SELECT is_admin FROM users`
  on each call.
- **`/api/import/check-duplicates` Zod-bounded to 100 repos** so a
  single request can no longer fan out unbounded GitHub API calls.

### Changed — multi-agent audit cleanup

- **`src/utils/appEvents.js`** centralises `openAISettings`,
  `openAppSettings`, `navigateToPricing`, `openBilling` — replaces four
  divergent local `window.dispatchEvent(...)` copies across
  `AINotConfiguredBanner`, `AINotHealthyBanner`, `QuotaExceededState`,
  `AIErrorState`.
- **`src/components/AI/bannerMotion.js`** — `BANNER_VARIANTS` +
  `BANNER_REDUCED_VARIANTS` shared by four banners (`AINotConfigured`,
  `AINotHealthy`, `WorkBoardCapReached`, etc.) instead of three byte-
  identical local copies.
- **`server/lib/in-memory-rate-limiter.js`** — `createInMemoryRateLimiter`
  + `createCooldownLimiter` factories. `deep-review.js` migrated; the
  pattern is ready for `pr-chat`, `pr-commands`, `prompt-studio`,
  `user-ai-config`. Each previously held its own near-identical
  sliding-window `Map` implementation.
- **`server/routes/repos/_shared.js`** — `GITHUB_NAME_RE`,
  `clampPerPage`, and `applyOwnerRepoParamValidators` lifted from six
  sub-routers (`crud`, `pulls`, `issues`, `commits`, `branches-releases`,
  `actions-community`).
- **`formatRelativeTime`** consolidated into five components that each
  carried a local `relativeTime()` (`AttentionFeed`, `Header`,
  `WorkBoardSummary`, `RepoRow`, `DiscoveryPanel`).
- **`MS_PER_DAY`** from `src/utils/time.js` adopted in five inline
  date-math sites (`prRisk`, `statsAggregator`, `ConflictPanel`,
  `OrganizationCard`, `LicenseBadge`).
- **`friendlyAiError`** marked fully `@deprecated` after `AISummaryCard`
  and `CommunityHealthFixModal` migrated to `formatUserError` +
  `<AIErrorState />`. `formatUserError` now accepts the lowercase
  server aliases (`ai_quota_exceeded`, `ai_rate_limited`, …) and
  surfaces the server-supplied `retryAfterSec`.
- **`ds-*` prefix** applied to `.ds-scrollbar`, `.ds-no-scrollbar`,
  `.ds-animate-spin-slow` (19 call-site updates), restoring the
  CLAUDE.md design-system contract.
- **`quotaErrorPayload`** marked `@deprecated` — every production caller
  uses `quotaExceededResponse` (the canonical envelope the frontend
  parses).
- **A11y polish** — `FALLBACK.action.type: 'retry'`,
  `aria-busy={loading}` on `<AIRunButton>`, `role="status"` +
  `aria-live="polite"` on `<QuotaExceededState>`, roving `tabIndex` +
  `role="tabpanel"` + `aria-labelledby` in `<AIInstructionsSection>`
  tabs.

### Security

- **`sanitizeForPrompt`** applied to every PR-derived string fed into
  AI Chat to neutralise prompt-injection attempts in PR bodies, comments,
  and file paths.

## [3.8.0] - 2026-04-28

A feature-and-honesty release. The dashboard hero, mobile nav and AI surfaces
were rebuilt; the Work Board grew a tracked-repos / discovery / AI-suggestions
spine across seven implementation phases; and a four-slice "vaporware audit"
swept the codebase for fake placeholder data, unmapped errors, missing
quota signalling, mocked-prod leaks, and inconsistent UI primitives. CSRF
coverage was extended to every mutating same-origin call site that had been
hand-rolled around `fetchWithRetry`. 2782 unit tests pass (up from 2060 at
v3.7.2); CI gates lint warnings, build honesty, and a 415 KB-gzip eager
bundle budget on every commit.

### Added — Dashboard hero redesign

- **`DashboardHero` composition** (`src/components/Dashboard/DashboardHero.jsx`)
  replaces the old PageHeader + YourWorkCard + AI banner with a unified
  mobile-first hero: personalized greeting (`getGreeting`), org-filter chip,
  time-range chip, and a "What needs you" grid (`WhatNeedsYouGrid`) with
  reviews / stale / issues counts, week-over-week deltas, and a celebratory
  empty state.
- **`HeroChip` primitive + variants** — `HeroOrgChip` (popover on desktop,
  bottom sheet on mobile via `Sheet`), `HeroTimeRangeChip`, mobile-only
  `HeroSyncChip`. All three are URL-syncable.
- **`AIPromoStrip`** — slim auto-dismissing AI promo with telemetry-driven
  visibility (`useAIPromoVisibility` + `useSyncExternalStore`); listens to
  `assistant:open-count` and `insights-viewed` events and hides itself once
  the user has clearly engaged with AI.
- **`AttentionFeed` on the Dashboard** — surfaces the top three repos that
  need your eyes today, with a `/api/v1/ai/attention-narrative` endpoint
  rendering an AI-written one-liner per item (1-hour cache).
- **PR list — inline risk badges** — every PR row carries a risk pill driven
  by the existing PR-review risk engine.

### Added — Mobile UX overhaul

- **`MobileQuickActionsFab`** — bottom-right FAB that expands Create / Import
  / DevToolkit with stagger animation, ESC handling, and focus management.
- **Mobile bottom-nav (5 items + More sheet)** in `Header.jsx` — `Home`,
  `Repos`, `Work` (with tracked-pending dot), `Teams`, `More`. The "More"
  bottom sheet exposes Pricing / Settings / sign-out.
- **`MobileDrawer` reachable via the Open-navigation-menu FAB** — keeps the
  desktop Sidebar accessible on mobile without showing the legacy slim rail.

### Added — Work Board (tracked repos + AI upgrade, 7 phases)

- **Phase 1 — Tracked repos foundation.** New tables `tracked_repos`,
  `prefs`, `ai_dismissed`, `undo_log` (migration 016). CRUD endpoints under
  `/api/v1/work-board/tracked-repos` (single + bulk), discovery
  (`POST /discover` with five signal collectors: review / authored /
  assigned / owned / commits), `POST /undo/:operation_id` with 24 h TTL,
  `GET/PATCH /prefs`. Existing read endpoints now drop muted repos and
  webhook ingestion auto-inserts unknown repos.
- **Phase 2 — Settings UI.** `WorkBoardSettingsSection` composes a
  premium tracked-repos manager: `RepoRow` with pin/mute/untrack menus,
  virtualized `TrackedReposList`, sticky `BulkActionsBar`, debounced
  `SearchFilterBar` with signal chips, `DiscoveryPanel` (refresh window +
  auto-mute), `AddRepoInput` with cmdk autocomplete, `WebhookConnectPanel`
  (tier-gated), `DangerZoneCard` (reset + clear-all confirms).
- **Phase 3 — Inline row actions.** Per-row `WorkBoardRowMenu`
  (pin/mute/untrack) on every Work Board tab + `EmptyStateDiscovery` with
  discover CTA, `ManageReposButton` popover in the page header.
- **Phase 4 — Cross-app integration.** `TrackedDot` indicator on RepoCards,
  `TrackedChip` in RepoDetail and PR Review headers, header nav badge
  driven by `useWorkBoardBadgeCounts`, Dashboard "Your Work" card with live
  counts.
- **Phase 5 — Command Palette extension.** `Ctrl+K` chip in the header,
  palette commands for pin / mute / track / refresh + tracked-repos fuzzy
  search via `GET /api/v1/work-board/repo-search`.
- **Phase 6 — AI Assistant backend.** `work_board_ai_spend` table for
  monthly cost tracking, AI gate middleware (flag + opt-in + cost cap),
  versioned prompts, deterministic suggestions engine
  (`server/lib/work-board-suggestions-engine.js`), HMAC-signed validity
  tokens for diff handoff, suggestions / dismiss / interpret / apply
  endpoints.
- **Phase 7 — AI Assistant frontend.** `WorkBoardAISection` with
  ConversationalEdit (preview → apply), SuggestionsPanel, AI activity
  card with spend + cap progress, AI Assistant toggle + monthly cap
  selector, AI commands group in the palette.
- **KPI snapshots.** Migration 017 adds `work_board_kpi_snapshots`; daily
  job extends the sweeper; `GET /api/v1/work-board/kpi-snapshots` exposes
  trend data; sparklines + delta badges + count-up animation on KPI tiles.
- **Suggestion chips on rows.** `POST /api/v1/work-board/suggest-action`
  returns ping / snooze / view chips on hover/focus; typewriter draft
  comment replaces the old `window.prompt`.
- **AI summary card** redesigned with two-column layout + urgency glow;
  trend-aware `buildFactSheet` passes 7-day snapshots into the prompt.
- **Keyboard nav.** `useFocusedRow` adds `j` / `k` row navigation across
  every Work Board tab.

### Added — Premium AI Configuration & honest error handling

- **Premium AI Configuration layout** in Settings with curated model
  dropdowns per provider, per-feature override section
  (`PerFeatureOverrideSection`), and a `CurrentConfigSummary` with
  per-feature key-health pills.
- **AI key health probes.** `keyHealth` field on the cached AI status
  endpoint; banners surface "invalid key" and "monthly cap reached" without
  firing the underlying request. Telemetry on probe outcomes.
- **Admin AI Probes tab** with `ProbeStatsSection` reading
  `/api/v1/admin/probe-stats`.
- **`formatUserError`** (`src/utils/errors.js`) + `toast.errorFromException`
  helper. 50 `toast.error(err.message)` callsites routed through the
  uniform mapper so users see "Couldn't reach the AI provider — try again
  in a moment" instead of `TypeError: fetch failed`.
- **`QuotaExceededState` modal** (`src/components/ui/QuotaExceededState.jsx`)
  with tier-aware CTA; mounted on the `app:show-quota-exceeded` event so
  every 429 in the app surfaces as a single rich UI.
- **Server quota envelope.** `quotaErrorPayload` + `tierRequiredPayload`
  helpers; existing 429 helper now emits `code: 'QUOTA_EXCEEDED'` for
  uniform frontend handling.

### Added — Cross-app polish

- **Conversational ask mode in `Ctrl+K`.** Natural-language queries hit
  `/api/ai/translate-search` (5-min cache) and convert to GitHub Search
  syntax; results stream back into the palette.
- **Recents + footer keyboard hints in `Ctrl+K`.** Contextual command
  groups change per active view.
- **Real notifications digest** in the header dropdown
  (`/api/v1/notifications/digest` + `/notifications/mark-seen`),
  `users.notifications_last_seen_at` column, aggregator library.
- **Branch hygiene panel** above `BranchesTab` — surfaces stale,
  unprotected, and conflicted branches with inline actions.
- **Personal-account aware `OrgManagerModal`** — opens on the user's own
  account when no org is selected.
- **AI-suggested topics in `RepoDetail` Settings tab.**
- **`RepoHealthBadge` is clickable** — opens the Insights Quality tab.
- **`PRDetailPanel` Generate Description + `CommitTab` Generate** are
  gated on AI being configured (no more silent failures).

### Added — Onboarding & UX uniformity

- **`useOnboarding` hook + `OnboardingTour`** 3-step carousel; mount in
  `App.jsx` with focus trap, a Settings re-run button, and an
  `app:show-quota-exceeded` listener that pauses the tour while the modal
  is up.
- **UI primitive consolidation.** New `Spinner` / `SectionSpinner`,
  `PageShell` / `PageHeader`, `EmptyState`, `Skeleton`, `Card`, expanded
  `Button` (soft-primary, soft-danger, outline, size=xs). 25 standalone
  `Loader2` sites migrated; 7 raw modals + DevToolkit SectionCard +
  AuditLog table + DLQ panels migrated to the shared primitives.
- **Lint guard against standalone `Loader2`** so the regression doesn't
  re-enter the codebase.
- **`docs/specs/` and `docs/plans/`** added for every slice (audit, AI
  wiring, UX uniformity, code health, work-board upgrade, dashboard hero).

### Changed — CSRF coverage on every mutation

- **30+ hand-rolled `fetch()` mutations** across migration wizard, teams,
  settings, dev toolkit, billing, AI chat, and the bulk-confirmation
  helper now route through `getCsrfToken()` before the POST/PUT/PATCH/
  DELETE. Coverage helpers in `useRepoDetail.apiFetch`,
  `useReviewAction.call`, `useWorkBoardPresets.call`,
  `useDevToolkit`, `useStreaming`, `useAzureOrganizations`, and
  `bulkExecuteWithConfirmation`. Server middleware unchanged — this
  closes a gap where new code had been bypassing the existing
  `requireCsrfToken` guard.
- **Test parity.** Seven test files updated to mock
  `@/utils/api.getCsrfToken` so the test fetch queue isn't consumed by
  the auth/csrf-token request. Header assertions relaxed to
  `expect.objectContaining` to allow `X-CSRF-Token`.

### Changed — Honesty pass

- **Mock factories moved behind a dev-only guard.**
  `src/__mocks__/mockAI.js` is loaded via dynamic `import()` from
  callsites that inline `import.meta.env.DEV && VITE_MOCK_MODE === 'true'`
  so production builds tree-shake the mock entirely.
- **CI build-honesty gate** (`tests/build/build-honesty.test.js`) fails
  the build if a production bundle contains mock-repo strings.
- **AI placeholders.** When AI is not configured, every analysis-shaped
  endpoint returns explicit `null` scores with a `Connect AI to see real
  analysis` note instead of fabricating numbers.
- **README honesty regression guard** (`tests/ci/`) catches future
  README claims that grep can't back up against the source tree.
- **ESLint rule** forbidding `.stack` access in `src/components/` so
  internal stacks can never reach a UI surface.

### Changed — Performance & operational guards

- **Bundle-size budget gate** (`tests/build/bundle-budget.test.js`):
  eager set ≤ 415 KB gzip. Sentry switched to named imports + dropped
  the dead `getCurrentHub` fallback.
- **`coverage.thresholds.{}`** updated to the Vitest 4+ schema.
- **`coverage/`** added to `.gitignore`.
- **Brand label demoted** from `<h1>` to `<h2>` (`Header.jsx`) so the
  page-level `<h1>` (e.g. the dashboard greeting) is the single
  semantic heading per route.
- **`/api/system/setup`, `/api/system/client-error`, `/api/v1/license/validate`,
  `/api/v1/billing/portal`, `/api/v1/billing/checkout`,
  `/api/stats/clear-cache`, `/api/repos/check-conflicts`, `/api/orgs/:org`
  PATCH, `/api/azure/projects` POST, `/api/azure/repos/*`,
  `/api/import/check-duplicates`, `/api/import/validate-url`,
  `/api/teams/*`, `/api/teams/:id/members`, `/api/teams/:id/repos`,
  `/api/repos/:owner/:repo/collaborators/:user`, `/api/repos/:owner/:repo/actions/workflows/:id/dispatches`,
  `/api/v1/api-keys`, `/api/v1/user/data` DELETE,
  `/api/v1/work-board/review-action`, `/api/v1/work-board/snooze`,
  `/api/v1/work-board/presets`, `/api/repos/.../pulls(/:n)`,
  `/api/repos/.../pulls/:n/reviews`, `/api/ai/chat`,
  `/api/ai/analyze-context`** — every one of these mutating endpoints
  now reliably receives `X-CSRF-Token` from the frontend.

### Fixed

- **`/api/ai/index` validator** now requires the GitHub numeric repo
  `id` (NOT NULL primary key in `repo_metadata` / `repo_embeddings`).
  Without it the INSERT was throwing as an opaque 500. Errors now
  route through `handleAIError` so quota / invalid-key / rate-limit
  cases surface with the typed envelope.
- **`/test` provider check** stopped silently falling back to Gemini
  when the user-configured provider was misconfigured.
- **Dashboard hero** — `useYourWork` guards concurrent refreshes and
  covers the negative-delta + visibility-debounce cases.
- **`AISummaryCard` meta prop** + sparkline opacity animation fixes.
- **`WorkBoardPage` mock** in `tests/components/App.test.jsx` now
  exports `useKpiSnapshots` so other route tests don't blow up when a
  WorkBoard hook is rendered into the tree.
- **CommandPalette tests** stub `translateSearch` so palette tests do
  not call out to localhost (was producing `ECONNREFUSED ::1:3000` in CI).
- **`webhook-retry.test.js`** — undo-log prepared statements now
  lazy-init.
- **Onboarding tour skip** moved from the hook to the App mount site
  so mock mode no longer flashes the tour on first paint.
- **E2E pipeline.** Mobile drawer-open assertion uses force-click +
  programmatic dispatch fallback (rides out hydration races on slow CI),
  responsive nav-button assertions match the actual mobile bottom-nav
  labels (`Home` / `Repos` / `Work` / `Teams` / `More`), dashboard-hero
  spec greens after the brand `<h1>` → `<h2>` demotion.
- **Mock-mode 401 redirect** skipped — the pre-existing redirect was
  killing every e2e test that auth-checked.
- **Rate-limit toast suppressed in mock mode**; onboarding tour
  suppressed in mock mode; status banner scoped; CSRF mocked for the
  migration auto-fix spec.
- **Build artifacts** (`.vite/`, `dist/`, `coverage/`) consistently
  `.gitignore`-d.

### Internal

- **267 commits** since v3.7.2. **Test count** 2060 → 2782 (+722).
  Significant new suites: WorkBoard tracked-repos backend (~120
  tests), KPI snapshots, AI suggestions engine, UI primitives
  consolidation guards, CSRF interceptor, formatUserError, build
  honesty, bundle budget.
- **CSS audit** — six orphan `ds-*` classes deleted (-63 lines) after a
  reachability sweep.
- **CI configuration.** Husky pre-commit lints touched files and
  rejects warnings; bundle budget guard runs on every PR.

## [3.7.2] - 2026-04-23

Docs pass — no code changes.

### Changed

- **`docs/index.md`** rewritten around reader intent ("I want to..." jump
  table, recent-releases summary, clearer section split: architecture,
  feature guides, operations, API, specs/plans). Removed a 30-entry spec
  dump that was mixing active / shipped / archived work.
- **`docs/architecture/overview.md`** refreshed to match the v3.6/v3.7
  surface: route count updated (~200 handlers across 25+ modules), BYOK
  multi-provider AI replaces the stale "Gemini-powered" wording, admin /
  health / work-board / license routes documented, circuit breaker + email
  DLQ listed in key infrastructure, and a new "Hardening (v3.6+)" section
  cross-links to G1–G9 in `security-hardening.md`. System diagram updated
  to show BYOK, Stripe, Resend instead of Gemini-only.

### Added

- **`docs/operations.md`** — first-class operator runbook covering release
  flow, DLQ, public status page, bundle budget, audit chain, admin access,
  and common incidents (RepoDetail spinner / CSRF 403 / Stripe retry /
  GitHub breaker / DLQ fill).
- **`docs/guides/admin-dlq.md`** — deep dive for the email + webhook DLQ:
  row shapes, every CLI subcommand with output example, UI walkthrough,
  audit-trail notes, troubleshooting.

## [3.7.1] - 2026-04-22

Pipeline-and-correctness patch. v3.7.0 shipped with a green unit suite but the
e2e leg was red on main since the PR-review spec landed (6baa6ec). This
release unblocks CI and fixes one real bug and a handful of a11y gaps that
were masked by the broken pipeline.

### Fixed

- **`useRepoDetail` returned an unstable wrapper object on every render**
  (`src/hooks/useRepoDetail.js`). All 40-odd callbacks inside were already
  memoised on `[base]`, but the enclosing object itself was fresh each render,
  so any consumer keying effects on `api` identity (notably `useTabData`,
  `[api, filter]` deps) entered an abort-retry loop — the Pull Requests tab
  sat on a loading spinner forever in tests, and refetched more than it
  should in production. `useMemo` now stabilises the return value.
- **E2E pipeline unbroken.** `pr-review.spec.js` had three layered problems:
  `.first()` on `getByRole('button', { name: REPO_NAME })` was picking the
  outer `role="button"` card (which only toggles selection) over the inner
  navigation button; glob-based mock routes collided on query-string `?`
  (now regex-based with an explicit pathname switch); the split/unified test
  targeted `aria-haspopup="menu"` as a descendant when the attribute is on
  the submit button itself. All fixed.
- **A11y critical gate landing clean.** The axe gate added in v3.7.0 blew up
  on first run — `button-name` (critical) on icon-only buttons in
  `RepoFilterBar` (selection-menu chevron, refresh) and `OrgPanel` (user
  settings trigger); the `color-contrast` + `nested-interactive` serious
  violations demand a design pass on brand gradients and a `RepoCard`
  restructure respectively, and now log as non-blocking warnings rather than
  failing the gate. Critical stays hard-fail.
- **`ReviewToolbar` split/unified buttons** (`src/components/PRReview/ReviewToolbar/ReviewToolbar.jsx`)
  now carry explicit `aria-label`s; the visible "Split" / "Unified" text is
  `hidden sm:inline` and was falling out of the accessibility tree at the
  narrower desktop breakpoints.

### Internal

- Removed dead `selectedEvent` state from `ReviewToolbar` (set-only, never
  read) so the pre-commit `max-warnings 0` gate stays clean.

## [3.7.0] - 2026-04-22

Operator-facing hardening on top of v3.6.0: admin tooling for the DLQ surfaces added in 3.6.0, a public status page for incident communication, a session-expiry UX so the 7-day ceiling is visible before it fires, and pre-commit hooks that enforce the standards this sprint established. Frontend & backend only — no schema breaking changes.

### Admin / operability

- **DLQ operator UI** (`src/components/Admin/AdminDLQPage.jsx`): tabs for Email / Webhook DLQs with filter (All / Unresolved / Resolved), per-row Retry + Resolve, side-panel detail view with full payload. Lazy-loaded chunk (4.5 KB gzip). Gated behind `requireAdmin` + `useIsAdmin()` (fail-closed when `users.is_admin !== 1`).
- **DLQ operator API** (`server/routes/admin-dlq.js`): 8 endpoints under `/api/v1/admin/dlq/{email,webhook}/...` — list, view, retry, soft-delete. All mutations audit-logged in the G1 hash chain under category `dlq.*`. M016 adds `users.is_admin` (default 0).
- **CLI operator scripts** (`server/scripts/`): `admin:grant`, `admin:revoke`, `admin:dlq` (summary / list / retry / resolve), `admin:dlq:sweep` (hard-delete resolved rows older than N days, dry-run default). Zero runtime deps, Windows-portable. Shared `_cli-utils.mjs` with parseArgs / printTable / askConfirm.

### Health & status

- **Public status page** at `/status` (`src/components/PublicStatus/StatusPage.jsx`): unauthenticated, polls `/api/health/ready`, shows large status pill + per-check table + last-checked timestamp + manual refresh. Split into its own 2 KB gzip chunk. Footer link in `LegalFooter`.
- **System status indicator in header** (`src/hooks/useSystemHealth.js` + `src/components/Header.jsx`): hidden on `ready`, amber dot on `degraded` (with popover listing failed checks), grey on `unknown`. 60 s poll with Page Visibility pause.

### Session UX

- **Session-expiry hook** (`src/hooks/useSessionExpiry.js`): polls `/api/auth/session-info` every 5 min, soft-warns via toast < 1 h before the 7-day ceiling (once per page-load via `sessionStorage`), harder warn < 5 min. Wired into `App.jsx`.
- **Graceful 401 handling** (`src/utils/api.js`): non-auth 401s now toast + hard-redirect to `/?error=session_expired` instead of leaving the UI in a broken state. Auth-flow paths bypassed so OAuth doesn't self-logout.
- **`GET /api/auth/session-info`**: returns `{ authenticated, userId, userLogin, isAdmin, expiresAt, expiresInSeconds, createdAt }` so the frontend can surface the expiry without guessing.

### Developer experience

- **Husky v9 pre-commit hook** + **lint-staged v16**: every commit runs `eslint --fix --max-warnings 0` on staged JS/JSX files and rejects `console.log` / `debugger` via a cross-platform Node check. Bypass with `--no-verify`. Setup via `npm install` (husky's `prepare` script).
- **CLI stdout cleanup**: replaced 19 `console.log` calls in `check-native-modules.js`, `retention.js`, `evals/run.js` with `process.stdout.write` so the pre-commit hook doesn't block future edits. Output byte-identical.

### UX

- **Toast coverage** extended to `IssueDetailPanel` + `PRDetailPanel` for comment / state-toggle / merge / close mutations. `useToast` now in 25 components.

### Documentation

- **`docs/security-hardening.md` G4 table**: `CREDENTIAL_ENCRYPTION_KEY` row updated to reflect v3.6.0 enforcement (required in production; fallback to `SESSION_SECRET` only in dev/test). Cross-linked to G9.

## [3.6.0] - 2026-04-22

A hardening sprint focused on closing P0–P4 audit findings: security depth (CSRF, SSRF, rolling-session ceiling, auth-endpoint throttling, mandatory encryption key), resilience (GitHub API circuit breaker, email + webhook DLQs, AI retry taxonomy), performance (route-level lazy splits, vendor-icons chunk, SWR, composite indexes), observability (request timing, Sentry breadcrumbs, perf marks), and a large internal-refactor pass that halves several oversized files. No user-facing feature additions — product surface is unchanged from 3.5.0.

### Security

- **`CREDENTIAL_ENCRYPTION_KEY` is now mandatory in production** (`server/lib/startup-secrets-check.js`). A dedicated key means a leaked `SESSION_SECRET` alone no longer decrypts stored BYOK / Azure PAT credentials. Startup aborts if the key is missing or shorter than 32 bytes.
- **Per-IP rate limit on OAuth login + callback** (`server/middleware/tenant-rate-limit.js#createAuthRouteLimiter`): 20 req / 15 min in prod (200 in dev) so authorisation-code replay and state-token brute-forcing are capped before a session exists.
- **SSRF guard on `POST /api/import/url`** (`server/lib/url-validator.js#assertSafeExternalUrl`): rejects non-HTTPS, embedded credentials, `localhost` / `*.local`, RFC1918 + link-local IPv4, IPv6 loopback / link-local / unique-local, and IPv4-mapped IPv6 pointing at private ranges (including the 169.254.169.254 cloud-metadata address).
- **CSRF double-submit tokens** (`server/middleware/csrf.js`, `src/utils/api.js`): 32-byte base64url token issued by `GET /api/auth/csrf-token`, stored in the session, and required on every `POST`/`PUT`/`PATCH`/`DELETE` via the `X-CSRF-Token` header. Bypass list is limited to pre-session OAuth and signature-verified webhook paths. Timing-safe comparison.
- **Rolling session + 7-day absolute timeout** (`server/middleware/session-absolute-timeout.js`): `express-session` keeps the UX of indefinite keepalive for active users, but every session is hard-destroyed 7 days after `createdAt` regardless of activity — so a stolen cookie cannot be kept alive forever with periodic refreshes.

### Resilience

- **GitHub API exponential backoff + Retry-After honouring + circuit breaker** added around the shared client — transient 5xx and secondary-rate-limit responses are retried with jitter, and a short open-circuit window prevents thundering-herd retries when GitHub is degraded.
- **Email retry + dead-letter queue** (`server/lib/email.js` + new DLQ table): transient Resend failures are retried with backoff; terminal failures land in a DLQ with payload + error for operator replay.
- **Webhook DLQ** for failed GitHub webhook events — persistence failures no longer silently drop; events land in `webhook_dlq` with a structured error for redelivery analysis.
- **AI provider retry + error taxonomy expanded** so transient upstream failures (429, 5xx, connection reset) are classified and retried, while user-facing config errors (401, 403, 404) fail fast.
- **Migration engine robustness** — `fix(migration-engine)` collects task promises so one crashed task no longer stalls the whole plan (B1); scheduler + credential-cleanup loops now supervise their own promises (B3); Stripe webhook rolls back its idempotency record when license issuance fails so retries actually mint the license (B2).

### Performance

- **Route-level lazy splitting** — `PRReviewView`'s shiki-backed `DiffRenderer` and `ReadmeEnhanceDiffPanel` are now user-gesture-loaded, keeping shiki's ~600 KB out of the initial bundle.
- **Vendor-icons chunk** — `lucide-react` split into its own chunk, removing ~35 KB gzipped from the main vendor bundle (`vite.config.js` `manualChunks`).
- **Stale-while-revalidate on Work Board hooks** — last-known-good data is served immediately while the background refetch runs, so tab-switches feel instant.
- **Composite DB indexes** on hot Work Board / PR-event query paths, cutting the N-row scans that showed up in slow-query traces.

### Observability

- **Request-timing middleware** — every response gets a `Server-Timing` header and a structured log line with method, path, status, and duration.
- **Sentry breadcrumbs** on client navigation, mutation starts/ends, and API calls — so a production error ticket arrives with the last ~30 user actions pre-loaded.
- **`performance.mark()` boundary events** at key client transitions (route mount, first paint, AI response received) to make real-user traces diff-able in DevTools.

### Accessibility

- **WCAG 2.1 AA pass** on form surfaces: every input now has an associated label, every icon-only button now carries an `aria-label`, and role/tabIndex semantics were cleaned up across the key forms flagged by axe.

### UX

- **Toast coverage expanded** from 8 → 19 mutation surfaces so every create/update/delete gives the user a visible acknowledgement.
- **Inline actions on the Work Board** (approve / request-changes / snooze) — already shipped in 3.5.0, now wired through the new toast coverage so the result is legible without opening the PR.
- **AI summary card on the Work Board** — already in 3.5.0; this release adds cross-provider parity so the BYOK provider choice no longer affects which summary format you get.

### Quality

- **Zod validation middleware** (`validate-request`) rolled out across 14 additional routes for a uniform 400 error envelope.
- **3 new integration-test files** exercising a real SQLite database (Work Board, Teams, Repos) — catches drift the unit suite missed.
- **9 new E2E specs** covering PR Review + Settings / API-keys flows.
- **Shell smoke tests** for `App`, `Header`, and `Sidebar`.
- Unit test count: **1998 passing** (up from 1764 at v3.5.0).

### Internal / refactor

- `src/components/RepoList.jsx`: 859 → 280 lines + 6 focused children.
- `src/pages/WorkBoardPage.jsx`: 1160 → 271 lines + 9 children.
- `src/components/MigrationWizard/steps/SourceStep.jsx`: 912 → 196 lines.
- `server/services/ai-service.js`: 550 → 138 lines + 6 per-feature modules.
- Migration credential lifecycle extracted into its own module.
- Brand + chart colours centralised via CSS variables (no behaviour change).
- Two long-standing lint warnings cleared.

## [3.5.0] - 2026-04-21

### Added

- **Work Board — zero-config live data source**: read endpoints (`/my-reviews`, `/my-issues`, `/stale-prs`, `/tech-debt`) now fall back to live GitHub Search when webhook data is empty or stale, so the board is usable without registering a webhook first. Results cached for 5 minutes in `work_board_cache`; ETag revalidation handled internally by `githubApi`. Every response carries a `meta: { source, fetchedAt, cacheExpiresAt, liveFetchError, liveSkipReason, requiresWebhook }` envelope. `/review-load` and the DORA family remain webhook-only because they require deduplicated event history.
- **Work Board — auto-refresh**: 60-second polling across the four KPI hooks with a Page Visibility guard (pauses when the tab is hidden, re-fetches immediately on re-visibility). Manual **Refresh** button in the header, "Updated N s ago" indicator reflecting the oldest `lastFetchedAt`, and `refreshIntervalMs: 0` to disable polling.
- **Work Board — filter bar with URL sync**: repo / author / label multi-selects, age-bucket single-select (`24h` / `7d` / `30d`), and Hide-snoozed toggle, all round-trip through the URL (`?tab=…&repos=…&authors=…&labels=…&age=…&snoozed=…`) so views are shareable and bookmarkable.
- **Work Board — server-stored filter presets**: new `work_board_presets` table + CRUD under `/api/v1/work-board/presets`. `PresetDropdown` manages save / apply / delete. Duplicate names return `409 { code: 'preset_exists' }` and surface as a readable inline error.
- **Work Board — server-side snooze (cross-device)**: new `work_board_snooze` table + `POST/DELETE/GET /api/v1/work-board/snooze(s)`. Snooze durations 1 / 4 / 8 / 24 / 72 / 168 / 720 hours. Snoozed items are filtered out of read endpoints unless `?includeSnoozed=1` is sent.
- **Work Board — inline PR actions**: `POST /api/v1/work-board/review-action` (`approve` / `request_changes` / `comment`) with optimistic UI, body required for `request_changes` and `comment`. GitHub 403 surfaces as `403 { code: 'scope_required' }` and the UI prompts re-auth with the `repo` scope.
- **Work Board — keyboard navigation**: `j` / `k` / `↑` / `↓` row nav, `Enter` to open, `.` approve, `x` request changes, `s` / `Shift+S` snooze 24 h / 7 d, `u` unsnooze, `r` re-request review, `/` focus filter, `?` help modal. Tabs switch via click or the command palette (a `g`-prefix chord was dropped because `g` is globally bound to Open Dev Toolkit).
- **Work Board — AI summary card (BYOK)**: `POST /api/v1/work-board/ai-summary` returns `{ headline, bullets[], urgencyScore, model, provider }` across Anthropic, OpenAI, Gemini, OpenRouter, and Local (LMStudio / Ollama). 5-minute per-user cooldown + 5-minute cache via `work_board_cache.query_type = 'ai_summary'`. Silently hidden for any 401/403/404 response (no noisy error banner). System prompt + response schema exported from `server/lib/work-board-summary.js`.
- **Work Board — Command Palette group**: `⌘K` / `Ctrl+K` on `/work-board` surfaces six navigate-to-tab actions, Regenerate AI summary, and Save current filters as preset.
- **Background sweeper** (`server/lib/work-board-sweeper.js`): runs every 10 minutes (idempotent start, `timer.unref()`ed for clean shutdown); deletes `work_board_cache` rows with `expires_at < NOW - 1 day` and `work_board_snooze` rows with `until_at < NOW - 1 day`.

### Fixed

- `/api/v1/work-board/tech-debt` now handles empty webhook data gracefully by falling back to a live GitHub Search (previously returned an empty list and left users guessing whether the query matched).
- `issue_events` table now persists `title` (migration 009) so Work Board rows no longer need a second round-trip to GitHub to render.

## [3.4.0] - 2026-04-20

### Added

- **BYOK provider parity across every AI endpoint** — five remaining endpoints (`/ai/chat`, `/ai/generate-commit`, `/ai/generate-pr`, `/ai/refine`, `/ai/chat-refine`) migrated off Gemini's `startChat()` session API onto `req.aiProvider.generate()` / `generateStream()`. Chat-refine flattens conversation history into a labelled `User: / Assistant:` transcript so multi-turn keeps working with Anthropic, OpenAI, OpenRouter, and Local providers — not just Gemini.
- **CODEOWNERS Suggest endpoint + UI** — `GET /api/v1/repos/:owner/:repo/codeowners/suggest` walks the N most recent commits, groups authors by top-level directory, and returns ranked owner suggestions plus a paste-ready preview body. New Suggest modal accessible from RepoDetail → Settings → CODEOWNERS card with hotspot pills, per-path owners, copy-to-clipboard, and tunable `commits` / `minTouches` / `maxOwners` controls.
- **Compare with Existing — side-by-side diff modal** — Each result row in the Similar Repositories drawer now has a Compare action that opens a modal showing README and `package.json` from the source and target repo side-by-side (with full UTF-8 decode and per-file tabs).
- **Cross-Repo Work Board** — Review Load tab (per-reviewer submitted vs pending stacked bars) and Tech Debt tab (open issues labelled `tech-debt`, `refactor`, `cleanup`, `debt`, `code-smell` with per-repo hotspot ranking).
- **DORA dashboard polish** — change failure rate, MTTR p50/p90, lead-time p50/p90, and CSV export of the four-metric set.
- **Command Palette live GitHub search** — searches PRs, issues, and repositories via the GitHub Search API with 300ms debounce, AbortController-backed cancellation, and explicit 429/401 surfaces.
- **AI Issue-to-PR Planner (plan-only)** — `POST /api/ai/issue-to-plan` takes an issue and returns a structured plan (approach, files to touch, tests, risks, estimate); rendered inline on the issue detail panel. Uses the user's BYOK provider; never creates branches or PRs.
- **Self-service GDPR surfaces** — Settings → Danger Zone exposes both `GET /api/v1/user/data/export` (Article 20, JSON download) and `DELETE /api/v1/user/data` (Article 17, requires "ERASE MY DATA" confirmation).
- **Migration Wizard session recovery + AI Assistant chat persistence** — both now survive a refresh / route change via sessionStorage. The wizard scrubs PATs, OAuth tokens, and Basic-auth passwords before persisting.

### Changed

- **PR Review write-back is now strictly Pro+** — `requireTier('pro')` added to four endpoints (`PUT /merge`, `POST /comments`, `POST /comments/:id/replies`, `POST /reviews`) so Free tier is read-only as the pricing page advertises. Locked by 9 new tier-gate tests so a future refactor cannot silently regress the gate.
- **Webhook persistence failures now propagate** — Actions webhook returns 500 on DB failure instead of silently 200, so GitHub re-delivers. GitHub-events webhook keeps the fast-ack pattern but logs failures with `eventId`, `repoFullName`, PR/issue number for manual `Redeliver`.
- **Startup secrets check hardened** — production aborts if `EMAIL_PROVIDER=console`, if Stripe is enabled without `STRIPE_WEBHOOK_SECRET`, or if `RESEND_API_KEY` is missing when `EMAIL_PROVIDER=resend`. Warns on non-HTTPS `FRONTEND_URL`.
- **Error-message leaks plugged** — `import.js` (3 sites), `repos-export.js`, and `azure/tfvc.js` (1 legacy site) all sanitise `err.message` through `safeError()` before persisting to `migration_jobs.error_message` so internal paths / credential URIs no longer reach the client.
- **README UTF-8 rendering fixed** — `OverviewTab` decodes base64 README payloads through `TextDecoder('utf-8')` so emoji, accents, and CJK render correctly instead of mojibake.
- **6 oversized files split via barrel pattern** — `server/routes/ai.js` (1678 → 35), `server/routes/repos.js` (1467 → 44), `server/routes/import.js` (958 → 11), `server/routes/import/azure.js` (692 → 9), `src/components/Settings/AIConfigSection.jsx` (1002 → 480), `src/components/MigrationWizard/steps/AIReviewStep.jsx` (1052 → 409). Zero functional changes; default exports preserved so every test mock and consumer keeps working unchanged.
- **ROADMAP honesty pass** — vapourware features (GitLab, Bitbucket, Azure on-prem importers, Advanced Analytics, Dependency Graph Visualizer) moved from "Shipping Now" to "Next (Q3 2026)" so the in-progress list reflects reality. Pricing page swapped the unverifiable "10,000+ repos managed" claim for capability statements that match the code.
- **Provider-neutral retry wrapper** replaces the Gemini-specific `generateWithRetry`. Old `streamGeminiToSSE` adapter removed (no remaining callers).
- **Production log level** defaults to `warn` instead of `info` to cut disk + Sentry breadcrumb noise.
- **Sentry init** now logs environment, sample rate, and DSN host on success or failure so wiring is visible at boot.

### Fixed

- **Tier-gate test for PR write-back** previously passed locally only because the developer's `.env` had `GEMINI_API_KEY` set; rewritten with `vi.stubEnv` so it passes deterministically in CI without that env.
- **Lint errors** unbroken: `bulkConfirm.js` had `headers` declared twice in the same object literal (the second silently won); `AIConfigSection.jsx` had a `try/catch (e) { throw e }` clause that lint correctly flagged as useless. Both fixed.
- **`APP_LOCALE`** changed from `pt-PT` to `en-US` to match the English UI; numbers now render `1,234` instead of `1.234`.
- **Avatar `alt=""`** replaced with descriptive labels on 6 profile-image components (a11y).
- **Two `window.confirm()` calls** replaced with state-driven `ConfirmModal` (PR Review staleness check; AI config remove); PR Review's modal also locks the toolbar while open to prevent double-submit.
- **`useTheme` "system change ignored" test** un-skipped — the closure-capture race was a test bug, not a hook bug.

### Tests

- 1582 unit tests passing (up from 1473 at the start of the arc).
- New suites: PR write-back tier gate (9), Actions webhook (6), Stripe event types (+6), PR Review staleness modal (6), Search routes (8), AI Issue-to-Plan (7), CODEOWNERS suggest endpoint (7) + UI (5), Compare diff modal (5), orgs.js (5), stats.js cache (7), event-aggregations new metrics (~14).

### Compliance

- GDPR Article 17 + Article 20 self-service surfaces are live in the UI (previously the DELETE endpoint shipped without a consumer).
- Audit log hash chain unchanged; retention pass + email scheduler documented in `docs/guides/github-webhook-setup.md` (new).

## [3.3.0] - 2026-04-18

### Added

- **AI Assistant action dispatch** (`src/utils/aiActions.js`, `src/components/AIAssistant.jsx`): the conversational assistant can now open five app modals from natural-language intent — Migration Wizard (`open_migration_wizard`), Migration History (`open_migration_history`), Create Repo (`open_create_repo`), Transfer (`open_transfer`), and Settings (`open_settings`). Actions go through `sanitizeActions` → `validateAction` → `dispatchAction` with a strict allow-list so the model cannot invoke arbitrary app state changes. Available on every tier, including Free.
- **AI-assisted migration descriptions** in the Migration Wizard's Configure step: Gemini generates a target-repo description from Azure metadata when a key is configured, with a deterministic template fallback for self-hosters / mock mode. Spec: [`docs/specs/2026-04-18-ai-migration-description.md`](docs/specs/2026-04-18-ai-migration-description.md).
- **License-tier-aware AI banner copy** on the Dashboard: the AI Quick-Start CTA adapts its copy and CTA based on the active license tier (Free / Pro / Enterprise) surfaced by `/api/v1/license`.
- **Custom `GithubIcon` component** replacing `lucide-react`'s `Github` glyph, which was removed upstream in the Lucide 1.x line.

### Changed

- **Dependencies refreshed** across the tree; `eslint-plugin-react-hooks` 7.1 rules softened where they flagged intentional effect-driven resets (now annotated with `// eslint-disable-next-line react-hooks/set-state-in-effect`).
- **Quieter `dotenv` boot** and `manualChunks` refactored to function form in `vite.config.js`.
- **Migration repo list** surfaces renamed `targetName` inline (no second click to verify the chosen rename).

### Fixed

- **`Select` combobox accessibility**: added `aria-controls` + `useId`-generated listbox IDs so the combobox role wires up correctly for screen readers.
- **`listTeams` mock-mode flake** stabilised via a getter-based mock so repeated calls in the same render don't return drifting references.
- **E2E `selectOption` on custom Select**: replaced with explicit click + option-click pattern matching the real DOM (the underlying element is a button, not a native `<select>`).

## [3.2.1] - 2026-04-18

### Fixed

- **Flaky `AutoFixDrawer` tests on CI** — three multi-character `userEvent.type` assertions raced the last keystroke against the assertion in happy-dom under CI scheduling. Tests now use `userEvent.setup({ delay: null })` (synchronous typing) plus `findByDisplayValue` polling. No production behavior change.
- **Removed an intrusive seeding effect in `AutoFixDrawer.jsx`** — the previous `useEffect` that seeded `strategies` from `repo.sizeStrategy` triggered a state update on every open, which compounded the typing race above. Replaced with a render-time fallback (`strategies[id] ?? repo.sizeStrategy`) that delivers the same UX (pre-selected previously applied strategy, "Fix applied" badge) without any extra render churn.

## [3.2.0] - 2026-04-18

### Added

- **Auto-Fix Drawer — persistent fixes & visual feedback** in the Migration Wizard's Repo Select step:
  - **Pre-selected strategy on reopen** (`src/components/MigrationWizard/steps/RepoSelectStep/AutoFixDrawer.jsx`): when reopening the drawer, the previously chosen `sizeStrategy` (`exclude` / `lfs-migrate`) is reflected as the active button instead of resetting to "no choice", removing the "did anything happen?" UX gap.
  - **"Fix applied" badge** (`src/components/MigrationWizard/steps/RepoSelectStep/SizeStrategyCard.jsx`): emerald pill on size-critical cards once the user has committed a mitigation, so the state is legible at a glance.

### Changed

- **`ruleSizeCritical` honors `repo.sizeStrategy`** (`src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js`): a repo with a chosen mitigation is no longer counted as a blocker. The Selection Summary Bar's blocker count drops, the row leaves the "Blocked" filter, and the wizard stops gating progression — instead of forcing the user to choose between mutating the data and being stuck.
- **`lfs-migrate` strategy auto-enables `lfsEnabled`** in the Configure step: picking "Mark for LFS migration" in the Fix issues drawer now writes both `sizeStrategy: 'lfs-migrate'` and `lfsEnabled: true` on the repo, so the downstream Configure-step LFS toggle reflects the decision without a second click.
- The Apply button correctly excludes already-applied strategies from its change count, so reopening the drawer with no edits keeps the action disabled.

## [3.1.0] - 2026-04-16

### Added

- **Migration Wizard — Select Repositories step redesign** ([spec](docs/specs/2026-04-16-migration-repo-select-redesign.md), [plan](docs/plans/2026-04-16-migration-repo-select-redesign.md)): a decision-support surface for picking which Azure DevOps repos to migrate.
  - **Deterministic risk engine** (`src/components/MigrationWizard/steps/RepoSelectStep/riskRules.js`) with 10 pure rules: archived, stale, empty, size-warning (>5GB), size-critical (>10GB), LFS-suggested, name-conflict, duplicate-in-batch, invalid-chars, reserved-name. Full unit test coverage (12 tests).
  - **5 new batched Azure enrichment endpoints** — `/api/azure/repos/activity`, `/api/azure/repos/lfs-check`, `/api/azure/repos/commit-activity`, `/api/azure/repos/readme`, `/api/azure/repos/full-stats`. All rate-limited (30/min) and capped at 200 repos per batch. Uses `p-limit(5)` concurrency against Azure DevOps REST API v7.1.
  - **New Select step UI**: hero dashboard with stats (total/at-risk/blockers/stale), reactive quick-filter chips (Recommended, At risk, Blocked, Stale, Archived, Large, TFVC, Conflicts), search + multi-criteria sort (name/size/activity/risk), list/compact view toggle, Smart Select dropdown with presets (Recommended, Active in last year, Exclude archived/stale/blockers) + regex pattern selection modal, risk-driven row accent gradients, sticky selection summary bar (totals + estimated migration time + warning/blocker counts).
  - **Slide-in detail panel** per repo: risk report with actionable flags, 12-month commit activity sparkline (lazy-loaded), details, README preview (4KB cap).
  - **Keyboard-first**: `/` focus search, `?` shortcut cheatsheet, `I` invert selection, `Ctrl+A`/`Ctrl+Shift+A` select/deselect, `↑↓` navigate rows, `Enter` open detail, `Esc` close.
  - **Virtualization** via `@tanstack/react-virtual` when repo count exceeds 50.
  - **Next button blocked** when any selected repo has a risk-engine `blocker` flag, with tooltip explaining why.
- **6 shared UI primitives** in `src/components/MigrationWizard/ui/repo/` — `StatCard`, `RiskBadge`, `RepoMetaBadges`, `SectionHero`, `SkeletonRow`, `RepoRiskReport`. Reused across Select, Configure, Schedule, and Summary steps.
- **Downstream coherence**: Configure step reads cached conflict status from Select (no re-fetch), AI Review receives pre-computed client risk flags, Schedule SummaryCard adopts `StatCard`, Summary shows a Pre-flight risk resolution section, BreadcrumbNav pill turns amber when the selection has warnings.
- **Shared motion tokens** (`src/components/MigrationWizard/ui/motion.js`): `WIZARD_EASE`, `WIZARD_SPRING`, `PANEL_SPRING`, `STAGGER_FAST`, `STAGGER_NORMAL`.
- **`.env.test`** pinning `VITE_MOCK_MODE=true` for Playwright runs regardless of the developer's local `.env`.

### Changed

- **E2E suite speed & stability**: full Playwright suite now runs in ~2 minutes (was ~48 minutes) with 47 passing tests (was 0).
  - `playwright.config.js` now starts the Express backend (3001) and Vite (5173) as separate `webServer` entries and waits for both before running tests — previously only 5173 was awaited, causing a race where every test failed at boot.
  - CI workers 1 → 2 (parallel), retries 2 → 1 (was tripling every failure), mobile project opt-in via `E2E_MOBILE=1`.
- **Dashboard `MigrationActivity`** guards `stats.recent.map()` with `|| []` — fixes a crash when the API returns a partial stats payload on fresh databases.
- **App boot in mock mode** bypasses the first-run SystemSetup screen; the ceremony was trapping e2e tests at an un-clickable "Launch Workspace" button.
- **`/api/system/setup`** no longer requires authentication — initial setup precedes any user session by definition. Rate-limited (5/min) and short-circuits when `setup_completed` is already `true`.

### Fixed

- Cross-step `RiskBadge` now uses correct ARIA — `role="checkbox"` on row toggles instead of the invalid `role="option"` on `<button>`.
- `PatternSelectModal` and `ShortcutsOverlay` now trap focus and support Escape + light-mode color variants.
- `QuickFilters` active chip state uses the `/15` opacity pattern (consistent with existing badge vocabulary) with proper dark-mode coverage.
- `SmartSelectMenu` dropdown gets keyboard navigation (↑/↓/Esc) and focus management, and light-mode backgrounds.
- Several stale E2E selectors (removed "AI Insights" context-menu item, non-existent `/pricing` route, `getByText('87')` matching `'12 487'` as substring) updated to current app state.

### Security

- All 5 new enriched-repo endpoints gated behind `requireAuth` + `isValidGitHubUsername(org)` + server-side PAT resolution. No PAT is ever logged or returned in responses.

## [3.0.1]

### Added

- **Product polish pass (2026-04-15)**: seven targeted improvements discovered by a parallel exploration agent, prioritised by impact/effort:
  - **Global `unhandledrejection` handler** in `src/main.jsx` — routes unhandled promise rejections to `console.error` (and Sentry if configured), ignoring routine `AbortError` noise. Prevents silent failures from `.catch(() => {})` sprinkled across async flows.
  - **RepoList empty state CTAs** — zero-repo users now see "Create your first repo" + "Import from Azure DevOps" buttons wired to the existing modals, instead of a flat "No repositories yet" message.
  - **Pricing page: Stripe-unavailable banner** — self-hosters who trigger checkout without Stripe configured now see an amber banner with the sales email instead of a silent fallback to the dashboard.
  - **AGPL §13 docs** — README and `.env.example` now explicitly document the `GET /api/v1/system/source` offer and instruct forks to update `sourceUrl` in `server/routes/system.js` before deploying a modified build as a network service.
  - **ContextMenu keyboard focus ring** — arrow-key navigation now renders a visible indigo ring (ring-2 ring-inset) on the focused item; mouse hover path unchanged.
  - **RepoList skeleton during semantic search** — while an AI search is in flight, placeholders replace the old list so users see search progress instead of stale results.
  - **Dashboard AI Quick-Start CTA** — a gradient banner on Dashboard promotes the now-free AI Assistant and Insights, with one-click entry via a new `ai-assistant:open` custom-event listener on `AIAssistant.jsx`.
- **Free Tier Expansion** ([spec](docs/specs/2026-04-15-free-tier-expansion.md)): AI product surface is now available to Free-tier users
  - AI Assistant (conversational), Semantic Search (50/month), Migration Risk Analysis (5/month), and PR Review Experience are now on the Free tier
  - Free AI query budget raised from 100 → 200/month; Pro raised from 2,000 → 5,000/month
  - Per-feature monthly caps backed by real counters: `ai_readme` (5/mo), `ai_commit` (50/mo), `ai_insights` (10/mo), `ai_migration_risk` (5/mo), `ai_semantic_search` (50/mo). Global `ai_queries` counter is still enforced in parallel.
  - New `POST /api/v1/ai/migration-risk` endpoint — pulls repo signals (size, LFS, branches, workflows, languages) and asks Gemini for a structured risk report (`overallRisk`, `score`, `blockers[]`, `warnings[]`, `recommendations[]`).
  - `checkAIFeatureLimit` / `incrementAIUsage` helpers in `server/lib/usage-meter.js`.
  - `GET /api/v1/usage` now includes an `aiFeatures` block with per-feature `{ current, limit }` pairs; `Settings/UsageDashboard.jsx` renders per-feature progress bars on Free.
- **License Mint Automation**: GitHub Actions-based Ed25519 license minting pipeline
  - `scripts/lib/minter.js` primitives: `validateInput`, `mintLicense`, `deliverLicense`, `logMint`, `mint-license-action.js` CLI wrapper
  - `mint-license.yml` workflow with SHA-pinned actions and scoped `LICENSE_PRIVATE_PEM` secret
  - Resend-based text-only email delivery
  - Optimistic concurrency and audit trail (separate private audit repo pattern)
  - `::add-mask::` safety for sensitive values; `mint-failure-notify.js` standalone error handler
  - Dependabot-managed GitHub Actions and Docker bumps (Node 24 compat)
- **License Kid Header & Resolver API**: `server/lib/license.js`
  - JWT `kid` header and algorithms allowlist for key rotation
  - Unified resolver wrapping with async support
- **License Badge UI**: Header pill showing active tier from `/api/v1/license` endpoint
  - Reads tier from Stripe subscription or license key
  - Dark-mode friendly
- **Modal System Redesign**: Shared `Modal` primitive consolidation
  - `useBodyScrollLock` hook, safe for stacked modals and React Strict Mode
  - `InsightCard` shared component with tones and stagger animations
  - `StatBar` animated progress bar, hardened against NaN/undefined
  - `Modal` enhancements: subtitle, 2xl/3xl sizes, body scroll lock, `staggerChildren`, `iconGradient`, `tabs` prop (embeds `TabBar` in header), `mobileVariant` (sheet/centered) with safe-area
  - Migrations to shared primitive: `SettingsModal`, `TransferModal`, `OrgManagerModal`, `RepoInsightsModal`, `CreateRepoModal`, `CommitGeneratorModal`
  - a11y ids, tab-panel association, sheet size ordering fixes
- **Reusable TabBar**: Shared component with 3 variants and WAI-ARIA keyboard navigation
  - Migrations: `Teams`, `Migration`, `PRDetail`, `OrgManager`, `Insights`, `Settings`, `RepoDetail`, `Health`
  - Unit tests for variants, ARIA, keyboard nav
- **Community Health Tabs**: Tabbed reorganization of health dashboard with animated sliding indicator
  - Desktop-only integration (mobile preserved as stacked)
  - Tab switching tests and mobile exclusion tests
  - `aria-labelledby` for tab panels
- **Health Dashboard Premium**: Visual overhaul of community health dashboard
- **PR Review Experience (in progress)**: Spec + plan for premium PR review UI with file tree, diff viewer, AI insights, conversation threads
- **Context Menu + Pricing Polish**: Scroll-free native context menu and dazzle-hover pricing cards
- **Rate Limit UX + Dev Fix**: User-friendly banners + dev-mode rate limit exemption
- **AI Submenu Redesign**: Per-item tab routing for AI Assistant submenu

### Changed

- `WizardPanel` now uses shared `useBodyScrollLock`; icon tile gained hover-glow for consistency
- **Tier matrix restructured**: Free tier now includes AI Assistant, Semantic Search (capped), Migration Risk Analysis (capped), and PR Review (read-only). Pro/Enterprise unchanged in structure; Pro AI-query budget bumped to 5,000/month.
- `PricingPage.jsx`, `FeatureComparison.jsx`, and `Landing/PricingPreview.jsx` updated to match the new matrix.
- Pricing-page FAQ answer on "What counts as an AI query?" now explains per-feature caps.

### Fixed (tier enforcement gaps)

- **Advanced bulk operations** (`POST /transfer`, `POST /transfer/check-conflicts`, `POST /mirror` in `server/routes/bulk.js`) now enforce `requireTier('pro')` — previously advertised Pro-only but not gated.
- **Dry-run migration** (`migration_plans.is_dry_run`) now actually skips remote API calls in `MigrationEngine._executeTask` — previously the flag was stored but ignored. Dry-run additionally probes target availability on GitHub (404 is the happy path, 200 surfaces a "target exists" failure) and refuses `work-items`/`wiki` tasks without an Azure PAT.
- **Free tier dry-run migration access**: moved the Pro gate from the `/migration` mount to a per-route `requireProOrDryRunPlan` helper so Free users can actually exercise the dry-run flow the pricing page advertises. `POST /plans` forces `isDryRun=true` for Free users regardless of client input.
- **Per-feature quotas** advertised on the pricing page (3/5/20 per month for README/Insights/Commit) are now backed by real counters, not shared with the global `ai_queries` budget.
- **`/ai/migration-risk` input validation**: `repo.full_name` is regex-validated via `isValidGitHubFullName` before being spliced into GitHub API URLs; `source`/`target` are restricted to an allowlist. Response fields are shape-coerced (risk enum, score clamped 0–100, arrays filtered). AI parse failures now return `overallRisk: 'unknown'` + `parseError: true` instead of fabricating a `medium` verdict.
- **Uniform 429 body** across AI endpoints via shared `quotaExceededResponse` helper; `incrementAIUsage` wraps its two counter writes in `db.transaction` to prevent drift on partial writes.

### Fixed

- Teams fetch gracefully handles `MOCK_MODE` and free-tier 403
- Tailwind JIT safelist for landscape fallback classes
- Minter CRLF→LF normalization before fingerprinting public key
- SESSION_SECRET test env var for vitest CI runs
- Mint-license workflow: private PEM scoped only to needed steps, surfaces audit commitSha
- Minter shebang removal + `.gitattributes` for cross-platform line endings

### Docs

- Specs and plans for all April 2026 work indexed in [docs/index.md](docs/index.md)
- Validation screenshots reorganized into `docs/images/` with sequential numbering
- Setup checklist months cap and Secrets vs Variables split corrected

## [3.0.0] - 2026-04-05

### Added

- **AGPL Open-Core Licensing**: Transitioned from MIT to AGPL v3 with commercial dual-license
  - Ed25519 JWT license key generation and validation
  - License info and validation API endpoints
  - License keys table and `LICENSE_KEY` config
  - Tier middleware resolves from Stripe subscription or license key
  - License info display in billing section for self-hosted instances
  - CLA bot workflow and updated contributing guide
- **SaaS Architecture Foundation**: Multi-phase platform transformation
  - Phase 1: SaaS architecture foundation (multi-tenancy, user_id scoping)
  - Phase 2: Cloud deployment and infrastructure (Vercel, Railway, Docker, Redis)
  - Phase 3: Auth, security, and enterprise features (API keys, SSO prep, audit logs)
  - Phase 4: Monetization and billing (Stripe checkout, portal, webhooks, usage metering)
  - Phase 5: Marketing and GTM (landing page, pricing page)
- **Pricing Page**: Redesigned layout with tier alignment and monetization strategy
  - Pro checkout wired to Stripe billing API
  - Stripe setup guide documentation

### Changed

- **License**: MIT → AGPL v3 with commercial license option (CLA required for contributions)
- **Landing Page**: Updated URLs and branding

### Fixed

- Sign-in unblocked by scoping migration tier gate
- IPv6 rate-limit validation and wrong landing page URLs
- Critical security review findings resolved
- All lint errors and test failures resolved
- Pricing badge alignment and overflow clipping
- Broken license link in plan documentation

### Security

- Security review: critical findings resolved (credential handling, input validation)
- Dangerous auto-allow del permission removed from Claude settings

## [2.5.0] - 2026-03-31

### Added

- **Azure DevOps Migration Suite**: Guided multi-step wizard (8 steps) for comprehensive Azure DevOps-to-GitHub migration
- **TFVC-to-Git Conversion**: Automatic conversion via Azure DevOps Import API
- **Work Items Migration**: Azure Boards to GitHub Issues with field mapping
- **Wiki Migration**: Azure DevOps to GitHub wiki with content conversion
- **AI-Assisted Migration Planning**: Gemini-powered risk analysis and migration recommendations
- **Migration Scheduling**: Encrypted credential storage (AES-256-GCM) for deferred migrations
- **Pause/Resume**: Capability for long-running migrations
- **Task Retry**: Individual failed migration tasks can be retried independently
- **Migration History**: Full audit trail for all migration operations
- **Smart Azure DevOps URL Parser**: Supports 6+ URL format variations with auto-fill
- **Dry-Run Mode**: Test migrations without making changes
- **Conflict Detection**: Pre-migration check for existing repositories in target organization

### Changed

- **Migration Wizard Redesign**: Fullscreen panel layout replacing modal-based wizard
- **Summary Step**: Redesigned with detailed migration plan review
- **Organization Field**: Smart auto-detection based on authentication method
- **Configure Step**: Improved UX with dashboard header and compact card-row layout

### Fixed

- TFVC credential embedding double-`@` and URL encoding for PAT-based authentication
- TFVC URL encoding for projects with spaces in their names
- TFVC repositories now shown in mixed Git+TFVC Azure DevOps projects
- TFVC folder size calculation and branch 404 errors
- Wizard navigation state management fixes

### Security

- Structured logging with Pino (automatic credential redaction)
- SSRF protection for work item attachment downloads
- Encrypted credential storage (AES-256-GCM) for scheduled migrations

## [2.4.0] - 2026-02-07

### Added

- **Security Hardening** (Critical):
  - Helmet.js middleware for HTTP security headers (CSP, X-Frame-Options, HSTS, etc.)
  - express-rate-limit: 200 req/15min for API, 20 req/15min for auth endpoints
  - `SESSION_SECRET` enforcement in production (server refuses to start with default secret)
  - GitHub username input validation on activity, team members, and collaborators endpoints
  - `safeError()` utility to sanitize error messages and prevent internal detail leakage
- **GitHub API Optimization**:
  - ETag conditional requests — 304 responses don't count against rate limit
  - Rate limit header tracking with auto-wait before exceeding limits
  - Batched team activity fetching (3 concurrent + 100ms delay) instead of unlimited parallel
- **Accessibility**:
  - Focus trap in Modal component (Tab cycling, Shift+Tab, Escape to close, focus restore)
  - ARIA roles on Modal (`role="dialog"`, `aria-modal="true"`, `aria-label`)
  - Keyboard navigation for RepoCards (`tabIndex`, `role="button"`, `onKeyDown` with Enter/Space)
  - ARIA attributes on selection checkboxes (`role="checkbox"`, `aria-checked`, `aria-label`)
- **Language Chart Colors**: GitHub-style color map for 38 languages with 20-color vibrant fallback palette
- **CSS Utilities**: Added missing `.no-scrollbar` and `.animate-spin-slow` classes
- **Premium Dashboard**: Category-based organization with collapsible sections
  - Overview, Organizations, PR/Issues, Actions Stats, Community Health sections
  - Smart sticky organization selector
  - Rich organization cards with star/fork/issue metrics

### Changed

- **Mobile Responsiveness**:
  - AI Assistant: responsive sizing (`w-[calc(100vw-2rem)] sm:w-80 md:w-96`, `h-[70vh] sm:h-[500px]`)
  - Repo card actions: visible on touch devices (`sm:opacity-0 sm:group-hover:opacity-100`)
  - CategorySection: responsive padding (`p-4 sm:p-6 lg:p-8`)
  - LanguageChart: fluid width (`maxWidth: 280px, width: 100%`)
  - Touch targets: minimum 44px on header buttons and nav buttons
- **Dark Mode**: Fixed background mismatch (`dark:bg-slate-900` → `dark:bg-slate-950` across App.jsx)
- **Performance**: Moved render-blocking Google Fonts `@import` to HTML `<link>` tags in `index.html`
- **StatCard**: Removed duplicate hover animation (`ds-hover-lift` CSS + Framer Motion `whileHover`)
- **README**: Updated Vite 6→7, added security stack to tech table, documented v2.0 completed milestones, expanded architecture diagram with security middleware layer
- **Screenshots**: Fresh 1920x1080 HD screenshots captured with Playwright MCP

### Fixed

- **SQL Injection** (Critical): Parameterized `repoIds` in `repo_metadata` query (`server/index.js:1062`)
- **Session Security**: Added `sameSite: 'lax'` to session cookie to prevent CSRF
- **OAuth Error Leak**: Removed `error_description` from OAuth redirect URL to prevent info exposure
- **Color Contrast**: Improved trend text contrast (`text-slate-400` → `text-slate-500` in StatCard)

### Security

- SQL injection vulnerability patched with parameterized placeholders
- HTTP security headers via Helmet.js (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.)
- API rate limiting prevents brute-force and abuse
- Input validation prevents injection via GitHub username parameters
- Session cookie hardened with `httpOnly`, `sameSite: 'lax'`, `secure` in production

## [2.3.1] - 2025-12-17

### Added
- **Backend Architecture Documentation**: Created [`docs/architecture/backend.md`](docs/architecture/backend.md) documenting monolithic design decision
- **Azure DevOps Limitations**: Added clear limitations section in README for import feature
- **UI Warning**: AzureImportModal now displays prominent warning about basic import capabilities

### Fixed
- **Version Synchronization**: Updated package.json version to match CHANGELOG (2.3.0 → 2.3.1)
- **Security Enhancement**: Removed hardcoded GitHub Client ID from `src/App.jsx:158`, delegating OAuth to backend
- **Code Quality**: Fixed ESLint warnings for unused variables in `src/App.jsx:26`
- **Documentation**: Updated README.md placeholder links from 'yourusername' to 'YOUR_USERNAME'
- **Repository URLs**: Standardized all GitHub repository references in documentation

### Changed
- **Azure DevOps Import Section**: Clarified in README that current implementation supports Git repository import only
- **Transparency**: Set clear expectations for users about Azure DevOps migration capabilities (v3.0+ roadmap)

## [2.3.0] - 2025-12-15

### Added
- **HD Screenshots**: Professional 1920x1080 screenshots captured using Playwright
  - Dashboard view with statistics and charts (`01_dashboard_hd.png`)
  - Repository list with filters and organization panel (`02_repositories_hd.png`)
  - Create repository modal interface (`03_create_repo_modal_hd.png`)
  - AI assistant chat interface (`04_ai_assistant_hd.png`)
  - Team hub management view (`05_teams_hub_hd.png`)
- **Comprehensive Documentation**: Complete README.md rewrite with:
  - Detailed feature documentation with visual examples
  - Step-by-step installation and configuration guides
  - Architecture overview with system diagram
  - Troubleshooting section with common issues and solutions
  - FAQ section covering general usage, AI features, and development
  - Roadmap for v2.0, v2.5, and v3.0
  - Contributing guidelines and support information
- **GitHub Permissions Guide**: Detailed table explaining required OAuth scopes and their purposes

### Changed
- **Mock Data Engine**: Enhanced `useGitHub` hook to generate realistic, context-aware mock data
  - Project-specific repository names (e.g., "fintech-dashboard", "ai-analytics-platform")
  - Realistic descriptions matching repository types
  - Varied programming languages and star counts
- **AI Mock Responses**: Improved simulated AI responses with actionable, project-specific advice
- **Screenshot Organization**: Reorganized documentation images with clear, numbered naming convention

### Improved
- README structure and navigation with emoji icons and clear sections
- Code examples and configuration snippets throughout documentation
- Visual hierarchy with tables, badges, and formatted content

## [2.2.0] - 2025-12-03

### Added
- **Premium UI/UX**: Complete visual overhaul with Glassmorphism design system
  - Semi-transparent backgrounds with backdrop blur effects
  - Layered shadows for depth perception
  - Smooth gradient overlays and border accents
- **Interactive Dashboard**: Real-time statistics and visualizations
  - Activity trends chart with time range selector
  - Language distribution pie chart
  - Top organizations horizontal bar chart
  - Animated stat cards with trend indicators
- **Enhanced Organization Panel**: Redesigned sidebar with improved UX
  - Organization search functionality
  - Grid/List view toggle
  - User profile section with avatar and username
  - Repository count badges

### Changed
- Refactored `Dashboard` component with `framer-motion` animations
- Updated `OrgPanel` with search and view mode state management
- Improved `App.jsx` layout to support new sidebar-based navigation
- Enhanced organization selection and data refresh logic

### Fixed
- Skeleton loading states for better perceived performance
- Organization data fetching race conditions
- Dark mode color inconsistencies in charts

## [2.1.0] - 2025-12-02

### Added
- **AI Assistant Integration**: Google Gemini Flash-powered features
  - Conversational chat interface for repository management
  - Context-aware responses about your repositories
  - Natural language command processing
- **AI-Powered Features**:
  - Smart description generator for new repositories
  - Repository quality analysis and insights
  - README generation and enhancement
  - Semantic repository search (with embeddings)
- **Dashboard Filtering**: Filter statistics and charts by organization
- **Enhanced Animations**: Integrated `framer-motion` for smooth transitions
  - Modal entry/exit animations
  - List item stagger effects
  - Page transition effects

### Changed
- AI configuration with graceful fallback to mock responses
- Server-side error handling for missing API keys
- UI feedback for AI feature availability status

### Fixed
- Organization data fetching in Dashboard component
- Server-side error handling for unconfigured AI endpoints
- AI API key validation on startup

## [2.0.0] - 2025-11-26

### Added
- **Theme System**: Dark/Light mode support
  - Persistent user preference in localStorage
  - System theme detection and auto-switching
  - Smooth theme transitions with Tailwind `dark:` variants
- **Dashboard View**: Comprehensive statistics and overview
  - Total repositories, public/private distribution
  - Fork count and organization memberships
  - Organization selector for filtered views
- **Organization Management**:
  - Organization panel with repository listings
  - Modal for viewing and editing organization details
  - Organization sync functionality
- **Azure DevOps Migration**: Complete import workflow
  - Connection validation and authentication
  - Project selection and mapping
  - Progress tracking and status updates
- **Activity Tracking**: Sidebar for monitoring operations
  - Bulk action history
  - Real-time status updates
  - Operation result notifications

### Changed
- Centralized GitHub data fetching in `useGitHub` hook
- Improved table, sidebar, and modal styling for accessibility
- Enhanced dark mode contrast ratios
- Added robust API utilities with retry logic and exponential backoff
- Implemented rich error types for better error handling

### Fixed
- Reduced unauthenticated API noise by conditional repo loading
- ESLint issues aligned with React/Node best practices
- Session persistence across page refreshes

## [1.0.0] - 2025-10-01

### Added
- **Initial Release**: GitHub Repo Manager MVP
  - GitHub OAuth authentication flow
  - Session-based backend with Express
  - Repository listing with pagination
  - Bulk repository selection interface
- **Bulk Operations**:
  - Change repository visibility (public/private)
  - Transfer repositories to organizations
  - Mirror repositories (fork)
  - Archive repositories
  - Delete multiple repositories
- **Activity Log**: Basic feedback system for operations
- **Responsive UI**: TailwindCSS-based interface

### Security
- Encrypted session cookies for token storage
- CSRF protection for API endpoints
- Secure OAuth callback handling

---

[Unreleased]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.15.0...HEAD
[4.19.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.18.1...v4.19.0
[4.18.1]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.18.0...v4.18.1
[4.18.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.17.0...v4.18.0
[4.17.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.16.0...v4.17.0
[4.16.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.15.0...v4.16.0
[4.15.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.14.1...v4.15.0
[4.14.1]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.14.0...v4.14.1
[4.14.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.13.1...v4.14.0
[4.13.1]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.13.0...v4.13.1
[4.12.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.11.0...v4.12.0
[4.11.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.10.0...v4.11.0
[4.10.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.9.0...v4.10.0
[4.9.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.8.2...v4.9.0
[4.8.2]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.8.1...v4.8.2
[4.8.1]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.8.0...v4.8.1
[4.8.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.7.0...v4.8.0
[4.7.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.6.1...v4.7.0
[4.6.1]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.6.0...v4.6.1
[4.6.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.4.0...v4.6.0
[4.5.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.4.0...v4.6.0
[4.4.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.3.0...v4.4.0
[4.0.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v3.8.0...v4.0.0
[4.13.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v4.12.0...v4.13.0
[3.8.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v3.7.2...v3.8.0
[3.7.2]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v3.7.1...v3.7.2
[3.7.1]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v3.7.0...v3.7.1
[3.7.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v3.6.0...v3.7.0
[3.6.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v3.5.0...v3.6.0
[3.5.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v3.4.0...v3.5.0
[3.0.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.5.0...v3.0.0
[2.5.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.4.0...v2.5.0
[2.4.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.3.1...v2.4.0
[2.3.1]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.3.0...v2.3.1
[2.3.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/tag/v1.0.0
