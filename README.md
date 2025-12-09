# GitHub Repository Manager

**Your personal command center for GitHub.**  
Manage your repositories, organize your portfolio, and perform bulk operations with ease—all from a beautiful, modern interface.

![GitHub Repo Manager](https://img.shields.io/badge/Status-Active-success) ![License](https://img.shields.io/badge/License-MIT-blue) ![Stack](https://img.shields.io/badge/Tech-React_19_•_Vite_•_Tailwind-indigo)

## 🚀 Why this exists

Managing hundreds of repositories on GitHub can be tedious. Whether you're cleaning up old forks, organizing your portfolio into organizations, or just trying to get a bird's-eye view of your code, the default GitHub UI often requires too many clicks.

**GitHub Repo Manager** solves this by giving you a powerful dashboard to:
*   **Bulk Edit**: Make 50 repos private in one click.
*   **Organize**: Transfer multiple projects to an organization instantly.
*   **Clean Up**: Archive or delete stale forks in batches.
*   **Analyze**: See stats and trends across all your organizations.

---

## ✨ Key Features

### 🛡️ Core Management
*   **Bulk Visibility Control**: Toggle privacy settings for multiple repos at once.
*   **Mass Transfer**: Move repositories between accounts and organizations seamlessly.
*   **Smart Archiving**: Quickly identify and archive unused projects.
*   **Mirroring**: Create backups/forks of repositories into other organizations.

### 📊 Insights & Dashboard
*   **Global Overview**: View total stars, forks, and activity across all your accounts.
*   **Organization Filter**: Drill down into specific organizations to see what's happening.
*   **Language Breakdown**: See your most used languages visually.

### 💎 Premium Experience (New!)
*   **Glassmorphism UI**: A stunning, modern interface with frosted glass effects and smooth animations.
*   **Interactive Dashboard**: Visualized data with beautiful charts and real-time organization filtering.
*   **Enhanced Navigation**: A redesigned sidebar for effortless switching between organizations and repositories.

### 🤖 AI-Powered Assistance
*   **Smart Suggestions**: Get AI-driven tips on how to improve your repository metadata.
*   **Auto-README**: Generate professional READMEs for your projects in seconds.
*   **Natural Language Search**: Find "my private react apps" just by typing it.

---

## 🛠️ Quick Start

### Prerequisites
*   Node.js 18+
*   A GitHub Account

### Installation

1.  **Clone the repository**
    ```bash
    git clone https://github.com/your-username/github-repo-manager.git
    cd github-repo-manager
    ```

2.  **Install dependencies**
    ```bash
    npm install
    ```

3.  **Start in Demo Mode** (No setup required)
    ```bash
    npm run dev
    ```
    The app will open at `http://localhost:5173` with mock data so you can explore the UI.

---

## ⚡ Production Setup (Real GitHub Data)

To manage your actual repositories, you'll need to connect the app to GitHub.

### 1. Create a GitHub OAuth App
1.  Go to [GitHub Developer Settings](https://github.com/settings/developers).
2.  Click **New OAuth App**.
3.  **Homepage URL**: `http://localhost:5173`
4.  **Callback URL**: `http://localhost:3001/api/auth/callback`
5.  Copy your **Client ID** and **Client Secret**.

### 2. Configure Environment
Create a `.env` file in the root directory:

```env
# Server Configuration
PORT=3001
FRONTEND_URL=http://localhost:5173

# GitHub OAuth (Required)
GITHUB_CLIENT_ID=your_client_id_here
GITHUB_CLIENT_SECRET=your_client_secret_here

# Security
SESSION_SECRET=your_random_secret_string

# AI Features (Optional - for Gemini integration)
GEMINI_API_KEY=your_gemini_api_key

# Frontend Config
VITE_MOCK_MODE=false
```

### 3. Run the App
Start both the backend server and frontend client:

```bash
npm run dev:all
```

Login with your GitHub account and start managing!
1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-username/github-repo-manager.git
   cd github-repo-manager
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Configure Environment:**
   Create a `.env` file in the root directory:
   ```env
   VITE_GITHUB_CLIENT_ID=your_github_client_id
   VITE_API_URL=http://localhost:3000
   GEMINI_API_KEY=your_gemini_api_key
   ```

4. **Run Development Server:**
   ```bash
   npm run dev:all
   ```
   This command starts both the React frontend (port 5173) and the Express backend (port 3000).

## 📸 Screenshots

*(Add your screenshots here)*

| Dashboard | AI Chat |
|:---:|:---:|
| ![Dashboard Placeholder](docs/dashboard.png) | ![AI Chat Placeholder](docs/ai-chat.png) |

## 🤝 Contributing

We welcome contributions! Please check out [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## 📄 License

MIT License.

---

*Built by Bruno Marques – Bola Labs, Inc.*
