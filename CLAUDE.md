# CLAUDE.md - Project Rules

## Git Commits
- NEVER add `Co-Authored-By` lines to commit messages
- Follow Conventional Commits format: `type(scope): description`
- Types: `feat`, `fix`, `chore`, `refactor`, `docs`, `style`, `perf`, `test`
- Keep commit subject under 72 characters
- Use body for details when needed (separated by blank line)

## Code Style
- Use `.jsx` files only (NO TypeScript)
- Use Tailwind CSS utility classes (NO global CSS element selectors)
- Design system classes use `ds-*` prefix only (opt-in, never global overrides)
- Framer Motion for animations
- Always read files before editing

## Architecture
- Frontend: React 19 + Vite 7 + Tailwind CSS v4
- Backend: Express + better-sqlite3 (port 3001, proxied through Vite)
- Dark mode: `.dark` class on `<html>` with `@custom-variant dark`
- Entry: `src/main.jsx` -> `index.css`, `design-system.css`, `App.jsx`

## Security
- Never commit `.env` files or credentials
- Use parameterized SQL queries (never string interpolation)
- Validate all user inputs on server endpoints
- Session cookies: `httpOnly`, `sameSite: 'lax'`, `secure` in production

## Documentation Structure
- `docs/index.md` — Documentation map (start here)
- `docs/specs/` — Design specs: `YYYY-MM-DD-feature-name.md` (what to build)
- `docs/plans/` — Implementation plans (how to build it, generated from approved specs)
- `docs/architecture/` — System architecture docs
- `docs/api/` — API reference
- `docs/reports/` — Validation and analysis reports
- `docs/images/` — Screenshots (`0X_description_hd.png`, Playwright MCP at 1920x1080)
- When creating specs or plans, ALWAYS use `docs/specs/` or `docs/plans/` — never create custom subdirectories
