# AGENTS.md

Instructions for coding agents working on GitHub Repo Manager: a React 19 +
Vite 8 + Tailwind v4 frontend with an Express 5 + better-sqlite3 backend.
The README is for humans; this file is for you.

Scoped rules live next to the code. Read the one for the area you touch:
`src/AGENTS.md` (frontend, design system) and `server/AGENTS.md` (backend,
security, email, licensing).

<!-- Maintainers: keep each AGENTS.md under ~200 lines, concrete and
verifiable. A rule that only matters for one directory goes in that
directory's AGENTS.md. Facts here are checked by tests/build/ci-guards
(every `npm run X` must exist). -->

## Commands

- Install: `npm install` (postinstall rebuilds better-sqlite3; if it fails:
  `npm run fix:native`). Node: `>=22 <25`.
- Dev, both halves: `npm run dev:all` (Vite :5173 proxies `/api` to Express
  :3001). Backend only `npm run dev:server`, frontend only `npm run dev`.
  Stuck ports: `npm run dev:kill`.
- Mock mode (no GitHub account needed): `NODE_ENV=test VITE_MOCK_MODE=true
  node server/index.js` plus `npx vite --mode test`.
- Build: `npm run build` (prebuild runs a CSS-class guard).
- Lint: `npm run lint` (`eslint . --max-warnings 0`). Pre-commit hooks run
  eslint --fix plus debug-statement, static-mock-import and raw-z-index guards.

## Tests

- Unit: `npx vitest run <paths>`, only the files you touched while iterating.
  The full suite (~8,000 tests) is for final verification; CI always runs it.
- Read the `Errors` line, not just `Tests passed`: an unhandled rejection fails
  the run with every test green. `Failed Suites N` with 0 failed tests under
  `server/` is usually SQLite WAL contention between workers; re-run that file
  alone before debugging it.
- Placement is enforced: `tests/` mirrors `src/` (`src/hooks/useTheme.jsx` →
  `tests/hooks/useTheme.test.jsx`); backend tests in `server/__tests__/`.
  Never next to source files.
- `.env.test` pins `VITE_MOCK_MODE=true`. For real-fetch branches:
  `vi.stubEnv('VITE_MOCK_MODE', 'false')` at file top, then `await import()`.
- Partially mocking a widely imported module (validators, auth middleware,
  ai-provider): `vi.mock('<mod>', async (io) => ({ ...(await io()), ... }))`,
  so new exports never break the suite at load.
- E2E: `npx playwright test <spec>`, one spec at a time locally. Playwright
  reuses any server on :5173; a non-mock dev server makes every spec fail.
- Honesty gates, never weaken them, update them WITH the change:
  `tests/pricing-feature-parity.test.js`, `tests/build/readme-honesty.test.js`,
  `tests/build/docs-facts.test.js` (`docs/index.md` states the route count in
  two places).
- A green test is not proof. When you add a guard, break it on purpose and
  confirm the test reddens. Commit first, restore with
  `git checkout HEAD -- <file>`; never use a `git stash` round-trip for this.
- `Dockerfile`, `.dockerignore`, `.github/workflows/release.yml` and
  `scripts/package-windows.mjs` only run on tags. A change to any of them
  needs a static gate in `tests/build/` (see `dockerfile-context.test.js`).
- UI changes: drive the mock app at 1920x1080 and at 390px wide, both themes,
  before calling it done. Tests alone have missed every phone-layout defect.

## Architecture map

- Entry: `src/main.jsx` → `index.css`, `design-system.css`, `App.jsx`.
- Frontend: `src/components/`, `src/hooks/`, `src/contexts/` (ModalContext
  owns ALL modal state), `src/api/`.
- Backend: `server/index.js` boots Express; routes in `server/routes/`, domain
  logic in `server/lib/`, AI features in `server/lib/ai-features/`.
- Tier gating source of truth: `server/lib/feature-flags.js` (TIER_FEATURES),
  `server/lib/usage-meter.js` (METRIC_TO_FEATURE),
  `server/middleware/require-tier.js`.
