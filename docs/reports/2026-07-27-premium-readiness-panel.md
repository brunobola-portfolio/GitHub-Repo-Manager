# Premium-Readiness Panel — 2026-07-27

Ten-specialist multi-agent audit of `main` @ `c359dd03` (v4.10.0), scoped to a single
question: **is this product premium and excellent, or what does it still need?**
Analysis only — no code was changed; the working tree stayed clean throughout.

Dimensions: engineering health (lint/build/tests/CI executed for real), security &
AI metering, premium/monetization, UX flows, code health, docs & honesty, UI craft
(driven live in mock mode with measured contrast), reliability & Windows
distribution, plus frontend and backend performance.

## Verdict

**Excellent engine, unshippable storefront.** The internals are genuinely premium —
metering is disciplined, the write contract is preview-first, house rules are
machine-enforced and actually followed, dark mode is measurably well-built, and the
Windows packaging is smoke-tested to a bar above most commercial installers. What
is not premium is the layer where money and trust change hands: a customer who pays
receives nothing, a free feature is sold behind a fake paywall, a contract sells an
unimplemented export, and the four most common failure modes of the flagship AI
feature each lie to the user in a different direction.

None of the blockers are architectural. Most are between one line and one afternoon.

| Dimension | Verdict | Headline |
|---|---|---|
| Engineering health | YELLOW | Lint/build/CI genuinely green; unit suite measurably flaky, coverage gate decorative |
| Security & AI metering | YELLOW | All 2026-07-19 metering HIGHs verified fixed; unsigned binaries, spend cap disabled by default, OAuth tokens plaintext |
| **Premium & monetization** | **RED** | Documented Stripe setup charges the customer and delivers nothing |
| **UX flows** | **RED** | Bulk actions report success while doing nothing; every AI failure mode misroutes |
| Code health | YELLOW | Unusually disciplined; three places are safe only by accident |
| Docs & honesty | YELLOW | Privacy claim now TRUE and gated; second-order dishonesty outside the gates' reach |
| UI craft | YELLOW | Premium chrome; the pricing page and PR Review carry the worst contrast in the app |
| Reliability & Windows | YELLOW / YELLOW / **RED** | Strong durability primitives; port drift breaks login; near-zero domain observability |
| Performance | YELLOW | Two event-loop stalls measured in minutes, not milliseconds |

## Blockers — fix before promoting or selling

1. **The documented Stripe setup is broken end to end.**
   `docs/guides/stripe-setup.md:29,44,77` registers the webhook at
   `/api/v1/stripe/webhooks`; the real route is `/api/v1/webhooks/stripe`
   (`server/index.js:204`) — segments transposed. Separately,
   `docker-compose.yml` is an explicit allowlist that never forwards
   `STRIPE_PRICE_*`, while it *does* forward `STRIPE_SECRET_KEY` — so checkout
   looks configured and 400s (`server/routes/billing.js:21`). Net effect for an
   operator who follows the docs: the card is charged,
   `checkout.session.completed` 404s, no subscription row, no tier, no license
   key, no email — silently. **S**

2. **A fake Pro paywall on a feature that is already free.**
   `src/components/Settings/WorkBoard/WebhookConnectPanel.jsx:20,28,34,63` gates a
   "Pro" badge, sells *"Enable live webhook-driven updates on Pro"*, hides the
   setup-instructions link from Free users, and offers "Upgrade to Pro →".
   `POST /api/v1/webhooks/github` (`server/index.js:211`) has no tier check
   anywhere. This charges for shipped functionality and withholds documentation to
   sustain the claim. **S**

3. **Enterprise "audit log with export" is sold in a commercial contract and does
   not exist.** `docs/LICENSE-COMMERCIAL.md:26`,
   `docs/billing-and-licensing.md:27`, `docs/architecture/backend.md:356`.
   `auditExport` (`server/lib/feature-flags.js:193`) has exactly one occurrence in
   the codebase: its own definition. Ship `GET /api/v1/audit/export` or strike the
   claim from all three documents. **M / S**

4. **Quick Actions report success while doing nothing — and Delete has no
   confirmation.** `src/App.jsx:617-621` calls `performAction(action, null, …)`;
   `src/hooks/useRepos.js:164-168` returns `{ success:false, skipped:true }`
   *without throwing*, so `toast.success(\`${action} completed successfully\`)`
   fires anyway (and prints the raw action id). The red Delete pill
   (`src/components/Sidebar.jsx:187-193`) reaches `POST /api/bulk/delete` with no
   modal; it currently 400s only because `selectedRepos` holds objects where
   `bulkDeleteSchema` (`server/lib/validators.js:38-41`) wants strings. A type bug
   is the only thing preventing an unconfirmed multi-repo delete. **S**

