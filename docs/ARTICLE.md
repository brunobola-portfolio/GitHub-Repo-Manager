# I Built an AI-Powered GitHub Management Platform -- Here's What I Learned

*By Bruno Silva Marques, Bola Labs*

---

## The Problem Nobody Talks About

If you manage more than a handful of repositories, you know the pain. Scattered dashboards. Manual quality checks. Tedious migrations between platforms. No unified view of what's actually going on across your projects.

Now multiply that by an organization with dozens of teams and hundreds of repos, and you're spending more time managing infrastructure than actually building software.

I decided to fix that -- and I used AI to do it, both as a feature of the product and as a co-developer in the process.

The result is **GitHub Repo Manager**: a comprehensive, AI-powered dashboard for managing your entire GitHub ecosystem with intelligence, automation, and a polished modern interface.

**GitHub Repository**: [github.com/brunobola-portfolio/GitHub-Repo-Manager](https://github.com/brunobola-portfolio/GitHub-Repo-Manager)

---

## What GitHub Repo Manager Actually Does

At its core, this is a full-stack web application that gives you a single pane of glass over your GitHub world -- repositories, organizations, teams, CI/CD pipelines, and community health metrics -- enhanced with AI intelligence at every layer.

But it goes far beyond a read-only dashboard. Here's what makes it stand out:

### AI-Powered Intelligence

This isn't AI bolted on as an afterthought. AI is woven throughout the platform:

- **Repo Advisor** -- Ask questions about your repositories in natural language. "Which of my repos need better documentation?" "What's the tech stack breakdown across my organization?" The assistant knows your project context.
- **Semantic Search** -- Go beyond keyword matching. Search your repositories by meaning, not just text.
- **README Generation and Enhancement** -- Point it at a project and get a professional README, or intelligently fill in missing sections of an existing one.
- **Quality Reports** -- Comprehensive analysis of code health, documentation completeness, community standards, and engineering practices, scored on a 0-100 scale with prioritized recommendations.
- **Smart Topic Suggestions** -- AI-generated tags for better discoverability.
- **Commit Message Generation** -- Context-aware commit messages based on your changes.
- **Migration Risk Analysis** -- Before you migrate, AI evaluates complexity, identifies potential issues, and recommends a strategy.

That's **10+ distinct AI-powered features**, all working together to make repository management genuinely intelligent.

> **Screenshot suggestion**: Upload `docs/images/09_ai_assistant_dark_hd.png` as a post image showing the Repo Advisor chat interface.

### Full Azure DevOps Migration Suite

This is the feature I'm most proud of. Migrating from Azure DevOps to GitHub is notoriously painful -- especially if you have TFVC repositories, work items, and wikis to bring over.

GitHub Repo Manager handles the entire migration through a guided, multi-step wizard:

- **Git Repositories** -- Complete history, branches, and tags preserved.
- **TFVC Repositories** -- Automatic TFVC-to-Git conversion via the Azure DevOps Import API (up to 180 days of history), with a ZIP snapshot fallback for edge cases.
- **Work Items** -- Azure Boards work items migrate to GitHub Issues with full field mapping, state conversion, and comment history.
- **Wiki Migration** -- Clone Azure DevOps project wikis into GitHub repositories.
- **AI-Assisted Planning** -- Gemini analyzes your migration and provides risk scores, time estimates, and strategy recommendations before you commit.
- **Scheduled Migrations** -- Queue plans for off-peak execution with AES-256-GCM encrypted credential storage.
- **Pause/Resume and Task Retry** -- Interrupt long-running migrations without data loss. Retry individual failed tasks without re-running the entire plan.
- **Full Audit Trail** -- Per-task status, duration, and detailed error reporting with actionable suggestions.

> **Screenshot suggestion**: Upload `docs/images/08_migration_wizard_hd.png` showing the Migration Wizard source selection screen.

### Comprehensive Repository Management

The day-to-day management features are equally polished:

- **Dashboard** with real-time statistics, activity trends, language distribution, and organization insights.
- **Advanced Search and Filtering** -- Find repositories by name, language, visibility, type, or use AI semantic search.
- **Bulk Actions** -- Archive, delete, transfer, or update multiple repositories simultaneously.
- **Team Collaboration Hub** -- Centralized view of all teams, member management, and role-based access tracking.
- **GitHub Actions Statistics** -- Workflow metrics, success rates, duration analysis, daily trends, and CSV export.
- **Community Health Scoring** -- 0-100 health ratings with smart recommendations for improving documentation, community files, and contributor activity.
- **Repository Starring and Pinning** -- Quick access to your most important projects.

> **Screenshot suggestions**: Upload these as a carousel or multi-image post:
> - `docs/images/01_dashboard_dark_hd.png` -- Dashboard overview
> - `docs/images/06_repositories_dark_hd.png` -- Repository management
> - `docs/images/07_teams_dark_hd.png` -- Team Hub

---

## The Tech Stack: Latest Everything

I deliberately chose the newest stable versions of every technology to push the boundaries and demonstrate proficiency with modern tooling:

| Layer | Technology | Version |
|-------|-----------|---------|
| **Frontend** | React | 19 |
| **Build** | Vite | 7 |
| **Styling** | Tailwind CSS | 4 |
| **Backend** | Express | 5 |
| **Database** | better-sqlite3 | Local, zero-config |
| **AI** | Google Gemini API | Latest |
| **Animations** | Framer Motion | 12 |
| **Charts** | Recharts | 3 |
| **Validation** | Zod | 4 |
| **Logging** | Pino | Structured JSON |
| **Security** | Helmet.js, express-rate-limit | Production-hardened |

**By the numbers:**

- **143+ API endpoints** across 13 route modules
- **109+ passing tests** (Vitest unit + Playwright E2E)
- **87 mock repositories** in demo mode for instant exploration
- **AES-256-GCM** encrypted credential storage for migration scheduling
- **0-100 health scoring** with multi-dimensional analysis
- Production security: rate limiting, parameterized SQL queries, input validation, ETag caching, Helmet.js headers, httpOnly session cookies

The UI features a **Glassmorphism design system** with depth-rich layers, subtle blurs, and smooth animations -- plus full dark/light mode support, responsive design down to mobile, accessibility features (focus traps, keyboard navigation, ARIA attributes), and touch-optimized targets.

---

## How AI Built This App

Here's the part that excites me the most from a professional development perspective.

**GitHub Repo Manager was built with AI as a development partner.** Specifically, I used **Claude Code** -- Anthropic's CLI-based AI coding assistant powered by Claude -- throughout the entire development lifecycle.

This wasn't "AI generated some boilerplate." Claude Code was involved in:

- **Architecture decisions** -- Discussing trade-offs between different approaches, database schema design, API structure.
- **Feature implementation** -- Writing and iterating on complex features like the migration engine, AI service integration, and the guided wizard flow.
- **Testing** -- Generating comprehensive unit and end-to-end tests, identifying edge cases I hadn't considered.
- **Security hardening** -- Auditing for SQL injection, implementing rate limiting, adding input validation, configuring security headers.
- **Code review** -- Reviewing changes before committing, catching bugs and suggesting improvements.
- **Documentation** -- Generating API docs, architecture diagrams, and user-facing documentation.
- **Debugging** -- Diagnosing complex issues like TFVC credential encoding bugs and Azure DevOps API edge cases.

The project has a `CLAUDE.md` file that serves as persistent instructions for the AI -- coding standards, architecture decisions, file organization rules. This creates a feedback loop where the AI gets better at working within the project's conventions over time.

**What I learned:** AI-assisted development isn't about replacing the developer. It's about amplifying your capabilities. The developer still needs to make architectural decisions, understand the problem domain, review AI output critically, and maintain a clear vision for the product. But with AI handling the mechanical aspects of coding, you can ship faster, at higher quality, and tackle more ambitious projects than you could alone.

This project is proof of that. A single developer, with AI assistance, built a production-quality platform with 143+ endpoints, 10+ AI features, a complete migration suite, and 109+ passing tests.

---

## Try It Yourself

GitHub Repo Manager is **open source** under the MIT license. You can explore it right now without any API keys:

### Quick Start (Demo Mode)

```bash
git clone https://github.com/brunobola-portfolio/GitHub-Repo-Manager.git
cd GitHub-Repo-Manager
npm install
npm run dev:all
```

Open `http://localhost:5173` -- demo mode is enabled by default with 87 realistic mock repositories, simulated organizations, teams, and mock AI responses. No GitHub account or API keys required to explore the full UI.

### Full Mode

Add your GitHub OAuth credentials and a Google Gemini API key (free tier available) to unlock real repository management and AI features.

---

## What's New in v3.5.0 — Work Board Mega-Upgrade

Shipped April 2026: the cross-repo Work Board graduated from a webhook-only digest to a zero-config, keyboard-driven cockpit.

- **Zero-config data** — PRs, issues, stale PRs, and tech-debt queries now fall back to live GitHub Search when webhook data is missing. No setup required to see value on day one. Results cached 5 minutes with ETag revalidation.
- **Auto-refresh + filters + server-side presets** — 60-second polling pauses when the tab is hidden; filters (repo / author / label / age) are URL-synced and saveable as named presets that persist across devices.
- **Inline actions** — approve, request-changes, snooze, or re-request review on any PR directly from the board with optimistic UI and proper `scope_required` fallback.
- **AI summary card (BYOK, cross-provider)** — Anthropic, OpenAI, Gemini, OpenRouter, and Local (Ollama/LMStudio) all produce a headline + severity-ranked bullets + urgency gauge from the same JSON-schema-constrained prompt.
- **Command palette group** — `⌘K` on `/work-board` surfaces six navigate-to-tab actions plus regenerate-AI and save-preset.

Full changelog: [CHANGELOG.md](../CHANGELOG.md) · [Release notes](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/tag/v3.5.0).

## What's Next

The roadmap includes advanced analytics with commit activity heatmaps, custom themes, repository templates, GitHub Enterprise support, and an ambitious v3.0 with automated code review agents, semantic search across all repositories, and multi-platform migration support for GitLab and Bitbucket.

---

## Get Involved

If this project resonates with you:

- **Star the repo** -- It helps with visibility and motivates continued development.
- **Try the demo** -- Explore mock mode and see what's possible.
- **Contribute** -- Bug fixes, features, documentation improvements -- all welcome.
- **Share feedback** -- Open an issue or start a discussion.

**Repository**: [github.com/brunobola-portfolio/GitHub-Repo-Manager](https://github.com/brunobola-portfolio/GitHub-Repo-Manager)

Built with genuine passion for developer tools, modern web technology, and the belief that AI is transforming how we build software -- not by replacing developers, but by making us significantly more effective.

---

*Bruno Silva Marques is the founder of Bola Labs, focused on building modern developer tools and exploring the intersection of AI and software engineering.*

---

**LinkedIn Hashtags** (copy separately):

#OpenSource #GitHub #AI #ArtificialIntelligence #GoogleGemini #ReactJS #WebDevelopment #FullStack #DevOps #AzureDevOps #Migration #DeveloperTools #SoftwareEngineering #AIAssistedDevelopment #ClaudeAI #Anthropic #Portfolio #JavaScript #NodeJS #TailwindCSS #Vite

---

## Posting Guide

### LinkedIn

1. Copy the article text above (from "The Problem Nobody Talks About" to the bio line)
2. Create a new LinkedIn article or long-form post
3. Upload `docs/images/01_dashboard_dark_hd.png` as the **cover/hero image**
4. Add additional images inline or as a carousel:
   - `docs/images/09_ai_assistant_dark_hd.png` (Repo Advisor)
   - `docs/images/08_migration_wizard_hd.png` (Migration Wizard)
   - `docs/images/06_repositories_dark_hd.png` (Repository Management)
5. Paste hashtags at the end of the post

### Facebook

Use the shorter version below. Upload 3-4 screenshots as a photo album.

---

## Facebook Version (Shorter)

After months of development, I'm excited to share my latest project: **GitHub Repo Manager** -- a full-stack platform for managing your entire GitHub ecosystem, powered by your configured AI provider.

**What it does:**
- Manages repositories, teams, organizations, and CI/CD pipelines from a single dashboard
- 10+ AI features: semantic search, README generation, quality reports, smart recommendations
- Full Azure DevOps to GitHub migration -- including TFVC repos, work items, and wikis
- 0-100 health scoring for every repository with actionable improvement suggestions

**The interesting part:** The app was built using AI-assisted development with Claude Code (Anthropic's Claude AI). A single developer + AI produced 143+ API endpoints, 109+ passing tests, and a complete migration suite.

**Tech stack:** React 19, Vite 7, Express 5, Tailwind CSS 4, Google Gemini AI, SQLite -- the latest versions of everything.

**Try it now** (no API keys needed for demo mode):

```
git clone https://github.com/brunobola-portfolio/GitHub-Repo-Manager.git
cd GitHub-Repo-Manager
npm install
npm run dev:all
```

It's open source (MIT license). Stars, contributions, and feedback are all welcome!

Link: [github.com/brunobola-portfolio/GitHub-Repo-Manager](https://github.com/brunobola-portfolio/GitHub-Repo-Manager)

#OpenSource #GitHub #AI #WebDevelopment #DevTools #ReactJS #FullStack
