# AGENTS.md

Agent instructions for GitHub Repo Manager — a React 19 + Vite 8 + Tailwind v4
frontend with an Express 5 + better-sqlite3 backend. Read this before making
changes; the README is for humans, this file is for you.

## Setup commands

- Install: `npm install` (rebuilds better-sqlite3 native module via postinstall;
  if it fails: `npm run fix:native`)
- Dev (frontend + backend): `npm run dev:all` — Vite on :5173 proxies `/api` to
  Express on :3001
- Backend only: `npm run dev:server` · Frontend only: `npm run dev`
- Kill stuck dev ports: `npm run dev:kill`
- Production build: `npm run build` (runs a CSS-class guard as prebuild)

## Testing instructions

- Unit tests: `npx vitest run <paths>` — run ONLY the files you touched while
  iterating; the full suite (`npx vitest run`, ~5900 tests) is for final
  verification, and CI always runs it.
- E2E: `npx playwright test` (Playwright, mock mode via `vite --mode test`).
  Do not run the full e2e suite casually; single spec files are fine.
  Warning: locally, Playwright reuses an existing dev server on :5173 — if a
  non-mock dev server is running, every spec fails at beforeEach.
- Test placement is enforced: unit tests live in `tests/` mirroring `src/`
  (e.g. `src/hooks/useTheme.jsx` → `tests/hooks/useTheme.test.jsx`); backend
  tests in `server/__tests__/`. NEVER next to source files.
- `.env.test` pins `VITE_MOCK_MODE=true` for unit tests. To exercise real-fetch
  branches: `vi.stubEnv('VITE_MOCK_MODE', 'false')` at file top, then load the
  module with a dynamic `await import(...)`.
- When partially mocking a module that other code imports widely (validators,
  auth middleware, ai-provider), use the importOriginal spread pattern —
  `vi.mock('<mod>', async (io) => ({ ...(await io()), <overrides> }))` — so new
  exports never break the suite at module load.
- Honesty gates that must stay green: `tests/pricing-feature-parity.test.js`
  (pricing surfaces ↔ feature flags, cell-for-cell vs README) and
  `tests/build/readme-honesty.test.js`. Never weaken them; update them WITH the
  change they gate.

## Code style

- `.jsx` files only — NO TypeScript anywhere. Vite resolves by explicit
  extension: an `App.jsx` import will not load an `App.tsx`.
- Tailwind utility classes; design-system classes are opt-in `ds-*` only
  (`src/design-system.css`). NEVER global CSS element selectors — they break
  Tailwind.
- Framer Motion via the shared vocabulary in `src/components/ui/motion.js`
  (DURATION/EASE/SPRING/TRANSITION) — never hardcode spring/easing values. No
  hover scale/translate on flat elements.
- Reuse canonical primitives before writing new UI: `SectionPanel`,
  `EmptyState`, `Badge`, `Tooltip`, `Spinner`, `PageHeader`, `Kbd`,
  `AIErrorState`, `QuotaExceededState`.
- Risk colors come from `src/utils/riskTokens.js` + `ds-risk-*` tokens: fills
  (500-level) are for graphics only; text uses the `--ds-risk-*-text` variants
  (they are WCAG AA on both themes — the fills are not, as text).
- Dark mode: `.dark` class on `<html>`; both themes are hard-gated for
  color-contrast in the axe e2e suite.
- Events: use `emitAppEvent`/`onAppEvent` with names registered in
  `APP_EVENTS` (`src/utils/appEvents.js`) — never `window.dispatchEvent`.
- Lint must be clean at zero warnings: `npm run lint`
  (`eslint . --max-warnings 0`); pre-commit hooks run eslint --fix plus
  debug-statement / static-mock-import / raw-z-index guards.

## Architecture map

- Entry: `src/main.jsx` → `index.css`, `design-system.css`, `App.jsx`
- Frontend: `src/components/` (RepoDetail tabs, PRReview, MigrationWizard,
  Dashboard, AI modals), `src/hooks/`, `src/contexts/` (ModalContext owns ALL
  modal state), `src/api/`
- Backend: `server/index.js` boots Express; routes in `server/routes/`,
  domain logic in `server/lib/`, AI features in `server/lib/ai-features/`
- Gating source of truth: `server/lib/feature-flags.js` (TIER_FEATURES) +
  `server/lib/usage-meter.js` (METRIC_TO_FEATURE) + `server/middleware/require-tier.js`
- Mock/demo layer: `src/__mocks__/` — dev-only, dynamic-imported behind
  `import.meta.env.DEV && VITE_MOCK_MODE === 'true'` (inline this guard at
  every callsite; never alias it, or Vite's dead-code elimination breaks)

## Security constraints

- Never commit `.env` files or credentials; `.dev/` is local-only workspace.
- SQLite only — parameterized queries always, never string interpolation.
  PostgreSQL is intentionally unsupported (rejected at boot).
- Every AI generation route MUST be metered: route through `guardedGenerate`
  (spend cap + cost recording + audit) or the documented manual
  `checkAISpendCap`/`recordAISpend` pair. Unmetered provider calls are a
  regression class with dedicated tests.
- Anything that writes to a user's repository goes preview-first through
  `commitOrOpenPR()` — never auto-commit, never invent a new write primitive.
  Server-side derive/validate file paths; never trust client-echoed paths.
- New `requireScope('ai')` routes must be added to `AI_GENERATION_ROUTE_PATHS`
  in `server/middleware/api-key-auth.js` (a parity gate enforces this).
- Session cookies: `httpOnly`, `sameSite: 'lax'`, `secure` in production.

## Working discipline

- Never write fake code: real, functional implementations only — no stubs,
  placeholder returns, or "TODO: implement later" comments unless the user
  explicitly asked for a scaffold.
- Comments explain WHY, never WHAT; no conversational narration ("Let's…",
  "Here we…"), no emojis in code. A comment earns its place only if removing
  it would cause a specific mistake.

## PR instructions

- Conventional Commits: `type(scope): description`, subject under 72 chars;
  types: feat, fix, chore, refactor, docs, style, perf, test.
- CI runs build, lint (zero warnings), the full unit suite, and Playwright e2e
  with hard a11y gates (axe: color-contrast is blocking on BOTH themes) — all
  must pass before merge.
- PRs touching `.github/workflows/` need the repository owner to merge (token
  scope limitation).
- Grounded honesty is a product value: generated content must never claim
  features/limits that don't exist; pricing/README claims are test-enforced.
