# Documentation Map

Navigation hub for GitHub Repo Manager documentation. Start here; each section
below links to the canonical page for that topic.

## Start here

| I want to... | Read |
| ------------ | ---- |
| Understand the system at a glance | [Architecture overview](architecture/overview.md) |
| Run a production instance | [Operations runbook](operations.md) |
| Call the API | [API reference](api/API.md) (341 route handlers — recounted via `grep`, see API.md header) |
| Configure an AI provider | [AI Providers (BYOK)](ai-providers.md) |
| Run on Windows without Docker or Node.js | [Windows guide](windows.md) |
| Publish on a public domain behind IIS | [IIS deployment guide](guides/deploy-iis-windows.md) |
| Use the AI Deep Review experience | [AI Deep Review feature guide](features/ai-deep-review.md) |
| Register a GitHub App for bot identity (roadmap) | [GitHub App setup](setup/github-app.md) |
| Wire a GitHub webhook | [Webhook setup guide](guides/github-webhook-setup.md) |
| Set up Stripe billing | [Stripe setup guide](guides/stripe-setup.md) |
| Use the logo, colours or media kit | [Brand](BRAND.md) |
| Harden a deployment | [Security hardening (G1–G9)](security-hardening.md) |
| Replay a failed email / webhook | [Admin DLQ guide](guides/admin-dlq.md) |
| Read release notes | [`CHANGELOG.md`](../CHANGELOG.md) |

## Recent releases

The 5 latest, in brief. Full detail and older releases: [`CHANGELOG.md`](../CHANGELOG.md).

- **v4.14.1 (2026-08-09) — consistency pass.** `.gitattributes` said nothing
  about `.svg`, so a Windows checkout turned the generated marks into CRLF and
  failed the brand gate on a developer machine while staying green on CI. Plus
  a sweep of stale counts and version links across the README, AGENTS.md and
  this page.
- **v4.14.0 (2026-08-09) — a brand system.** The logo is replaced and, more to
  the point, generated: one file holds the geometry and emits all twelve SVGs,
  the PNGs and a Windows `.ico` whose 16 and 24 px slots carry different artwork
  from the rest. The old mark was 8 KB of gradients and blurs that read as a
  violet square in a browser tab and lost every filter converting to `.ico`.
  Colour and type are inherited from the BolaLabs platform. See
  [Brand](BRAND.md).
- **v4.13.1 (2026-08-09) — dependency maintenance.** Seven Dependabot updates
  merged and validated as a batch, including `better-sqlite3` 13.0.3, which
  still builds against Node-API 10 with ABI-independent prebuilds — so the
  Node 22.14/24 story is unchanged, and the `compat (node 22 floor)` job keeps
  proving it. No product change.
- **v4.13.0 (2026-08-09) — production hardening.** Everything needed to put the
  app on a public domain behind IIS, plus the review panel that found what the
  first pass missed. `DATA_DIR` set in `.env` was ignored for the database, so
  it landed inside the install tree where an upgrade overwrites it — and every
  operator CLI had the same bug, which made `audit:verify` return a clean
  tamper check against the wrong file (**read the upgrade note in the
  CHANGELOG**). OAuth login broke behind any proxy that does not forward
  `X-Forwarded-Proto`. The theme script was blocked by the production CSP.
  Licence minting by `repository_dispatch` never ran, and interpolated a
  caller-supplied email into a shell step holding the signing key. 99 muted-text
  tokens failed WCAG AA in both themes. Node 24 LTS is now the target, with CI
  testing the 22.14 floor.
- **v4.12.0 (2026-07-29) — money paths and honest claims.** An aborted AI
  stream recorded zero spend, so disconnecting evaded the only cost control on
  Pro/Enterprise streaming; a burst of concurrent requests could spend past any
  AI cap; and Repo Insights and Semantic Search billed the operator's key
  instead of the caller's. Three routes returned 400 on every call. Eight
  claims the product made about itself — a seat limit that does not exist,
  a hardcoded price, a cap sold nowhere, an invented SECURITY.md SLA — were
  corrected, most of them now test-enforced. better-sqlite3 upgraded to 13.


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

- [API Reference](api/API.md) — 341 route handlers across 76 route
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
