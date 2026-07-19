# README + Docs Excellence — Design & Implementation Plan

**Date:** 2026-07-19 · **Status:** Approved (owner) · **Owner:** Bruno Silva Marques

Restructure the README into a lean, premium, WOW-factor landing page; move
version history to git (tags + CHANGELOG); rebuild diagrams as theme-aware
SVGs; and validate + interlink every doc with zero broken links and zero
vaporware. Grounded by a 5-specialist audit panel (2026-07-19).

## Goals

1. **Lean premium README** (~500 lines, down from 1026) that wins the first
   screenful, is scannable, and reads production-grade — without losing depth
   (progressive disclosure + docs links).
2. **Git as version source of truth** — remove the 66-line "Recently Shipped"
   duplication; a slim "What's new in v4.6.0" pointer to CHANGELOG + Releases.
3. **Zero vaporware** — every claim matches code; fix the confirmed slips.
4. **Premium theme-aware SVG diagrams** — rebuild the 3 stale/dark-only SVGs
   and add high-value new ones; all work on GitHub light *and* dark.
5. **Latest WOW imagery** — promote the unused v4.6 AI suite, replace the two
   weakest heroes, serve dark/light via `<picture>`, alt text everywhere.
6. **All docs validated + interlinked** — 0 broken links repo-wide (incl.
   historical), fix stale/contradictory docs, add a `docs:linkcheck` gate.

## Non-goals

- No repricing. The pricing matrix and feature-flags are unchanged.
- No product/code behaviour changes (one exception: aligning the README OAuth
  scope table to the code — a doc fix, not a scope change).
- No new screenshots requiring a live app capture in this pass (rely on the
  existing v4.6 suite + new SVGs); optional Playwright capture is a follow-up.

## Honesty-gate constraints (MUST preserve — CI-locked)

Two tests read `README.md`: `tests/pricing-feature-parity.test.js` and
`tests/build/readme-honesty.test.js`. The restructure is CI-safe **iff**:

- Keep the heading `## Plans & Pricing` **verbatim** (ampersand, single
  spaces) and keep **another `## ` heading after** the pricing table (the
  parser slices between them). Migration/Architecture will follow it.
- The pricing matrix stays a GFM pipe table with **Free as the first data
  column**. Header/`Pro`/`Enterprise` cells are not parsed — only Free.
- **19 row labels are frozen** (matched literally, em dashes `—` and backticks
  are load-bearing): Repositories managed · API keys · Semantic Search · Repo
  Insights / Quality Report · README Studio (AI improve) · AI Deep Review —
  walkthrough + comments + publish · AI Deep Review — Prompt Studio (custom
  presets, path rules, severity floor) · AI Deep Review — org-shared prompts ·
  AI Deep Review — PR slash commands (`/describe`, `/test_plan`, `/improve`) ·
  AI Deep Review — PR Chat (streaming Q&A) · AI Diagram Generator · Agent Rules
  Generator (AGENTS.md / CLAUDE.md) · Security Posture AI Summary · AI Image
  Generation (social / hero / logo) · Basic bulk on own repos · Advanced bulk
  (transfer, mirror, cross-org) · Azure DevOps Cloud migration · Mirror Sync
  (preview free, apply metered) · White-glove migration services.
- **Free-cell values frozen** (exact `toBe`): 1,000 · 25 · `10 / month` · ✓ ·
  `30 / month` · `100 messages / month` · ✓ · ✓ · `5 / month` · `10 / month` ·
  ✗. Substring (`toContain`): 375 · 75 · (10 **and** 30) · 15 · 20 · 75 · 5 ·
  25. Glyphs must be `✓` U+2713 / `✗` U+2717 (no emoji).
- **Decision:** copy the existing pricing table over **verbatim**. No edits.
- Keep a `## Roadmap` heading; never place `Full migration (Azure + GitLab)`
  outside it (honesty test). Don't advertise SSO/SAML/GitLab as shipped.

## Confirmed fixes (code-verified by the panel)

### README
- **BLOCKER** `README.md:203` "DORA Metrics **(Enterprise)**" → DORA is free on
  all tiers (`server/routes/work-board.js` auth-only; parity test). Drop
  "(Enterprise)".
