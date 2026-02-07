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

## Screenshots
- Store in `docs/images/` only (root PNGs are gitignored)
- Use Playwright MCP at 1920x1080 for HD captures
- Name format: `0X_description_hd.png`