5. **Every failure mode of the flagship AI feature lies, each differently.**
   `src/api/aiFetch.js:34` emits `AI_INVALID_KEY`; `src/utils/errors.js:115`
   defines `AI_KEY_INVALID` — transposed, no alias, so lookup misses and the
   `status === 401` heuristic renders **"Session expired — sign in again"** with a
   button that runs a full GitHub OAuth round-trip and fixes nothing. The server
   returns 422 specifically to prevent this, with a comment saying so
   (`server/routes/ai/shared.js:54-57`). Likewise `AI_QUOTA_EXCEEDED` is absent
   from `CODE_ALIASES` (only the lowercase form is mapped), so exhausting a monthly
   cap renders as a transient rate limit with a Retry button and no upgrade path —
   discarding the correct sentence the server already wrote
   (`server/lib/usage-meter.js:293-295`). And the quota modal never shows an
   upgrade button, because 0 of 98 `errorFromException` callsites pass `detail`. **S**

6. **Windows binaries ship unsigned and the self-update trusts a same-feed hash.**
   `packaging/windows/installer.iss:87-89` guards `SignTool` behind `#ifdef SIGN`;
   neither ISCC invocation (`release.yml:439`, `windows-package.yml:415`) ever
   defines it — dead code. `server/lib/updater.js:313-352` downloads an installer
   and its `.sha256` from the *same* release, verifies, then spawns it
   `/VERYSILENT`: transport integrity, not authenticity, with no Authenticode
   fallback because of the first half. **M** (cert procurement dominates)

7. **The pricing page's most decorated element has the worst contrast in the app.**
   `src/components/Pricing/PricingCard.jsx:100` — white on `bg-amber-500`,
   **measured 2.13:1** (needs 4.5), identical in both themes and both widths. Root
   cause is systemic: `--ds-accent-enterprise` (`src/design-system.css:100-101`)
   ships fill values with no `-text` companion, unlike `riskTokens` which gets this
   right. **S**

## High — fix before scaling

**Money**

- Spend cap ships `0` (disabled) on all three tiers
  (`server/lib/feature-flags.js:109,153,200`), `docker-compose.yml` never forwards
  `AI_SPEND_CAP_CENTS*`, and even when enabled `recordAISpend`
  (`server/lib/ai-spend-cap.js:32-34,71-73`) rounds to whole cents and discards
  anything under half a cent — a flash-model call costs ~$0.0004 and records as 0,
  so the cap never fires. The entire denial-of-wallet backstop is decorative. **S**
- `maxRepos: 1000` — the first bullet of the Pro card, advertised on eight surfaces
  — is never incremented and never checked anywhere in `server/`. **S**
- No existing-subscription guard on checkout (`server/routes/billing.js:55-97`) +
  `ON CONFLICT(user_id)` upsert (`stripe-webhooks.js:132`) orphans the first,
  still-billing subscription: **double-charge**. `checkout.session.completed` never
  checks `payment_status`, so a license key is emailed before payment settles. No
  `charge.refunded` or `charge.dispute.created` handler exists at all. **S**
- The only remaining tier gate renders **"Access denied"** with no upgrade CTA:
  `tierRequiredPayload()` emits `error: 'Tier required'` while
  `states/parseApiError.js:45-47` matches `'upgrade_required'`. **S**
- `LicensePlanSection.jsx:371-380` opens `/pricing` as a path in a hash-routed app —
  the primary in-app upgrade CTA full-reloads to the Dashboard. **S**

**Security & data**

- GitHub OAuth access tokens stored in plaintext (`server/routes/auth.js:168` →
  `server/lib/session-store.js:47-52`). Azure PATs and BYOK keys *are* encrypted;
  the highest-value credential is the only one that isn't. **M**
- `.gitignore:35-40,96` enumerates secret filenames instead of patterns —
  `.env.staging`, `keys/private.key`, `*.pfx` are all currently **not ignored**
  (verified with `git check-ignore`). **S**
- `dados.txt` (untracked, live enterprise license JWT valid to 2028) is not in
  `.dockerignore` while `Dockerfile:11` does `COPY . .`. No license revocation
  path exists — `lid` is minted and never checked. **S**