- `README.md:32` header link `v4.5.0` → `v4.6.0` (`CHANGELOG.md#460---2026-07-19`).
- Remove "## Recently Shipped" (846–912); add slim "What's new in v4.6.0".
- Tests badge + Tech Stack "5,200+" → "6,000+" (real ≈ 6,006).
- OAuth table lists `user` scope not requested; code asks
  `repo delete_repo read:org admin:org` (`server/routes/auth.js:29`). Align table.
- Migration "8-step wizard" enumeration ≠ real step machine
  (`src/hooks/useMigrationWizard.js`). Rewrite to real Azure sequence, "8–10
  steps depending on options".
- BYOK drift: OpenRouter "30+ models" → "200+"; model IDs → `claude-opus-4-5`,
  `claude-sonnet-4-6`, `o3-mini`; reconcile req/day figures with
  `docs/ai-providers.md`.
- Node "18+" (Prereqs) vs "20+" (badges/stack/Dockerfile). Standardize on 20+.
- TOC: add "Plans & Pricing".

### Docs (fix stale / contradictory / honesty-violating)
- `docs/ARTICLE.md` — **rewrite for v4.6** (currently says MIT→AGPL, GitLab,
  SSO delivered, Vite 7, Gemini-only, 143 endpoints/109 tests).
- `docs/LICENSE-COMMERCIAL.md` — remove SSO/SAML + GitLab as delivered; fix
  quotas to feature-flags (Pro 10,000 AI / 50 keys; Ent 100 keys).
- `docs/work-board.md`, `docs/api/WORK-BOARD-API.md` — DORA + Stale/Review/Tech
  Debt are Free (2026-07-18 rebalance), not Pro/Enterprise.
- `docs/architecture/backend.md` — regenerate Tier table from
  `feature-flags.js`; drop "(or PostgreSQL)"; teams/migration mounted Free.
- `docs/architecture/overview.md` — remove "PostgreSQL supported" intro claim
  (SQLite-only); normalize route counts to "74 modules / 324 handlers"; soften
  Gemini-specific phrasing to provider-neutral.
