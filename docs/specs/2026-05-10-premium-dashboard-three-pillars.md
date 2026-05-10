# Premium Dashboard — Three Pillars

**Spec date:** 2026-05-10
**Status:** Draft (awaiting user review)
**Owner:** Bruno Silva Marques
**Target release:** v4.2 (rolling, one phase per minor)

## Why

The current dashboard tells the user "Estás em dia. Nada precisa de ti agora." while their actual GitHub has live PRs, issues, CI failures, and Dependabot alerts waiting. Root cause: [src/components/Dashboard/AttentionFeed.jsx](../../src/components/Dashboard/AttentionFeed.jsx) is fed exclusively by [server/lib/attention-feed.js](../../server/lib/attention-feed.js), which only knows four local-DB signals (`failed_migration`, `stale_pinned`, `abandoned`, `hot`). It never reads the live aggregators (`event-aggregations.js`, `notifications-digest.js`, `work-board /stale-prs`, `repos-security`) that already exist on the backend.

The result is a dashboard that under-delivers on its own promise. A code review of `server/lib/` and `server/routes/` confirmed that ~95 % of the data needed to make this dashboard demonstrably better than github.com is already aggregated server-side — it is simply not stitched into the dashboard surface.

This spec converts that gap into three signature widgets:

1. **Live Inbox** — replaces the empty "Attention feed" with a sectioned, actionable inbox.
2. **DORA Card** — surfaces the metrics already computed by `/work-board/dora`.
3. **Service Scorecards** — adds a Cortex/OpsLevel-style red/yellow/green ring to each work-board tile.

## Goals

- A user with N review-requested PRs, M assigned issues, and K ready-to-merge Dependabot PRs sees all of them, sectioned, on the dashboard within 1.2 s of page load (cached) or 4 s (cold).
- An Enterprise user sees a DORA card with current values, deltas vs the previous period, sparklines with benchmark bands, and a clear empty state when webhook ingestion has not been set up.
- A user opening the work board sees a 5-point scorecard ring on each repo tile, with a drawer that lists what is failing and offers Fix actions (gated by tier).
- The premium UI passes eight design rules (see "Visual contract" below) — no glassmorphism, no overshoot springs, four-color status palette.
- Zero new vendor dependencies. All data comes from existing aggregators or thin wrappers over them.
- Every premium component lazy-loads; bundle delta on initial dashboard payload < 30 KB gzipped.

## Non-goals

- PR Stack Visualizer (Graphite-style dependency tree). Deferred to a separate slice.
- Cross-repo bulk merge actions in the command palette. Deferred.
- Freeze-window calendar (Mergify-style). Deferred.
- New analytics dimensions. We surface `/dora` numbers as-is plus delta + classification.
- AI-generated dashboard summaries beyond the existing `/attention-narrative` endpoint.

## Architecture

### Backend

A new namespace `/api/v1/dashboard/*` consolidates the dashboard's data contract behind a single namespace. All endpoints live in [server/routes/dashboard.js](../../server/routes/dashboard.js) (new) and delegate to a new aggregator module [server/lib/dashboard-aggregator.js](../../server/lib/dashboard-aggregator.js).

| Endpoint | Tier | Purpose |
| --- | --- | --- |
| `GET /api/v1/dashboard/inbox?sections=...&include_archived=0` | Free | Fan-out aggregator → returns sectioned items |
| `POST /api/v1/dashboard/inbox/:item_id/archive` | Free | Persist archive state |
| `POST /api/v1/dashboard/inbox/:item_id/snooze` | Free | Body `{ until: ISO8601 }`. Persist snooze |
| `POST /api/v1/dashboard/inbox/:item_id/restore` | Free | Unarchive / unsnooze |
| `GET /api/v1/dashboard/dora-card?environment=production` | Enterprise | Current + previous period + classification + sparkline |
| `GET /api/v1/dashboard/scorecard?repos=a/b,c/d` | Free | Batch scoring of up to 50 repos per call |
| `POST /api/v1/dashboard/scorecard/:owner/:repo/fix/:check` | Pro | Triggers existing fix flow for the named check |

#### Aggregator composition

`dashboard-aggregator.js` exposes:

- `composeInbox(userId, { sections, includeArchived }) → { sections: [{ key, label, items: [...] }] }`
  - Reads from existing modules:
    - `event-aggregations.listMyPendingReviews(userId)` → section `needs_review`
    - `event-aggregations.listMyOpenIssues(userId)` → section `mentions` filtered to mention/assignee
    - **`event-aggregations.listMyOpenPRs({ authorLogin, limit })` (NEW — to be added in Phase 1)** → section `my_prs`. Mirrors `listMyPendingReviews` query shape but filters by author, not reviewer. Same pr_events table.
    - `work-board.listStalePRs(userId)` → section `stale_drafts`
    - `repos-security.listDependabotReadyToMerge(userId)` → section `dependabot_ready`
    - `gh-cache.readThrough()` for live CI status of items in `my_prs` → section `failing_ci` (subset)
  - Deduplicates by canonical GitHub URL (avoids double-counting "needs my review" + "mentions" for the same PR).
  - Filters out items where `dashboard_inbox_state.archived_at IS NOT NULL` unless `includeArchived=1`.
  - Filters out items where `dashboard_inbox_state.snoozed_until > now`.

