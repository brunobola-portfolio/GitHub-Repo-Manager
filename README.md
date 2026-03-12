# GitHub Repo Manager

![React](https://img.shields.io/badge/React-19.0-61DAFB?style=for-the-badge&logo=react&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-7.2-646CFF?style=for-the-badge&logo=vite&logoColor=white)
![TailwindCSS](https://img.shields.io/badge/Tailwind_CSS-4.0-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-20-339933?style=for-the-badge&logo=node.js&logoColor=white)
![Gemini AI](https://img.shields.io/badge/Gemini_AI-Powered-8E75B2?style=for-the-badge&logo=google-gemini&logoColor=white)
![Tests](https://img.shields.io/badge/Tests-109%20passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)
![CI Status](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/workflows/CI/badge.svg)

> **A modern, AI-powered dashboard for managing your GitHub ecosystem with style and intelligence.**

---

## ✨ Overview

**GitHub Repo Manager** is a comprehensive workspace designed for developers who manage multiple repositories, organizations, and teams. Built with a stunning **Glassmorphism UI** that combines aesthetic beauty with powerful functionality, it transforms repository management from a chore into an elegant experience.

Whether you're an individual developer with dozens of side projects or a team lead managing an organization's infrastructure, this tool provides the insights and controls you need—all in one beautiful interface.

![Dashboard View](docs/images/01_dashboard_hd.png)

---

## 🎯 Key Features

### 🎨 Modern Glassmorphism UI
Experience a meticulously crafted interface with depth-rich layers, subtle blurs, and smooth animations that make navigating complex data intuitive and delightful.

- **🌓 Dark/Light Mode**: Seamlessly switch between themes with system preference detection
- **📱 Responsive Design**: Works beautifully across desktop, tablet, and mobile devices with touch-optimized targets (44px minimum)
- **⚡ Lightning Fast**: Built with Vite 7 for instant hot-module replacement and blazing-fast builds
- **🎭 Smooth Animations**: Powered by Framer Motion for fluid, natural interactions
- **♿ Accessible**: Focus traps in modals, keyboard navigation, ARIA attributes, and screen reader support

### 📊 Comprehensive Dashboard
Get a bird's-eye view of your entire GitHub ecosystem at a glance.

- **Real-time Statistics**: Track total repos, public/private distribution, forks, and organizations
- **Activity Trends**: Visual charts showing your development activity over time
- **Language Distribution**: See which technologies power your projects
- **Top Organizations**: Quick insights into your most active organizations

![Repository Management](docs/images/02_repositories_hd.png)

### 📦 Advanced Repository Management
Organize, filter, and manage your repositories with powerful tools built for scale.

- **🔍 Smart Search & Filters**: Find repos instantly by name, language, visibility, or type
- **🤖 AI Semantic Search**: Natural language search powered by embeddings (requires AI setup)
- **📋 Bulk Actions**: Archive, delete, transfer, or update multiple repos simultaneously
- **🏷️ Intelligent Sorting**: Sort by stars, forks, update date, or custom criteria
- **🎯 Advanced Filters**: Filter by programming language, visibility, archived status, and more
- **📄 Pagination**: Efficiently navigate large repository collections

### ⚡ Quick Repository Creation
Streamline your workflow with our intuitive repository creation modal.

![Create Repository](docs/images/03_create_repo_modal_hd.png)

- **📝 Smart Defaults**: Intelligent form pre-population based on your patterns
- **🏢 Organization Support**: Create repos under personal account or any organization
- **🤖 AI Description Generator**: Auto-generate professional descriptions (requires AI setup)
- **🔒 Privacy Controls**: Set repository visibility with a single click
- **✨ Template Support**: Create from existing templates for faster setup

### 🤖 AI-Powered Intelligence
Leverage Google Gemini AI to supercharge your repository management.

![AI Assistant](docs/images/04_ai_assistant_hd.png)

#### Conversational AI Assistant
- **💬 Natural Language Interface**: Ask questions about your repositories in plain English
- **🎯 Context-Aware Responses**: Get answers tailored to your specific projects
- **📚 Knowledge Base**: Built-in understanding of best practices and GitHub workflows
- **🚀 Quick Actions**: Execute common tasks through conversation

#### Repository Insights & Analysis
- **📊 Quality Reports**: Comprehensive analysis of code health, documentation, and community
- **🔍 Pattern Detection**: Automatically identify missing README sections, CI/CD, tests, license
- **📈 Health Scoring**: 0-100 score based on documentation, community, engineering, and polish
- **💡 Actionable Recommendations**: Priority-ranked suggestions for improvement

#### AI-Enhanced Features
- **📝 README Generation**: Create professional README files based on your project structure
- **✨ README Enhancement**: Intelligently add missing sections to existing documentation
- **🏷️ Smart Topic Suggestions**: AI-generated tags for better discoverability
- **🔮 Project Classification**: Automatic detection of project type (library, app, tool, etc.)

### 👥 Team Collaboration Hub
Manage your teams and streamline collaboration across your organization.

![Team Hub](docs/images/05_teams_hub_hd.png)

- **🏢 Team Overview**: Centralized view of all your teams and their repositories
- **📊 Team Analytics**: Track repository count and member activity per team
- **👤 Member Management**: Easy team member administration
- **🔐 Role-Based Access**: Owner, member, and maintainer role tracking
- **📋 Team Repositories**: Quick access to all team-managed projects

### ⚡ GitHub Actions Statistics
Monitor CI/CD pipeline performance with comprehensive analytics.

- **📊 Workflow Metrics**: Success rates, failure tracking, and duration analysis
- **📈 Daily Trends**: Interactive charts showing workflow performance over time
- **Real-time Sync**: Sync workflow runs directly from GitHub API
- **📥 Export Data**: Download statistics as CSV for reporting
- **👥 Team Analytics**: Aggregate metrics across all team repositories
- **🎯 Workflow-Specific Stats**: Detailed analysis per workflow

### 🏥 Community Health Metrics
Evaluate and improve repository community standards.

- **💯 Health Score**: 0-100 rating based on documentation, files, and activity
- **📋 File Checklist**: Verify presence of README, LICENSE, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY
- **📊 Activity Metrics**: Track contributors, commits, and issue resolution
- **💡 Smart Recommendations**: Priority-ranked suggestions (high/medium/low)
- **⚡ Performance Cache**: Fast repeated access with intelligent caching
- **🔍 Multi-Repo Comparison**: Compare health scores across repositories

### 🔄 Azure DevOps Import (Basic)
Import Git repositories from Azure DevOps to GitHub with a streamlined workflow.

**✅ Currently Supported:**
- **📥 Git Repository Code**: Complete history, branches, and tags preservation
- **🔗 Connection Verification**: Validate Azure DevOps credentials before import
- **🎯 Flexible Targeting**: Import to personal account or organization
- **🔒 Privacy Controls**: Choose public or private repository visibility
- **🛡️ Safe Import**: Read-only operation that preserves your original Azure DevOps data

**⚠️ Current Limitations:**
- **Pull Requests**: Not automatically migrated (manual recreation required)
- **Work Items/Boards**: Not migrated (Azure Boards → GitHub Issues conversion not available)
- **Pipelines**: Not converted (Azure Pipelines → GitHub Actions requires manual setup)
- **Wiki**: Not migrated (requires manual export/import)
- **Test Plans**: Not supported
- **Artifacts**: Not supported

**🗺️ Future Roadmap:**
Full Azure DevOps migration capabilities (Work Items, Pipelines, Wiki) are planned for **v3.0+**. Current version focuses on essential Git repository migration for quick project transfers.

### 🎯 Additional Power Features

- **⭐ Repository Starring**: Quick-star functionality for your favorite projects
- **📌 Pin Repositories**: Keep important repos at the top of your list
- **🔔 Smart Notifications**: Stay updated on important repository events
- **📈 Activity Timeline**: Visual history of recent repository and team activities
- **🔄 Organization Sync**: Refresh organization data with a single click
- **💾 Local Caching**: Fast performance with intelligent data caching
- **🌐 Offline Support**: Continue working even when GitHub is unreachable

---

## 🛠️ Tech Stack

| Category | Technologies |
|----------|-------------|
| **Frontend** | React 19, Vite 7, TailwindCSS 4 |
| **UI/UX** | Framer Motion 12, Lucide Icons, Recharts 3 |
| **Backend** | Node.js 20+, Express 5 |
| **Database** | Better-SQLite3 (local) |
| **Security** | Helmet.js, express-rate-limit, ETag caching |
| **AI** | Google Gemini API (@google/generative-ai) |
| **APIs** | GitHub REST API (v2022-11-28), Azure DevOps API |

---

## 🚀 Getting Started

### Prerequisites

- **Node.js** 18+ (20+ recommended)
- **npm** or **yarn**
- **GitHub account** (for OAuth and API access)
- **Google Gemini API key** (optional, for AI features)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/brunobola-portfolio/GitHub-Repo-Manager.git
   cd GitHub-Repo-Manager
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   
   Copy the example file and configure:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials (see [Configuration](#%EF%B8%8F-configuration) below)

### Running the Application

**Option 1: Run Everything Together (Recommended)**
```bash
npm run dev:all
```
This launches both frontend (`:5173`) and backend (`:3001`) concurrently.

**Option 2: Run Separately**
```bash
# Terminal 1: Backend
npm run dev:server

# Terminal 2: Frontend
npm run dev
```

**Access the application**: Open [http://localhost:5173](http://localhost:5173)

---

## ⚙️ Configuration

### Mock Mode vs. Real Mode

The application supports **Mock Mode** for development and demos without external API keys.

#### Mock Mode (Default)
Perfect for testing the UI and exploring features without setup:
```env
VITE_MOCK_MODE=true
```

Mock mode provides:
- ✅ Realistic repository data with 87 mock repositories
- ✅ Simulated organizations and teams
- ✅ Mock AI responses for all AI features
- ✅ Full UI functionality without API calls

#### Real Mode
For production use with actual GitHub and AI integration:
```env
VITE_MOCK_MODE=false
GITHUB_CLIENT_ID=your_github_client_id
GITHUB_CLIENT_SECRET=your_github_client_secret
GEMINI_API_KEY=your_gemini_api_key
```

### Environment Variables

Create a `.env` file in the root directory:

```env
# ===================
# GitHub OAuth (Required for Real Mode)
# ===================
GITHUB_CLIENT_ID=your_github_oauth_client_id
GITHUB_CLIENT_SECRET=your_github_oauth_client_secret

# ===================
# AI Features (Optional)
# ===================
# Get your key from: https://makersuite.google.com/app/apikey
GEMINI_API_KEY=your_gemini_api_key

# ===================
# Azure DevOps Migration (Optional)
# ===================
AZURE_PAT=your_azure_personal_access_token

# ===================
# Server Configuration
# ===================
PORT=3001
SESSION_SECRET=your_random_session_secret
FRONTEND_URL=http://localhost:5173

# ===================
# Development
# ===================
VITE_MOCK_MODE=true
```

### Setting Up GitHub OAuth

1. Go to **GitHub Settings** → **Developer settings** → **OAuth Apps**
2. Click **New OAuth App**
3. Configure:
   - **Application name**: GitHub Repo Manager
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:3001/api/auth/callback`
4. Copy the **Client ID** and **Client Secret** to your `.env` file

### Setting Up AI Features

1. Visit [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Add it to `.env` as `GEMINI_API_KEY`

Without an API key, AI features will return mock responses with sample data.

---

## 🔐 GitHub Permissions

The application requires specific GitHub scopes for full functionality:

| Scope | Purpose | Why We Need It |
|-------|---------|----------------|
| `repo` | Full repository control | List, create, update, and delete repositories (public and private) |
| `read:org` | Read organization data | Display your organizations and team memberships |
| `user` | Read user profile | Fetch profile information and email address |
| `delete_repo` | Delete repositories | Required explicitly for the bulk delete action |
| `admin:org` | Organization administration | Create teams and manage organization settings (optional) |

> **🔒 Security Note**: Access tokens are stored in encrypted session cookies (`httpOnly`, `sameSite: lax`) and never persisted to disk. The backend is hardened with Helmet.js security headers, rate limiting (200 req/15min API, 20 req/15min auth), parameterized SQL queries, and input validation. ETag conditional requests optimize GitHub API rate limit usage.

---

## 📚 Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (React + Vite)                   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Components │  │    Hooks    │  │    API Utilities    │  │
│  │  (UI Layer) │  │ (useGitHub) │  │  (src/api/, utils/) │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Backend (Express Server)                   │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Security: Helmet · Rate Limit · Input Validation    │   │
│  └──────────────────────────────────────────────────────┘   │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   Routes    │  │  AI Service │  │   Database (SQLite) │  │
│  │ /api/*      │  │ (Gemini)    │  │   (Better-SQLite3)  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  GitHub API: ETag Cache · Rate Limit Tracking        │   │
│  └──────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    External Services                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  GitHub API │  │ Gemini API  │  │   Azure DevOps API  │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

For detailed architecture documentation, see [`docs/architecture/overview.md`](docs/architecture/overview.md).

---

## 🐛 Troubleshooting

### Common Issues

#### Backend Server Not Running (ECONNREFUSED)

```text
[vite] http proxy error: /api/auth/login
AggregateError [ECONNREFUSED]
```

**Cause**: The frontend is running but the backend server is not started.

**Solution**:

1. **Recommended**: Run both servers together:

   ```bash
   npm run dev:all
   ```

2. **Alternative**: Start the backend separately in another terminal:

   ```bash
   npm run dev:server
   ```

3. Verify the backend is running on port 3001 by visiting `http://localhost:3001/api/health`

**Note**: The UI will display a helpful guide when this error occurs, showing the exact commands to run.

#### Port Already in Use
```bash
Error: Port 5173 is already in use
```
**Solution**: Kill the process using the port or change it in `vite.config.js`:
```bash
# Windows
netstat -ano | findstr :5173
taskkill /PID <pid> /F

# macOS/Linux
lsof -ti:5173 | xargs kill -9
```

#### GitHub OAuth Callback Error
```
Error: Invalid callback URL
```
**Solution**: Ensure your OAuth app's callback URL matches exactly:
- Development: `http://localhost:3001/api/auth/callback`
- Production: `https://yourdomain.com/api/auth/callback`

#### AI Features Not Working
```
503 Service Unavailable
```
**Solution**: 
1. Verify `GEMINI_API_KEY` is set in `.env`
2. Check API key is valid at [Google AI Studio](https://makersuite.google.com/app/apikey)
3. Without a key, mock responses are returned automatically

#### Session Lost on Refresh

**Solution**: Check that `SESSION_SECRET` is set in `.env` and the backend is running.

#### Native Module Version Mismatch (NODE_MODULE_VERSION)

```text
Error: The module 'better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 137. This version of Node.js requires NODE_MODULE_VERSION 127.
```

**Cause**: The `better-sqlite3` native module was compiled for a different Node.js version than you're currently running. This typically happens after updating Node.js.

**Solution**:

1. **Quick fix** - Rebuild the native module:

   ```bash
   npm run fix:native
   ```

2. **Alternative** - Manual rebuild:

   ```bash
   npm rebuild better-sqlite3
   ```

3. **Full reinstall** (if above fails):

   ```bash
   rm -rf node_modules package-lock.json
   npm install
   ```

**Prevention**: The app automatically checks native module compatibility on `npm install` and when starting the server.

#### npm install Fails

```bash
Error: Cannot find module 'some-package'
```

**Solution**:

```bash
rm -rf node_modules package-lock.json
npm cache clean --force
npm install
```

#### Charts Not Rendering

**Solution**: Ensure browser window is focused and wait 2-3 seconds for data to load. Charts use lazy rendering for performance.

---

## ❓ FAQ

### General Questions

**Q: Do I need a GitHub account to use this?**  
A: Yes, for real mode. Mock mode works without any accounts.

**Q: Is my data secure?**  
A: Yes. We use encrypted session cookies and never store tokens permanently. All data stays on your machine.

**Q: Can I use this with GitHub Enterprise?**  
A: Not currently, but it's on our roadmap. Contributions welcome!

**Q: Does this work offline?**  
A: The UI works offline with cached data. Live features like syncing require internet connectivity.

### AI Features

**Q: Do I need to pay for AI features?**  
A: Google Gemini has a free tier. Check current limits at [ai.google.dev](https://ai.google.dev/).

**Q: What data is sent to AI?**  
A: Only repository metadata (name, description, topics, README). Never code content.

**Q: Can I use a different AI provider?**  
A: Currently only Gemini is supported. Other providers can be added—see `server/ai-service.js`.

### Features & Usage

**Q: How many repositories can I manage?**  
A: Unlimited. Pagination handles large collections efficiently.

**Q: Can I bulk-edit repository settings?**  
A: Yes! Select multiple repos and use bulk actions in the Quick Actions panel.

**Q: Does this support GitHub Actions?**
A: Yes! View workflow statistics, success rates, and trends. Triggering workflows is also supported through the Actions tab.

**Q: Can I export my repository data?**
A: Yes! Actions Statistics can be exported to CSV. Full repository export is planned for a future release.

### Development

**Q: Can I contribute?**  
A: Absolutely! See [`CONTRIBUTING.md`](CONTRIBUTING.md) for guidelines.

**Q: How do I report a bug?**  
A: Open an issue on GitHub with:
- Steps to reproduce
- Expected vs actual behavior  
- Screenshots if applicable
- Browser and OS version

**Q: Where are feature requests tracked?**  
A: In GitHub Issues with the `enhancement` label.

---

## 🗺️ Roadmap

### v2.0 (Q1 2026) - COMPLETED

- [x] **CI/CD Integration**: View and trigger GitHub Actions directly from the dashboard
- [x] **Community Health Metrics**: Repository health scoring and recommendations
- [x] **Security Hardening**: Helmet.js, rate limiting, SQL injection fixes, input validation, ETag caching
- [x] **Accessibility**: Focus traps, keyboard navigation, ARIA roles, touch-optimized targets (44px)
- [x] **Mobile Responsiveness**: Responsive AI Assistant, touch-friendly repo actions, adaptive padding
- [x] **GitHub API Optimization**: ETag conditional requests, rate limit tracking, batched team requests

### v2.5 (Q2 2026)

- [ ] **Advanced Analytics**: Historical trends, commit activity heatmaps, contributor insights
- [ ] **Custom Themes**: User-customizable color schemes and glassmorphism intensity
- [ ] **Keyboard Shortcuts**: Power-user shortcuts for common actions
- [ ] **Repository Templates**: Save and reuse repository configurations
- [ ] **Mobile App**: React Native companion for on-the-go management
- [ ] **GitHub Enterprise Support**: Connect to self-hosted GitHub instances
- [ ] **Data Export**: Export repository data to CSV, JSON, or Excel
- [ ] **Webhooks Dashboard**: Real-time webhook monitoring and debugging
- [ ] **Collaborative Features**: Share repository collections with team members

### v3.0 (Q3 2026)

- [ ] **Enhanced AI**:
  - Automated code review agents
  - Semantic search across all repositories
  - "Chat with your codebase" feature
  - AI-powered issue triage
- [ ] **Premium Insights**:
  - Dependency vulnerability scanning
  - Security best practices checker
  - Performance optimization suggestions
- [ ] **Multi-Platform Migration**: Support for GitLab, Bitbucket, and more

---

## 🤝 Contributing

We love contributions! Whether it's bug fixes, new features, or documentation improvements, every contribution makes this project better.

### Quick Start for Contributors

1. **Fork** the repository
2. **Clone** your fork:
   ```bash
   git clone https://github.com/YOUR-USERNAME/GitHub-Repo-Manager.git
   ```
3. **Create a feature branch**:
   ```bash
   git checkout -b feature/AmazingFeature
   ```
4. **Make your changes** and commit:
   ```bash
   git commit -m 'feat: Add AmazingFeature'
   ```
5. **Push** to your fork:
   ```bash
   git push origin feature/AmazingFeature
   ```
6. **Open a Pull Request** with a clear description

### Development Guidelines

- **Code Style**: We use ESLint. Run `npm run lint` before committing.
- **Commit Messages**: Follow [Conventional Commits](https://www.conventionalcommits.org/).
- **Testing**: Add tests for new features. Run `npm test` to verify.
- **Documentation**: Update README and docs when adding features.

For detailed guidelines, see [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## 📜 License

Distributed under the **MIT License**. See [`LICENSE`](LICENSE) for more information.

---

## 🙏 Acknowledgments

- **React Team** for the amazing React 19 release
- **Vite Team** for the blazing-fast build tool
- **Tailwind Labs** for TailwindCSS 4.0
- **Google** for the Gemini AI API
- **GitHub** for their comprehensive REST API
- **All Contributors** who make this project possible

---

## 💖 Support This Project

If this project has helped you save time or improve your workflow, consider supporting its development!

<div align="center">

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/brunobola)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-Support-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white)](https://ko-fi.com/brunobola)

</div>

### 🌟 Why Support?

Your contributions help:
- 🐛 **Fix bugs** and improve stability
- ✨ **Develop new features** requested by the community
- 📚 **Create better documentation** and tutorials
- ⚡ **Maintain dependencies** and ensure compatibility
- 💬 **Provide faster support** to users

Every coffee makes a difference! Even small contributions fuel development and show appreciation for open-source work. 🙏

---

## 📞 Support

- **📖 Documentation**: Full docs at [`/docs`](docs/)
- **🐛 Bug Reports**: [GitHub Issues](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/issues)
- **💡 Feature Requests**: [GitHub Discussions](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/discussions)
- **💬 Community**: Open an issue for support

---

## 📊 Project Stats

![GitHub stars](https://img.shields.io/github/stars/brunobola-portfolio/GitHub-Repo-Manager?style=social)
![GitHub forks](https://img.shields.io/github/forks/brunobola-portfolio/GitHub-Repo-Manager?style=social)
![GitHub issues](https://img.shields.io/github/issues/brunobola-portfolio/GitHub-Repo-Manager)
![GitHub pull requests](https://img.shields.io/github/issues-pr/brunobola-portfolio/GitHub-Repo-Manager)
![License](https://img.shields.io/github/license/brunobola-portfolio/GitHub-Repo-Manager)

---

<p align="center">
  <strong>Built with ❤️ by Bola Labs</strong><br>
  <sub>Powered by React 19, Vite 7, and Google Gemini AI</sub>
</p>

<p align="center">
  <a href="#-overview">Overview</a> •
  <a href="#-key-features">Features</a> •
  <a href="#-getting-started">Getting Started</a> •
  <a href="#%EF%B8%8F-configuration">Configuration</a> •
  <a href="#-troubleshooting">Troubleshooting</a> •
  <a href="#-support-this-project">Support</a> •
  <a href="#-contributing">Contributing</a>
</p>
