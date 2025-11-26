# GitHub Repo Manager

A modern React application for performing bulk operations on GitHub repositories. Easily manage visibility, transfer ownership, create mirrors, import from Azure DevOps, and organize repositories across organizations.

![GitHub Repo Manager](https://img.shields.io/badge/React-19-blue) ![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-cyan) ![Vite](https://img.shields.io/badge/Vite-7-purple) ![Express](https://img.shields.io/badge/Express-5-green)

## ✨ Features

### Core Features

- **🔐 GitHub OAuth Authentication** - Secure login with your GitHub account
- **📋 Repository Listing** - View all your repositories with pagination
- **☑️ Bulk Selection** - Select multiple repositories for batch operations
- **🔒 Change Visibility** - Make repositories public or private in bulk
- **🔄 Transfer Ownership** - Transfer repositories to an organization
- **📦 Create Mirrors** - Create independent copies of repositories
- **📜 Activity History** - Track all performed operations
- **🎨 Modern UI** - Clean, responsive design with Tailwind CSS

### New Features (v2.0)

- **📊 Dashboard** - Overview of all repositories with statistics
- **🏢 Organization Management** - View and filter by organizations
- **📁 Archive/Unarchive** - Archive repositories for cleanup
- **🗑️ Delete Repositories** - Permanently delete with confirmation
- **➕ Create Repositories** - Create new repos in your account or organizations
- **☁️ Azure DevOps Import** - Migrate repositories from Azure DevOps to GitHub
- **🔍 Filter by Owner** - Quick filter between personal and org repos
- **🌙 Dark/Light Theme** - Toggle between dark and light mode with persistence
- **⚡ Error Handling** - Retry logic with exponential backoff for failed requests
- **💀 Loading Skeletons** - Smooth loading states while fetching data

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm, yarn, or pnpm

### Installation

```bash
# Clone the repository
git clone https://github.com/your-username/github-repo-manager.git
cd github-repo-manager

# Install dependencies
npm install

# Start development server (Demo Mode)
npm run dev
```

The app will open at `http://localhost:5173` in Demo Mode with mock data.

---

## ⚡ Production Setup (Real GitHub Integration)

### 1. Create a GitHub OAuth App

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **"New OAuth App"**
3. Fill in:
   - **Application name**: GitHub Repo Manager
   - **Homepage URL**: `http://localhost:5173`
   - **Authorization callback URL**: `http://localhost:3001/api/auth/callback`
4. Click **"Register application"**
5. Copy the **Client ID**
6. Click **"Generate a new client secret"** and copy it

### 2. Configure Environment

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your values
```

Edit `.env`:

```env
# Frontend
VITE_MOCK_MODE=false

# Backend - GitHub OAuth (required)
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here

# Security (change in production!)
SESSION_SECRET=generate-a-random-string-here
```

### 3. Start Both Servers

```bash
# Option 1: Start both simultaneously
npm run dev:all

# Option 2: Start separately (in two terminals)
npm run dev:server   # Backend on port 3001
npm run dev          # Frontend on port 5173
```

### 4. Login and Use

1. Open `http://localhost:5173`
2. Click **"Login with GitHub"**
3. Authorize the app
4. Start managing your repositories!

## 📖 Usage Guide

### 1. Login with GitHub

Click "Login with GitHub" to authenticate. The backend handles OAuth flow.

### 2. Dashboard

View statistics about your repositories:
- Total repos, public/private counts
- Number of forks and archived repos
- List of your organizations with repo counts

### 3. Select Repositories

- Click on repository rows to select/deselect
- Use "Select All" to select all visible repositories
- Filter by organization using the sidebar
- Selection persists across pages

### 4. Perform Actions

| Action | Description |
|--------|-------------|
| **Make Private** | Changes visibility to private for selected repos |
| **Make Public** | Changes visibility to public for selected repos |
| **Transfer to Org** | Transfers selected repos to the target organization |
| **Mirror (Fork)** | Creates independent copies in the target organization |
| **Archive** | Archives selected repositories |
| **Delete Forever** | Permanently deletes repositories (requires confirmation) |

### 5. Create New Repository

Click "New Repo" to create a new repository:
- Choose owner (personal account or organization)
- Set name, description, and visibility

### 6. Import from Azure DevOps

Click "Azure Import" to migrate a repository from Azure DevOps:

1. **Get Azure DevOps PAT**:
   - Go to `dev.azure.com/{your-org}/_usersSettings/tokens`
   - Create a new token with **Code (Read)** scope
   - Copy the token

2. **Fill in the form**:
   - Azure Organization (e.g., `mycompany`)
   - Project name
   - Repository name
   - Personal Access Token

3. **Choose GitHub target**:
   - Select target organization (optional)
   - Set repository name (defaults to source name)
   - Choose visibility (public/private)

4. Click **Start Import** - the migration runs in the background

### 7. Check Activity

The sidebar shows real-time status and history of all operations.

## 🔧 API Endpoints

The included Express backend (`server/index.js`) provides these endpoints:

### Authentication

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/login` | GET | Initiates GitHub OAuth flow |
| `/api/auth/callback` | GET | OAuth callback handler |
| `/api/auth/logout` | GET | Ends user session |
| `/api/user` | GET | Returns authenticated user info |

### Repository Operations

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/api/repos` | GET | - | Lists user repositories (pagination supported) |
| `/api/repos` | POST | `{ name, description, private, org? }` | Creates new repository |
| `/api/visibility` | POST | `{ repos[], makePublic }` | Changes visibility |
| `/api/transfer` | POST | `{ repos[], toOrg }` | Transfers to organization |
| `/api/mirror` | POST | `{ repos[], toOrg }` | Creates forks in organization |
| `/api/archive` | POST | `{ repos[], archive }` | Archives/unarchives repos |
| `/api/delete` | POST | `{ repos[], confirm: "DELETE" }` | Deletes repositories |

### Organization Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/orgs` | GET | Lists user's organizations |
| `/api/orgs/:org` | GET | Gets organization details |
| `/api/orgs/:org/repos` | GET | Lists organization repositories |

### Azure DevOps Import

| Endpoint | Method | Body | Description |
|----------|--------|------|-------------|
| `/api/import-azure` | POST | `{ azureOrg, azureProject, azureRepo, azurePat, githubOrg?, repoName?, isPrivate }` | Starts import |
| `/api/import-status/:owner/:repo` | GET | - | Checks import status |

### Statistics

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/stats` | GET | Returns repository statistics |

## 🏗️ Project Structure

```text
├── server/
│   └── index.js           # Express backend with GitHub API
├── src/
│   ├── components/
│   │   ├── ui/
│   │   │   ├── Badge.jsx      # Status badges
│   │   │   ├── Button.jsx     # Button variants
│   │   │   └── Card.jsx       # Card container
│   │   ├── AzureImportModal.jsx  # Azure DevOps import wizard
│   │   ├── CreateRepoModal.jsx   # New repository form
│   │   ├── Dashboard.jsx         # Stats and org overview
│   │   ├── Header.jsx            # Navigation and auth
│   │   ├── OrgSidebar.jsx        # Organization filter
│   │   ├── RepoList.jsx          # Repository table
│   │   └── Sidebar.jsx           # Actions panel
│   ├── hooks/
│   │   └── useGitHub.js       # GitHub API hook
│   ├── utils/
│   │   └── api.js             # API utilities
│   ├── config.js              # App configuration
│   ├── App.jsx                # Main application
│   ├── main.jsx               # Entry point
└── index.css              # Tailwind styles
```

## 🛠️ Development

### Available Commands

| Command | Description |
|---------|-------------|
| `npm install` | Install all dependencies |
| `npm run dev` | Start Vite frontend dev server (port 5173) |
| `npm run dev:server` | Start Express API backend (port 3001) |
| `npm run dev:all` | Start both frontend and backend simultaneously |
| `npm run build` | Build for production |
| `npm run preview` | Preview production build |
| `npm run lint` | Run ESLint |
| `npm start` | Start production server |

### Quick Start Commands

```bash
# Install dependencies (first time only)
npm install

# Development - Start both frontend and backend
npm run dev:all

# Or start separately (two terminals)
npm run dev:server   # Terminal 1: API on port 3001
npm run dev          # Terminal 2: Frontend on port 5173

# Production build
npm run build
npm start
```

### Demo Mode

By default, the app runs in Demo Mode during development, showing mock data. To test with a real backend:

1. Set `VITE_MOCK_MODE=false` in `.env.local`
2. Ensure your backend is running
3. Restart the dev server

You can also toggle mock mode via browser console:
```javascript
localStorage.setItem('MOCK_MODE', 'false')
location.reload()
```

## � Portfolio Organization Tips

Use this app to organize your GitHub repositories into a clean portfolio:

### Suggested Organization Structure

| Organization | Purpose | Example Repos |
|--------------|---------|---------------|
| `yourname-portfolio` | Showcase projects | Best personal projects |
| `yourname-forks` | Forked repositories | Open source contributions |
| `yourname-experiments` | Learning/experiments | Tutorials, tests, POCs |
| `yourname-archive` | Old/inactive projects | Legacy code |

### Workflow

1. **Create organizations** on GitHub (Settings → Organizations → New)
2. **Filter** your repos by type (forks, archived, etc.)
3. **Select** repos to organize
4. **Transfer** to appropriate organization
5. **Archive** inactive repos to clean up

## 🔒 Security Notes

- Never commit `.env` or `.env.local` files
- The `.gitignore` is configured to exclude sensitive files
- GitHub tokens are stored server-side in sessions
- Use HTTPS in production
- OAuth scopes used: `repo`, `delete_repo`, `read:org`, `admin:org`

## 📦 Tech Stack

- **React 19** - UI library
- **Vite 7** - Build tool
- **Express 5** - Backend server
- **Tailwind CSS 4** - Styling
- **Lucide React** - Icons
- **clsx & tailwind-merge** - Class utilities

## 📄 License

MIT License - See [LICENSE](LICENSE) for details.

---

Made with ❤️ for GitHub power users
