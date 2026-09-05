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

## Second pass (2026-09-05): the sweeps and the features

Seventeen Sonnet agents in three waves, each owning a disjoint file set, then
verified and committed by the coordinator (four ran into the session limit
near the end and were finished by hand).

**Primitives and sweeps.** A `Checkbox` primitive replaces thirty native
checkboxes (twenty rendered browser-blue). 180 styled raw buttons, links and
`role=button` elements carry `ds-focus-ring`; a gate refuses new ones without
a focus class. One colour per meaning: red→rose, green→emerald,
yellow/orange→amber across 118 files, twenty-two text sites moved off the 500
shade, 48 bare `text-slate-400` body-text sites gained their dark pair, and
the palette gate retires the four ramps. Motion literals (178 sites), the
uppercase eyebrow label (94 files, nine letter-spacings) and arbitrary
`text-[Npx]` sizes (37) read tokens now, each with a gate. Five hand-rolled
switches, two inline tab bars, three tooltip systems and 31 native `title=`
attributes on interactive controls are gone; four dialog shells share a
`CloseButton`; nineteen popovers share one surface recipe.

**Flows.** `g` then `d`/`r`/`w`/`t`/`p` reaches every primary view; `j`/`k`
and Enter work on the repository grid, list and Live Inbox; four keyboard
help overlays are one registry-driven dialog. The bell and the user menu read
the same data as the dashboard (the digest short-circuited to empty in demo
mode; `useOrgs` skipped its first fetch and never retried). Archive confirms
like Make Private. The onboarding step sets up the AI key inline with a
probe. The command palette drills into a repository for an uncapped action
list. The audit log is a page with server-fed filters and a chain-verify
action. Saved views and URL sync on the repositories view (which exposed and
fixed a `useUrlParams` bug that dropped the route hash). An opt-in daily or
weekly digest e-mail with signed one-click unsubscribe.

**Backend.** Validation envelopes converge on `VALIDATION_ERROR`; the
fourteen direct `process.env` reads move into the config schema with parity
gates against `.env.example` and the runbook; the tenant `ai` rate-limit
bucket covers the four LLM routes outside the barrel; CSRF bypass narrowed to
the OAuth paths; `azurePost` replaces 24 hand-rolled POST blocks and a
ratchet holds the raw `fetch()` count at 128; assets are precompressed at
build time (entry chunk 207 KB raw, 57.6 KB gz, 47.8 KB br).

**Copy.** "Please" leaves 39 instructional strings, 63 load failures read
"Couldn't load X.", system failures drop the first person, the five casing
conflicts resolve to sentence case, five empty states gain the action their
component already had, and the retention e-mail states what happens instead
of citing a policy that is not published.

**Verification, second pass.** Lint clean. Full unit suite: 774 files, 7 545
tests passed. Full Playwright suite including the widened axe gate (hover,
375 px project, overlays): see the line below. Visual walk of the new
surfaces: see the line below.

- Playwright, full suite incl. the widened axe gate (two projects, mock stack, backend on :3006): 134 passed, 59 skipped by design (each mobile/desktop body skips on the other project), 1 flake in bulk-actions under four workers that passes 7/7 alone.
- Visual walk (32 screenshots, desktop + mobile, light + dark): `g w`,
  `g r`, `g t` land on the right hash in all four; `j j` moves focus to the
  second repository card; the Presets control is on the repositories filter
  bar; the audit page renders its heading; the palette closes on Escape. One
  real defect surfaced and was fixed with a test: `parseApiError` threw an
  unhandled rejection on a 429 whose response carried no `Headers` instance.
  The 429s themselves were the demo's auth limiter tripped by the walk
  re-signing in on every navigation.

## Validation panel (2026-09-05)

Six Sonnet agents re-checked the two passes from the outside — visual walk,
functional flows, backend review, frontend code review, accessibility and
copy re-scan, documentation honesty — each with authority to fix its own
area. What they found and closed:

- **Backend.** `POST /migration/analyze` read `req.aiProvider` before
  anything populated it after the lazy-provider change, so AI risk analysis
  always took the deterministic fallback (regression test wires the real
  middleware). `GET /ai/metadata` gained the `repo_ids` filter an earlier
  commit message had claimed. A scan test keeps every `per_page` reader
  clamped.
- **Frontend review.** The shared session-info request handed both hooks
  the same `Response`; the second `.json()` threw "body stream already
  read" and the admin flag was lost on cold start. Callers get a clone now.
  The comments list re-seeds its edit draft from the current body.
  `plural()` gained tests. Ratchet counts verified against reality.
- **Visual walk.** ~24 views and overlays × 3 widths × 2 themes: no visual
  regression from the sweeps. It surfaced two console defects: the Actions
  list routes turned a GitHub 401 into a 500, and the demo's issues fixture
  had no ids, so the tab warned about keys. Both fixed.
