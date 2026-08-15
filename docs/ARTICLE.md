# The GitHub Dashboard That Thinks: Building an AI-Native Repository Platform

*By Bruno Silva Marques, Bola Labs — GitHub Repo Manager v4.7.0, July 2026*

---

## The problem nobody schedules time for

If you look after more than a handful of repositories, you already know the tax. Reviews you're the blocker on, buried in email. Pull requests that quietly went stale two weeks ago. A migration off Azure DevOps that everyone agrees is "important" and nobody wants to own. Documentation that drifts out of sync with the code the moment it's written.

None of this is hard, exactly. It's just scattered — spread across a dozen tabs, several org dashboards, and the part of your memory you were hoping to use for actual engineering. Multiply it across teams and hundreds of repos, and you spend more time *administering* software than building it.

I built **GitHub Repo Manager** to collapse that surface area into one place — and to put AI where it actually saves time, not where it demos well. It's a full-stack, AI-native dashboard for managing, reviewing, and migrating repositories. And as of today's **v4.7.0**, it runs natively on Windows: download, double-click, your browser opens. No Docker. No Node.js install. No admin rights.

**Repository:** [github.com/brunobola-portfolio/GitHub-Repo-Manager](https://github.com/brunobola-portfolio/GitHub-Repo-Manager)

![Dashboard](images/01_dashboard_dark_hd.png)

---

## New in v4.7.0: a real Windows app, validated like one

Self-hosted tools love to say "just run Docker." That's a real barrier for a lot of people who'd benefit most from a tool like this. So v4.7.0 ships Windows as a first-class distribution:

- **A per-user installer and a portable ZIP**, both carrying their own Node.js runtime (checksum-verified against the official nodejs.org SHASUMS at build time). The installer needs no admin rights and no UAC prompt — it installs to your user profile.
- **First run configures itself.** The app generates four independent random secrets into a local `.env`, binds to `127.0.0.1` only — so there's no Windows Firewall prompt and nothing exposed to your LAN — and opens your browser. If port 3001 is busy, it finds the next free one.
- **Your data survives everything.** The installer keeps data in `%LOCALAPPDATA%`, out of the app directory; updates and even uninstall leave it in place.
- **CI boots the package before anything ships.** Every PR and every release runs the launcher headless, waits for the health endpoints, then silently installs, boots the installed copy, uninstalls, and asserts the data survived. The release job refuses to upload an artifact that never booted.
- **Update notifications, not auto-updates.** Settings → About shows a dismissable "new version available" banner sourced from a single unauthenticated call to the GitHub Releases API — no identifying data sent, cached 24 hours, and `UPDATE_CHECK=false` turns the outbound call off entirely. The app never modifies itself.

Two honest caveats, because they're the kind of thing this project puts in writing: the binaries are **unsigned** for now, so SmartScreen will ask you to confirm ("More info → Run anyway") — every asset ships with a SHA-256 sidecar you can verify. And **winget is not available yet**; the manifests are scaffolded and submission is pending.

---

## What it actually does

At its core, this is a single pane of glass over your GitHub world — repositories, organizations, teams, CI/CD, and community-health signals — with AI woven through the layers where it earns its place. Four workflows carry the product.

### 1. A dashboard with a Live Inbox

The home screen opens with a "What needs you" grid — reviews waiting on you, stale PRs, open issues, each with week-over-week deltas — and a sectioned, keyboard-driven **Live Inbox** (needs review, my open PRs, mentions, stale drafts) that replaces the usual static activity feed. Archive with `e`, snooze with `s`; both persist per user and are free on every tier.

![Live Inbox](images/10_dashboard_live_inbox_needs_review_hd.png)

### 2. A cross-repo Work Board

A cockpit across every repository you touch — no manual registration. It seeds itself from five signal collectors, live-fetches from GitHub Search when no webhook is configured, and covers **My Reviews**, **My Issues**, **Stale PRs**, **Review Load** (who's drowning), **Tech Debt**, and a **DORA Metrics tab** (deploy frequency, lead time p50/p90, change-failure rate, MTTR, CSV export) — on every tier. Keyboard-first (`j`/`k`, `.` to approve, `s` to snooze), and every filter round-trips through the URL, so any view is shareable as a link.

![Work Board](images/33_work_board_dark_hd.png)

### 3. AI Deep Review

Point it at a pull request and it produces a structured **walkthrough** (summary, per-file change table, a Mermaid sequence diagram), up to **25 line-level comments** with one-click `suggestion` blocks you can edit before publishing, PR-context **slash commands** (`/describe`, `/test_plan`, `/improve`), and a **streaming Q&A chat** grounded in the PR. One click batches everything into a single GitHub review — through an idempotent outbox, so a double-click across a server restart still collapses into one review — with an honest AI-generated footer.

A built-in **Prompt Studio** layers custom review presets at user, repo, or org scope, with path-scoped rules, a severity floor, and a token that inlines your repo's own review-rules file.

### 4. The grounded repo tools

Five AI tools, each metered generously on Free and each with a *deterministic, zero-AI-cost fallback* so nothing hard-blocks when a key or quota is missing:

- **README Studio** — a deterministic README quality score plus a grounded improve flow that never invents a license claim, command, or badge.
- **AI Diagram Generator** — architecture diagrams grounded in the repo's real file tree, with a self-repair pass on invalid Mermaid and embed-into-repo as an idempotent README fence or sanitized SVG.
- **Agent Rules Generator** — `AGENTS.md` / `CLAUDE.md` from *actually detected* build/test/lint/CI signals, never a fabricated command.
- **Security Posture Panel** — a 10-check deterministic report card (branch protection, secret scanning, Dependabot, workflow token permissions, org 2FA…) with an optional AI narrative fed only whitelisted check results.
- **AI Image Generation** — repo banner / README hero / logo drafts, capability-gated per provider, with binary-safe commits.

---

## The engineering decisions I'd defend in a review

### Honesty is a build-time gate, not a value statement

Generated content is not allowed to claim a feature, limit, or price that doesn't exist — and that's checked in CI. Pricing surfaces are compared cell-for-cell against the README by a parity test; a README-honesty guard fails the build on a growing list of forbidden claims we either don't ship or caught ourselves almost making ("PostgreSQL support", "SAML SSO included"). Every AI tool degrades into *truthful* deterministic output instead of a hallucinated one when AI is unavailable.

### We audited our own guardrails before asking you to trust them

Days before this release, a seven-dimension launch-readiness audit went hunting in our own codebase — and found real holes: one AI route with no metering at all (a prompt inflatable across 200 repos per call), five routes where omitting `?stream` skipped the spend cap entirely, and AI routes that charged quota but never touched the global cap. **All of them were closed before this launch**, each with a regression test — an unmetered provider call is a named regression class in this codebase. CodeQL now runs on every PR, and the Docker image is booted and health-checked in CI before it's pushed.

### Provider-neutral AI, with the guardrails an LLM product actually needs

The AI layer is BYOK and provider-neutral: **Anthropic, OpenAI, Google Gemini, OpenRouter, and local runtimes (Ollama / LM Studio)** are interchangeable. Per-user keys are encrypted at rest with AES-256-GCM. Around that seam: a **global spend cap** plus **per-call output-token caps** (OWASP LLM10), **PII-safe audit metadata** on every generation, **SSE streaming** that preserves partial text on disconnect, BYOK hardening (key rotation, model-id validation, DNS re-checks), and a **golden-eval suite gated in CI**. Without any key, the app returns high-quality mock responses so the full UI is explorable with zero setup.

### SQLite on purpose — and PostgreSQL rejected on purpose

better-sqlite3 in WAL mode: one file, online WAL-safe backups, no second service to run. The broken Postgres path was deleted outright — a `postgres://` URL fails fast at boot with an actionable error. Schema changes flow through one versioned, idempotent migration ledger. v4.7.0 added a `DATA_DIR` root for all persisted state, which is also what lets the Windows installer keep your data outside the app directory.

### Accessibility gated on *both* themes

Dark and light are both hard-gated for color contrast in the Playwright/axe suite — **11 views × 2 themes**, blocking. Risk colors come from a token system where graphic fills and text variants are separate, because a fill that reads fine as a chart bar fails WCAG AA as text.

### Preview-first writes, metered generation, parameterized SQL

Anything that writes to a user's repository goes preview-first through a single `commitOrOpenPR()` primitive — never an auto-commit, and file paths are always derived server-side rather than trusted from the client. SQL is parameterized throughout. Session cookies are `httpOnly`, `sameSite`, and `secure` in production.

---

## Architecture at a glance

- **Frontend** — React 19.2 + Vite 8 + Tailwind CSS 4.1, code-split under explicit gzip budgets enforced by a CI gate (the entry chunk was cut 11% this month and the budget lowered to lock it). Framer Motion drives animation from a shared motion vocabulary.
- **Backend** — Express 5.2 with **325 route handlers across 74 route modules**, fronted by Helmet, tier-aware rate limiting, CSRF double-submit tokens, an SSRF + DNS-rebinding guard on import-from-URL, and rolling sessions with an absolute ceiling.
- **Data** — better-sqlite3 (WAL), every per-user table keyed by `user_id`, WAL-safe scheduled backups, maintenance janitors.
- **Integrations** — GitHub REST API, Azure DevOps API v7.1, Stripe billing, Resend email (with retry + dead-letter queue), BYOK AI providers, and a GitHub API circuit breaker.

Full detail in [`docs/architecture/overview.md`](architecture/overview.md) and the [API reference](api/API.md).

---

## The migration suite (and exactly what it covers)

| Source | What migrates | How |
|--------|---------------|-----|
| **Git repos** | Full history, branches, tags | Direct clone with complete preservation |
| **TFVC repos** | Up to 180 days of history | TFVC-to-Git conversion via the Azure Import API, ZIP-snapshot fallback |
| **Work items** | Types, states, comments, attachments | Azure Boards → GitHub Issues with field mapping |
| **Wikis** | All pages and content | Git-based clone with markdown conversion |

Around the transfer: an AI risk analysis step, dry-run mode, inline conflict resolution with type-to-confirm destructive replaces and one-click "Replace & retry", Git LFS retry, provenance tagging on every migrated repo, PATs encrypted at rest, and a real cancel that actually stops the in-flight clone.

To be precise about scope: **migration is Azure DevOps → GitHub only.** No GitLab, no Bitbucket. If you need those, this isn't your tool yet.

![Migration Wizard](images/08_migration_wizard_hd.png)

---

## Pricing: free-first, on purpose

Nearly everything — bulk operations, mirror sync, AI Deep Review, Prompt Studio, PR Chat, slash commands, the DORA Metrics tab, unlimited teams — ships on the **Free** tier with generous, non-infinite monthly caps. Pro ($19/mo) and Enterprise sell **AI headroom** and compliance/service deliverables, not feature unlocks. Self-hosting is free forever under Apache-2.0.

Two trust details shipped this week: **Settings → Usage now shows every one of the Free tier's per-feature quotas** with your month's consumption — you see the limit before you hit it, not at the 429. And **license keys now match what you paid for**: a monthly subscription gets a one-month key, automatically re-issued on every renewal invoice; only yearly plans get a 12-month key. (Honest caveat, documented: issued keys aren't remotely revocable.)

The full matrix lives in the [README](../README.md#plans--pricing), and a parity test keeps it honest against the code.

---

## Building it with AI as a co-developer

This platform was built with **Claude Code** — Anthropic's CLI coding agent — as a development partner throughout: architecture trade-offs, the migration engine, test generation, security hardening, code review, documentation. The repo carries an `AGENTS.md` of persistent conventions, so the assistant compounds context instead of relearning the house style every session.

The lesson isn't "AI replaces the developer." It's that the developer still owns the architecture, the problem domain, and the critical review of every diff — but with the mechanical work amortized, one person can ship and *maintain* 325 API routes, a full migration suite, five AI workflows, a native Windows distribution, and **6,337 passing tests across 677 test files**. That leverage is the actual headline.

---

## Honest capabilities and limits

- **Migration is Azure DevOps → GitHub only.**
- **SSO / SAML is roadmap**, not shipped — flagged as such on the pricing page and in the feature flags.
- **GitHub Enterprise Server support is roadmap.** Today the target is GitHub.com via OAuth.
- **The Windows binaries are unsigned** (SmartScreen will prompt; SHA-256 sidecars ship with every asset) and **winget submission is pending**.
- **The backend is a long-running process, not a serverless function.** The frontend is static-hostable; the Express + SQLite backend needs a host and a persistent volume — or a Windows machine and a double-click.

---

## Try it yourself

Three paths, in order of friction:

**Windows (2 minutes, no dependencies):** download the installer or portable ZIP from the [latest release](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/latest), run `Start GitHub Repo Manager`, and your browser opens.

**Docker:**
```bash
docker pull ghcr.io/brunobola-portfolio/github-repo-manager:latest
```
The image is multi-arch (amd64/arm64), ships with SBOM + provenance, and is booted and health-checked in CI before every push.

**From source (for development):**
```bash
git clone https://github.com/brunobola-portfolio/GitHub-Repo-Manager.git
cd GitHub-Repo-Manager
npm install
npm run dev:all
```

Dev demo mode runs the full UI with 87 realistic mock repositories and mock AI responses — no GitHub account, no API keys. For real use, add GitHub OAuth credentials and any AI provider key you like under **Settings → AI Configuration**; it's encrypted at rest the moment you paste it.

---

## Licensing

**Apache-2.0** — free to run, modify, embed and redistribute, forever, with no copyleft. The name and the mark are reserved (Apache-2.0 §6, spelled out in `TRADEMARKS.md`): fork freely, rename the fork. A **commercial subscription** buys capacity, a hosted instance and support — never permission, which the licence already granted — **[bruno@bolalabs.pt](mailto:bruno@bolalabs.pt)**.

---

*Bruno Silva Marques is the founder of Bola Labs, building modern developer tools at the intersection of AI and software engineering. If GitHub Repo Manager is useful to you, a star on the [repository](https://github.com/brunobola-portfolio/GitHub-Repo-Manager) genuinely helps.*