- Unvalidated pidfile content spliced into `cmd /C` in Setup
  (`packaging/windows/installer.iss:219-226`); the `IsAllDigits` helper the file
  needs already exists at `:386-398`. **S**

**Reliability**

- Windows port fallback is silent and permanently breaks login:
  `packaging/windows/start.ps1:183-200` moves to 3002 without persisting the port
  to `.env`, so `redirect_uri` follows the real port, the registered callback does
  not, and the drift repeats every launch. This is the same class as the tester's
  "login broken in the package" report and is still open. **M**
- Backup retention is count-based and re-pruned on every boot
  (`server/lib/db-backup.js:150-151`, `maintenance-janitors.js:174-180`): seven
  launches evict the entire history. Default backup location is *inside* the live
  data directory, which the uninstaller offers to `DelTree` along with
  `CREDENTIAL_ENCRYPTION_KEY`. **S**
- Near-zero domain observability: `server/lib/metrics.js:37,45` exposes only HTTP
  latency and in-flight count. A backup failing daily for six weeks is a
  `logger.warn` swallowed by an isolation `try` that then logs *"daily pass
  complete"* at INFO. **M**

**Performance**

- Daily event purge is O(n²) and runs immediately at boot: no index leads with the
  purge column on any of the five tables (`server/lib/maintenance-janitors.js:76-87`).
  At 1M rows that is ~200M row visits — **60–180 s of fully blocked event loop**,
  on a synchronous SQLite connection. `CREATE INDEX` fixes it. **S**
- Semantic search loads every embedding into JS per query
  (`server/lib/ai-features/semantic-search.js:141`): 500 repos × 3072 dims ≈ 23 MB
  read + 500 `JSON.parse` + 500 cosine on the request thread ≈ **150–300 ms
  blocked**. `cosineSimilarity` also recomputes the query norm inside every
  iteration (~33% waste). **S**
- `RepoMarkdown` (`src/components/ui/RepoMarkdown.jsx:283-294`) re-runs the full
  remark→rehype→sanitize pipeline on every parent render — ~30–80 ms on a 60 KB
  README — because three props are freshly allocated. The file's own comment at
  `:62-68` explains why the *components* map was hoisted; the plugin arrays 12
  lines below were not. **S**
- Typing in the PR inline-comment box re-renders the entire diff subtree
  (`DiffPanel.jsx:116,307`, `DiffRenderer.jsx:118,193`). **S**

**Correctness & craft**

- `src/config.js:14` drops the `import.meta.env.DEV &&` conjunct the house rule
  requires, while `.env.example:31` ships `VITE_MOCK_MODE=true` as the documented
  default — a self-hoster following the documented path can build a production
  bundle serving fabricated users and teams. Latent today (the local `.env` sets
  `false`; current `dist/` verified clean). **S**
- Two divergent AI-error→HTTP mappers: `server/routes/ai/shared.js:53-62` returns
  422, `server/middleware/ai-error-mapper.js:57-62` returns 401 for the same
  condition — contained today only because the affected clients use raw `fetch`.
  The obvious refactor makes a wrong AI key log the user out of the app. **M**
- Four RepoDetail tabs turn a fetch failure into a false empty state
  (`BranchesTab.jsx:25`, `ReleasesTab.jsx:17`, `IssuesTab.jsx:22`,
  `PullRequestsTab.jsx:24` never destructure `error` from `useTabData`) — the app
  states as fact that a repo has no branches. **S**
- `ConfirmModal.jsx:117` lacks `whitespace-pre-line`, so the four multi-line
  destructive confirmations render as one illegible run-on line. **S**
- `src/utils/api.js:187` tells end users to run `npm run dev:server` — the global
  backend-unreachable string, shipped to Windows installer users. **S**
- `SECURITY.md:53` claims no PII beyond usernames and session tokens; licensee
  emails, `email_dead_letter`, and Stripe identifiers are stored
  (`server/lib/db-migrations.js:347,106,188-205`). **S**
- PR Review "Approve" and "Publish to GitHub" measure **3.65:1**; diff `+/-`
  deltas **2.64–3.22:1** — all state-gated, so the axe e2e gate has never seen
  them. **S / M**
- Unit suite is non-deterministically flaky: three full runs produced 1, 4 and 3
  *different* timeout failures, all green in isolation. `vitest.config.js` sets no
  `testTimeout`, so everything inherits Vitest's 5 s default; CI runs on 2-core
  runners. **S**

## Where the guardrails end

The honesty gates are strong but bounded, and every RED finding above lives in
their blind spot:

