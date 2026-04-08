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
- [Context Menu + Pricing Polish](specs/2026-04-08-context-menu-and-pricing-polish.md) — Scroll-free native context menu + hybrid dazzle hover on pricing cards

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
- [Context Menu + Pricing Polish](plans/2026-04-08-context-menu-and-pricing-polish.md) — Scroll-free context menu fix + dazzle hover system for pricing cards

## Architecture

- [Overview](architecture/overview.md) — System architecture, data flow, component structure
- [Backend](architecture/backend.md) — Express server, routes, middleware, database
- [Teams](architecture/teams.md) — Teams feature architecture and data model

## API

- [API Reference](api/API.md) — Complete endpoint documentation (154 endpoints)

## Reports

- [Validation Report](reports/VALIDATION-REPORT.md) — Code analysis and validation results (Dec 2025, partially outdated)
- [Mobile Validation Snapshot](reports/validation-mobile-snapshot.md) — Playwright accessibility tree snapshot

## Articles

- [Article](ARTICLE.md) — Project article/blog post

## Images

Screenshots stored in `docs/images/` — named `0X_description_hd.png` for HD captures.
