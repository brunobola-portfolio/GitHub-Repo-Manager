# Roadmap

A thin mirror of the in-app Roadmap page (`/roadmap`). Everything here is either in progress or planned — items that aren't genuinely close to shipping live in **Next** so the "Shipping Now" list stays honest.

## Shipping Now (Q2 2026)

- **Security & Secrets Scan** — Pro. Aggregates GitHub's native Dependabot / secret scanning alerts.

## Next (Q3 2026)

- **Azure DevOps Server (on-premise)** — Enterprise. PAT + URL adaptation for self-hosted Azure DevOps.
- **GitLab Migration Importer** — Pro + Enterprise. Clone GitLab repos with history. Scope: sources, branches, default protections, issues (best-effort).
- **Bitbucket Migration Importer** — Pro + Enterprise.
- **Advanced Analytics Dashboard** — Enterprise. Commit heatmaps, contributor insights, dependency graph.
- **Dependency Graph Visualizer** — Pro. Interactive graph of repo dependencies (SBOM-derived).
- **SSO / SAML** — Enterprise. Okta, Entra ID, SAML 2.0.
- **Backup & Restore System** — Enterprise. Scheduled snapshots with point-in-time restore.
- **Security Alerts Dashboard** — Pro. Cross-repo CVE aggregation.
- **SBOM Export** — Enterprise. CycloneDX + SPDX.
- **Release Notes Generator** — Pro. AI from commits + PRs.

## Later (Q4 2026+)

- **GitHub Enterprise Server** — Enterprise.
- **Plugin / Extension System** — Free + Pro.
- **Mobile App (React Native)** — all tiers.
- **Org Permissions Sync** — Enterprise.
- **Dependabot Aggregation** — Pro.
- **Custom Workflow Templates** — Pro.

## Recently Shipped (v3.8.0 — April 2026)

- **Dashboard hero redesign** — `DashboardHero`, `WhatNeedsYouGrid`, `AIPromoStrip`, `AttentionFeed` with AI narrative on the lead item.
- **Mobile UX overhaul** — 5-item bottom-nav, `MobileQuickActionsFab`, focus-trapped drawer, "More" bottom sheet.
- **Work Board — tracked repos + AI upgrade (7 phases)** — explicit tracked-repo set with five-signal discovery, virtualised settings UI, KPI sparklines + deltas, AI summary card with urgency glow, suggestion chips, conversational-edit preview-then-apply.
- **Premium AI Configuration** — curated model dropdowns, per-feature override section, per-feature key-health pills, admin probe stats tab.
- **Honest error handling** — `formatUserError`, `toast.errorFromException`, `QuotaExceededState` modal mounted on a single global event, server `quotaErrorPayload` / `tierRequiredPayload` helpers.
- **Onboarding tour** — `useOnboarding` + 3-step `OnboardingTour` with focus trap and Settings re-run button.
- **Cross-app polish** — conversational ask mode in `Ctrl+K`, real notifications digest, branch hygiene panel, AI-suggested topics, clickable `RepoHealthBadge`.
- **CSRF coverage on every mutating call site** (30+ hand-rolled fetches now route through `getCsrfToken()`).
- **CI guards** — bundle-size budget (≤ 415 KB gzip eager), build-honesty test (no mock-repo strings in production bundles), README honesty regression guard, ESLint rule forbidding `.stack` access in `src/components/`.
- **UI primitive consolidation** — `Spinner` / `SectionSpinner`, `PageShell` / `PageHeader`, `EmptyState`, `Skeleton`, `Card`, expanded `Button` variants. 25 standalone `Loader2` sites migrated.

## Recently Shipped (Q1–Q2 2026)

- **Admin DLQ UI + CLI** (v3.7.0) — Email + Webhook DLQs with retry / resolve / filter, plus zero-dep CLI scripts.
- **Public `/status` page + session-expiry hook** (v3.7.0) — unauthenticated health page; soft + hard warns before the 7-day session ceiling.
- **Husky v9 + lint-staged v16** (v3.7.0) — pre-commit `eslint --fix --max-warnings 0` and `console.log` / `debugger` rejection.
- **BYOK multi-provider AI** (v3.4.0) — Gemini, Anthropic, OpenAI, OpenRouter, LMStudio. AES-256-GCM at rest. Custom model selection.
- **GitHub event ingestion pipeline** (v3.4.0) — real-time PR, issue, deployment webhooks.
- **Cross-Repo Work Board (initial release)** (v3.5.0) — my reviews / stale PRs / my issues / review load / Tech Debt / DORA.
- **Command Palette live GitHub search** (v3.4.0) — PRs / issues / repositories with debounce + 429 awareness.
- **AI Issue-to-PR Planner (plan-only)** (v3.4.0) — structured plans (approach, files, tests, risks, estimate); BYOK.
- **SOC 2 code hardening** (v3.6.0) — append-only audit log with SHA-256 hash chain, GDPR Article 17 + 20 self-service, startup secrets verification, retention pass with warning emails, CSRF + SSRF + rolling session + auth-route rate-limit + mandatory `CREDENTIAL_ENCRYPTION_KEY`.
- **Stripe billing + license key delivery** (v3.0.0) — Ed25519-signed JWT license keys issued and emailed on checkout completion.
- **CODEOWNERS Parser + Suggest endpoint + UI** (v3.4.0).
- **Compare-with-existing side-by-side diff** (v3.4.0) — README + package.json side-by-side from any similar-repo result.
- **README Enhance** (v3.0.1) — Pro. AI-generated diff against your current README.
- **Batch Indexing** (v3.0.1) — Pro. Bulk AI indexing with progress modal.
- **Bulk operations safety** — confirmation dialogs, dry-run mode, tier-gated destructive actions.
- **PR Review write-back tier gating** (v3.4.0) — Free is read-only; Pro+ for approve / request-changes / comment / merge.
- **PR Review Experience** (v3.0.x) — file tree, diff viewer, AI insights, threads.
- **License Badge + License Mint Automation** (v3.0.1) — Ed25519 JWT.
- **Modal System Redesign** (v3.0.1) — shared primitive, body scroll lock.
- **Health Dashboard Premium** (v3.0.x) — tabbed organisation, visual polish.
- **Rate Limit UX** (v3.0.x) — friendly notices + dev-mode exemption.
- **Landing Page** (v3.0.0) — hero, features, CTA.
- **AGPL Open-Core License Key System** (v3.0.0) — Ed25519 JWT.

See `docs/specs/` and `docs/plans/` for detailed design and implementation history.
