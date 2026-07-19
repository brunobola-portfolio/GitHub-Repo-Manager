# The GitHub Dashboard That Thinks: Building an AI-Native Repository Platform

*By Bruno Silva Marques, Bola Labs — GitHub Repo Manager v4.6.0, July 2026*

---

## The problem nobody schedules time for

If you look after more than a handful of repositories, you already know the tax. Reviews you're the blocker on, buried in email. Pull requests that quietly went stale two weeks ago. A migration off Azure DevOps that everyone agrees is "important" and nobody wants to own. Documentation that drifts out of sync with the code the moment it's written.

None of this is hard, exactly. It's just scattered — spread across a dozen tabs, several org dashboards, and the part of your memory you were hoping to use for actual engineering. Multiply it across teams and hundreds of repos, and you spend more time *administering* software than building it.

I built **GitHub Repo Manager** to collapse that surface area into one place — and to put AI where it actually saves time, not where it demos well. It's a full-stack, AI-native dashboard for managing, reviewing, and migrating repositories, released today as **v4.6.0**.

**Repository:** [github.com/brunobola-portfolio/GitHub-Repo-Manager](https://github.com/brunobola-portfolio/GitHub-Repo-Manager)

![Dashboard](images/01_dashboard_dark_hd.png)

---

## What it actually does

At its core, this is a single pane of glass over your GitHub world — repositories, organizations, teams, CI/CD, and community-health signals — with AI woven through the layers where it earns its place. But the interesting part isn't the dashboard. It's the four workflows the product is genuinely built around.

### 1. A dashboard with a Live Inbox

The home screen opens with a personalized greeting and a "What needs you" grid: reviews waiting on you, stale PRs, and open issues, each with week-over-week deltas and a real empty state when you're actually caught up.

The centerpiece is the **Live Inbox** — a sectioned, keyboard-driven queue (needs review, my open PRs, mentions, stale drafts) that replaces the usual static activity feed. Archive an item with `e`, snooze it with `s`; both actions persist per user and are free on every tier. The top items in the active section can carry a one-line AI narrative so you understand *why* something needs you before you click in.

![Live Inbox](images/10_dashboard_live_inbox_needs_review_hd.png)

### 2. A cross-repo Work Board

The Work Board is a cockpit across every repository you touch — no manual registration required. It seeds itself from five signal collectors (review-requested, authored, assigned, owned, recently-committed) so you never start with an empty board, and it live-fetches from GitHub Search when no webhook is configured, cached five minutes with ETag revalidation.

Tabs cover **My Reviews**, **My Issues**, **Stale PRs**, **Review Load** (submitted-vs-pending per reviewer, to spot who's drowning), and **Tech Debt** (issues grouped by hotspot). It also surfaces **DORA metrics** — deploy frequency, lead-time p50/p90, change-failure rate, MTTR — with CSV export, available on every tier as part of the free-first rebalance.

Everything is keyboard-first (`j`/`k` navigation, `.` to approve, `x` to request changes, `s` to snooze) and every filter round-trips through the URL, so a filtered view is shareable by copy-pasting the link. Inline actions — approve, request changes, snooze, re-request review — happen right on the row with optimistic UI and a clean re-auth fallback when an OAuth scope is missing.

![Work Board](images/33_work_board_dark_hd.png)

### 3. AI Deep Review

This is the feature that turns the in-app PR view into something developers choose over github.com. Point it at a pull request and it produces a structured **walkthrough** (markdown summary, per-file change table, a Mermaid sequence diagram), up to 25 **line-level comments** with one-click `suggestion` blocks you can edit before publishing, PR-context **slash commands** (`/describe`, `/test_plan`, `/improve`), and a **streaming Q&A chat** grounded in the PR. One click batches the whole thing into a single GitHub review — through an idempotent outbox, so a double-click across a server restart still collapses into one review row — with an honest AI-generated footer.

A built-in **Prompt Studio** lets you layer custom review presets at user, repo, or org scope, with path-scoped rules, a severity floor, and a `${REPO_STYLE_GUIDE}` token that inlines your repo's own `.repomanager/review-rules.md`.

### 4. The "Community WOW" tools (new in v4.6)

The v4.6 wave adds four AI-grounded repo tools, each metered generously on Free with a *deterministic, zero-AI-cost fallback* so nothing hard-blocks when a key or quota is unavailable:

- **README Studio** — a free deterministic README quality score (license correctness, badge-vs-reality consistency, install-vs-stack match, screenshots, section order) plus a grounded improve flow that will never invent a license claim, command, or badge that isn't real.
- **AI Diagram Generator** — architecture diagrams grounded in the repo's real file tree and README, with a retry-once self-repair pass on invalid Mermaid, SSE streaming, and embed-into-repo as either an idempotent README fence or a sanitized SVG.
- **Agent Rules Generator** — `AGENTS.md` / `CLAUDE.md` generated from *actually detected* build/test/lint/CI signals, never a fabricated command, with a diff-aware refresh mode.
- **Security Posture Panel** — a 10-check deterministic report card (branch protection, alert severity, secret scanning + push protection, Dependabot updates, code scanning, `SECURITY.md`, workflow token permissions, org 2FA) with an optional AI narrative fed only whitelisted check results — never raw alert bodies.
- **AI Image Generation** — repo banner / README hero / logo drafts across three fixed presets, capability-gated per provider, with binary-safe commits and typed refusal handling.

---

## The engineering decisions I'd defend in a review

A product is the sum of the choices you're willing to argue for. Here are the ones that shaped this codebase.

### Grounded honesty is a build-time gate, not a value statement

Every AI product claims to be "honest." Very few enforce it. Here, generated content is not allowed to claim a feature, limit, or price that doesn't exist — and that's checked in CI. Pricing surfaces are compared cell-for-cell against the README by a parity test; a README-honesty regression guard fails the build if the docs drift from the flags. The four Community WOW tools all ship a deterministic fallback precisely so the product degrades into *truthful* output instead of a hallucinated one when AI is unavailable. Honesty is a property of the pipeline, not a promise in the copy.

### Provider-neutral AI, with the guardrails an LLM product actually needs

The AI layer is BYOK (bring your own key) and provider-neutral behind a single `AI_PROVIDER` seam: **Anthropic, OpenAI, Google Gemini, OpenRouter, and local runtimes (Ollama / LMStudio)** are interchangeable per feature. Per-user keys are encrypted at rest with AES-256-GCM (PBKDF2-HMAC-SHA256 key derivation).

Around that seam sit the controls a production LLM feature needs and most skip: a **global spend cap** plus a **per-call output-token cap** (OWASP LLM10), **PII-safe audit metadata** on every generation, **SSE streaming** that preserves partial text on disconnect, BYOK hardening (key rotation, model-id validation, DNS re-checks), and a **golden-eval suite gated in CI**. Repo Advisor answers are answer-first, grounded, and cited. Without any key configured, the app returns high-quality mock responses so the full UI is explorable with zero setup.

### SQLite on purpose — and PostgreSQL rejected on purpose

The datastore is **better-sqlite3 in WAL mode**, and that's a deliberate ceiling, not a starting point I never got around to raising. SQLite keeps the operational surface tiny: one file, an online `db.backup()` that's WAL-safe, and no separate database to run. The non-functional PostgreSQL adapter path was removed outright — a `postgres://` `DATABASE_URL` now fails fast at boot with an actionable error instead of silently exercising a broken code path. Schema changes flow through a single versioned migration ledger, not loose `.sql` files, and every migration is written to be idempotent so it can safely re-apply.

### Accessibility gated on *both* themes

Dark and light aren't a cosmetic toggle bolted on at the end — both are hard-gated for color contrast in the Playwright/axe suite (nine views × two themes). Risk colors come from a dedicated token system where the graphic fills and the text variants are separate, because a fill that reads fine as a chart bar fails WCAG AA as text. The visual language itself was deliberately walked *back* in v4.3.0, from a gradient-and-glow "AI template" look to a restrained, GitHub-tasteful aesthetic. Restraint reads as premium; shimmer reads as a demo.

### Preview-first writes, metered generation, parameterized SQL

Anything that writes to a user's repository goes preview-first through a single `commitOrOpenPR()` primitive — never an auto-commit, never a new bespoke write path, and file paths are always derived server-side rather than trusted from the client. Every AI generation route is metered through a guarded path that records cost and writes an audit entry; an unmetered provider call is treated as a regression class with its own tests. SQL is parameterized throughout.

---

## Architecture at a glance

It's a two-part application, and honest about being one.

- **Frontend** — React 19.2 + Vite 8.0 + Tailwind CSS 4.1, a single-page app with heavy route-level code-splitting (Work Board, PR Review, Admin, RepoDetail) held under explicit gzip budgets by a CI bundle-size gate. Framer Motion 12 drives animation from a shared motion vocabulary; Recharts 3 handles charts.
- **Backend** — Express 5.2 with **324 route handlers across 74 route modules**, fronted by Helmet, tier-aware and per-IP rate limiting, CSRF double-submit tokens, an SSRF + DNS-rebinding guard on import-from-URL, and rolling sessions with a 7-day absolute ceiling. Zod schemas validate request bodies behind a consistent `validation_failed` envelope.
- **Data** — better-sqlite3 12.9 (WAL), all per-user tables keyed by `user_id` for multi-tenant isolation, with WAL-safe scheduled backups and maintenance janitors that keep a long-running instance healthy without babysitting.
- **Integrations** — GitHub REST API, Azure DevOps API v7.1, Stripe billing, Resend email (with retry + dead-letter queue), and the BYOK AI providers. A GitHub API circuit breaker keeps upstream degradations from cascading into a retry storm.

Full detail lives in [`docs/architecture/overview.md`](architecture/overview.md) and the [API reference](api/API.md).

---

## The migration suite (and exactly what it covers)

Migrating off Azure DevOps is genuinely painful, especially with TFVC history, work items, and wikis in the mix. GitHub Repo Manager handles it through a guided eight-step wizard.

| Source | What migrates | How |
|--------|---------------|-----|
| **Git repos** | Full history, branches, tags | Direct clone with complete preservation |
| **TFVC repos** | Up to 180 days of history | Automatic TFVC-to-Git conversion via the Azure Import API, ZIP-snapshot fallback |
| **Work items** | Types, states, comments, attachments | Azure Boards → GitHub Issues with field mapping |
| **Wikis** | All pages and content | Git-based clone with markdown conversion |

Beyond the transfer itself: an **AI Review step** with severity-ranked risk analysis; a 10-rule risk engine on repo selection; **dry-run mode**; inline **conflict resolution** (replace / rename / skip) with a type-to-confirm modal for destructive replaces and one-click **Replace & retry**; **Git LFS retry** for oversized-file failures; **provenance tagging** that marks every successful migration; PATs encrypted at rest with AES-256-GCM; and a full per-task audit trail. In v4.6, cancel actually stops the in-flight clone/LFS/push instead of letting the background job run to completion, and a Migration Health card summarizes per-task caveats in plain English.

To be precise about scope: **migration is Azure DevOps → GitHub only.** GitLab and Bitbucket are not supported. If you need them, this isn't your tool yet.

![Migration Wizard](images/08_migration_wizard_hd.png)

---

## Pricing: free-first, on purpose

The hosted product is deliberately **free-first**. Nearly every capability — bulk operations, mirror sync, AI Deep Review, Prompt Studio, PR Chat, PR slash commands, DORA metrics, and unlimited teams — ships on the **Free** tier with generous, non-infinite monthly caps. Each AI capability carries its own cap so one feature can't drain the whole budget, and usage is metered per individual account even within a team.

Pro ($19/mo) and Enterprise don't unlock features. They sell **AI headroom** (bigger caps, a higher spend-cap ceiling), more API keys, and compliance/service deliverables — audit logs, priority support with an SLA, white-glove migration. Self-hosting under AGPL v3 is free forever. The full matrix lives in the [README](../README.md#plans--pricing), and a parity test keeps it honest against the code.

---

## Building it with AI as a co-developer

Worth saying plainly, because it's part of the story: this platform was built with AI as a development partner. I used **Claude Code** — Anthropic's CLI coding agent — throughout the lifecycle: architecture trade-offs, the migration engine and AI-service integration, test generation, security hardening, code review, and documentation. The repo carries a `CLAUDE.md` (and now a generated `AGENTS.md`) of persistent conventions, so the assistant compounds context over time instead of relearning the house style every session.

The lesson isn't "AI replaces the developer." It's that the developer still owns the architecture, the problem domain, and the critical review of every diff — but with the mechanical work amortized, one person can ship and *maintain* something with 324 route handlers, a full migration suite, four flagship AI workflows, and **6,000+ passing tests**. That leverage is the actual headline.

---

## Honest capabilities and limits

A launch article that only lists wins isn't worth reading. So, the boundaries:

- **Migration is Azure DevOps → GitHub only.** No GitLab, no Bitbucket.
- **SSO / SAML is roadmap**, not shipped — it's honestly flagged as such on the pricing page and in the feature flags.
- **GitHub Enterprise Server support is roadmap.** Today the target is GitHub.com via OAuth.
- **A GitHub App bot identity is roadmap** — AI Deep Review currently publishes under the authenticated OAuth user, not a `[bot]` account.
- **The backend is a long-running process, not a serverless function.** The `dist/` frontend is static-hostable anywhere; the Express + SQLite backend needs a host and a persistent volume. There's no serverless deploy target for it today, and that's stated plainly in the ops guide.

Everything on the pricing page works today. Upcoming items are scoped honestly as Shipping Now / Next / Later on the in-app roadmap.

---

## The stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19.2, Vite 8.0, Tailwind CSS 4.1 |
| Animation / UI | Framer Motion 12, Recharts 3, Lucide, Radix UI, cmdk |
| Backend | Node.js 20+, Express 5.2 |
| Database | better-sqlite3 12.9 (WAL) — SQLite only |
| AI (BYOK) | Anthropic, OpenAI, Google Gemini, OpenRouter, Ollama / LMStudio — provider-neutral (`AI_PROVIDER`) |
| Validation | Zod 4 |
| Security | Helmet, express-rate-limit, CSRF double-submit, SSRF + DNS-rebinding guard, AES-256-GCM at rest |
| Logging | Pino (structured JSON, credential redaction) + Sentry breadcrumbs |
| Testing | Vitest (6,000+ unit tests) + Testing Library + Playwright, dual-theme axe a11y gate |

---

## Try it yourself

Demo mode runs the full UI with 87 realistic mock repositories, simulated orgs and teams, and mock AI responses — **no GitHub account and no API keys required**.

```bash
git clone https://github.com/brunobola-portfolio/GitHub-Repo-Manager.git
cd GitHub-Repo-Manager
npm install
npm run dev:all
```

Open [http://localhost:5173](http://localhost:5173) and explore. For real mode, add your GitHub OAuth credentials, and configure any AI provider key you like under **Settings → AI Configuration** — it's encrypted at rest the moment you paste it. Full detail is in the [README](../README.md) and the [changelog](../CHANGELOG.md).

---

## Licensing

GitHub Repo Manager is **open-core under the GNU Affero General Public License v3 (AGPL-3.0)** — free to self-host forever, with contributions accepted under a CLA. If you run a modified version as a network service, AGPL §13 applies, and the app ships a machine-readable source-offer endpoint (`GET /api/v1/system/source`) to make that easy to honor.

A **commercial license** is available for organizations that need to use the software without AGPL obligations, along with hosted Pro/Enterprise plans backed by signed license keys. For terms, licensing, or anything else, reach me at **[bruno@bolalabs.pt](mailto:bruno@bolalabs.pt)**.

---

*Bruno Silva Marques is the founder of Bola Labs, building modern developer tools at the intersection of AI and software engineering. If GitHub Repo Manager is useful to you, a star on the [repository](https://github.com/brunobola-portfolio/GitHub-Repo-Manager) genuinely helps.*