- `scoreRepo(userId, owner, repo) → { score: 0–5, checks: [{ key, passed, fix_endpoint, fix_label }] }`
  - Five equally-weighted checks:
    1. `readme_present` — checks repo metadata via gh-cache
    2. `codeowners_present` — uses [server/lib/ai-features/community-health-fix.js](../../server/lib/ai-features/community-health-fix.js) detection
    3. `ci_workflow_present` — checks `.github/workflows/*.yml` via existing actions-community route
    4. `no_critical_alerts_open` — reads from [server/routes/v1/repos-security.js](../../server/routes/v1/repos-security.js)
    5. `default_branch_protected` — reads from [server/routes/repos/branches-releases.js](../../server/routes/repos/branches-releases.js)
  - Cached 1 h per repo in a new `dashboard_scorecard_cache` table.

- `composeDoraCard(userId, { environment }) → { current, previous, delta, classification, sparkline }`
  - Calls `deployFrequency`, `leadTimeForChanges`, `changeFailureRate`, `meanTimeToRecovery` from [server/lib/event-aggregations.js](../../server/lib/event-aggregations.js) (already extracted, already used by `/work-board/dora`).
  - For each metric, runs the helper twice: current 30-day window and previous 30-day window.
  - Classifies vs DORA standard thresholds (Elite / High / Medium / Low) — table embedded as a constant in the aggregator, not hard-coded into UI.
  - Joins `kpi_snapshots` for last 30 datapoints to render the sparkline.
  - When `requiresWebhook` is true, returns `empty: true` with a reason code so the UI can render the setup prompt.

#### New tables

```sql
CREATE TABLE IF NOT EXISTS dashboard_inbox_state (
    user_id INTEGER NOT NULL,
    item_id TEXT NOT NULL,
    archived_at TEXT,
    snoozed_until TEXT,
    PRIMARY KEY (user_id, item_id)
);

CREATE TABLE IF NOT EXISTS dashboard_scorecard_cache (
    user_id INTEGER NOT NULL,
    repo_full_name TEXT NOT NULL,
    score INTEGER NOT NULL,
    checks_json TEXT NOT NULL,
    computed_at TEXT NOT NULL,
    PRIMARY KEY (user_id, repo_full_name)
);
```

`item_id` is the canonical aggregator-stable key (e.g., `pr:owner/repo#123`), not a GitHub numeric ID. Snooze beyond `snoozed_until` is treated as "active again" — the row is kept so the user's history of snoozes is auditable.

### Frontend

New components under `src/components/Dashboard/Premium/`:

| Component | Responsibility |
| --- | --- |
| `InboxPanel.jsx` | Sectioned list with sidebar of saved sections. Archive/snooze keyboard shortcuts (`e` / `s` / `↵`). Top 3 items get AI narrative when AI configured |
| `InboxRow.jsx` | One row. Avatar, title, repo path mono, status chips, timestamp, chevron. Expands in place with chevron rotating 90° |
| `InboxSection.jsx` | Sidebar entry: label + count badge. Active = full bright; idle = 70 % opacity |
| `DoraCard.jsx` | 4-column tile: lead time, deploy freq, CFR, MTTR. Each column = label + big number tabular-nums + delta arrow + sparkline with benchmark band |
| `DoraEmptyState.jsx` | Renders when `empty: true` — single sentence + setup link |
| `DoraLockedState.jsx` | Renders for Free/Pro users — premium upsell with screenshot teaser |
| `ScorecardRing.jsx` | SVG progress ring (5 segments) overlaid on existing repo tile icon. Color: green ≥ 4/5, amber 2–3/5, red ≤ 1/5 |
| `ScorecardDrawer.jsx` | Right-side drawer (uses existing Modal primitive at z-modal) listing checks + Fix buttons. Fix gated by tier |

The existing [src/components/Dashboard/AttentionFeed.jsx](../../src/components/Dashboard/AttentionFeed.jsx) is **not deleted**. It moves to a 1-column "Repo Health" panel on the right side of the dashboard hero, retaining its four local-DB signals which remain valuable for repo hygiene (failed migrations, stale-pinned, abandoned, hot).

### Wiring into existing surfaces

[src/components/Dashboard/DashboardPremium.jsx](../../src/components/Dashboard/DashboardPremium.jsx) is the integration point. New layout (md and above):

