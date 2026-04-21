<div align="center">

# GitHub Repo Manager

**The GitHub dashboard that thinks — manage, migrate, and optimize with AI**

<!-- Stack -->
![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-8.0-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4.1-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.2-000000?style=for-the-badge&logo=express&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?style=for-the-badge&logo=sqlite&logoColor=white)

<!-- BYOK AI Providers -->
![BYOK](https://img.shields.io/badge/BYOK-AI-8E75B2?style=for-the-badge)
![Gemini](https://img.shields.io/badge/Gemini-4285F4?style=for-the-badge&logo=googlegemini&logoColor=white)
![Anthropic](https://img.shields.io/badge/Anthropic-191919?style=for-the-badge&logo=anthropic&logoColor=white)
![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=for-the-badge&logo=openai&logoColor=white)
![OpenRouter](https://img.shields.io/badge/OpenRouter-6466F1?style=for-the-badge)
![LM Studio](https://img.shields.io/badge/LM_Studio-4B2DDC?style=for-the-badge)

<!-- Quality -->
![Tests](https://img.shields.io/badge/Tests-1764_passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/License-AGPL_v3-blue?style=for-the-badge&logo=gnu&logoColor=white)
![Release](https://img.shields.io/github/v/release/brunobola-portfolio/GitHub-Repo-Manager?style=for-the-badge&logo=github&logoColor=white)

**A full-stack AI-powered dashboard for managing repositories, teams, CI/CD, and migrating from Azure DevOps — all in one beautiful interface.**

[Try Demo Mode](#quick-start-demo-mode) | [Features](#features-overview) | [Installation](#installation) | [Documentation](docs/) | [What's new in v3.5.0](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/releases/tag/v3.5.0)

</div>

---

<div align="center">

### Dashboard

![Dashboard Dark Mode](docs/images/01_dashboard_dark_hd.png)

### Migration Wizard

![Migration Wizard](docs/images/08_migration_wizard_hd.png)

</div>

---

## Why GitHub Repo Manager?

Managing a growing GitHub ecosystem is hard. Between dozens of repositories, multiple organizations, team permissions, CI/CD pipelines, and now migrating from Azure DevOps — developers waste hours on repetitive management tasks.

**GitHub Repo Manager** solves this by providing:

- **One dashboard** to see everything: repos, teams, actions, health metrics
- **AI intelligence** to analyze, search, and improve your repositories automatically
- **Migration tools** to move from Azure DevOps (including TFVC) to GitHub in minutes
- **Bulk operations** to manage hundreds of repos with a few clicks
- **Zero setup needed** — try it instantly in Demo Mode with 87 pre-loaded mock repositories

> Built with the latest stack: React 19, Vite 8, Express 5, Tailwind CSS 4, and BYOK AI — bring your own Gemini, Anthropic, OpenAI, OpenRouter, or LMStudio key.

---

## Table of Contents

- [Features Overview](#features-overview)
- [AI-Powered Intelligence](#ai-powered-intelligence)
- [Azure DevOps Migration Suite](#azure-devops-migration-suite)
- [Quick Start (Demo Mode)](#quick-start-demo-mode)
- [Installation](#installation)
- [Configuration](#configuration)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [AI Workflow Examples](#ai-workflow-examples)
- [Screenshots Gallery](#screenshots-gallery)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [Support This Project](#support-this-project)
- [License](#license)

---

## Features Overview

### Comprehensive Dashboard
Get a bird's-eye view of your entire GitHub ecosystem at a glance.

- **Real-time Statistics** — Total repos, public/private distribution, stars, forks, organizations
- **Activity Trends** — Interactive charts showing development activity over 7/30/90 days
- **Language Distribution** — Technology breakdown across all your projects
- **Organization Overview** — Quick insights with star, fork, and issue counts per org
- **Migration Activity** — Track migration progress and history

### Advanced Repository Management

![Repository Management](docs/images/06_repositories_dark_hd.png)

Organize, filter, and manage your repositories with powerful tools built for scale.

- **Smart Search & Filters** — Find repos by name, language, visibility, type, or archived status
- **AI Semantic Search** — Natural language search powered by vector embeddings
- **Bulk Actions** — Archive, delete, transfer, or change visibility for multiple repos at once
- **Repository Creation** — Quick creation with AI-generated descriptions
- **Detailed Repo View** — Branches, PRs, issues, releases, actions, and community health
- **Repository Insights** — AI-powered quality reports with actionable recommendations

### Team Collaboration Hub

![Team Hub](docs/images/07_teams_dark_hd.png)

- **Team Overview** — Centralized view of all teams and their repositories
- **Member Management** — Add/remove members with role assignment (Owner, Admin, Member)
- **Team Activity Stream** — Aggregated events from all team repositories
- **Team Actions Statistics** — CI/CD metrics across all team repos
- **Quick Repo Access** — Jump to any team-managed repository instantly

### GitHub Actions Analytics

- **Workflow Metrics** — Success rates, failure tracking, duration analysis
- **Daily Trends** — Interactive charts (30-90 day windows)
- **Workflow Triggering** — Trigger workflows directly from the dashboard
- **CSV Export** — Download statistics for reporting
- **Team-Level Analytics** — Aggregate metrics across multiple team repos

### Community Health Metrics

- **Health Score (0-100)** — Based on documentation, community standards, and activity
- **File Checklist** — Verify README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
- **Smart Recommendations** — Priority-ranked suggestions (high/medium/low)
- **Multi-Repo Comparison** — Compare health scores across repositories
- **Performance Cache** — Fast repeated access with intelligent caching

### Cross-Repo Work Board

A single cockpit across all your repositories — no context switching.

![Work Board — KPI row, filter bar, inline actions](docs/images/33_work_board_dark_hd.png)

Filters are URL-synced and round-trip through the browser history — share a filtered view by copy-pasting the URL.

![Filters applied — 1 matching PR](docs/images/37_work_board_filters_active_hd.png)

- **Zero-config data** — live-fetches PRs and issues from GitHub when no webhook is configured; ETag-revalidated with a 5-minute cache.
- **Auto-refresh** — polls every 60 s, pauses when the tab is hidden, shows "updated N ago".
- **Filters + URL sync** — multi-select by repo / author / label, single-select age bucket (24 h / 7 d / 30 d), hide snoozed toggle. Selection reflected in the URL and saveable as a server-side preset.
- **Inline actions** — approve / request-changes / snooze a PR directly on the row (falls back to a re-auth prompt if the OAuth scope is missing).
- **AI summary** (BYOK) — Anthropic, OpenAI, Gemini, OpenRouter or Local Ollama / LMStudio generate a headline + urgency gauge + actionable bullets; silently hidden when no provider is configured.
- **Command Palette group** — `⌘K` surfaces a Work Board section with one-shortcut navigation to every tab plus AI regenerate.

  ![Command Palette — Work Board group](docs/images/35_work_board_command_palette_hd.png)

Tabs on offer:

- **My Reviews** — every PR where you are a requested reviewer, sorted by age
- **My Issues** — every open issue assigned to you across all tracked repos
- **Stale PRs** (Pro+) — PRs open beyond a configurable threshold, ranked by staleness
- **Review Load** (Pro+) — per-reviewer submitted vs pending counts, visualised as stacked bars to spot overloaded reviewers at a glance
- **Tech Debt** (Pro+) — open issues labelled with `tech-debt`, `technical-debt`, `debt`, `refactor`, `refactoring`, `cleanup` or `code-smell`, grouped by repo with hotspot ranking
- **DORA Metrics** (Enterprise) — deploy frequency, lead-time p50/p90, change failure rate, MTTR p50/p90, and CSV export for the whole 4-metric set

### Command Palette (Ctrl+K)

Keyboard-first navigation across the entire app — search repos, jump to any page, trigger bulk actions.

### BYOK — Multi-Provider AI

Configure any of these providers in Settings → AI Configuration:

| Provider | Free tier | Models |
|----------|-----------|--------|
| Google Gemini | Yes | gemini-2.5-flash, gemini-2.5-pro |
| Anthropic | No | claude-opus-4, claude-sonnet-4-5 |
| OpenAI | No | gpt-4o, o4-mini |
| OpenRouter | Yes (50 req/day) | 30+ models |
| LMStudio | Local (free) | Any local model |

### Additional Features

- **Dark/Light Mode** — System preference detection with manual toggle
- **Keyboard Shortcuts** — Command palette (Ctrl+K), navigation, and action shortcuts
- **Responsive Design** — Desktop, tablet, and mobile with touch-optimized targets (44px min)
- **Accessibility** — Focus traps, ARIA roles, screen reader support, skip navigation
- **Smart Notifications** — Non-intrusive toast feedback on all actions
- **Local Caching** — Fast performance with intelligent data caching
- **Offline Support** — Continue browsing cached data when disconnected
- **GitHub Webhook Ingestion** — real-time PR, issue, and deployment events (see `docs/event-ingestion.md`)

---

## AI-Powered Intelligence

![AI Assistant](docs/images/09_ai_assistant_dark_hd.png)

GitHub Repo Manager integrates AI via **BYOK** (Bring Your Own Key) — configure Gemini, Anthropic, OpenAI, OpenRouter, or LMStudio in Settings → AI Configuration. 10+ AI features ship on every tier:

### Conversational AI Assistant
- **Natural Language Interface** — Ask questions about your repositories in plain English
- **Context-Aware Responses** — Answers tailored to your specific projects and data
- **Quick Actions** — Execute common tasks through conversation

### Conversational Task Automation (new in v3.3.0)
The assistant doesn't just answer — it **dispatches real app actions** from natural-language intent. Ask "start a migration from Azure" and it opens the Migration Wizard for you; say "create a new repo" and the creation modal appears pre-focused.

<div align="center">

![Action Dispatch Flow](docs/images/action-dispatch.svg)

</div>

| Intent example | Action dispatched |
|----------------|-------------------|
| "migrate from Azure DevOps" | Opens the 8-step Migration Wizard |
| "show me past migrations" | Opens the Migration History panel |
| "create a new repository" | Opens the Create Repo modal |
| "transfer this repo to another org" | Opens the Transfer modal |
| "open settings" | Opens the Settings panel |

Available on **every tier including Free** — the full AI product surface (Assistant, Semantic Search, Migration Risk Analysis, PR Review read-only) ships on the Free plan with per-feature monthly caps. Implementation lives in [`src/utils/aiActions.js`](src/utils/aiActions.js) with strict allow-list validation: any action `type` not in the five above is silently dropped, so the model cannot invoke arbitrary app state changes.

### Repository Analysis & Quality Reports
- **Quality Scoring (0-100)** — Comprehensive analysis across 4 categories:
  - Documentation (30 pts), Community (20 pts), Engineering (20 pts), Polish (10 pts)
- **Pattern Detection** — Automatically identifies missing README sections, CI/CD, tests, license
- **Actionable Recommendations** — Priority-ranked suggestions for improvement

### AI-Enhanced Features

| Feature | Description |
|---------|-------------|
| **README Generation** | Create professional READMEs based on project structure |
| **README Enhancement** | Intelligently add missing sections to existing docs |
| **Smart Topics** | AI-generated tags for better discoverability |
| **Project Classification** | Auto-detect project type (library, app, tool, etc.) |
| **Semantic Search** | Find repos using natural language via vector embeddings |
| **Commit Generator** | AI-powered conventional commit messages from diffs |
| **AI Review Step** | AI-powered risk assessment embedded in the migration wizard |
| **Batch Indexing** | Index up to 10 repos at once for semantic search |
| **BYOK / Multi-provider** | Gemini, Anthropic, OpenAI, OpenRouter, LMStudio — configurable per user in Settings |

> Without any key configured, AI features return high-quality mock responses automatically.

---

## Plans & Pricing

The hosted product ships three tiers. The **Free tier includes the full AI product surface** — Assistant, Semantic Search, Migration Risk Analysis, and PR Review — so you can evaluate the AI without a credit card. Each AI capability has its own monthly cap on Free so one feature can't drain your whole budget.

| Feature                                | Free            | Pro ($19/mo)  | Enterprise |
|----------------------------------------|-----------------|---------------|------------|
| Repositories managed                   | 50              | Unlimited     | Unlimited  |
| AI Assistant (conversational)          | ✓               | ✓             | ✓          |
| AI queries / month (total)             | 200             | 5,000         | Unlimited  |
| Semantic Search                        | 50 / month      | Unlimited     | Unlimited  |
| Migration Risk Analysis (AI)           | 5 / month       | Unlimited     | Unlimited  |
| Repo Insights / Quality Report         | 10 / month      | Unlimited     | Unlimited  |
| README Generator (AI)                  | 5 / month       | Unlimited     | Unlimited  |
| Commit Generator (AI)                  | 50 / month      | Unlimited     | Unlimited  |
| PR Review Experience                   | Read-only       | Full + write-back | Full + write-back |
| Basic bulk on own repos                | ✓               | ✓             | ✓          |
| Advanced bulk (transfer, mirror, cross-org) | ✗          | ✓             | ✓          |
| Azure DevOps Cloud migration           | ✗               | ✓             | ✓          |
| Mirror Sync                            | ✗               | ✓             | ✓          |
| Dry-Run migration                      | ✓               | ✓             | ✓          |
| Teams                                  | ✗               | 15 members    | Unlimited  |
| Audit Logs / SSO                       | ✗               | ✗             | ✓          |
| API keys                               | 2               | 10            | 50         |

Self-hosting under AGPL v3 is free forever — see [LICENSE](LICENSE). The matrix above describes the hosted SaaS.

See the [Free Tier Expansion spec](docs/specs/2026-04-15-free-tier-expansion.md) for the design rationale and enforcement details.

---

## Azure DevOps Migration Suite

![Migration Wizard](docs/images/08_migration_wizard_hd.png)

A complete migration platform for moving from Azure DevOps to GitHub with a guided **8-step wizard**.

### What You Can Migrate

| Source | What | How |
|--------|------|-----|
| **Git Repos** | Complete history, branches, tags | Direct clone with full preservation |
| **TFVC Repos** | Up to 180 days of history | Automatic TFVC-to-Git conversion via Azure Import API |
| **Work Items** | Types, states, comments, attachments | Azure Boards to GitHub Issues with field mapping |
| **Wikis** | All pages and content | Git-based clone with markdown conversion |

### Migration Features

- **Guided Wizard** — 8-step flow: Source Type, Configuration, Repo Selection, Target Config, Wiki, Work Items, AI Review, Execute
- **AI-Assisted Planning** — Gemini-powered risk analysis with severity levels and mitigation suggestions
- **Auto-Fix Drawer** — One-click resolution for blocker-level issues (size > 10 GB, name conflicts, reserved/invalid names). Choices persist across the wizard: a repo flagged for LFS migration is pre-selected the next time you open the drawer, the blocker badge clears, and the LFS toggle is auto-enabled in the Configure step.
- **Smart URL Parser** — Supports 6+ Azure DevOps URL formats (dev.azure.com, visualstudio.com, SSH, shorthand)
- **Dry-Run Mode** — Test migrations without making changes
- **Scheduling** — Queue migrations for off-peak execution
- **Pause/Resume** — Interrupt and continue without data loss
- **Task Retry** — Retry individual failed tasks without re-running everything
- **Conflict Detection** — Pre-check for existing repos in target
- **Encrypted Credentials** — PATs encrypted at rest with AES-256-GCM
- **Progress Tracking** — Real-time updates with per-task status and duration
- **Full Audit Trail** — Complete migration history with error details

### TFVC Support (Industry-Leading)

GitHub Repo Manager is one of the few tools that handles **TFVC-to-Git conversion** automatically:
- Detects TFVC vs Git repositories in Azure DevOps projects
- Converts via Azure DevOps Import API (preserves up to 180 days of history)
- Falls back to ZIP snapshot if conversion fails
- Handles repositories up to 1GB per folder
- Supports projects with mixed Git + TFVC repos

---

## Quick Start (Demo Mode)

Try the full application instantly — **no API keys or GitHub account needed**.

```bash
# Clone the repository
git clone https://github.com/brunobola-portfolio/GitHub-Repo-Manager.git
cd GitHub-Repo-Manager

# Install dependencies
npm install

# Start in demo mode (default)
npm run dev:all
```

Open [http://localhost:5173](http://localhost:5173) and explore with **87 pre-loaded mock repositories**, simulated organizations, teams, and AI responses.

---

## Installation

### Prerequisites

- **Node.js** 18+ (20+ recommended)
- **npm** or **yarn**
- **GitHub account** (for real mode with OAuth)
- **AI provider key** (optional — add your own Gemini, Anthropic, OpenAI, OpenRouter, or LMStudio key in Settings → AI Configuration after first login; see `docs/ai-providers.md`)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/brunobola-portfolio/GitHub-Repo-Manager.git
   cd GitHub-Repo-Manager
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` with your credentials (see [Configuration](#configuration) below).

4. **Start the application**
   ```bash
   # Both frontend and backend together (recommended)
   npm run dev:all

   # Or separately:
   npm run dev:server  # Backend on :3001
   npm run dev         # Frontend on :5173
   ```

5. **Open** [http://localhost:5173](http://localhost:5173)

### Docker Quick Start

Run the full stack with a single command using Docker Compose.

```bash
# Clone the repository
git clone https://github.com/brunobola-portfolio/GitHub-Repo-Manager.git
cd GitHub-Repo-Manager

# Configure environment
cp .env.example .env
# Edit .env with your values (see Configuration section)

# Run with Docker Compose
docker compose up -d

# App is now running at http://localhost:3001
```

---

## Configuration

### Mock Mode vs. Real Mode

| Feature | Mock Mode (Default) | Real Mode |
|---------|-------------------|-----------|
| **Setup** | Zero config | GitHub OAuth + .env |
| **Repositories** | 87 mock repos | Your real repos |
| **AI Features** | Mock responses | Gemini-powered |
| **Migration** | UI only | Fully functional |
| **Best for** | Demos, UI testing | Production use |

### Environment Variables

The essentials to get started:

```env
# GitHub OAuth (required for real mode)
GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret

# Server security (required in production)
SESSION_SECRET=<random 48+ byte string>
WEBHOOK_SECRET=<random 48+ byte string>

# Frontend / dev
FRONTEND_URL=http://localhost:5173
VITE_MOCK_MODE=true
```

See `.env.example` for the complete list of variables, including AI configuration (`GEMINI_API_KEY`, `AI_REQUIRE_USER_CONFIG`), email delivery (`EMAIL_PROVIDER`, `RESEND_API_KEY`), Stripe billing (`STRIPE_SECRET_KEY`), license issuance (`LICENSE_SIGNING_PRIVATE_KEY_PEM`), data retention (`DATA_RETENTION_DAYS`), and observability (`LOG_LEVEL`, `SENTRY_DSN`).

### Setting Up GitHub OAuth

1. Go to **GitHub Settings** > **Developer settings** > **OAuth Apps**
2. Click **New OAuth App**
3. Configure:
   - **Application name**: GitHub Repo Manager
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:3001/api/auth/callback`
4. Copy the **Client ID** and **Client Secret** to your `.env` file

### Setting Up AI Features (BYOK)

AI features use **Bring Your Own Key** — each user configures their own provider key in the app:

1. Log in via GitHub OAuth
2. Open **Settings → AI Configuration**
3. Choose your provider: Gemini, Anthropic, OpenAI, OpenRouter, or LMStudio
4. Paste your API key — it is encrypted at rest with AES-256-GCM

See [`docs/ai-providers.md`](docs/ai-providers.md) for per-provider setup instructions and free-tier limits.

> **Single-tenant self-hosts**: you may set `GEMINI_API_KEY` in `.env` as a shared server-wide fallback so users don't need to configure their own key. Set `AI_REQUIRE_USER_CONFIG=true` to disable this fallback in multi-tenant deployments.
>
> Without any key configured, AI features return high-quality mock responses automatically.

---

## Architecture

<div align="center">

![Architecture](docs/images/architecture.svg)

</div>

For detailed architecture documentation, see [`docs/architecture/overview.md`](docs/architecture/overview.md).

---

## Tech Stack

| Category | Technologies |
|----------|-------------|
| **Frontend** | React 19.2, Vite 8.0, TailwindCSS 4.1 |
| **UI/UX** | Framer Motion 12, Lucide Icons (554), Recharts 3, Radix UI |
| **Backend** | Node.js 20+, Express 5.2 |
| **Database** | Better-SQLite3 12.9 (WAL mode, 32MB cache) |
| **Security** | Helmet.js, express-rate-limit, Zod validation, SSRF protection |
| **AI** | Google Gemini API (gemini-embedding-001, gemini-2.5-flash) |
| **APIs** | GitHub REST API (v2022-11-28), Azure DevOps API (v7.1) |
| **Logging** | Pino (structured JSON logging with credential redaction) |
| **Testing** | Vitest, Testing Library, Playwright |
| **Auth** | GitHub OAuth 2.0 (CSRF state validation), Azure DevOps OAuth |

### GitHub Permissions

| Scope | Purpose |
|-------|---------|
| `repo` | List, create, update, and delete repositories (public and private) |
| `read:org` | Display organizations and team memberships |
| `user` | Fetch profile information |
| `delete_repo` | Required for bulk delete action |
| `admin:org` | Create teams, manage organization settings (optional) |

> **Security**: Tokens are stored in encrypted server-side sessions (`httpOnly`, `sameSite: lax`). The backend uses Helmet.js headers, rate limiting (200 req/15min API, 20 req/15min auth), parameterized SQL, and Zod input validation. Azure PATs are encrypted at rest with AES-256-GCM.

---

## AI Workflow Examples

Real examples of what the AI can do for your repositories:

| Task | How | What You Get |
|------|-----|--------------|
| **Find repos without CI** | Type "repos without CI/CD" in search | Filtered list with setup recommendations |
| **Generate documentation** | Click "Generate README" on any repo | Professional README based on project structure |
| **Assess migration risk** | AI Review step inside the migration wizard | Risk report with severity levels and mitigation plan |
| **Check repo quality** | Click "Analyze" on any repository | Score 0-100 across docs, community, engineering, polish |
| **Find similar projects** | Search "repos like my-api-service" | Embedding-based similarity results across all your repos |
| **Write commit messages** | Open commit generator with a diff | Conventional commit message matching your changes |
| **Improve discoverability** | Click "Suggest Topics" on a repo | AI-generated tags based on project content |
| **Enhance existing docs** | Click "Enhance README" | Missing sections added intelligently to your existing README |

### How It Works

<div align="center">

![AI Flow](docs/images/ai-flow.svg)

</div>

- **With a provider key** (configured in Settings → AI Configuration): Full AI-powered analysis, semantic search with vector embeddings, natural language chat
- **Without any key**: Algorithmic fallbacks for quality scoring, pattern detection, and smart suggestions — the app works perfectly either way

See [`docs/ai-providers.md`](docs/ai-providers.md) for per-provider setup and free-tier limits.

---

## Screenshots Gallery

<details>
<summary><strong>Click to expand all screenshots</strong></summary>

### Dashboard (Dark Mode)
![Dashboard Dark](docs/images/01_dashboard_dark_hd.png)

### Dashboard (Light Mode)
![Dashboard Light](docs/images/01_dashboard_light_hd.png)

### Repository Management
![Repositories](docs/images/06_repositories_dark_hd.png)

### Team Hub
![Teams](docs/images/07_teams_dark_hd.png)

### Migration Wizard
![Migration](docs/images/08_migration_wizard_hd.png)

### AI Assistant
![AI Assistant](docs/images/09_ai_assistant_dark_hd.png)

### Work Board (Dark Mode)

![Work Board Dark](docs/images/33_work_board_dark_hd.png)

### Work Board (Light Mode)

![Work Board Light](docs/images/36_work_board_light_hd.png)

### Work Board — Filters Applied

![Filters Active](docs/images/37_work_board_filters_active_hd.png)

### Work Board — Command Palette

![Command Palette](docs/images/35_work_board_command_palette_hd.png)

</details>

---

## Troubleshooting

<details>
<summary><strong>Backend Server Not Running (ECONNREFUSED)</strong></summary>

```text
[vite] http proxy error: /api/auth/login
AggregateError [ECONNREFUSED]
```

**Solution**: Run both servers together with `npm run dev:all`, or start the backend separately:
```bash
npm run dev:server
```
Verify at `http://localhost:3001/api/health`.

</details>

<details>
<summary><strong>Port Already in Use</strong></summary>

If you see `Port is already in use` (backend 3001) or `Port 5176 is in use, trying another one...` (Vite cascading through 5173–5180), a previous dev server is still alive. One-shot cleanup:

```bash
npm run dev:kill
```

Works on Windows/macOS/Linux — kills anything listening on 3001, 5173–5180 using `netstat`+`taskkill` or `lsof`+`kill` depending on the OS. Then re-run `npm run dev:all`.

Manual fallback if the script isn't available:

```bash
# Windows
netstat -ano | findstr :5173
taskkill /PID <pid> /F

# macOS/Linux
lsof -ti:5173 | xargs kill -9
```

</details>

<details>
<summary><strong>GitHub OAuth Callback Error</strong></summary>

Ensure your OAuth app's callback URL matches exactly:
- Development: `http://localhost:3001/api/auth/callback`
- Production: `https://yourdomain.com/api/auth/callback`

</details>

<details>
<summary><strong>AI Features Not Working (503)</strong></summary>

1. Verify `GEMINI_API_KEY` is set in `.env`
2. Check validity at [Google AI Studio](https://aistudio.google.com/apikey)
3. Without a key, mock responses are returned automatically

</details>

<details>
<summary><strong>Native Module Version Mismatch</strong></summary>

```bash
# Quick fix
npm run fix:native

# Or manual rebuild
npm rebuild better-sqlite3

# Full reinstall (last resort)
rm -rf node_modules package-lock.json && npm install
```

</details>

<details>
<summary><strong>Session Lost on Refresh</strong></summary>

Check that `SESSION_SECRET` is set in `.env` and the backend is running.

</details>

---

## FAQ

<details>
<summary><strong>General Questions</strong></summary>

**Q: Do I need a GitHub account?**
A: No! Demo mode works without any accounts. Real mode requires GitHub OAuth.

**Q: Is my data secure?**
A: Yes. Encrypted session cookies, server-side token storage, parameterized SQL, and all data stays on your machine.

**Q: Can I use this with GitHub Enterprise?**
A: Not yet — it's planned for a later release. See [ROADMAP.md](ROADMAP.md) for details.

**Q: Does this work offline?**
A: The UI works offline with cached data. Live features require internet.

</details>

<details>
<summary><strong>AI Features</strong></summary>

**Q: Do I need to pay for AI?**
A: Several providers have free tiers — Google Gemini offers 250 req/day, OpenRouter 50 req/day. See [`docs/ai-providers.md`](docs/ai-providers.md).

**Q: What data is sent to AI?**
A: Only repository metadata (name, description, topics, README). Never code content.

**Q: Can I use a different AI provider?**
A: Yes. Go to **Settings → AI Configuration** and choose from Gemini, Anthropic, OpenAI, OpenRouter, or LMStudio. Each user can configure their own key. See [`docs/ai-providers.md`](docs/ai-providers.md) for setup details.

</details>

<details>
<summary><strong>Migration</strong></summary>

**Q: Can I migrate TFVC repositories?**
A: Yes! Automatic TFVC-to-Git conversion with up to 180 days of history preserved.

**Q: What about work items and wikis?**
A: Full support — Azure Boards items become GitHub Issues, wikis are cloned with markdown conversion.

**Q: Is migration destructive?**
A: No. Source repos are never modified. Use dry-run mode to test first.

</details>

---

## Recently Shipped (March–April 2026)

- **BYOK — Multi-provider AI** — configure Gemini, Anthropic, OpenAI, OpenRouter, or LMStudio per user in Settings → AI Configuration; keys encrypted at rest with AES-256-GCM
- **GitHub Event Ingestion** — real-time PR, issue, and deployment webhook pipeline (see `docs/event-ingestion.md`)
- **Cross-Repo Work Board** — my reviews, stale PRs, review load, DORA metrics across all repos
- **SOC 2 Code Hardening** — append-only audit log with SHA-256 hash chain, self-service data erasure (GDPR Art. 17), startup secrets verification, data retention + warning emails
- **Command Palette (Ctrl+K)** — keyboard-first app-wide navigation and actions
- **Stripe Billing + License Key Delivery** — Ed25519-signed JWT license keys issued and emailed on checkout completion
- **AI Assistant Action Dispatch (v3.3.0)** — chat opens Migration Wizard, Create Repo, Transfer, and Settings modals from natural-language requests
- **AI-Assisted Migration Descriptions (v3.3.0)** — AI generates target-repo descriptions with deterministic fallback when no key is present
- **Migration Repo Select Redesign (v3.1.0)** — 10-rule risk engine, 5 batched Azure enrichment endpoints, slide-in detail panel, keyboard-first UX, virtualized rows
- **Auto-Fix Drawer (v3.2.0)** — persistent size-strategy choices with "Fix applied" badge; LFS toggle auto-enabled
- **Bulk Operations Safety** — confirmation dialogs, dry-run mode, tier-gated destructive actions
- **PR Review Experience** — file tree, diff viewer, AI insights, conversation threads
- **License Mint Automation** — GitHub Actions workflow for Ed25519-signed license key distribution
- **Modal System Redesign** — shared Modal primitive with body scroll lock
- **Health Dashboard Premium** — tabbed organization with visual polish
- **Rate Limit UX** — friendly notices with dev-mode exemption

## Roadmap

See [ROADMAP.md](ROADMAP.md) or the in-app `/roadmap` page for what's next. Every feature on the Pricing page works today; upcoming items are honestly scoped as **Shipping Now** / **Next** / **Later**.

---

## Contributing

We welcome contributions! Whether it's bug fixes, new features, or documentation improvements.

### Quick Start for Contributors

1. **Fork** the repository
2. **Clone** your fork: `git clone https://github.com/YOUR-USERNAME/GitHub-Repo-Manager.git`
3. **Create a branch**: `git checkout -b feature/AmazingFeature`
4. **Make changes** and commit: `git commit -m 'feat: Add AmazingFeature'`
5. **Push**: `git push origin feature/AmazingFeature`
6. **Open a Pull Request**

### Development Guidelines

- **Code Style**: ESLint — run `npm run lint` before committing
- **Commits**: [Conventional Commits](https://www.conventionalcommits.org/) format
- **Testing**: Add tests for new features — run `npm test` to verify
- **Files**: `.jsx` only (no TypeScript), Tailwind CSS utilities
- **Documentation**: Update README and docs when adding features

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for detailed guidelines.

---

## Support This Project

If this project has helped you or you find it interesting, consider supporting its development:

<div align="center">

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/brunobola)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/brunobola)
[![Star on GitHub](https://img.shields.io/badge/Star_on_GitHub-%E2%AD%90-yellow?style=for-the-badge&logo=github&logoColor=white)](https://github.com/brunobola-portfolio/GitHub-Repo-Manager)

</div>

Your support helps:
- Fix bugs and improve stability
- Develop new features requested by the community
- Create better documentation and tutorials
- Maintain dependencies and ensure compatibility

---

## License

Distributed under the **GNU Affero General Public License v3 (AGPL-3.0)**. See [`LICENSE`](LICENSE) for details.

A **commercial license** is available for organizations that need to use this software without AGPL obligations. See [`LICENSE-COMMERCIAL.md`](docs/LICENSE-COMMERCIAL.md) for terms, or contact [bruno@bolalabs.pt](mailto:bruno@bolalabs.pt).

### AGPL §13 — Source offer for network operators

If you run a modified version of this software as a network service, AGPL §13 requires you to offer users the corresponding source code. This repo includes a machine-readable endpoint for that purpose:

```http
GET /api/v1/system/source
```

```json
{
  "license": "AGPL-3.0-only",
  "sourceUrl": "https://github.com/brunobola-portfolio/GitHub-Repo-Manager",
  "commercialLicenseUrl": "https://bolalabs.pt/license",
  "notice": "Modified versions running as a network service must offer their corresponding source under AGPL §13."
}
```

**If you fork and deploy this as a service, edit [server/routes/system.js](server/routes/system.js) and update `sourceUrl` to point at your modified source repo** so downstream consumers can programmatically discover it. Keep the endpoint reachable without authentication — AGPL §13 requires the offer to be made to every user of the network service.

---

## Acknowledgments

- **Anthropic** — Claude Code for AI-assisted development
- **Google** — Gemini AI API for intelligent features
- **React Team** — React 19 with concurrent features
- **Vite Team** — Lightning-fast build tooling
- **Tailwind Labs** — TailwindCSS 4 with next-gen features
- **GitHub** — Comprehensive REST API
- **All Contributors** — Who make open source possible

---

<div align="center">

### Contact & Links

**Bruno Silva Marques** | [Bola Labs](https://github.com/brunobola-portfolio)

[![GitHub](https://img.shields.io/badge/GitHub-brunobola--portfolio-181717?style=flat-square&logo=github)](https://github.com/brunobola-portfolio)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-Connect-0A66C2?style=flat-square&logo=linkedin)](https://www.linkedin.com/in/bolalabs/)

---

**Built with React 19, Vite 8, BYOK AI, and Claude Code**

[Overview](#why-github-repo-manager) |
[Features](#features-overview) |
[AI](#ai-powered-intelligence) |
[Migration](#azure-devops-migration-suite) |
[Get Started](#quick-start-demo-mode) |
[Contribute](#contributing) |
[Support](#support-this-project)

</div>