- `docs/event-ingestion.md` — Work Board/DORA have shipped (not "Phase E2/E3
  not built yet"); add See-also links.
- `docs/setup/github-app.md` — webhook path → `/api/v1/webhooks/github`.
- `docs/index.md` — add v4.6.0 release entry; add the 2 orphans
  (`architecture/work-board-tracking.md`, `api/WORK-BOARD-API.md`).
- `docs/architecture/teams.md` — refresh date, cross-link, note free/unlimited.
- Interlinks: event-ingestion ↔ work-board ↔ github-webhook-setup;
  billing-and-licensing ↔ stripe-setup ↔ LICENSE-COMMERCIAL; ai-providers ↔
  ai-client-contracts. Fix feature-guide anchor slugs to `API.md`.

### Broken links (91, all historical) — fix repo-wide to 0
- Wrong relative depth in `docs/plans/*` and `docs/specs/*` (root-relative
  links that resolve under the doc's dir): prefix with correct `../` / `../../`
  or convert dead source-path refs to inline code.
- Remove `~/.claude/...` local-machine links (3).
- `product-honesty-wave-3.md` → missing `roadmap.md`: repoint to
  `../../ROADMAP.md`.
- `2026-06-26-codebase-audit-panel.md:360` `[...](...)` placeholder → plain text.
- Add `scripts/check-doc-links.mjs` + `npm run docs:linkcheck` (zero-dep
  relative-link + image checker over `docs/**` and root `*.md`).

## New README outline (~500 lines)

```
<div align=center> — # title · tagline · theme-aware hero <picture> ·
  5–6 curated badges (CI · Build · Tests 6,000+ · AGPL-3.0 · Release v4.6.0) ·
  one value line · "What's new in v4.6.0" · CTA row (Demo·Features·Install·Docs·Pricing)
Table of Contents (grouped; includes Plans & Pricing)
## Why GitHub Repo Manager?        (problem framing, 3 bullets)
## Quick Start (Demo Mode)         (≤3 commands, one path)
## Features                        (grouped; real v4.6 shots; <details> depth)
   Dashboard & Live Inbox · Repositories & Bulk · Cross-Repo Work Board ·
   AI-Powered Intelligence (Insights·Deep Review·Diagram·README Studio·Agent Rules·Image Gen) ·
   Command Palette · Mobile · Onboarding · Accessibility
## Screenshots                     (curated gallery, theme-aware, alt text)
## Plans & Pricing                 (pricing matrix VERBATIM — gate-safe)
## Azure DevOps Migration Suite    (theme-aware migration-flow SVG; the `## ` after pricing)
## Architecture                    (theme-aware architecture SVG + docs link)
## Configuration                   (essentials + <details> full env)
## Tech Stack                      (table)
## Documentation                   (trailhead → docs/index.md map)
## Troubleshooting                 (<details> accordions)
## FAQ                             (<details>)
## Roadmap                         (link ROADMAP.md; honest scoping)  [keep '## Roadmap']
## Contributing
## License                         (AGPL + commercial + §13)
## Acknowledgments / Contact
```

## SVG design system (theme-aware)

One shared visual language across all diagrams: `viewBox`-scaled, `Segoe UI,
system-ui` font, rounded cards, subtle shadows, a restrained blue/violet/emerald
accent set. **Theme-awareness via an embedded `<style>` block** using
`@media (prefers-color-scheme: dark)` so a single asset renders correctly on
GitHub light and dark. Backgrounds/text use CSS variables toggled by the media
query (no hardcoded `#0d1117`). Every node reflects **current reality**:
SQLite-only (no Redis/Postgres), **BYOK / AI_PROVIDER multi-provider** (never
"GEMINI AI").

**Set:**
1. `architecture.svg` — rebuild: SPA (Vite :5173) → `/api` proxy → Express
   :3001 → better-sqlite3 (WAL) + GitHub/Azure APIs + BYOK provider box
   (Anthropic·OpenAI·Gemini·OpenRouter·LMStudio) via `guardedGenerate`.
2. `ai-spend-cap.svg` (replaces `ai-flow.svg`) — request → BYOK resolve →
   `checkAISpendCap`/`guardedGenerate` → per-call output cap (OWASP LLM10) →
   `recordAISpend` + PII-safe audit → SSE stream (partial-on-disconnect).
3. `action-dispatch.svg` — rebuild theme-aware; rename node to "AI (BYOK)".
4. `migration-flow.svg` — Azure (Git/TFVC/Boards/Wikis) → 8–10-step wizard →
   risk engine + AI Review → dry-run → clone --bare/push --mirror + LFS →
   conflict resolution → provenance tagging.
5. `tier-gating.svg` — feature-flags (TIER_FEATURES) + usage-meter
   (METRIC_TO_FEATURE) + require-tier → per-feature Free caps → pricing.
6. `event-ingestion.svg` — webhook → HMAC verify → ingest/dedup → Work Board
   auto-track + gh-cache/gh-outbox → Dashboard Live Inbox.
7. `ai-deep-review.svg` — PR → Walkthrough/Comments/Commands/Chat → single
   batched GitHub review via outbox (idempotency key).

## Image plan

- **Promote** v4.6 AI suite into README: `44` (AI Overview 72/100 ring), `40`
  (Quality bars), `45` (Image Generator), `41` (README Studio), `43` (Diagram
  Generator), `46` (Agent Rules), `47` (Suggest routing).
- **Replace weak heroes**: retire `09_ai_assistant_dark` (empty Teams) from the
  AI hero; lead Migration with `migration-flow.svg` (+ keep `08` secondary).
- **Theme-aware heroes** via `<picture>` + `prefers-color-scheme`:
  `01_dashboard_dark/light`, `10/15` live-inbox, `33/36` work board.
- **Archive** the 51 orphaned files (stale dupes + QA/validation/dev artifacts)
  to `docs/images/archive/` (all unreferenced → safe). Archiving naturally
  resolves the reused `10/11/12` prefixes (the colliding orphans move out).
  Kept referenced filenames stay stable to avoid churn.
- Alt text on every informative image; `alt=""` on purely decorative.

## Verification

- `npx vitest run tests/pricing-feature-parity.test.js tests/build/readme-honesty.test.js` → green.
- `npm run docs:linkcheck` → 0 broken links.
- `npm run lint` → clean (0 warnings).
- Manual render check of README + SVGs on light and dark.
- Full CI on the PR (build, full unit suite, e2e a11y gates).

## Implementation waves

- **W1 (parallel):** historical broken-link sweep · ARTICLE.md rewrite · SVG
  set (single author for cohesion) · batch quality-doc fixes.
- **W2 (owner-driven):** README rewrite (gate-safe) · image archive + `<picture>`
  wiring · `docs:linkcheck` script · `index.md` map + interlinks.
- **W3:** integrate, run full verification, open PR.
