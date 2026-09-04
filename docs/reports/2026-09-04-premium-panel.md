# Premium-readiness panel — 2026-09-04

Eight review lenses walked v4.23.2 as strangers: UI consistency, UX
walkthrough, accessibility and responsive, frontend code, backend, performance,
copy and terminology, market positioning. Each produced a report with
file:line evidence (working copies under `.dev/panel-2026-09-04/`, not
committed). The coordinator triaged them, applied the fixes below on `main`,
and verified every claim against the running app before recording it here.

## What closed

**Copy and vocabulary.** Eighteen strings pointed at a "Settings → AI" tab the
product labels "AI Configuration". Six phrasings of session expiry across three
verbs. The Teams hub sold a Pro paywall that `feature-flags.js` does not
implement (teams are unlimited on every tier) while the pricing page said so.
The migration step and the PR feature both answered to "AI Review". Bulk
confirmations counted "3 repo(s)". "Workspace" named five different things.
All unified; the retention e-mail says "12 March 2027" instead of an ISO date;
the support contact is `VITE_SUPPORT_EMAIL` so a self-hoster's users reach
their own desk.

**First screen.** The landing page now states what the code proves: your AI
key on every plan, Apache-2.0, Docker/IIS/Windows, a review that publishes
nothing without you, and the TFVC + Azure DevOps Server migration GitHub's own
importer refuses. The access-management claim teams never implemented is gone.

**Performance.** The `vendor-diff` manual chunk had welded React's JSX runtime
into the diff viewer, so `index.html` preloaded 316 KB of diff viewer and 40
grammars on every cold load. Removing the group took the transitive eager
closure from 340.4 KB to 292.9 KB gzip; the bundle gate now walks static
imports transitively and asserts the diff viewer is absent. The route fallback
fills the viewport, so the legal footer no longer jumps when a view mounts:
first-load CLS 0.106 → 0.021, measured in the running app.

**Flows an evaluator tries first.** Pagination wrote a state updater into the
URL (`?page=(p) => p + 1`) and dropped the route hash, so a reload landed on
the dashboard. Plain-text search saw only the thirty repositories on screen and
answered "no repositories match your filters" for one on page two; the empty
state now names its scope and loads every page on request. `Modal` coupled
Escape to `closeOnBackdrop`, leaving sixteen dialogs (AI Insights, Community
Health, the keyboard-shortcuts help itself) deaf to Escape. A content modal
survived hash navigation and browser Back while holding the body scroll lock.
Community Health spun on skeletons forever after a failed fetch. Three repo
tabs rendered a "sign in again" banner with no sign-in and "please retry" with
no retry beside a `TabLoadError` that renders both. "Open PR #N in app" from
the Work Board no-oped silently when the PR was not in the loaded list. The
demo served the same README for every repository and announced a fake
v99.0.0 in About. A reviewer can now edit a draft AI comment from the comments
list, not only inline.

**Accessibility** (25 surfaces the twelve-view axe gate never opens). Repo and
team card titles turned brand-500 on hover, 3.51:1 in dark on the most-repeated
text in the product. The quick-actions FAB shipped a `role="menu"` with
role-less list items (eleven axe nodes, two critical rules) and a halo that
ignored `prefers-reduced-motion`. Prompt Studio's filter chips sat on the blue
ramp at 24 px tall; its "built-in" badge measured 3.33:1. The pricing table had
no caption, no column scope and `<td>` row headers. The Work Board dismiss
control was 22×22. Plus the 9 px "or Mirror" label, kbd glyphs short of AA,
rose destructive items below AA on their own hover fill, and white at 20% on a
brand fill.

**Design-system unification.** `MarksDetailModal` was a permanently dark slab
with its own backdrop, spring and a text close glyph; `SnoozeModal` had no
entrance and raw buttons. Both compose `Modal`. `SectionPanel`, the canonical
collapsible, gained the focus ring its own header lacked (inset, because the
section clips). `EmptyState` used the non-existent `text-md`. Two retired
palette colours had come back as `rgb()` triplets; the gate now checks
400/500/600 of every retired family in either syntax.

**Backend.** `POST /work-board/ai/interpret` was the only LLM route outside
`guardedGenerate` (no spend cap, no audit, and its own ledger write sat after
the parse gate). Client `limit`/`page` had no floor: SQLite reads a negative
LIMIT as no limit. The global `per_page` middleware never worked under Express
5 and is gone. Unmatched `/api/*` answers JSON in every environment. Six sites
put a machine slug in `error` and the human text in `message`; every client
renders `body.error`, so users read `AI_NOT_CONFIGURED`. `attachAIProvider`
resolves lazily instead of a DB read, a decrypt and a DNS lookup per request.
Timeouts on the providers' blocking path and the OAuth exchanges; jitter on the
three retry workers; a 5 MB limit on webhook raw parsers; prepared statements
reused in four per-item loops; an index on `deployment_events`; a strict schema
on `PATCH /orgs/:org`.

