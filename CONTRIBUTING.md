# Contributing to GitHub Repo Manager

Thank you for your interest in contributing to GitHub Repo Manager! This document covers everything you need to get started.

## Contributor License Agreement (CLA)

This project uses a dual-license model:

- **AGPL v3** for the open-source community
- **Commercial license** for organizations (see [LICENSE-COMMERCIAL.md](docs/LICENSE-COMMERCIAL.md))

Before your first contribution can be merged, you must sign our [CLA](CLA.md) by
commenting "I have read the CLA and I agree" on your pull request. This is a one-time
requirement.

The CLA grants Bola Labs the right to include your contributions in both the open-source
and commercially licensed versions. You retain full copyright over your work.

## Prerequisites

- **Node.js** 20 or later
- **npm** 10 or later
- A GitHub account with OAuth app credentials (see `.env.example`)

## Local Setup

```bash
# 1. Fork and clone the repository
git clone https://github.com/brunobola-portfolio/GitHub-Repo-Manager.git
cd GitHub-Repo-Manager

# 2. Install dependencies
npm install

# 3. Configure environment
cp .env.example .env
# Edit .env with your GitHub OAuth credentials and session secret

# 4. Start the development server (frontend + backend)
npm run dev:all
```

The frontend runs at `http://localhost:5173` and the backend at `http://localhost:3001` (proxied through Vite).

If a previous run left a stale process on `3001` or any of `5173–5180` (Vite cascades through them), use the cross-platform cleanup script:

```bash
npm run dev:kill   # kills anything listening on 3001 + 5173–5180
npm run dev:all    # then re-run
```

## Code Style

### Language and Framework

- **JSX only** — do not use TypeScript (`.tsx`, `.ts` files)
- **React 19** functional components and hooks
- **Tailwind CSS v4** utility classes — no global CSS element selectors
- **Framer Motion** for all animations
- **Express 5** for backend routes

### CSS Rules

- Use `ds-*` prefixed classes from `design-system.css` for opt-in design system features
- Never add global element selectors (e.g., `a { ... }`, `button { ... }`) — these break Tailwind
- Prefer Tailwind utility classes over inline styles

### JavaScript Conventions

- `const` over `let`; avoid `var`
- `async/await` for asynchronous operations
- Parameterized SQL queries only — never string interpolation
- Validate all user inputs on server endpoints with Zod schemas

## Testing

```bash
# Unit tests (Vitest + Testing Library)
npx vitest

# Unit tests with coverage report
npx vitest run --coverage

# E2E tests (Playwright)
npx playwright test

# Lint
npm run lint
```

Test files go in `tests/` (unit) or `e2e/` (Playwright) — never alongside source files in `src/`.

### Accessibility

Automated a11y checks run via `e2e/a11y-smoke.spec.js` using axe-core. Add `await checkA11y(page)` at the end of any new e2e journey that lands on a new view. Known violations are listed with TODO comments in `e2e/a11y-smoke.spec.js`; address them rather than extending the allowlist when possible.

## Git Hooks

A pre-commit hook runs [lint-staged](https://github.com/lint-staged/lint-staged) on staged JS/JSX files:

- `eslint --fix --max-warnings 0` on staged files in `src/`, `server/`, `tests/`, and `e2e/` — any warning or error on a touched file blocks the commit. Existing warnings in files you don't touch are unaffected.
- A `console.log(...)` / `debugger` guard on staged files in `src/` and `server/` (see `scripts/check-debug-statements.mjs`).

The hook is installed automatically by `npm install` via the `prepare` script ([Husky](https://typicode.github.io/husky/)). Bypass with `git commit --no-verify` for hotfixes only.

## Making Changes

1. **Fork** the repo and create a branch from `main`:

   ```bash
   git checkout -b feat/your-feature-name
   ```

2. **One feature per PR** — keep pull requests focused and reviewable.

3. **Write tests** for new behaviour. Check existing tests in `tests/` and `e2e/` for patterns.

4. **Run the full test suite** and lint before pushing:

   ```bash
   npm run lint && npx vitest run && npx playwright test
   ```

5. **Commit** using [Conventional Commits](https://www.conventionalcommits.org/):

   ```text
   feat(auth): add OAuth logout endpoint
   fix(dashboard): correct chart rendering on empty repos
   chore(deps): bump vite to 7.2.5
   ```

   | Type       | When to use                                        |
   | ---------- | -------------------------------------------------- |
   | `feat`     | New feature                                        |
   | `fix`      | Bug fix                                            |
   | `chore`    | Build, tooling, dependency updates                 |
   | `refactor` | Code change that is neither a fix nor a feature    |
   | `docs`     | Documentation only                                 |
   | `style`    | Formatting, missing semicolons — no logic change   |
   | `perf`     | Performance improvement                            |
   | `test`     | Adding or updating tests                           |

   - Subject line: 72 characters max, imperative mood ("add" not "added")
   - Reference issues in the body: `Closes #123`

6. **Open a pull request** against `main` and fill in the PR template.

## Architecture Overview

Before diving in, read the architecture docs:

- `docs/architecture/overview.md` — high-level system design
- `docs/architecture/backend.md` — Express server, SQLite, API routes
- `docs/architecture/teams.md` — team and permission model
- `docs/api/API.md` — full API reference

Key entry points:

| Path                      | Purpose                                        |
| ------------------------- | ---------------------------------------------- |
| `src/main.jsx`            | Frontend entry — loads CSS, mounts `App.jsx`   |
| `src/App.jsx`             | Root component, routing, context providers     |
| `src/hooks/useGitHub.js`  | Primary data-fetching hook                     |
| `server/index.js`         | Express server entry point                     |
| `server/db.js`            | SQLite database setup and migrations           |

## Reporting Bugs

Use the [bug report template](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/issues/new?template=bug_report.md) and include:

- Steps to reproduce
- Expected vs actual behaviour
- OS, Node version, browser

## Suggesting Features

Use the [feature request template](https://github.com/brunobola-portfolio/GitHub-Repo-Manager/issues/new?template=feature_request.md).

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating you agree to uphold it. Report unacceptable behaviour to [bruno@bolalabs.pt](mailto:bruno@bolalabs.pt).

## License

By contributing you agree that your contributions will be licensed under the
[AGPL v3 License](LICENSE) and the terms of the [CLA](CLA.md).
