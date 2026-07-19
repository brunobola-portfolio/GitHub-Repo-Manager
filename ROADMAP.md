# Roadmap

A thin mirror of the in-app Roadmap page (`/roadmap`). Everything here is either in progress or planned — the in-app page no longer carries a separate "Shipping Now" stage, so this mirror doesn't either; everything not yet shipped lives in **Next** or **Later**.

## Next (Q3 2026)

- **Pierre diff + tree primitives** — All tiers. Adopt `@pierre/diffs` (Apache-2.0, AGPL-compatible) as the canonical PR / commit diff renderer, `@pierre/trees` as the repo file-tree primitive.
- **Vercel AI Elements migration** — Pro. Port Repo Advisor, AI Issue Planner, and the Dashboard AI narrative onto Vercel's shadcn-shaped AI Elements (streaming, reasoning, tool calls).
- **Premium Dashboard Phase 2 (DORA)** — Enterprise. KPI cards + area charts with sparklines, delta badges, and CSV export.
- **Cross-repo Command Palette (Ctrl+K / ⌘K v2)** — All tiers. Cross-repo jump, recent-PR / issue search, AI-driven action quick-fire.
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

## Recently Shipped (v4.6.0–v4.7.0 — July 2026)

- **Native Windows distribution** (v4.7.0) — a CI-boot-validated installer and portable ZIP, both bundling their own Node.js runtime; first-run bootstrap generates its own secrets and a local `.env`; new `HOST` / `DATA_DIR` / `ALLOW_CONSOLE_EMAIL` env vars for installed layouts; in-app update notifications (`UPDATE_CHECK=false` to disable); winget manifests scaffolded, submission still pending.
- **Community WOW** (v4.6.0) — four new AI-grounded repo tools, all metered on Free with deterministic zero-AI-cost fallbacks: **README Studio** (free quality score + grounded improve), **AI Diagram Generator** (embed-into-repo + retry-once self-repair), **Agent Rules Generator** (AGENTS.md / CLAUDE.md from real detected build/test/CI signals), and **Security Posture Panel** (10-check report card + optional AI narrative).
- **Free-first pricing rebalance** (v4.6.0) — bulk ops (transfer/mirror/cross-org), mirror sync apply, AI Deep Review, Prompt Studio, PR Chat, and PR slash commands all moved off the Pro paywall to Free with generous monthly caps; Pro's role narrows to AI headroom and more API keys rather than feature unlocks.
- **Ops readiness** (v4.6.0) — a Prometheus `/metrics` endpoint (admin-session or bearer-token gated), a reverse-proxy/TLS deployment guide, and list virtualization for large repo grids.
- **Launch-readiness hardening** (v4.6.1) — every finding from the 2026-07-19 seven-dimension audit fixed, including AI spend-cap gaps on routes that could bypass metering entirely, plus 10 previously-invisible Free-tier quotas surfaced in Settings → Usage.

## Recently Shipped (v4.0.0 — May 2026)

- **AI Deep Review — slice 1a (free).** `runDeepReview` engine producing a markdown walkthrough, per-file change table, Mermaid sequence diagram, and up to 25 line comments with editable `suggestion` blocks; one-click batched publish through the outbox with idempotency-key collapse; 5 routes under `/api/ai/deep-review/*`; honest MOCK_MODE publish.
- **AI Deep Review — slice 1a-2 hardening.** Provider `usageMetadata` threading across Gemini / Anthropic / OpenAI / OpenRouter / local; unified `computeCostUSD`; LRU sweep on the rate limiter; mermaid theme observer; shared `useFocusTrap`.
- **Premium Prompt Studio** (launched Pro; now Free with monthly caps — free-first rebalance v4.6.0). 5 built-in preset lenses + per-user / per-repo / per-org custom presets, path-scoped rules, severity floor, `${REPO_STYLE_GUIDE}` token from `.repomanager/review-rules.md`. `/ai/prompts` page with Library + Editor + PromptPicker.
- **PR Slash Commands** (launched Pro; now Free with monthly caps — free-first rebalance v4.6.0). `/describe`, `/test_plan`, `/improve` from a Commands tab in the AI Review Panel; `/describe → Apply to PR` PATCHes the body via the outbox with body-hash + `updatedAt` idempotency.
- **PR Chat tab** (launched Pro; now Free with monthly caps — free-first rebalance v4.6.0). Streaming SSE Q&A on the PR with per-`(user, PR)` history persisted in `ai_pr_chat_messages` (`MAX_HISTORY_TURNS = 10`); every PR-derived string sanitised via `sanitizeForPrompt`; cancellable AbortController on unmount + new send.
- **Org-shared prompts** (launched Pro; now Free with monthly caps — free-first rebalance v4.6.0). `scope='org'` end-to-end with GitHub org-membership gating cached 5 min; resolution chain extends to `org-default`. Read-only badges in the Library.
- **Premium UX unification.** Unified 17-code AI error vocabulary + shared `<AIErrorState>`; global `<DemoModeBanner>`; `<SafeMarkdown>` for every model-output surface; 401→422 fix decoupling AI auth from session expiry; PRFilesTab "reviewed" state persisted.
- **Surface uniformity primitives.** `<SectionPanel>`, `<HeroHalo>`, `<CountUp>`, `<PageMount>` applied across Dashboard / RepoDetail / WorkBoard, all honouring `prefers-reduced-motion`.
- **Drawer consolidation.** Unified `<Drawer side="left|right|bottom">` replacing Sheet, MobileDrawer, SidePanel and AutoFixDrawer's bespoke shells. Bottom variant adds drag handle + `safe-area-inset-bottom` + swipe-to-dismiss. Fixes a pre-existing bug where `MobileDrawer side="bottom"` silently routed to `right`.
- **Suggest Name & Description.** Dedicated modal proposing name + description for a repository; field-by-field accept / edit / reject; deterministic fallback when no AI key is configured.

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
- **README Enhance** (v3.0.1) — launched Pro; now Free with monthly caps (free-first rebalance v4.6.0). AI-generated diff against your current README.
- **Batch Indexing** (v3.0.1) — launched Pro; now Free with monthly caps (free-first rebalance v4.6.0). Bulk AI indexing with progress modal.
- **Bulk operations safety** — confirmation dialogs, dry-run mode, tier-gated destructive actions.
- **PR Review write-back** (v3.4.0) — approve / request-changes / comment / merge from the app. Available on all tiers: the original Pro gating was deliberately removed in the v4.x pricing rebalance (locked by tier-gate tests).
- **PR Review Experience** (v3.0.x) — file tree, diff viewer, AI insights, threads.
- **License Badge + License Mint Automation** (v3.0.1) — Ed25519 JWT.
- **Modal System Redesign** (v3.0.1) — shared primitive, body scroll lock.
- **Health Dashboard Premium** (v3.0.x) — tabbed organisation, visual polish.
- **Rate Limit UX** (v3.0.x) — friendly notices + dev-mode exemption.
- **Landing Page** (v3.0.0) — hero, features, CTA.
- **AGPL Open-Core License Key System** (v3.0.0) — Ed25519 JWT.

See `docs/specs/` and `docs/plans/` for detailed design and implementation history.
