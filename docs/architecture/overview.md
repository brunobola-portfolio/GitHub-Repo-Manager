# Architecture Overview

GitHub Repo Manager is a full-stack JavaScript application composed of a React + Vite frontend
and an Express backend that talks to the GitHub REST API.

## High-Level Design

- **Frontend**: React 19 single-page app built with Vite and Tailwind CSS 4.
- **Backend**: Express 5 server exposing a small REST API and handling GitHub OAuth.
- **Auth**: GitHub OAuth App with session-based storage of the access token.
- **Styling**: Tailwind with a global dark/light theme toggle using the `dark` class.

## Frontend

Entry point: `src/main.jsx`

- Renders `<App />` wrapped in a `ThemeProvider`.
- Mounts into `#root` and wires global styles from `src/index.css` and `src/design-system.css`.

Root component: `src/App.jsx`

- Wires together:
  - **Header** (`HeaderNew`) for navigation, auth controls, and theme toggle.
  - **Dashboard** for high-level stats.
  - **Sidebar** for actions and activity history.
  - **RepoList** for the main repository table.
  - **OrgPanel** and **OrgManagerModal** for organization management.
  - Modal components for creating, transferring, and importing repositories.
  - Toast system for success/error notifications.

State & data:

- `src/hooks/useGitHub.js`
  - Central hook for user, repos, orgs, org repos, stats, pagination, and bulk actions.
  - Uses `fetchWithRetry` and related helpers from `src/utils/api.js`.
  - Skips repo loading when no user is authenticated to avoid noisy 401s.
- `src/hooks/useTheme.jsx`
  - Manages light/dark mode using `document.documentElement.classList`.
  - Persists theme preference in `localStorage` and respects system settings.
- `src/hooks/useToast.js`
  - Provides a simple toast API (`toast.success`, `toast.error`) used across the UI.

## Backend

Entry point: `server/index.js`

- Loads configuration from environment variables (see `.env.example`).
- Configures CORS, JSON parsing, and `express-session`.
- Validates the presence of GitHub OAuth credentials at startup.
- Exposes endpoints for:
  - **Auth**: `/api/auth/login`, `/api/auth/callback`, `/api/auth/logout`, `/api/user`.
  - **Repositories**: listing, creating, visibility changes, transfer, mirror, archive, delete.
  - **Organizations**: list orgs, get org details, list org repos.
  - **Azure Import**: Git repo imports, TFVC-to-Git conversion, batch imports, migration stats.
  - **Migration Engine**: plan-based migrations with work items, wikis, and scheduling.
  - **Stats**: aggregate repository statistics.

## Configuration

- `src/config.js` centralizes frontend configuration:
  - `API_BASE_URL`, `AUTH_ENDPOINTS`, `API_ENDPOINTS`, pagination defaults, and mock mode flag.
- `.env.example` documents required backend environment variables:
  - `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `SESSION_SECRET`, `FRONTEND_URL`, `PORT`.

## Error Handling

- `src/utils/api.js` implements:
  - `ApiError` with typed error categories and user-facing messages.
  - `fetchWithRetry` with exponential backoff and jitter for transient errors.
  - Graceful JSON parsing via `safeParseJson`.
- UI surfaces friendly messages via the toast system and inline hints in the repo table.

## Theming

- Dark mode is driven by a `dark` class on `<html>`.
- `ThemeProvider` synchronizes the class with user preference and system theme.
- Components use Tailwind `dark:` variants to render appropriate backgrounds, borders, and text.

## Migration & Import

The application supports importing repositories from multiple sources:

- **Git URL**: Clone any public or private Git repository via URL.
- **Azure DevOps (Git)**: Import Git repos from Azure DevOps with PAT authentication.
- **Azure DevOps (TFVC)**: Automatically detects TFVC projects and converts them to Git via the Azure DevOps Import Request API (preserves up to 180 days of history). Falls back to ZIP snapshot if conversion fails.
- **GitHub**: Import between GitHub accounts/orgs.

Key services:

- `server/import-service.js` — Git clone + push pipeline using `simple-git`.
- `server/azure-service.js` — Azure DevOps REST API v7.1 (Git, TFVC, work items, wikis).
- `server/migration-engine.js` — Plan-based migration with task types: `repo`, `repo-tfvc`, `work-items`, `wiki`.
- `server/migration-planner.js` — AI-assisted (Gemini) or fallback risk analysis for migrations.

This document is a high-level guide; see inline comments and the README for more details.
