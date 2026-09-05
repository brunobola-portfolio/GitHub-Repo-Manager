# Documentation Map

Navigation hub for GitHub Repo Manager documentation. Start here; each section
below links to the canonical page for that topic.

## Start here

| I want to... | Read |
| ------------ | ---- |
| Understand the system at a glance | [Architecture overview](architecture/overview.md) |
| Run a production instance | [Operations runbook](operations.md) |
| Call the API | [API reference](api/API.md) (351 route handlers — recounted via `grep`, see API.md header) |
| Configure an AI provider | [AI Providers (BYOK)](ai-providers.md) |
| Run on Windows without Docker or Node.js | [Windows guide](windows.md) |
| Publish on a public domain behind IIS | [IIS deployment guide](guides/deploy-iis-windows.md) |
| Use the AI Deep Review experience | [AI Deep Review feature guide](features/ai-deep-review.md) |
| Register a GitHub App for bot identity (roadmap) | [GitHub App setup](setup/github-app.md) |
| Wire a GitHub webhook | [Webhook setup guide](guides/github-webhook-setup.md) |
| Set up Stripe billing | [Stripe setup guide](guides/stripe-setup.md) |
| Use the logo, colours or media kit | [Brand spec](BRAND.md) · [visual guide](../brand/index.html) — also served at `/brand` |
| Ship this to production as SaaS | [Launch alignment plan](plans/2026-08-14-saas-launch-alignment.html) — the cross-repo state, the licence decision, and the order |
| Brief the platform session | [Platform handoff](plans/2026-08-15-platform-handoff.md) — what the site must change now that the app is Apache-2.0 |
| Harden a deployment | [Security hardening (G1–G9)](security-hardening.md) |
| Know what a deployment stores and where it goes | [Privacy & data](privacy-and-data.md) — facts from the code, with the file each one is enforced in |
| Replay a failed email / webhook | [Admin DLQ guide](guides/admin-dlq.md) |
| Read release notes | [`CHANGELOG.md`](../CHANGELOG.md) |
| See every view before installing | [Screenshot gallery](screenshots.md) — real captures, both themes |
| See what's planned but not shipped | [`ROADMAP.md`](../ROADMAP.md) |

## Recent releases

The latest releases, in brief. Full detail and older releases: [`CHANGELOG.md`](../CHANGELOG.md).

- **v4.24.0 (2026-09-05) — the polish release.** The audit log is a full
  page with chain verification; saved views and URL sync reach the
  Repositories filter bar; an opt-in digest e-mail; `g`-chord and `j`/`k`
  navigation everywhere; one colour per meaning across the app; Mermaid
  diagrams in the brand palette; the monthly AI spend cap is atomic across
  parallel calls; `npm run release` cuts a release in one command; and a
  screenshot gallery (`docs/screenshots.md`).
- **v4.23.2 (2026-08-31) — the tooling survives PowerShell 5.1.** The
  Windows `.ps1` scripts shipped without a BOM, so real Windows PowerShell
  read them as ANSI and choked on the em dashes before running a single
  line — the exact way the first automatic deploy failed. All five carry
  the BOM now, and the deploy job runs under `pwsh` as well.
- **v4.23.1 (2026-08-31) — releases deploy themselves.** The release
  workflow gained an opt-in `deploy` job on a self-hosted runner on the
  production VPS, gated by the `AUTO_DEPLOY` repository variable: the same
  `deploy.ps1` an operator would run — backup, health check against the
  freshly installed version, automatic rollback — now runs itself the
  moment a tag is cut.
- **v4.23.0 (2026-08-28) — what a screen reader hears.** The panel's
  remaining accessibility findings, closed: toasts announce (persistent live
  regions instead of per-toast ones), the context menu returns focus and
  exposes its current item, modals with an inline `onClose` return focus to
  their trigger, the command palette no longer presents an empty listbox,
  and Settings tabs stop rendering a second banner. Plus an invalid easing
  on two dashboard panels, a dead skip link, and three docs that described
  gates or components that no longer exist.
- **v4.22.0 (2026-08-24) — the tenant keys.** The two findings the launch
  review left open, closed. Diffs bound for AI providers get value-shaped
  redaction: the line survives, only the credential-shaped value goes, so a
  PR touching auth code stays reviewable while a committed `ghp_…` does not
  leave the server. And each user gets a personal webhook URL with its own
  secret — the instance-wide `WEBHOOK_SECRET` was one key for every tenant;
  on `DEPLOYMENT_MODE=saas` the shared endpoint now answers 410.