- They cover `README.md` plus five pricing surfaces. ROADMAP, NOTICE, SECURITY.md,
  LICENSE-COMMERCIAL.md, `docs/**` and CHANGELOG are ungated — and that is exactly
  where the remaining dishonesty is.
- They assert *doc ↔ flag*, never *flag ↔ implementation*. `auditExport` passes
  every gate with zero consumers. `canAccess()` (`feature-flags.js:211`) is dead
  code.
- `tests/pricing-feature-parity.test.js:464-475` tests that no pricing surface
  claims a free trial unless Stripe grants one — but reads only two components, so
  `docs/guides/stripe-setup.md:64` advertises a 14-day trial the checkout cannot
  grant, gate green.
- `check-no-static-mock-imports`, `check-debug-statements` and `check-no-raw-z-index`
  run only in `lint-staged`, never in CI — `--no-verify` or a GitHub-web commit
  bypasses them permanently.
- Coverage thresholds (`vitest.config.js:59-64`) are ~18pp below actual and never
  execute; CI runs `vitest run` without `--coverage`.
- The axe gate is real and rigorous (11 views × both themes, fails on `serious`)
  but stops at first paint — no state-gated surface is ever scanned.

## Verified healthy — do not re-audit

- **All three 2026-07-19 AI-metering HIGHs are genuinely fixed**, verified route by
  route. A full inventory of provider call sites found **no unmetered generation
  path**; the two unmetered residuals are hard-capped at 1 and 10 output tokens.
- **The README privacy claim is now TRUE**, verified feature by feature —
  including the precise statement that PR Chat is the diff-less exception
  (`server/lib/ai-features/pr-chat.js` contains no `diffPatch`). Locked by
  `tests/build/readme-honesty.test.js:22`.
- **Zero SQL injection.** Every `${}` in SQL is a hardcoded constant; all `IN (…)`
  built with `.map(() => '?')`. **No secret ever committed** (history searched).
  **IDOR posture solid** across 56 sampled `params.id` sites.
- **Repo writes are preview-first with server-derived paths**, honouring
  `commitOrOpenPR()` everywhere, with an automatic PR fallback on protected
  branches.
- **House rules are machine-true**: zero TypeScript files, zero
  `window.dispatchEvent`, zero misplaced test files, zero global CSS element
  selectors, zero native `<select>`, zero `console.log`/`debugger`, zero stray
  `.only`, zero hardcoded spring literals outside `motion.js`.
- **"Never write fake code" holds**: 4 TODO markers across ~860 non-test source
  files, three of which are deliberate grounded-content placeholders that refuse
  to fabricate a license or install command.
- **CI is real**: lint at zero warnings, ~6,500 tests, honesty gates executing
  under `RUN_BUILD_TESTS=1`, CodeQL `security-extended` weekly, Docker image
  boot-tested before publish, and a Windows install→boot→stop→uninstall smoke test
  that asserts the DB and `.env` survive.
- **Data durability primitives are correct**: WAL-safe online `db.backup()`, boot
  `quick_check`, corruption quarantine-by-rename with newest-first restore (nine
  test cases), individually transactional migrations with a downgrade guard, and
  an unusually complete graceful shutdown.
- **Production dependency tree has zero known vulnerabilities.**

## Suggested order of work

1. **One afternoon, highest trust return** — items 1, 2, 4, 5 above, plus
   `whitespace-pre-line`, the `npm run dev:server` string, and the four tabs that
   destructure `error`. These are the lies; nothing else matters while they stand.
2. **One day, money correctness** — subscription guard, `payment_status` check,
   refund/dispute handlers, `maxRepos` decision (enforce or retract), upgrade CTA
   routing, spend-cap defaults and sub-cent accumulation.
3. **One day, doesn't-fall-over** — the five purge indexes, `env_file` in compose,
   backup retention and location, backup-age + queue-depth + spend gauges,
   `testTimeout`, Windows port persistence.
4. **Then** — the token layer that makes contrast failures structurally impossible,
   an axe pass over state-gated surfaces, extending the honesty gates to the four
   ungated legal/marketing documents plus a flag↔consumer assertion, and
   Authenticode signing.

## The one-sentence answer

The product does not need more features to be premium — it needs the twenty-odd
places where it currently misrepresents itself to stop doing that, and the paid
tier to be worth its price, because today `server/routes/` contains no
`requireTier('pro')` at all and the single credible upgrade trigger in the entire
product is a cap of ten deep reviews a month.
