# Documentation Map

Navigation hub for GitHub Repo Manager documentation. Start here; each section
below links to the canonical page for that topic.

## Start here

| I want to... | Read |
| ------------ | ---- |
| Understand the system at a glance | [Architecture overview](architecture/overview.md) |
| Run a production instance | [Operations runbook](operations.md) |
| Call the API | [API reference](api/API.md) (315 endpoints) |
| Configure an AI provider | [AI Providers (BYOK)](ai-providers.md) |
| Use the AI Deep Review experience | [AI Deep Review feature guide](features/ai-deep-review.md) |
| Register a GitHub App for bot identity (roadmap) | [GitHub App setup](setup/github-app.md) |
| Wire a GitHub webhook | [Webhook setup guide](guides/github-webhook-setup.md) |
| Set up Stripe billing | [Stripe setup guide](guides/stripe-setup.md) |
| Harden a deployment | [Security hardening (G1–G9)](security-hardening.md) |
| Replay a failed email / webhook | [Admin DLQ guide](guides/admin-dlq.md) |
| Read release notes | [`CHANGELOG.md`](../CHANGELOG.md) |

## Recent releases

Full detail: [`CHANGELOG.md`](../CHANGELOG.md).

- **v4.5.0 (2026-07-06)** — **Production readiness.** A 10-specialist audit (88 findings) followed by eight remediation waves on `main`. Repo Advisor rebuilt end-to-end (provider-neutral `AI_PROVIDER`, spend caps + audit metadata, SSE streaming, BYOK hardening, golden evals + CI gate); end-to-end migration Replace (resolve conflicts, Replace & retry, LFS retry); environment-tooling readiness (`npm run doctor`, `/api/env`, per-plan preflight); GDPR registry-driven erasure + export; ops hardening (WAL-safe scheduled backups, daily/hourly janitors, `/live` + `/ready` probes, compression, SSE-aware shutdown); shared Zod request-validation layer (`validation_failed`); versioned migration ledger replacing loose `.sql` files. Quality gates: 5,200+ unit tests + a dual-theme axe a11y gate (9 views × 2 themes) + design-token anti-drift lint.
- **v4.4.0 (2026-06-13)** — **Azure/TFS credential hardening + production-readiness pass.** Self-fix host-allowlist UX (1-click admin add, audited), structured `HOST_NOT_ALLOWED` / `UNSAFE_URL` / `PRIVATE_ADDRESS` codes, PBKDF2-SHA512 credential-vault KDF. Fixes a boot-stopping Express 5 SPA-fallback bug and a login DoS surfaced by a full multi-dimension audit.
- **v4.3.0 (2026-05-18)** — **Premium-through-restraint.** Visual language pivots from "AI-template" (rainbow gradients, glow shadows, shimmer) to a GitHub-tasteful aesthetic across every modal, toast, banner and empty/error state (see [theme spec](specs/2026-05-14-premium-non-llm-theme-design.md)). Mobile gets a peek-out FAB with breathing halo + edge stripe + spring reveal; hash deep-linking (`#/repos`, `#/work`, `#/teams`, `#/roadmap`, `#/pricing`, `#/ai/prompts`) syncs bidirectionally with view state; the page scrollbar becomes a premium overlay (transparent by default, slate-400/50 on hover) and fully hides on touch devices. RepoDetail tabs, WorkBoard tabs, SettingsModal sections and MigrationWizard late steps now lazy-loaded — **~91 KB gzipped deferred from first paint** (RepoDetail alone: 331 → 188 KB, -43 %). 121 commits, 3896 unit + 84 e2e green.
- **v4.2.0 (2026-05-13)** — **Premium Dashboard Phase 1: Live Inbox.** Replaces the always-empty Attention Feed with a sectioned, keyboard-driven inbox (needs review, my PRs, mentions, stale drafts). Archive (`e`) / snooze (`s`) state persisted in `dashboard_inbox_state` SQLite table. AI narrative on top-3 items. Four new endpoints under `/api/v1/dashboard/*`. `dependabot_ready` and `failing_ci` are stubs (data wired in Phase 2/3). Lazy-loaded; gated behind `localStorage` flag `dashboard_premium_v2_inbox`. All actions free-tier.
- **v4.1.0 (2026-05-10)** — **PR review premium pass.** Layered render
  strategy for huge diffs: `<DiffCollapser>` fold-by-default above
  500 lines, `<DiffComputeOnDemand>` above 50 000, `useDeferredValue`
  on tab expansion, and `content-visibility: auto`. Mobile parity: file-tree
  `<MobileFileTreeSheet>` and AI panel drawer below `lg`, both
  reusing the existing Modal sheet primitive. Sticky review action
  bar with animated SVG progress ring + thumb-zone Approve/Comment/
  Request changes. Floating composer that doesn't trap the user.
  Layout-animated FileTreeItem on mark-as-viewed. Keyboard help
  overlay (`?`) + PR-scoped Command Palette commands. Unified
  comment chrome (synced/pending/AI all share one card with status
  badges). Z-index design tokens consumed across 37 surfaces with a
  pre-commit guard against raw `z-N`. Bundle hygiene: dynamic mock
  imports + a CI guard so fixture data can't leak to production.
  Bundles Phase A of the post-migration AI Polish work. **3679 unit
  tests + the iPhone-13 mobile e2e pass; ESLint clean; main entry
  64.5 KB gzip.**
