<div align="center">

# GitHub Repo Manager

**The GitHub dashboard that thinks — manage, migrate, and optimize with AI**

![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-7.2-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-4.1-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Express](https://img.shields.io/badge/Express-5.1-000000?style=for-the-badge&logo=express&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20+-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Gemini AI](https://img.shields.io/badge/Gemini_AI-Powered-8E75B2?style=for-the-badge&logo=google-gemini&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?style=for-the-badge&logo=sqlite&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-109%20passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

**A full-stack AI-powered dashboard for managing repositories, teams, CI/CD, and migrating from Azure DevOps — all in one beautiful interface.**

[Try Demo Mode](#quick-start-demo-mode) | [Features](#features-overview) | [Installation](#installation) | [Documentation](docs/)

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

> Built with the latest stack: React 19, Vite 7, Express 5, Tailwind CSS 4, and Google Gemini AI.

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
- [Built with AI](#built-with-ai)
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

### Additional Features

- **Dark/Light Mode** — System preference detection with manual toggle
- **Keyboard Shortcuts** — Command palette (Ctrl+K), navigation, and action shortcuts
- **Responsive Design** — Desktop, tablet, and mobile with touch-optimized targets (44px min)
- **Accessibility** — Focus traps, ARIA roles, screen reader support, skip navigation
- **Smart Notifications** — Non-intrusive toast feedback on all actions
- **Local Caching** — Fast performance with intelligent data caching
- **Offline Support** — Continue browsing cached data when disconnected

---

## AI-Powered Intelligence

![AI Assistant](docs/images/09_ai_assistant_dark_hd.png)

GitHub Repo Manager integrates **Google Gemini AI** to supercharge your workflow with 10+ AI features:

### Conversational AI Assistant
- **Natural Language Interface** — Ask questions about your repositories in plain English
- **Context-Aware Responses** — Answers tailored to your specific projects and data
- **Quick Actions** — Execute common tasks through conversation

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
| **Migration Risk Analysis** | Gemini-powered risk assessment before migrations |
| **Batch Indexing** | Index up to 10 repos at once for semantic search |

> **Free to use**: Gemini AI has a generous free tier. Without an API key, the app works perfectly with mock AI responses.

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
- **Google Gemini API key** (optional, for AI features)

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

> **Note**: Docker support is part of the v3.0 roadmap. A `docker-compose.yml` will be provided in that release.

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

```env
# GitHub OAuth (Required for Real Mode)
GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret

# AI Features (Optional - free tier available)
# Get your key: https://aistudio.google.com/apikey
GEMINI_API_KEY=your_gemini_api_key

# Azure DevOps Migration (Optional)
AZURE_PAT=your_azure_personal_access_token

# Server Configuration
PORT=3001
SESSION_SECRET=your_random_session_secret_min_32_chars
FRONTEND_URL=http://localhost:5173

# Development
VITE_MOCK_MODE=true
```

### Setting Up GitHub OAuth

1. Go to **GitHub Settings** > **Developer settings** > **OAuth Apps**
2. Click **New OAuth App**
3. Configure:
   - **Application name**: GitHub Repo Manager
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:3001/api/auth/callback`
4. Copy the **Client ID** and **Client Secret** to your `.env` file

### Setting Up AI Features

1. Visit [Google AI Studio](https://aistudio.google.com/apikey)
2. Create a new API key (free tier: 250 requests/day)
3. Add to `.env` as `GEMINI_API_KEY`

> Without an API key, all AI features return high-quality mock responses automatically.

---

## Architecture

```
+---------------------------------------------------------------+
|                   Frontend (React 19 + Vite 7)                 |
|  +-------------+  +-----------+  +--------------------------+  |
|  | Components  |  |   Hooks   |  |     API Utilities        |  |
|  | (UI Layer)  |  | (useGitHub|  |  (src/api/, utils/)      |  |
|  |             |  |  useTheme) |  |  Mock/Real mode switch   |  |
|  +-------------+  +-----------+  +--------------------------+  |
+---------------------------------------------------------------+
                            |
                   Vite Dev Proxy / Build
                            |
+---------------------------------------------------------------+
|                  Backend (Express 5 + Node 20)                 |
|  +----------------------------------------------------------+  |
|  |  Security: Helmet | Rate Limit | Zod Validation | SSRF   |  |
|  +----------------------------------------------------------+  |
|  +-------------+  +-----------+  +--------------------------+  |
|  |   Routes    |  | AI Service|  |   Database (SQLite WAL)  |  |
|  | 143+ endpts |  | (Gemini)  |  |   better-sqlite3         |  |
|  +-------------+  +-----------+  +--------------------------+  |
|  +----------------------------------------------------------+  |
|  |  Migration Engine | Planner | Import Service | Git Ops   |  |
|  +----------------------------------------------------------+  |
|  +----------------------------------------------------------+  |
|  |  GitHub API: ETag Cache | Rate Limit Tracking | Batching |  |
|  +----------------------------------------------------------+  |
+---------------------------------------------------------------+
                            |
+---------------------------------------------------------------+
|                     External Services                          |
|  +-------------+  +-----------+  +--------------------------+  |
|  |  GitHub API |  | Gemini AI |  |   Azure DevOps API       |  |
|  | v2022-11-28 |  | 2.5 Flash |  |   v7.1 (Git + TFVC)      |  |
|  +-------------+  +-----------+  +--------------------------+  |
+---------------------------------------------------------------+
```

For detailed architecture documentation, see [`docs/architecture/overview.md`](docs/architecture/overview.md).

---

## Tech Stack

| Category | Technologies |
|----------|-------------|
| **Frontend** | React 19.2, Vite 7.2, TailwindCSS 4.1 |
| **UI/UX** | Framer Motion 12, Lucide Icons (554), Recharts 3, Radix UI |
| **Backend** | Node.js 20+, Express 5.1 |
| **Database** | Better-SQLite3 12.6 (WAL mode, 32MB cache) |
| **Security** | Helmet.js, express-rate-limit, Zod validation, SSRF protection |
| **AI** | Google Gemini API (text-embedding-004, gemini-2.5-flash) |
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

## Built with AI

This project demonstrates the power of **AI-assisted software development** at every level:

### AI in the Application
- **10+ AI features** powered by Google Gemini (analysis, search, generation, migration planning)
- **Semantic search** with vector embeddings stored in SQLite
- **Quality scoring** that combines algorithmic analysis with AI insights
- **Graceful degradation** — every AI feature has a programmatic fallback

### AI in Development
- **Claude Code** (Anthropic's Claude AI) was used extensively throughout development
- Architecture decisions, code generation, testing, and documentation — all AI-assisted
- Specs and implementation plans in `docs/specs/` and `docs/plans/` were co-created with AI
- This README itself was crafted with AI assistance

### The AI Stack
```
Development:   Claude Code (Anthropic) — architecture, code, tests, docs
Application:   Google Gemini 2.5 Flash — analysis, search, generation
Embeddings:    text-embedding-004 — semantic similarity & search
Fallbacks:     Programmatic analysis — works without any AI API key
```

> **The result**: A production-quality full-stack application with 143+ API endpoints, 109+ tests, enterprise-grade security, and a polished glassmorphism UI — built faster and better with AI.

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
A: Not yet — it's on the roadmap. See [Roadmap](#roadmap) for details.

**Q: Does this work offline?**
A: The UI works offline with cached data. Live features require internet.

</details>

<details>
<summary><strong>AI Features</strong></summary>

**Q: Do I need to pay for AI?**
A: Google Gemini has a free tier (250 req/day). Check [ai.google.dev](https://ai.google.dev/).

**Q: What data is sent to AI?**
A: Only repository metadata (name, description, topics, README). Never code content.

**Q: Can I use a different AI provider?**
A: Currently Gemini only. The architecture supports adding providers — see `server/ai-service.js`.

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

## Roadmap

### v2.0 (Q1 2026) — Completed

- [x] CI/CD Integration (view and trigger GitHub Actions)
- [x] Community Health Metrics (0-100 scoring)
- [x] Security Hardening (Helmet, rate limiting, input validation, ETag caching)
- [x] Accessibility (focus traps, keyboard nav, ARIA, touch-optimized)
- [x] Mobile Responsiveness (adaptive layouts, touch-friendly actions)

### v2.5 (Q1 2026) — Completed

- [x] Azure DevOps Migration Suite (Git, TFVC, Work Items, Wikis)
- [x] Migration Wizard (8-step guided flow)
- [x] AI-Assisted Migration Planning (risk analysis, recommendations)
- [x] Migration Scheduling (encrypted credentials, off-peak execution)
- [x] Pause/Resume and Task Retry
- [x] Smart URL Parser (6+ Azure DevOps URL formats)
- [x] TFVC-to-Git Conversion (automatic, with fallback)

### v3.0 — Platform Edition (In Progress)

The next major release transforms GitHub Repo Manager from a local tool into an **open-core platform** with a hosted cloud edition.

#### Infrastructure & Architecture

- [ ] Docker & Docker Compose support (self-host in one command)
- [ ] Database abstraction layer (SQLite for self-hosted, PostgreSQL for cloud)
- [ ] Redis sessions & BullMQ job queues for horizontal scaling
- [ ] Multi-tenancy with user-scoped data isolation
- [ ] API versioning (`/api/v1/`)

#### Cloud Edition (SaaS)

- [ ] Hosted version — sign in with GitHub, zero setup
- [ ] Vercel (frontend) + Railway (backend) deployment
- [ ] Sentry error tracking & enhanced monitoring
- [ ] Automated CI/CD deployment pipeline

#### Security & Enterprise

- [ ] API key authentication with scoped permissions
- [ ] Comprehensive audit logging with searchable UI
- [ ] Per-tenant rate limiting (tier-aware)
- [ ] Subscription tiers (Free / Pro / Enterprise)
- [ ] HSTS, CSP hardening, request ID tracing

#### Monetization

- [ ] Stripe billing integration (checkout, portal, webhooks)
- [ ] Usage metering (AI queries, repos, migrations)
- [ ] Pricing page with feature comparison
- [ ] Billing & usage dashboard in Settings

#### Go-to-Market

- [ ] Public landing page with feature showcase
- [ ] GitHub Marketplace listing
- [ ] Product Hunt & Hacker News launches

> See the full [Platform Transformation Spec](docs/specs/2026-04-01-platform-transformation-spec.md) and [implementation plans](docs/plans/) for details.

### Future (v3.x+)

- [ ] Multi-platform migration: GitLab, Bitbucket source support
- [ ] GitHub Enterprise Server support
- [ ] Plugin/extension system for community contributions
- [ ] Advanced analytics: commit heatmaps, contributor insights, dependency graphs
- [ ] Custom AI model selection (OpenAI, Claude, local models)

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

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for details.

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

**Built with React 19, Vite 7, Google Gemini AI, and Claude Code**

[Overview](#why-github-repo-manager) |
[Features](#features-overview) |
[AI](#ai-powered-intelligence) |
[Migration](#azure-devops-migration-suite) |
[Get Started](#quick-start-demo-mode) |
[Contribute](#contributing) |
[Support](#support-this-project)

</div>