- Row 1 (full width): Hero strip — greeting, org chip, range chip (unchanged)
- Row 2 (full width): `<DoraCard />` (gradient-ring premium card, the only one with the gradient ring)
- Row 3 (2 cols / 1 col): `<InboxPanel />` (2 cols) + `<AttentionFeed />` rebranded as Repo Health (1 col)
- Row 4 (full width): existing work-board grid, with `<ScorecardRing />` overlaid on each tile

Below `md` breakpoint:

- DORA card stacks its 4 columns to 2 × 2.
- InboxPanel sidebar collapses to a `<select>` dropdown above the list.
- Scorecard rings shrink to 24 px and become tap-to-expand drawer triggers.

### Visual contract — the eight design rules

Every premium component must satisfy all eight. A visual-regression Playwright snapshot test enforces them per phase.

1. **Tabular numerics** — every metric rendered with `font-variant-numeric: tabular-nums` and `ds-font-mono` for SHAs, counts, durations.
2. **Gradient ring 1 px, only on the DORA card** — `--ds-gradient-premium` is reserved for that one card. All other cards use solid `border-zinc-800/60`.
3. **Sidebar recedes** — InboxSection items are 70 % opacity except the active one (full bright). Linear pattern.
4. **Status uses exactly four hues** — green-500, amber-500, red-500, zinc-400. The brand gradient is never status. Glow shadow is reserved for transient states (success toast, error toast) — never for hover affordance.
5. **Buttons keep their label during loading** — append a 14 px spinner; never replace text with "Loading…". Vercel rule.
6. **Row expands in place, not into a modal** — `cubic-bezier(0.32, 0.72, 0, 1)` over 280 ms. Modals reserved for destructive actions.
7. **Empty state is one line plus one button** — no full-page illustrations. Skeleton mirrors final layout to prevent CLS.
8. **Cmd+K pins recents** — top three rows of the palette are most-recently-touched repos before query results; right-aligned `⌘N` shortcut hint per row.

New design tokens added to [src/design-system.css](../../src/design-system.css):

```css
:root {
  --ds-status-success: #22c55e;
  --ds-status-warning: #f59e0b;
  --ds-status-danger:  #ef4444;
  --ds-status-neutral: #94a3b8;

  --ds-ease-row-expand:    cubic-bezier(0.32, 0.72, 0, 1);
  --ds-duration-row-expand: 280ms;
}
```

Reduced-motion: a global `@media (prefers-reduced-motion: reduce)` block collapses all `--ds-duration-*` to `0.01s` and removes transforms — fall back to opacity-only fades. This is added once and applies across the design system, not per component.

## Data flow

### Inbox

1. `InboxPanel` mounts → `useEffect` fires `fetchInbox({ sections, includeArchived })`.
2. Backend `composeInbox` fans out to existing aggregators in parallel (`Promise.all`), each cached via `gh-cache.readThrough()` with 60 s SWR.
3. Dedup pass on canonical URL.
4. `dashboard_inbox_state` join filters archived/snoozed.
5. Top 3 items trigger `/api/ai/attention-narrative` calls, gated by `useAIQuotaState` (existing).
6. User archives → optimistic UI flip + `POST /archive`. On failure → toast error, revert.
7. User snoozes → modal asks until-when (1 h / tomorrow morning / next Mon / custom). `POST /snooze` with ISO timestamp.

### DORA card

1. `DoraCard` mounts → tier check via existing `useTier` hook.
2. If tier < Enterprise → render `<DoraLockedState />` and stop.
3. Otherwise → `fetchDoraCard()` → `/api/v1/dashboard/dora-card`.
4. Backend computes current + previous period + classification + sparkline server-side.
5. If `empty: true` → render `<DoraEmptyState />` with link to webhook setup.
6. Cache 1 h client-side via React Query (existing pattern in repo).

### Scorecard

1. Work-board tile enters viewport → `IntersectionObserver` triggers lazy `fetchScorecard(repos)` batched per 5 visible tiles (debounce 100 ms).
2. Backend reads cache; cache miss → runs five checks in parallel, persists.
3. Ring renders client-side from `score` + `checks`.
4. User clicks ring → drawer opens. Each failed check shows a Fix button.
5. Fix button — Free tier shows upgrade prompt; Pro tier triggers `POST /fix/:check`, which routes through `gh-outbox.enqueueAndExecute()` for resilience, and on success invalidates the cache row.

## Tier gating decision matrix

| Capability | Free | Pro | Enterprise |
| --- | --- | --- | --- |
| Inbox view + archive + snooze | yes | yes | yes |
| Scorecard ring (read) | yes | yes | yes |
| Scorecard Fix actions | upsell | yes | yes |
| DORA card view | upsell | upsell | yes |
| AI narrative on inbox top 3 | gated by quota | gated by quota | gated by quota |