- **v4.0.0 (2026-05-08)** — **AI Deep Review.** Slice 1a free core
  engine (walkthrough + line comments + `suggestion` blocks + Mermaid +
  batched publish through outbox); slice 1a-2 hardening (provider
  `usageMetadata` threading, `computeCostUSD`, rate-limiter LRU sweep,
  `useFocusTrap`); slice 1b Prompt Studio (5 built-ins + user/repo/org
  custom presets, path-scoped rules, severity floor,
  `${REPO_STYLE_GUIDE}` token); PR slash commands (`/describe`,
  `/test_plan`, `/improve`); PR Chat tab (streaming SSE Q&A with
  per-`(user, PR)` history + `MAX_HISTORY_TURNS = 10`). Plus org-shared
  prompts, premium UX unification (17-code AI error vocabulary,
  `<AIErrorState>`, `<SafeMarkdown>`, honest mock-mode publish), AI
  polish sweep, surface uniformity primitives (`<SectionPanel>`,
  `<HeroHalo>`, `<CountUp>`, `<PageMount>`), and drawer consolidation
  (unified `<Drawer>` primitive — fixed `side="bottom"` routing bug).
  Closes with a multi-agent audit pass: prompt-injection guards on
  every `/ai/*` body, DNS-rebinding defence on import, cross-user
  cache isolation, license-cache TTL, `closeOnBackdrop=false` on every
  state-bearing modal/drawer (no more accidental dismiss), and 600+
  lines of dedup (shared rate limiter, repos `_shared.js`, banner
  motion, `appEvents`). **5241 tests pass** (1740 server + 3501
  frontend). See [feature guide](features/ai-deep-review.md).
- **v3.8.0 (2026-04-28)** — Dashboard hero redesign (`DashboardHero`,
  `WhatNeedsYouGrid`, `AIPromoStrip`, `AttentionFeed`); mobile UX overhaul
  (bottom-nav, `MobileQuickActionsFab`, drawer); Work Board tracked-repos
  and AI upgrade across seven phases; premium AI Configuration with
  per-feature key-health probes; honest error handling (`formatUserError`
  with `QuotaExceededState`); CSRF coverage on every mutating call site;
  onboarding tour; UI primitive consolidation; and CI bundle-budget,
  build-honesty, and README honesty guards. **2782 unit tests**
  (up from 2060).
- **v3.7.2 (2026-04-23)** — Docs pass: `docs/index.md` rewrite,
  `docs/operations.md` runbook, `docs/guides/admin-dlq.md`.
- **v3.7.1 (2026-04-22)** — CI pipeline unbroken after 10+ red commits;
  `useRepoDetail` memoised (fixed real RepoDetail tab churn); a11y critical
  gate landed clean; `pr-review` e2e greened.
- **v3.7.0 (2026-04-22)** — Admin DLQ UI + CLI, public `/status` page,
  session-expiry UX, husky v9 + lint-staged pre-commit (rejects lint
  warnings and `console.log` / `debugger`).
- **v3.6.0 (2026-04-22)** — Security depth (CSRF, SSRF, rolling session,
  mandatory credential encryption key), resilience (GitHub circuit breaker,
  email + webhook DLQs, AI retry taxonomy), observability (Server-Timing,
  Sentry breadcrumbs), route-level lazy splits + bundle-budget gate.
- **v3.5.0 (2026-04-21)** — Work Board initial release (zero-config data,
  auto-refresh, inline actions, presets, snooze, DORA tab).

## Architecture

- [Overview](architecture/overview.md) — system shape, routes, hardening
  summary, component diagram.
- [Backend](architecture/backend.md) — Express routes, middleware stack,
  DB adapter seam.
- [Teams](architecture/teams.md) — teams feature data model.
- [AI client contracts (ADR)](architecture/ai-client-contracts.md) — why
  `aiApi` (placeholders) and `aiFetch` (typed throws) coexist, which to use,
  and the deferred unification plan.

## Feature guides

- [AI Deep Review](features/ai-deep-review.md) — walkthrough, line
  comments with `suggestion` blocks, Prompt Studio (Pro), PR slash
  commands (Pro), streaming PR Chat (Pro), org-shared prompts, BYOK
  provider matrix, mock-mode behaviour, privacy & data handling.