- Mock/demo layer: `src/__mocks__/`, dev-only (rules in `src/AGENTS.md`).

## Product rules

- Grounded honesty: copy, docs and generated content never claim a feature,
  limit or price that the code does not implement. Pricing and README claims
  are test-enforced.
- BYOK is permanent: paid tiers sell higher caps, more API keys and support,
  never managed inference. No copy may imply AI credits are included, or offer
  your own key as a way around a quota.
- Names: the product is "GitHub Repo Manager" (short form "RepoManager"), the
  company is "BolaLabs". Rules in `docs/BRAND.md`.
- The holder is the registered brand **BolaLabs**: copyright lines, legal pages
  and footers never carry a personal name. Public contact is the BolaLabs
  support desk or `suporte@bolalabs.pt`; licence keys come from
  `licencas@bolalabs.pt`.
- A self-hosted install must never send its users to the upstream vendor
  (support, sales or email) unless its operator configured that.

## Code and workspace

- JavaScript only: `.jsx`/`.js`, no TypeScript anywhere.
- Real implementations only: no stubs, placeholder returns or "TODO later"
  unless a scaffold was asked for.
- Comments explain WHY, never WHAT; no narration, no emojis. A comment earns
  its place only if removing it would cause a specific mistake.
- Improve complex components in place; never add a replacement file beside
  the real one.
- Never commit `.env` files or credentials.
- `.dev/` is gitignored scratch (drafts, screenshots, agent output). Never put
  loose files in the repo root or create temp folders elsewhere.
- Docs: `docs/index.md` is the map. Specs in `docs/specs/`, plans in
  `docs/plans/` (`YYYY-MM-DD-name.md`), validation reports in `docs/reports/`,
  screenshots in `docs/images/` (`0X_description_hd.png`, 1920x1080). No other
  subdirectories.
- Reports for the owner: when the content is complex (an audit, a plan with
  decisions), write ONE self-contained HTML page (light and dark, no external
  assets) in `.dev/reports/`, or `docs/reports/` for a product report. Do not
  write the same content twice in two formats. Simple outcomes stay a short
  Markdown note or the chat reply.
- Ask the owner before launching more than one parallel sub-agent: say what
  each covers, the total count and the model, and recommend one option.
- Windows shell (Git Bash): `python3` hangs here, use node scripts. One heredoc
  per command; write scripts containing backslashes with a file, not a heredoc.

## Git and pull requests

- Conventional Commits, `type(scope): description`, subject under 72 chars.
  Types: feat, fix, chore, refactor, docs, style, perf, test.
- No AI or tool attribution anywhere: no `Co-Authored-By` trailers, no
  "Generated with …" lines, in commits, PR titles or PR bodies.
- New commit over amend. Never skip hooks (`--no-verify`).
- `git status --short` before staging; stage paths explicitly. Untracked build
  output (coverage/, dist/, .vite/) gets gitignored, never committed.
- Every user-visible PR adds bullets under `## [Unreleased]` in CHANGELOG.md;
  `npm run release` refuses an empty block.
- CI: build, lint, full unit suite, Playwright e2e with axe color-contrast
  blocking on both themes.
- Before any merge, read `gh pr checks <n>` for the LATEST run yourself. Branch
  protection does not block a merge with failing checks.
- PRs touching `.github/workflows/` are merged by the repository owner.

## Release and deploy

- `main` is not deployed. Only a tag ships: `npm run release -- <patch|minor>
  --title "…" --push`, then probe the live host
  (`https://repomanager.bolalabs.pt/api/health`) and check the CI workflow on
  `main`, not only Release.
- `package-lock.json` must be generated on Linux, or `npm ci` fails in CI:
  `docker run --rm -v "$PWD":/app -w /app node:22 bash -c "npm install
  --no-audit --no-fund --package-lock-only && npm ci --dry-run"`.
- Deploy runbooks: `deploy/iis/` and `docs/guides/`.