- **Flows.** All ten changed flows pass in the running demo (chords, j/k,
  search-all-pages and URL round-trips, presets isolation, palette drill-in,
  onboarding key step, audit page gate, digest setting, header menus,
  confirmations and Escape, Work Board "open PR" toast).
- **Accessibility and copy.** The palette dropped focus to body on every
  close after the first (it mounts once behind an ever-opened gate); an
  opener ref restores it. The presets popover wrapped a text input in
  `role=menu`; it is a labelled group. The add-repo combobox's list is
  always mounted so `aria-controls` never dangles. AI-configuration step
  numbers at 70% opacity measured 2.6:1. Audit table headers carry
  `scope`; two labels and four load-failure strings corrected.
- **Docs.** README, API reference, architecture pages, operations runbook,
  Work Board and Live Inbox guides, BRAND and CHANGELOG describe what
  shipped; stale references to deleted components and the removed inbox
  flag are gone; all honesty gates green.

Final numbers after the panel: see the two lines below.

- Unit suite: 782 files, 7 569 tests passed, 29 skipped; the two reds in that run were a CHANGELOG code-span that exposed a banned URL to the licence gate (fixed) and a timing flake in useBlockingDialogPresence under full load (passes in isolation).
- Playwright, full suite, two projects, two workers alongside the unit run: 135 passed, 59 skipped by design, 0 failed.

## Third pass (2026-09-05): the owner's decisions

The open items went back to the owner with five answers: simplify or remove
the commercial claims; remove the in-product marketing the way a premium
product would; handle every remaining sweep; validate the UI as beautiful and
excellent; and use judgement on the refactors. Five Sonnet agents, then the
coordinator's validation.

**Commercial honesty.** Enterprise sells priority support (e-mail,
prioritised) and white-glove migration services — no SLA the product cannot
define, no "guarantees". `docs/privacy-and-data.md` states what a deployment
stores, what leaves it and to whom, retention, deletion and export, each fact
with the file that enforces it; the footer links it, and the roadmap.

**Less product-as-brochure.** Pricing left the primary navigation (user menu,
palette and `g p` still reach it). The dashboard promo strip is gone. The KPI
grid keeps the three tiles a professional acts on. The in-app roadmap page is
gone; `ROADMAP.md` is canonical. The repositories view lost its right rail
(duplicates of header and palette, an always-empty history); Recent Activity
became a dashboard section. The bulk-selection bar labels every action and is
the single bulk surface.

**Last sweeps.** `blue-*` (193 uses) resolved to brand or slate by meaning and
retired by the gate; 143 raw shadows read `ds-elevation-*` with a gate; the
repository action registry reads in sentence case. 88 more raw `fetch()`
calls go through `apiCall` (39 remain, each documented in the ratchet
header: the AI client contract, the bulk-confirmation protocol, SSE, health
probes, blob downloads); `/api` literals ratcheted from 159 to 66.

**Two features from the market lens.** A Markdown migration report from data
the wizard already stores, downloadable from the summary step and the
history; a Health tab beside DORA ranking tracked repositories by a persisted
community-health score with week-over-week delta (migration 37, captured by
the daily janitor).

**Verification after this pass.** Lint clean. Unit suite 782 files, 7 606
tests passed. Playwright full suite 136 passed, 59 skipped by design, 0
failed.

## Still open

1. **Packaging.** `shiki`, `@shikijs` and `@git-diff-view/shiki` ship zero
   bytes but cost ~27 MB installed. Removing them needs the lockfile
   regenerated on Linux (`docker run … node:22 npm install
   --package-lock-only`); Docker Desktop was not running on the development
   machine when this was attempted, so the change was reverted rather than
   shipped with a Windows-generated lockfile.
2. **Raw `fetch()`, the last 39.** Each is a documented exception in the
   ratchet header (AI client contract, bulk-confirmation protocol, SSE,
   health probes, blob downloads, one cross-origin call). The AI client
   (`src/api/ai.js`, 19 sites) is the one worth a dedicated migration.
3. **`/api` literals.** 66 remain outside `src/config.js` and `src/api/**`,
   ratcheted; they matter only for a split-origin deployment.
4. **Larger refactors.** Four data-loading layers coexist (FE-08); 159
   `eslint-disable` escapes on the hooks rules (FE-17). `App.jsx` is being
   split into hooks in the current pass.
5. **Not built, by choice.** A contribution heatmap (G11) is the most
   decorative item on the market list; PR stacking should not be built —
   GitHub ships it natively.
6. **Environment.** Windows reserves ports 2906–3005 on the development
   machine (Hyper-V); everything here runs with `PORT=3006`. Freeing the
   range (`net stop winnat`/`net start winnat`) is an operator decision.