- [Premium Dashboard — Live Inbox](features/dashboard-live-inbox.md) — sectioned inbox, archive/snooze, AI narrative, keyboard shortcuts, feature flag, Phase 1 scope and stubs.
- [AI Providers (BYOK)](ai-providers.md) — Anthropic, OpenAI, Gemini,
  OpenRouter, Ollama, LMStudio. Per-feature overrides + cost hints.
- [Cross-Repo Work Board](work-board.md) — review load, stale PRs, DORA
  metrics, presets, snooze, cache.
- [GitHub Event Ingestion](event-ingestion.md) — webhook pipeline, event
  routing, DLQ fallback.
- [GitHub Webhook Setup](guides/github-webhook-setup.md) — step-by-step
  webhook configuration + troubleshooting.
- [Billing & Licensing](billing-and-licensing.md) — Stripe + Ed25519 JWT
  license keys, self-hosted Pro/Enterprise.
- [Stripe Setup](guides/stripe-setup.md) — Stripe product + webhook
  configuration.

## Setup guides

- [GitHub App identity](setup/github-app.md) **(roadmap)** — register a
  GitHub App so AI Deep Review publishes under `github-repo-manager[bot]`
  instead of the OAuth user. Documents the planned env vars
  (`GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`,
  `GITHUB_APP_PRIVATE_KEY_PEM`, optional `GITHUB_APP_INSTALLATION_ID`)
  so operators can pre-register their App today.

## Operations

- [**Operations runbook**](operations.md) — release flow, DLQ, status page,
  bundle budget, audit trail, admin access, common incidents.
- [Admin DLQ guide](guides/admin-dlq.md) — CLI + UI walkthrough.
- [Security hardening](security-hardening.md) — G1–G9 (audit chain, data
  erasure, retention, CSRF, SSRF, rolling session, auth rate-limit,
  encryption-key-mandatory).

## API reference

- [API Reference](api/API.md) — 315 route handlers across 70 route
  modules. Every endpoint documented with auth requirements,
  request/response shape, and error codes.

## Specs & plans

Design specs live in [`specs/`](specs/) (what to build) and implementation
plans in [`plans/`](plans/) (how to build it). The spec→plan→execute flow is
part of the superpowers workflow; a plan that references an implemented spec
will call it out explicitly.

Recent specs — full list under each directory:

- [Platform Transformation](specs/2026-04-01-platform-transformation-spec.md) — open-core + SaaS master spec.
- [AGPL Open-Core License Key System](specs/2026-04-03-agpl-open-core-license-key-system.md) — Ed25519-signed JWT license keys.
- [PR Review Experience](specs/2026-04-09-pr-review-experience-design.md) — file tree, diff viewer, AI insights, conversation threads.
- [Modal System Redesign](specs/2026-04-11-modal-system-redesign.md) — shared Modal primitive + scrollbar fix + InsightCard/StatBar.
- [License Mint Automation](specs/2026-04-11-license-mint-automation-design.md) — GitHub Actions–based Ed25519 minting with Resend delivery.
- [Free Tier Expansion](specs/2026-04-15-free-tier-expansion.md) — move Repo Advisor, Semantic Search, Migration Risk Analysis, and PR Review (read-only) to Free.
- [Migration Repo Select Redesign](specs/2026-04-16-migration-repo-select-redesign.md) — 10-rule risk engine + 5 batched Azure endpoints + virtualized detail panel.
- [BYOK and Remaining Phase 0](specs/2026-04-19-byok-and-remaining-phase-0.md) — BYOK multi-provider AI, event ingestion, Work Board, SOC 2 hardening.
- [Premium Dashboard Phase 1 — Live Inbox](plans/2026-05-10-premium-dashboard-phase-1-inbox.md) — implementation plan for the inbox aggregator, four endpoints, `dashboard_inbox_state` table, and `InboxPanel` component tree.

## Reports

Validation and audit-panel reports live in [`reports/`](reports/). Recent:

- [Prod/Premium readiness panel (2026-07-05)](reports/2026-07-05-prod-premium-readiness-panel.md) — 8-specialist audit behind the v4.5.0 remediation.
- [Codebase audit panel (2026-06-26)](reports/2026-06-26-codebase-audit-panel.md) — full-codebase multi-specialist review.
- [Validation report](reports/VALIDATION-REPORT.md) — earlier code analysis and validation results (partially outdated).

## Other

- [Commercial License](LICENSE-COMMERCIAL.md) — terms for commercial /
  closed-source use alongside the AGPL v3 public license.
- [Article](ARTICLE.md) — project article / blog post.
- [Images](images/) — screenshots, named `NN_description_hd.png` (HD
  captures via Playwright MCP at 1920x1080).