The existing JWT license-key check in [server/lib/license.js](../../server/lib/license.js) gates the endpoints; the frontend mirrors via `useTier`.

## Testing strategy

- **Unit (vitest)** — `tests/lib/dashboard-aggregator.test.js` covering all six inbox sections, dedup, archive/snooze filter logic, scorecard scoring of each of the five checks, DORA classification at every threshold boundary.
- **Backend integration** — `server/__tests__/dashboard.test.js` covering the seven endpoints, tier enforcement, snooze TTL.
- **Frontend unit** — `tests/components/Dashboard/Premium/*.test.jsx` for each component, including reduced-motion fallback, empty state, locked state.
- **E2E (playwright)** — `e2e/dashboard-premium.spec.js`:
  - archive → row disappears → restore → reappears
  - snooze 1h → row disappears → travel time forward → reappears
  - DORA card empty state for fresh user
  - Scorecard drawer Fix button gated for Free user
- **Mobile e2e** — gated on `E2E_MOBILE=1` (existing pattern); 2x2 DORA stack, sidebar dropdown, scorecard tap-to-drawer.
- **Visual regression** — Playwright screenshot of full dashboard at 1920×1080 dark + light, 768 mobile, both with reduced-motion on/off. Snapshots committed under `e2e/__screenshots__/dashboard-premium/`.
- **Bundle budget** — existing budget gate (CI) extended with a per-route limit: dashboard chunk delta ≤ 30 KB gzipped.

## Rollout

Each phase ships behind localStorage flag `dashboard_premium_v2_<phase>` (default off). After internal QA, flipped on for all users in a follow-up release.

| Phase | Scope | Estimated effort |
| --- | --- | --- |
| Phase 1 | Inbox endpoints + UI + dedup + archive/snooze | 5–7 dev days |
| Phase 2 | DORA card endpoint wrapper + UI + classification + empty/locked states | 3–4 dev days |
| Phase 3 | Scorecard engine + ring + drawer + Fix wiring | 5–7 dev days |
| Phase 4 | Visual regression suite + reduced-motion audit + bundle-budget tightening | 2–3 dev days |

Total: roughly 3 weeks of focused work, shippable in 4 separate releases.

## Risks and mitigations

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Inbox dedup misses an edge case (review request + mention on same PR) | Medium | Dedup by canonical GitHub URL before sectioning; unit tests cover the overlap |
| DORA helpers may be inlined in `work-board.js` not extracted to `dora-metrics.js` | High | Confirmed during plan-writing; extract first if needed (one mechanical commit) |
| `gh-cache` cold start on a busy user can exceed 4 s budget | Medium | Aggregator returns partial results immediately, streams the rest via SSE in a follow-up if measured slow in dogfooding |
| Scorecard Fix actions hit GitHub rate limits during batch operations | Medium | All Fix actions go through `gh-outbox.enqueueAndExecute()`; UI shows pending-sync badge |
| DORA empty state is permanently empty for users without webhooks | High | First-class empty state with single setup link; not a half-broken card |
| Bundle budget violated by SVG-heavy scorecard ring | Low | Use a single shared SVG sprite, not per-tile inlines |

## Acceptance criteria

A user with three review-requested PRs sees all three in the Inbox under "Needs my review" within 1.2 s of cached page load.

A user with no webhook ingestion sees the DORA card render its empty state, with a single setup link, within the same render budget — never a half-broken card.

A repo with no CODEOWNERS file shows a 4/5 ring, and clicking it opens a drawer where the CODEOWNERS row has a Fix button (active for Pro+, upsell for Free).

`prefers-reduced-motion: reduce` users see no row-expand animation, no chevron rotation animation, no spring on the scorecard ring fill — only opacity transitions ≤ 0.01 s.

The premium dashboard chunk delta is ≤ 30 KB gzipped vs `main` at the time of merge.

All tests in `tests/lib/dashboard-aggregator.test.js`, `server/__tests__/dashboard.test.js`, `tests/components/Dashboard/Premium/`, and `e2e/dashboard-premium.spec.js` pass on CI.

## Open questions

1. Should `failing_ci` be a separate top-level inbox section, or a chip-filter on top of `my_prs`? Default in this draft: separate section, because failing CI is the highest-urgency signal and deserves its own count badge. If user feedback during dogfooding says it duplicates `my_prs`, fold it back as a filter chip.
2. Should the AttentionFeed Repo Health panel be collapsible or always visible? Default: collapsible, default collapsed when zero items, expanded when ≥ 1.
3. Should snooze defaults match Inbox/Slack conventions ("Tomorrow 9 am", "Next Monday")? Default: yes — those four presets plus a custom date picker.
