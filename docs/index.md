# Documentation Map

Navigation hub for GitHub Repo Manager documentation. Start here; each section
below links to the canonical page for that topic.

## Start here

| I want to... | Read |
| ------------ | ---- |
| Understand the system at a glance | [Architecture overview](architecture/overview.md) |
| Run a production instance | [Operations runbook](operations.md) |
| Call the API | [API reference](api/API.md) (~200 endpoints) |
| Configure an AI provider | [AI Providers (BYOK)](ai-providers.md) |
| Wire a GitHub webhook | [Webhook setup guide](guides/github-webhook-setup.md) |
| Set up Stripe billing | [Stripe setup guide](guides/stripe-setup.md) |
| Harden a deployment | [Security hardening (G1–G9)](security-hardening.md) |
| Replay a failed email / webhook | [Admin DLQ guide](guides/admin-dlq.md) |
| Read release notes | [`CHANGELOG.md`](../CHANGELOG.md) |

## Recent releases

Full detail: [`CHANGELOG.md`](../CHANGELOG.md).

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

## Feature guides

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

## Operations

- [**Operations runbook**](operations.md) — release flow, DLQ, status page,
  bundle budget, audit trail, admin access, common incidents.
- [Admin DLQ guide](guides/admin-dlq.md) — CLI + UI walkthrough.
- [Security hardening](security-hardening.md) — G1–G9 (audit chain, data
  erasure, retention, CSRF, SSRF, rolling session, auth rate-limit,
  encryption-key-mandatory).

## API reference

- [API Reference](api/API.md) — ~200 route handlers across 25+ modules.
  Every endpoint documented with auth requirements, request/response shape,
  and error codes.

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
- [Free Tier Expansion](specs/2026-04-15-free-tier-expansion.md) — move AI Assistant, Semantic Search, Migration Risk Analysis, and PR Review (read-only) to Free.
- [Migration Repo Select Redesign](specs/2026-04-16-migration-repo-select-redesign.md) — 10-rule risk engine + 5 batched Azure endpoints + virtualized detail panel.
- [BYOK and Remaining Phase 0](specs/2026-04-19-byok-and-remaining-phase-0.md) — BYOK multi-provider AI, event ingestion, Work Board, SOC 2 hardening.

## Reports

- [Validation report](reports/VALIDATION-REPORT.md) — code analysis and
  validation results (Dec 2025, partially outdated).
- [Mobile validation snapshot](reports/validation-mobile-snapshot.md) —
  Playwright accessibility tree snapshot.

## Other

- [Commercial License](LICENSE-COMMERCIAL.md) — terms for commercial /
  closed-source use alongside the AGPL v3 public license.
- [Article](ARTICLE.md) — project article / blog post.
- [Images](images/) — screenshots, named `NN_description_hd.png` (HD
  captures via Playwright MCP at 1920x1080).
