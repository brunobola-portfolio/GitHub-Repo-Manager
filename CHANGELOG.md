# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Security Enhancement**: Removed hardcoded GitHub Client ID from [`App.jsx`](src/App.jsx:158), delegating OAuth to backend
- **Code Quality**: Fixed ESLint warnings for unused variables in [`App.jsx`](src/App.jsx:26)
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

[Unreleased]: https://github.com/brunobola-portfolio/GitHub-Repo-Manager/compare/v3.5.0...HEAD
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
