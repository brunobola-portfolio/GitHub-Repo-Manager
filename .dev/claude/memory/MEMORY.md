# GitHub Repo Manager - Project Memory

## Project Overview
- React 19 + Vite 7.2.4 + Tailwind CSS v4 application
- Uses `.jsx` files (NOT TypeScript)
- Dark mode via `.dark` class on `<html>` with `@custom-variant dark`
- Framer Motion for animations throughout
- Backend: Express + better-sqlite3 with GitHub OAuth (port 3001, proxied through Vite)
- 106 backend API endpoints, Azure DevOps integration, import/migration system

## Key Architecture
- Entry: `src/main.jsx` → imports `index.css`, `design-system.css`, then `App.jsx`
- Theme: `src/hooks/useTheme.jsx` (ThemeProvider wraps App)
- Components: `src/components/` (HeaderNew, RepoList, AIAssistant, Sidebar, Dashboard/*)
- Hooks: `src/hooks/useGitHub.js` (main data), `useRepoDetail.js` (repo detail API), `useKeyboardShortcuts.js`
- Contexts: `SelectionContext`, `ModalContext` (centralized modal state)
- RepoDetail: `src/components/RepoDetail/` (6 tabs: Overview, Branches, Releases, Issues, PRs, Settings)

## Backend Services
- `server/azure-service.js` - Azure DevOps API v7.1 (PAT auth, projects, repos, branches)
- `server/import-service.js` - Git import via simple-git (clone --bare + push --mirror, LFS)
- `server/db.js` - SQLite with `migration_jobs` table for tracking imports
- Webhook signature verification with `WEBHOOK_SECRET` (X-Hub-Signature-256)

## Design System Pattern
- `src/design-system.css` uses ONLY opt-in `ds-*` prefixed classes
- NO global element selectors - these BREAK Tailwind
- Key classes: `ds-card-shimmer`, `ds-hover-lift`, `ds-gradient-text`, `ds-btn-shimmer`, `ds-font-display`, `ds-font-mono`, `ds-glass`, `ds-animate-scale-in`

## Documentation Structure (reorganized 2026-03-12)
- `docs/index.md` — Documentation map
- `docs/specs/` — Design specs (YYYY-MM-DD-feature-name.md)
- `docs/plans/` — Implementation plans (from approved specs)
- `docs/architecture/` — overview.md, backend.md, teams.md
- `docs/api/API.md` — API reference
- `docs/reports/` — Validation reports
- `docs/images/` — Screenshots

## Project Structure (updated 2026-03-21)
- `tests/` — Unit tests (Vitest), mirrors `src/` structure
- `e2e/` — E2E tests (Playwright)
- `.dev/` — AI development files (memory, plans, brainstorm)
- `.claude/` — Claude Code settings (settings.json committed, settings.local.json gitignored)

## Critical Lessons
1. **NEVER create global CSS overrides when Tailwind is in use**
2. **NEVER create replacement files (App.tsx)** for existing complex apps - always enhance in-place
3. **Always read files before Write/Edit** - the tools enforce this
4. **Windows shell**: use `rm -f` not `del`
5. **Vite resolves imports by explicit extension** - `App.jsx` import won't load `App.tsx`
6. **GitHub Source Imports API retired April 2024** - must use simple-git server-side
7. **ModalContext** manages all modal state centrally - never hardcode `isOpen={false}`
8. **useGitHub return object** must include ALL destructured names from App.jsx
9. **Specs go in `docs/specs/`**, plans in `docs/plans/`** — never create custom subdirs like `docs/superpowers/`
10. **Unit tests go in `tests/`** mirroring `src/` — NEVER alongside source files in `src/`
11. **safe-area-left/right CSS classes** override Tailwind padding — don't use both on same element
