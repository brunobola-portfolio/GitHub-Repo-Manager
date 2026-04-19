# Documentation Map

Quick reference for navigating project documentation.

## Specs (What to build)

Design specifications and feature requirements.

- [Platform Transformation](specs/2026-04-01-platform-transformation-spec.md) — Open-core + SaaS transformation master spec (Active)
- [Dashboard Premium Redesign](specs/2026-02-05-dashboard-premium-redesign.md) — Category-based dashboard with premium filters and charts (In Progress)
- [Azure DevOps Smart Import](specs/2026-03-12-azure-smart-import-design.md) — Smart URL parser + auto-PAT for simplified Azure imports (Implemented)
- [Pixel-Perfect Layout Consistency](specs/2026-03-18-pixel-perfect-layout-consistency.md) — Layout alignment and spacing refinements
- [Responsive Layout Redesign](specs/2026-03-18-responsive-layout-redesign.md) — Mobile-first responsive layout overhaul
- [Enhanced Migration System](specs/2026-03-21-enhanced-migration-system-design.md) — Multi-source migration with work items, wikis, AI review, scheduling
- [Transfer Conflict Resolution](specs/2026-03-21-transfer-conflict-resolution.md) — Pre-transfer conflict detection and resolution strategies
- [Migration Wizard Redesign](specs/2026-03-25-migration-wizard-redesign.md) — Smart URL paste, tri-option credentials, auto-validation, visual refresh
- [Wizard Fullscreen Panel Design](specs/2026-03-25-wizard-fullscreen-panel-design.md) — Fullscreen takeover panel with sidebar navigation and state safety
- [Configure Step Redesign](specs/2026-03-26-configure-step-redesign.md) — Dashboard + compact card-rows layout for Configure Repositories step
- [Smart Organization Field](specs/2026-03-26-smart-organization-field-design.md) — Adaptive organization field based on authentication method
- [AGPL Open-Core License Key System](specs/2026-04-03-agpl-open-core-license-key-system.md) — Ed25519-signed JWT license keys for self-hosted Pro/Enterprise tiers (Implemented)
- [Context Menu + Pricing Polish](specs/2026-04-08-context-menu-and-pricing-polish.md) — Scroll-free native context menu + hybrid dazzle hover on pricing cards
- [PR Review Experience](specs/2026-04-09-pr-review-experience-design.md) — Premium PR review UI with file tree, diff viewer, AI insights, conversation threads
- [Rate Limit UX + Dev Fix](specs/2026-04-09-rate-limit-ux-and-dev-fix.md) — User-friendly rate limit notices and dev-mode rate limit exemption
- [Community Health Tabs](specs/2026-04-10-community-health-tabs-design.md) — Tabbed organization of community health dashboard sections
- [Health Dashboard Premium](specs/2026-04-10-health-dashboard-premium-design.md) — Premium visual redesign of the community health dashboard
- [Reusable TabBar](specs/2026-04-10-reusable-tabbar-design.md) — Shared TabBar primitive extracted from Modal, used across 4+ call sites
- [Modal System Redesign](specs/2026-04-11-modal-system-redesign.md) — AI Insights scrollbar fix + shared Modal primitive consolidation + InsightCard/StatBar shared components
- [License Mint Automation](specs/2026-04-11-license-mint-automation-design.md) — GitHub Actions-based Ed25519 license minting with Resend delivery, separate private audit repo, two-phase audit pattern, Phase 2 migration path (Implemented)
- [Free Tier Expansion](specs/2026-04-15-free-tier-expansion.md) — Move AI Assistant, Semantic Search, Migration Risk Analysis, and PR Review (read-only) to Free tier; back advertised per-feature caps with real counters; gate advanced bulk behind Pro; honor dry-run migration flag (Implemented)
- [Migration Repo Select Redesign](specs/2026-04-16-migration-repo-select-redesign.md) — Decision-support surface for picking which Azure DevOps repos to migrate: deterministic 10-rule risk engine, 5 batched Azure enrichment endpoints, slide-in detail panel, keyboard-first UX, virtualized rows (Implemented)
- [Migration Auto-Fix Drawer](specs/2026-04-16-migration-autofix-drawer.md) — Persistent size-strategy choices with "Fix applied" badge; `lfs-migrate` auto-enables the Configure-step LFS toggle (Implemented)
- [AI-Assisted Migration Description](specs/2026-04-18-ai-migration-description.md) — Gemini-generated target-repo descriptions with deterministic fallback (Implemented in v3.3.0)
- [BYOK and Remaining Phase 0](specs/2026-04-19-byok-and-remaining-phase-0.md) — BYOK multi-provider AI, event ingestion, Work Board, SOC 2 hardening
- [Expert Panel Review](specs/2026-04-19-expert-panel-review.md) — Expert panel findings and prioritised feature gaps
- [Feature Research and Roadmap Gaps](specs/2026-04-19-feature-research-and-roadmap-gaps.md) — Research into unimplemented features and roadmap alignment
- [Next-Session Handoff](specs/2026-04-19-next-session-handoff.md) — Starting point for the next agent session