- **v4.21.0 (2026-08-22) — the first ten minutes.** A nine-lens review panel
  walked both the product and the site as strangers. The Quick Start did not
  start the demo (`npm run demo` now does, on a clone with no `.env`); a
  copied `.env.example` booted in production with the template's own secrets
  and with backups off; team cards were unreachable by keyboard; status text
  was short of AA in light mode across 99 files; the mobile FAB looked
  clipped; and the demo's numbers moved between renders. All closed, each
  with the measurement that found it.
- **v4.20.0 (2026-08-17) — the four launch blockers.** Work Board aggregations
  crossed the tenant boundary: the webhook event tables carry no `user_id`, and
  the filter that was meant to scope them took a client-supplied list that
  defaulted to nothing, so any authenticated user read every tenant's private
  repo names, PR titles and reviewer logins. An API key could permanently
  rewrite the browser session to another identity. Encoded path traversal
  (`%252e%252e`) reached the Contents routes carrying the caller's OAuth token.
  An instance licence upgraded every tenant on a billed deployment. Each has a
  regression test named after the mechanism, not the symptom.
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
- [Premium Dashboard — Live Inbox](features/dashboard-live-inbox.md) — sectioned inbox, archive/snooze, j/k row navigation, AI narrative, Phase 1 scope and stubs.
- [Community WOW — README Studio, AI Diagrams, Agent Rules, Security Posture](features/community-wow.md) — four AI-grounded repo tools with deterministic zero-AI-cost fallbacks, metered on Free.
- [AI Providers (BYOK)](ai-providers.md) — Anthropic, OpenAI, Gemini,
  OpenRouter, Ollama, LMStudio. Per-feature overrides + cost hints.
- [Windows](windows.md) — installer + portable ZIP, first-run bootstrap,
  data locations, one-click update (installer + portable) with automatic
  rollback on the portable build, repair/uninstall maintenance, and honest
  limits (unsigned binaries, winget pending).
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
- [Licence keys & the portal](guides/license-keys-and-portal.md) — how keys are
  signed and delivered, the three issuance paths (Stripe self-service, GitHub
  `repository_dispatch`, and why not to sign in the portal), and the claims a
  marketing site must not make.

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
- [IIS deployment (Windows Server)](guides/deploy-iis-windows.md) — public
  domain behind an ARR reverse proxy: build, secrets, OAuth App, Windows
  service, the two things ARR gets wrong by default, and a seven-point
  post-deploy verification.
- [Admin DLQ guide](guides/admin-dlq.md) — CLI + UI walkthrough.
- [Security hardening](security-hardening.md) — G1–G9 (audit chain, data
  erasure, retention, CSRF, SSRF, rolling session, auth rate-limit,
  encryption-key-mandatory).

## API reference

- [API Reference](api/API.md) — 351 route handlers across 77 route
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
- [Open-Core License Key System](specs/2026-04-03-agpl-open-core-license-key-system.md) — Ed25519-signed JWT subscription keys. Written while the project was AGPL; the key mechanism is unchanged, what a key *means* is not (see [`TRADEMARKS.md`](../TRADEMARKS.md) and [`LICENSE-COMMERCIAL.md`](LICENSE-COMMERCIAL.md)).
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

- [Premium-readiness panel (2026-09-04)](reports/2026-09-04-premium-panel.md) — eight lenses on v4.23.2; what closed, what was measured, what is still open.
- [Prod/Premium readiness panel (2026-07-05)](reports/2026-07-05-prod-premium-readiness-panel.md) — 8-specialist audit behind the v4.5.0 remediation.
- [Codebase audit panel (2026-06-26)](reports/2026-06-26-codebase-audit-panel.md) — full-codebase multi-specialist review.
- [Validation report](reports/VALIDATION-REPORT.md) — earlier code analysis and validation results (partially outdated).

## Other

- [Commercial License](LICENSE-COMMERCIAL.md) — terms for commercial /
  service and capacity alongside the Apache-2.0 public license.
- [Article](ARTICLE.md) — project article / blog post.
- [Images](images/) — screenshots, named `NN_description_hd.png` (HD
  captures via Playwright MCP at 1920x1080).
