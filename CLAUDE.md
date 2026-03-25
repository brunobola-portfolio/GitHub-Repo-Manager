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

## Testing
- Unit tests go in `tests/` mirroring `src/` structure (e.g., `src/hooks/useTheme.jsx` → `tests/hooks/useTheme.test.jsx`)
- E2E tests go in `e2e/` (Playwright)
- Test setup file: `tests/setup.js`
- Run unit tests: `npx vitest`
- Run E2E tests: `npx playwright test`
- Backend tests go in `server/__tests__/` (e.g., `server/middleware/auth.js` → `server/__tests__/auth.test.js`)
- NEVER place test files alongside source files in `src/` or `server/`

## Documentation Structure
- `docs/index.md` — Documentation map (start here)
- `docs/specs/` — Design specs: `YYYY-MM-DD-feature-name.md` (what to build)
- `docs/plans/` — Implementation plans (how to build it, generated from approved specs)
- `docs/architecture/` — System architecture docs
- `docs/api/` — API reference
- `docs/reports/` — Validation and analysis reports
- `docs/images/` — Screenshots (`0X_description_hd.png`, Playwright MCP at 1920x1080)
- When creating specs or plans, ALWAYS use `docs/specs/` or `docs/plans/` — never create custom subdirectories

## Dev Files
- `.dev/claude/memory/` — Claude persistent memory for this project (committed)
- `.dev/claude/plans/` — Implementation plans generated during development (committed)
- `.claude/settings.json` — Claude Code project settings (committed)
- `.claude/settings.local.json` — Local overrides (gitignored)

## Workspace Organisation

### Folder `.dev/` (local working dirs are gitignored)

- **Screenshots/design refs**: ALWAYS in `.dev/screenshots/[page]/`
- **Technical documentation drafts**: ALWAYS in `.dev/docs/[topic]/`
- **Local plan copies**: ALWAYS in `.dev/plans/`
- **Validation checklists**: ALWAYS in `.dev/checklists/`

### File rules

- **Never** place loose files (PNG, PDF, MD) in the project root
- **Never** create temporary folders outside of `.dev/`
- Before creating any auxiliary file, check if a suitable folder exists in `.dev/`
- If a new category is needed, create a subfolder inside `.dev/`