## Plans (How to build it)

Step-by-step implementation plans generated from approved specs.

### Platform Transformation (Open-Core + SaaS)

- [Phase 0: Open-Source Launch Prep](plans/2026-04-01-phase0-opensource-launch-prep.md) — Docker, community files, CI/CD, repo cleanup
- [Phase 1: SaaS Architecture](plans/2026-04-01-phase1-saas-architecture.md) — DB abstraction, multi-tenancy, Redis sessions, job queues, API versioning
- [Phase 2: Cloud Deployment](plans/2026-04-01-phase2-cloud-deployment.md) — Vercel + Railway, monitoring, CI/CD pipeline
- [Phase 3: Auth & Enterprise](plans/2026-04-01-phase3-auth-security-enterprise.md) — API keys, audit logs, rate limits, tier system, security hardening
- [Phase 4: Monetization](plans/2026-04-01-phase4-monetization.md) — Stripe billing, usage metering, pricing page, checkout flow
- [Phase 5: Marketing & GTM](plans/2026-04-01-phase5-marketing-gtm.md) — Landing page, Product Hunt, content, community, partnerships

### Feature Development

- [Azure DevOps Smart Import](plans/2026-03-12-azure-smart-import-plan.md) — 7-task implementation plan for smart URL parser + env PAT (Complete)
- [Pixel-Perfect Layout Consistency](plans/2026-03-18-pixel-perfect-layout-consistency.md) — Layout alignment and spacing fixes
- [Responsive Layout Redesign](plans/2026-03-18-responsive-layout-redesign.md) — Mobile-first responsive implementation
- [Enhanced Migration System](plans/2026-03-21-enhanced-migration-system.md) — Migration engine, work items, wikis, AI planner (Complete)
- [Transfer Conflict Resolution](plans/2026-03-21-transfer-conflict-resolution.md) — Conflict detection implementation
- [Migration Wizard Redesign](plans/2026-03-25-migration-wizard-redesign.md) — Smart URL paste, credentials panel, auto-validation, visual refresh
- [Wizard Fullscreen Panel](plans/2026-03-25-wizard-fullscreen-panel.md) — Fullscreen panel container with sidebar stepper and dirty-state safety
- [Configure Step Redesign](plans/2026-03-26-configure-step-redesign.md) — Dashboard header + compact card-rows for Configure Repositories step
- [AGPL Open-Core License Key System](plans/2026-04-03-agpl-open-core-license-key-system.md) — 13-task plan: Ed25519 keypair, JWT sign/verify, middleware integration, tests (Complete)
- [Context Menu + Pricing Polish](plans/2026-04-08-context-menu-and-pricing-polish.md) — Scroll-free context menu fix + dazzle hover system for pricing cards
- [PR Review Experience](plans/2026-04-09-pr-review-experience-plan.md) — Multi-phase plan for file tree, diff viewer, AI insights, conversation threads
- [Rate Limit UX + Dev Fix](plans/2026-04-09-rate-limit-ux-and-dev-fix.md) — Toast notifications and dev-mode rate limit exemption
- [Community Health Tabs](plans/2026-04-10-community-health-tabs.md) — Tabbed reorganization of health dashboard
- [Health Dashboard Premium](plans/2026-04-10-health-dashboard-premium.md) — Premium visual overhaul implementation
- [Reusable TabBar](plans/2026-04-10-reusable-tabbar.md) — Extraction of shared TabBar primitive + migration of call sites
- [Modal System Redesign](plans/2026-04-11-modal-system-redesign.md) — 24-task plan: useBodyScrollLock + InsightCard + StatBar + Modal enhancement + migration of 3 hand-rolled modals + WizardPanel alignment
- [License Mint Automation](plans/2026-04-11-license-mint-automation.md) — 10-task TDD plan: `scripts/lib/minter.js` primitives, CLI composition wrapper, mint-license.yml workflow, dependabot config, server/lib/license.js kid/resolver additions (Complete)
- [Eight-Specialist Audit](plans/2026-04-13-eight-specialist-audit.md) — Parallel-agent audit + validated, prioritised plan covering security, legal (AGPL §13), monetization (Stripe idempotency, license cache), perf, code quality, a11y, DX (In Progress)
- [Comprehensive Code Review](plans/2026-04-13-comprehensive-code-review.md) — Repo-wide code review pass (In Progress)
- [Migration Repo Select Redesign](plans/2026-04-16-migration-repo-select-redesign.md) — 10-rule risk engine + 5 batched Azure endpoints + virtualized list + slide-in detail panel (Complete)
- [Migration Auto-Fix Drawer](plans/2026-04-16-migration-autofix-drawer-plan.md) — Persistent size-strategy choices with visual feedback (Complete)

