# Documentation Map

Navigation hub for GitHub Repo Manager documentation. Start here; each section
below links to the canonical page for that topic.

## Start here

| I want to... | Read |
| ------------ | ---- |
| Understand the system at a glance | [Architecture overview](architecture/overview.md) |
| Run a production instance | [Operations runbook](operations.md) |
| Call the API | [API reference](api/API.md) (331 route handlers — recounted via `grep`, see API.md header) |
| Configure an AI provider | [AI Providers (BYOK)](ai-providers.md) |
| Run on Windows without Docker or Node.js | [Windows guide](windows.md) |
| Use the AI Deep Review experience | [AI Deep Review feature guide](features/ai-deep-review.md) |
| Register a GitHub App for bot identity (roadmap) | [GitHub App setup](setup/github-app.md) |
| Wire a GitHub webhook | [Webhook setup guide](guides/github-webhook-setup.md) |
| Set up Stripe billing | [Stripe setup guide](guides/stripe-setup.md) |
| Harden a deployment | [Security hardening (G1–G9)](security-hardening.md) |
| Replay a failed email / webhook | [Admin DLQ guide](guides/admin-dlq.md) |
| Read release notes | [`CHANGELOG.md`](../CHANGELOG.md) |

## Recent releases

The 3 latest, in brief. Full detail and older releases: [`CHANGELOG.md`](../CHANGELOG.md).

- **v4.7.0 (2026-07-19) — Native Windows distribution.** A CI-boot-validated
  installer and portable ZIP, both bundling their own Node.js runtime — no
  Docker, no separate Node.js install, no admin rights for the installer.
  First-run bootstrap generates its own random secrets and a sane local
  `.env` (`scripts/first-run.mjs`); new `HOST` (bind address) and `DATA_DIR`
  (persisted-state root) env vars support installed layouts whose app
  directory isn't writable; `ALLOW_CONSOLE_EMAIL` opts a single-user install
  out of the hosted-deployment email-provider guard. Settings → About shows
  an in-app "new version available" banner sourced from a single
  unauthenticated GitHub releases check, disable with `UPDATE_CHECK=false`.
  winget manifest scaffolding exists but submission to `winget-pkgs` is
  still pending. See [Windows guide](windows.md).
- **v4.6.1 (2026-07-19) — Launch-readiness hardening.** Every finding from
  the 2026-07-19 seven-dimension launch-readiness panel fixed: closed AI
  spend-cap gaps (`POST /api/migration/analyze` was fully unmetered; five
  non-streaming AI routes could bypass the spend cap by omitting
  `?stream`), a UTC/local-calendar usage-dashboard read bug, a README FAQ
  privacy overclaim, and small-text WCAG AA contrast fixes. Plus 10
  previously-invisible Free-tier quotas surfaced in Settings → Usage, the
  Docker image quickstart promoted to primary, and license-key duration now
  matching the actual billing cadence. See the
  [panel report](reports/2026-07-19-launch-readiness-panel.md).
- **v4.6.0 (2026-07-19) — Community WOW + six production-premium waves.** Four
  new AI-grounded repo tools, all metered on Free with deterministic zero-AI-cost
  fallbacks: **README Studio** (free quality score + grounded improve),
  **AI Diagram Generator** (architecture diagrams with embed-into-repo and
  retry-once self-repair), **Agent Rules Generator** (AGENTS.md/CLAUDE.md
  from real detected build/test/CI signals), and **Security Posture Panel**
  (10-check report card + optional AI narrative). Plus a free-first pricing
  rebalance (bulk ops, mirror sync, Deep Review, Prompt Studio, PR Chat/
  commands moved off the Pro paywall), a premium migration/README-reading
  pass, ops readiness (Prometheus metrics, reverse-proxy guide), and list
  virtualization. See [Production Premium Plan](plans/2026-07-17-production-premium-plan.md)
  and [Community WOW spec](specs/2026-07-18-community-wow-wave6.md).

## Architecture

- [Overview](architecture/overview.md) — system shape, routes, hardening
  summary, component diagram.
- [Backend](architecture/backend.md) — Express routes, middleware stack,
  DB adapter seam.
- [Teams](architecture/teams.md) — teams feature data model.
- [Work Board tracking](architecture/work-board-tracking.md) — tracked-repo set,
  five-signal discovery, KPI snapshots, and the sweeper job.
- [AI client contracts (ADR)](architecture/ai-client-contracts.md) — why
  `aiApi` (placeholders) and `aiFetch` (typed throws) coexist, which to use,
  and the deferred unification plan.

## Feature guides

- [AI Deep Review](features/ai-deep-review.md) — walkthrough, line
  comments with `suggestion` blocks, Prompt Studio, PR slash commands,
  streaming PR Chat (all Free with monthly caps, unlimited on Pro),
  org-shared prompts, BYOK provider matrix, mock-mode behaviour,
  privacy & data handling.
- [Premium Dashboard — Live Inbox](features/dashboard-live-inbox.md) — sectioned inbox, archive/snooze, AI narrative, keyboard shortcuts, feature flag, Phase 1 scope and stubs.
- [Community WOW — README Studio, AI Diagrams, Agent Rules, Security Posture](features/community-wow.md) — four AI-grounded repo tools with deterministic zero-AI-cost fallbacks, metered on Free.
- [AI Providers (BYOK)](ai-providers.md) — Anthropic, OpenAI, Gemini,
  OpenRouter, Ollama, LMStudio. Per-feature overrides + cost hints.
- [Windows](windows.md) — installer + portable ZIP, first-run bootstrap,
  data locations, one-click update (installed) and automatic rollback
  (portable), repair/uninstall maintenance, and honest limits (unsigned
  binaries, winget pending).
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

- [API Reference](api/API.md) — 331 route handlers across 74 route
  modules (recounted via `grep`; see the API.md header for the exact
  command). Every endpoint documented with auth requirements,
  request/response shape, and error codes.
- [Work Board API](api/WORK-BOARD-API.md) — the `/api/v1/work-board/*` surface:
  tabs, KPI snapshots, discovery, presets, and DORA metrics (free on all tiers).

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
- [Production Premium Plan](plans/2026-07-17-production-premium-plan.md) — six-wave implementation plan (hardening, free-first pricing, migration/reading UX, ops readiness, dark-mode/virtualization, Community WOW) following the 2026-07-17 audit.
- [Community WOW — Wave 6](specs/2026-07-18-community-wow-wave6.md) — README Studio, AI Diagram Generator, Agent Rules Generator, and Security Posture Panel design spec.

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