**Frontend hygiene.** Fourteen hand-rolled clipboard copies, eighteen raw
`setError(e.message)` sites, twelve browser-locale date sites and the ms
arithmetic now use the helpers that already existed. An interval leak in
`MyReviewsTab` (25 ms forever on an unmounted component) is fixed. Seven dead
files and the unreachable `AttentionFeed` branch are gone. The two
session-info pollers share one request.

## Verification

| Check | Result |
| ----- | ------ |
| `npm run lint` | clean, zero warnings |
| `npx vitest run` (full) | 746 files, 7 319 tests passed, 25 skipped |
| Playwright subset (a11y gate both themes, modals, dashboard, bulk, README, responsive, context menu, settings, Work Board, PR review, wizard, mobile nav, inbox) | 77 passed, 1 skipped |
| Playwright full suite (mock stack, backend on :3006) | 111 passed, 11 skipped, 0 failed |
| Production build, transitive eager closure | 292.9 KB gzip, entry 55.7 KB; no `vendor-diff` in `index.html` |
| First-load CLS on the demo | 0.021 (was 0.106) |
| Visual walk, 38 screenshots, desktop + mobile, light + dark | zero console errors or warnings; shortcuts dialog closes on Escape in all four |
| Mutation checks | Modal Escape default, pagination updater and hash, loadAllPages effect guard — each test reddens when its guard is removed |

Note on the walkthrough lens: its 401 findings in Settings tabs and repo tabs
came from a backend started with `NODE_ENV=test`, where the mock sign-in route
is disallowed. The rendering defects it exposed (no sign-in button, no retry)
were real and are fixed; the 401s themselves were an environment artefact.

## Still open

Decisions or larger sweeps, in the order the reports rank them.

1. **Commercial claims.** "Priority Support + SLA" on three surfaces with no
   SLA terms anywhere; the retention e-mail cites a data-retention policy and
   the pricing FAQ makes handling commitments, but `docs/` has no privacy
   policy, terms or retention policy and the footer links none. Either publish
   them or narrow the wording (`docs/LICENSE-COMMERCIAL.md:117` says
   "guarantees").
2. **Checkbox primitive.** Twenty of thirty native checkboxes render in the
   browser's blue: `@tailwindcss/forms` is not installed, so `text-*` on a
   checkbox is dead CSS. Add `ui/form/Checkbox.jsx` and migrate the thirty.
3. **Focus rings.** 227 of 329 styled raw `<button>`s never opt into
   `ds-focus-ring`; the app shows two focus indicators. Sweep, then gate.
4. **Contrast sweep.** 59 bare `text-slate-400` as body text with no `dark:`
   pair (2.56:1 in light), none in the axe-gated views. Plus the `red`/`rose`
   and `green`/`emerald` duplicate ramps (1 117 uses) the palette gate does
   not cover — extend `RETIRED` once migrated.
5. **Raw `fetch()`.** 166 sites bypass `fetchWithRetry` (73 mutations lose
   CSRF rotation-retry and the offline queue); 24 copies of the Azure POST
   block in the migration wizard want one `azurePost` helper. Migrate
   mutations first; gate afterwards.
6. **Keyboard parity.** No shortcut reaches the Work Board; `g` is spent on
   the Dev Toolkit instead of a navigation chord; `j/k` row navigation stops
   at the Work Board's edge. Four keyboard-help overlays each retype `<kbd>`.
7. **Contradictions on one screen.** The bell says "You're all caught up"
   beside "5 reviews waiting"; the user menu says "Organizations (0)" beside
   the dashboard's "3". Feed both from the counters' source.
8. **Premium patterns worth building next** (market lens, ranked): inline
   BYOK setup in onboarding with a key probe; saved views and URL sync on the
   repositories view; the audit log as a page with chain verification (it is
   the only flag Enterprise buys); an opt-in digest e-mail (Resend and the
   scheduler exist); palette drill-down instead of the three-repo cap; a
   migration report at the end of the wizard. Do not build PR stacking:
   GitHub shipped it natively in July.
9. **Dilution to remove** (product call): Pricing in the primary nav, the
   in-app roadmap of eighteen unshipped items, the AI promo strip, the
   eight-tile KPI grid on the dashboard, the third navigation rail.
10. **Gate coverage.** The axe suite never hovers, never runs at 375 px, and
    never opens the command palette with a query, Dev Toolkit, Prompt Studio
    or the shortcuts help — one hover pass, one mobile project and six
    `setup()` entries would have caught most of the accessibility findings.
11. **Packaging.** `shiki`, `@shikijs` and `@git-diff-view/shiki` ship zero
    bytes but cost ~27 MB installed; removing them needs the Linux-generated
    lockfile. Precompressing assets at build time saves a further 58 KB
    brotli per cold load.
12. **Environment.** Windows reserves ports 2906–3005 on the development
    machine (Hyper-V); the backend cannot bind :3001 there. The Vite proxy now
    follows `PORT`, but Playwright's `webServer` still expects :3001 — run it
    with `PORT=3006` and an override config, or free the range.