## Guides

- [AI Providers (BYOK)](ai-providers.md) — BYOK multi-provider setup (Gemini, Anthropic, OpenAI, OpenRouter, LMStudio)
- [GitHub Event Ingestion](event-ingestion.md) — GitHub webhook ingestion (PR, issues, deployments)
- [Cross-Repo Work Board](work-board.md) — Work Board — reviews, stale PRs, DORA
- [Security Hardening](security-hardening.md) — SOC 2 code hardening (audit chain, data erasure, retention)
- [Billing and Licensing](billing-and-licensing.md) — Stripe subscription + license key delivery

## Architecture

- [Overview](architecture/overview.md) — System architecture, data flow, component structure
- [Backend](architecture/backend.md) — Express server, routes, middleware, database
- [Teams](architecture/teams.md) — Teams feature architecture and data model

## API

- [API Reference](api/API.md) — Complete endpoint documentation (~180 route handlers across 21 route modules)

## Reports

- [Validation Report](reports/VALIDATION-REPORT.md) — Code analysis and validation results (Dec 2025, partially outdated)
- [Mobile Validation Snapshot](reports/validation-mobile-snapshot.md) — Playwright accessibility tree snapshot

## Articles

- [Article](ARTICLE.md) — Project article/blog post

## Images

Screenshots stored in `docs/images/` — named `NN_description_hd.png` for HD captures (Playwright MCP at 1920x1080).

Recent captures (April 2026):

- `21_license_badge_enterprise_hd.png`, `22_license_badge_header_hd.png` — LicenseBadge header pill showing Enterprise tier from `/api/v1/license`
- `23_context_menu_fix_hd.png` — Scroll-free context menu validation ([2026-04-08 spec](specs/2026-04-08-context-menu-and-pricing-polish.md))
- `24_rate_limit_banner_landing_hd.png`, `25_rate_limit_banner_ready_hd.png`, `26_rate_limit_banner_verify_hd.png` — Rate limit banner states ([2026-04-09 spec](specs/2026-04-09-rate-limit-ux-and-dev-fix.md))
- `27_landing_validated_hd.png` — Landing page served by `npm run dev:all`, captured after CHANGELOG/docs/test reorganization pass
- `28_releases_tab_empty_hd.png` — RepoDetail → Releases tab, empty state ("No releases yet") after navigation in mock mode
- `29_releases_tab_create_form_hd.png` — Releases tab with the New Release form opened (Tag, Title, Release Notes, Draft/Pre-release toggles)
- `30_releases_tab_form_filled_hd.png` — Create form populated with `v3.1.0` / Modal System Redesign / pre-release toggle enabled, Publish button active
- `31_releases_tab_form_dark_hd.png` — Same filled form in dark mode, validating Tailwind `.dark` variants on Card/Input/Button/TabBar
- `32_releases_tab_publish_error_hd.png` — Error state after Publish: backend surfaces `"GitHub token expired or revoked"` banner (expected in mock mode — real backend refuses the fake token)
